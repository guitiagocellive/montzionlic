import { Bot, FlaskConical, Info, PlugZap, Sparkles, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { calcularPreco } from "../../../shared/negocio";
import { podeEditar } from "../../../shared/permissoes";
import { CONFIG_ROBO_PADRAO, type ConfigItemRobo, type ConfigRobo, ITEM_ROBO_PADRAO, centavosAcima } from "../../../shared/robo";
import type { Cotacao, ItemLicitacao, Licitacao, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { avisar, Carregando, Interruptor, Vazio } from "../../components/Ui";
import { formatarMoeda, formatarNumero, paraNumero } from "../../formato";

const SimuladorRobo = lazy(() => import("./SimuladorRobo").then((m) => ({ default: m.SimuladorRobo })));

/** Custo (melhor cotação, com frete) e preços de referência de cada item, a partir do orçamento. */
export interface PrecosItem {
  custo: number | null; // por unidade, com frete
  empate: number | null; // custo + impostos (sem lucro): abaixo disso é prejuízo
  venda: number | null; // preço da proposta (com o lucro do orçamento)
}

export function precosDoItem(item: ItemLicitacao, cotacoes: Cotacao[], l: Licitacao, lucro = l.lucro_percentual): PrecosItem & { comLucro: number | null } {
  const opcoes = cotacoes
    .filter((c) => c.item_id === item.id && c.custo_unitario != null)
    .map((c) => calcularPreco({ custoUnitario: c.custo_unitario ?? 0, frete: c.frete ?? 0, quantidade: item.quantidade ?? 1, impostoPercentual: l.imposto_percentual, lucroPercentual: l.lucro_percentual }));
  if (!opcoes.length) return { custo: null, empate: null, venda: null, comLucro: null };
  const melhor = opcoes.reduce((a, b) => (b.precoVenda < a.precoVenda ? b : a));
  const custo = melhor.custoUnitarioComFrete;
  const divisor = 1 - (l.imposto_percentual || 0) / 100 - (lucro || 0) / 100;
  return { custo, empate: melhor.precoMinimo || null, venda: melhor.precoVenda || null, comLucro: divisor > 0 ? centavosAcima(custo / divisor) : null };
}

const textoNumero = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

export function AbaRobo({ licitacao, itens, cotacoes, usuario }: { licitacao: Licitacao; itens: ItemLicitacao[]; cotacoes: Cotacao[]; usuario: Usuario }) {
  const editar = podeEditar(usuario.permissoes, "licitacoes");
  const participando = useMemo(() => itens.filter((i) => i.participar), [itens]);
  const [config, setConfig] = useState<ConfigRobo | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [salvo, setSalvo] = useState<"" | "salvando" | "salvo">("");
  const [simulando, setSimulando] = useState(false);
  const carregado = useRef(false);

  const itemCfg = (id: number): ConfigItemRobo => config?.itens[id] ?? ITEM_ROBO_PADRAO;

  useEffect(() => {
    api<{ config: ConfigRobo }>(`/licitacoes/${licitacao.id}/robo`).then(
      (r) => {
        setConfig(r.config ?? CONFIG_ROBO_PADRAO);
        const t: Record<string, string> = {};
        for (const [id, c] of Object.entries(r.config.itens)) {
          t[`${id}:minimo`] = textoNumero(c.minimo);
          t[`${id}:reducao`] = textoNumero(c.reducao);
          t[`${id}:fechado`] = textoNumero(c.lanceFechado);
        }
        t.segundos = String(r.config.segundosFinais);
        t.lucro = textoNumero(r.config.lucroMinimo);
        setTextos(t);
      },
      (e) => avisar(mensagemDeErro(e), "erro"),
    );
  }, [licitacao.id]);

  // Salva sozinho um instante depois de cada mudança.
  useEffect(() => {
    if (!config || !editar) return;
    if (!carregado.current) {
      carregado.current = true;
      return;
    }
    setSalvo("salvando");
    const t = setTimeout(() => {
      api(`/licitacoes/${licitacao.id}/robo`, { metodo: "PUT", corpo: { config } }).then(
        () => setSalvo("salvo"),
        (e) => {
          setSalvo("");
          avisar(mensagemDeErro(e), "erro");
        },
      );
    }, 800);
    return () => clearTimeout(t);
  }, [config, licitacao.id, editar]);

  const precos = useMemo(() => new Map(participando.map((i) => [i.id, precosDoItem(i, cotacoes, licitacao, config?.lucroMinimo ?? 0)])), [participando, cotacoes, licitacao, config?.lucroMinimo]);

  if (!config) return <Carregando />;

  const mudarGeral = (novo: Partial<ConfigRobo>) => setConfig((c) => (c ? { ...c, ...novo } : c));
  const mudarItem = (id: number, novo: Partial<ConfigItemRobo>) =>
    setConfig((c) => (c ? { ...c, itens: { ...c.itens, [id]: { ...(c.itens[id] ?? ITEM_ROBO_PADRAO), ...novo } } } : c));
  const texto = (chave: string, padrao: string) => textos[chave] ?? padrao;
  const digitar = (chave: string, valor: string) => setTextos((t) => ({ ...t, [chave]: valor }));

  function preencherPeloOrcamento() {
    let n = 0;
    const novosTextos: Record<string, string> = {};
    setConfig((c) => {
      if (!c) return c;
      const itensCfg = { ...c.itens };
      for (const i of participando) {
        const p = precos.get(i.id);
        if (!p?.comLucro) continue;
        itensCfg[i.id] = { ...(itensCfg[i.id] ?? ITEM_ROBO_PADRAO), minimo: p.comLucro };
        novosTextos[`${i.id}:minimo`] = textoNumero(p.comLucro);
        n++;
      }
      return { ...c, itens: itensCfg };
    });
    setTextos((t) => ({ ...t, ...novosTextos }));
    avisar(n ? `Valor mínimo preenchido em ${n} item(ns) com lucro mínimo de ${formatarNumero(config!.lucroMinimo)}%.` : "Nenhum item tem cotação no orçamento ainda.", n ? "sucesso" : "erro");
  }

  const comMinimo = participando.filter((i) => itemCfg(i.id).ativo && itemCfg(i.id).minimo);
  const abaixoDoCusto = participando.filter((i) => {
    const m = itemCfg(i.id).minimo;
    const e = precos.get(i.id)?.empate;
    return itemCfg(i.id).ativo && m != null && e != null && m < e - 0.005;
  });

  if (!participando.length)
    return (
      <section className="cartao">
        <Vazio icone={<Bot />} titulo="Nenhum item marcado para participar">
          Marque na aba Itens de quais itens a empresa vai participar. O robô usa esses itens.
        </Vazio>
      </section>
    );

  return (
    <>
      <section className="cartao robo-geral">
        <div className="robo-topo">
          <h2>
            <Bot size={18} /> Robô de lances
          </h2>
          <span className="texto-fraco pequeno">{salvo === "salvando" ? "Salvando…" : salvo === "salvo" ? "Salvo" : ""}</span>
        </div>
        <p className="texto-suave pequeno" style={{ margin: 0 }}>
          O robô espera os <strong>segundos finais</strong> do cronômetro de cada item e só então dá o menor lance que coloca a empresa em 1º. Se não der
          para ser 1º sem passar do <strong>valor mínimo</strong>, ele dá o mínimo (melhor colocação possível) e para. Nunca vai abaixo do mínimo.
        </p>
        <div className="robo-opcoes">
          <label className="campo campo-curto">
            <span>Começar nos segundos finais</span>
            <span className="entrada com-sufixo">
              <input
                inputMode="numeric"
                value={texto("segundos", String(config.segundosFinais))}
                disabled={!editar}
                onChange={(e) => {
                  digitar("segundos", e.target.value);
                  const n = parseInt(e.target.value, 10);
                  if (n >= 3 && n <= 600) mudarGeral({ segundosFinais: n });
                }}
                aria-label="Segundos finais"
              />
              <em>segundos</em>
            </span>
          </label>
          <div className="robo-interruptor">
            <Interruptor ligado={config.naoAguardar} aoMudar={(v) => editar && mudarGeral({ naoAguardar: v })} rotulo="Não aguardar os segundos finais para enviar o lance" />
            <span className="texto-fraco pequeno">
              {config.naoAguardar
                ? "Ligado: dá o lance assim que perder o 1º lugar (gasta margem mais cedo)."
                : `Desligado: só dá lances nos últimos ${config.segundosFinais} segundos do cronômetro.`}
            </span>
          </div>
        </div>
      </section>

      <section className="cartao">
        <div className="robo-topo">
          <h2>Valor mínimo por item</h2>
          {editar && (
            <div className="linha-botoes">
              <label className="campo-lucro">
                <span className="texto-fraco pequeno">Lucro mínimo</span>
                <span className="entrada com-sufixo">
                  <input
                    inputMode="decimal"
                    value={texto("lucro", textoNumero(config.lucroMinimo))}
                    onChange={(e) => {
                      digitar("lucro", e.target.value);
                      const n = paraNumero(e.target.value);
                      if (n != null && n > -50 && n < 90) mudarGeral({ lucroMinimo: n });
                    }}
                    aria-label="Lucro mínimo"
                  />
                  <em>%</em>
                </span>
              </label>
              <button className="botao secundario pequeno" onClick={preencherPeloOrcamento}>
                <Sparkles /> Preencher pelo orçamento
              </button>
            </div>
          )}
        </div>
        <p className="texto-fraco pequeno" style={{ margin: "0 0 10px" }}>
          "Preencher pelo orçamento" calcula: custo com frete ÷ (1 − impostos − lucro mínimo). "Empate" é o preço sem lucro: abaixo dele é prejuízo.
        </p>
        {abaixoDoCusto.length > 0 && (
          <p className="alerta atencao robo-alerta">
            <TriangleAlert size={15} /> {abaixoDoCusto.length} item(ns) com valor mínimo abaixo do empate (custo + impostos): o robô pode vender com prejuízo.
          </p>
        )}
        <div className="tabela-rolavel">
          <table className="tabela-fin tabela-robo">
            <thead>
              <tr>
                <th>Robô</th>
                <th>Item</th>
                <th className="num">Custo</th>
                <th className="num">Empate</th>
                <th className="num">Proposta</th>
                <th>Valor mínimo (un.)</th>
                <th>Baixar a cada lance</th>
                <th>Lance fechado</th>
              </tr>
            </thead>
            <tbody>
              {participando.map((i) => {
                const c = itemCfg(i.id);
                const p = precos.get(i.id);
                const prejuizo = c.minimo != null && p?.empate != null && c.minimo < p.empate - 0.005;
                return (
                  <tr key={i.id} className={c.ativo ? "" : "apagada"}>
                    <td>
                      <input type="checkbox" checked={c.ativo} disabled={!editar} onChange={(e) => mudarItem(i.id, { ativo: e.target.checked })} aria-label={`Robô no item ${i.numero}`} />
                    </td>
                    <td>
                      <strong>{i.numero}</strong> {i.descricao}
                      <small>
                        {formatarNumero(i.quantidade)} {i.unidade ?? ""}
                        {i.valor_referencia ? ` · ref. ${formatarMoeda(i.valor_referencia)}` : ""}
                      </small>
                    </td>
                    <td className="num">{p?.custo != null ? formatarMoeda(p.custo) : "—"}</td>
                    <td className="num">{p?.empate != null ? formatarMoeda(p.empate) : "—"}</td>
                    <td className="num">{p?.venda != null ? formatarMoeda(p.venda) : "—"}</td>
                    <td>
                      <span className={`entrada com-prefixo ${prejuizo ? "perigo" : ""}`}>
                        <em>R$</em>
                        <input
                          inputMode="decimal"
                          value={texto(`${i.id}:minimo`, textoNumero(c.minimo))}
                          disabled={!editar}
                          placeholder={p?.comLucro ? textoNumero(p.comLucro) : "0,00"}
                          onChange={(e) => {
                            digitar(`${i.id}:minimo`, e.target.value);
                            mudarItem(i.id, { minimo: paraNumero(e.target.value) });
                          }}
                          aria-label={`Valor mínimo do item ${i.numero}`}
                        />
                      </span>
                      {prejuizo && <small className="texto-perigo">abaixo do empate</small>}
                    </td>
                    <td>
                      <span className="reducao-robo">
                        <span className="entrada">
                          <input
                            inputMode="decimal"
                            value={texto(`${i.id}:reducao`, textoNumero(c.reducao))}
                            disabled={!editar}
                            onChange={(e) => {
                              digitar(`${i.id}:reducao`, e.target.value);
                              const n = paraNumero(e.target.value);
                              if (n != null && n >= 0) mudarItem(i.id, { reducao: n });
                            }}
                            aria-label={`Redução do item ${i.numero}`}
                          />
                        </span>
                        <select value={c.reducaoTipo} disabled={!editar} onChange={(e) => mudarItem(i.id, { reducaoTipo: e.target.value as "valor" | "percentual" })} aria-label={`Tipo de redução do item ${i.numero}`}>
                          <option value="valor">R$</option>
                          <option value="percentual">%</option>
                        </select>
                      </span>
                    </td>
                    <td>
                      <span className="entrada com-prefixo">
                        <em>R$</em>
                        <input
                          inputMode="decimal"
                          value={texto(`${i.id}:fechado`, textoNumero(c.lanceFechado))}
                          disabled={!editar}
                          placeholder="= mínimo"
                          onChange={(e) => {
                            digitar(`${i.id}:fechado`, e.target.value);
                            mudarItem(i.id, { lanceFechado: paraNumero(e.target.value) });
                          }}
                          aria-label={`Lance fechado do item ${i.numero}`}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="texto-fraco pequeno" style={{ margin: "10px 0 0" }}>
          "Baixar a cada lance": quanto o robô tira do melhor lance para passar à frente (confira o intervalo mínimo exigido no edital). "Lance fechado": só no modo
          aberto e fechado; vazio = o valor mínimo.
        </p>
      </section>

      <section className="cartao robo-acoes">
        <div>
          <h2>
            <FlaskConical size={17} /> Testar no simulador
          </h2>
          <p className="texto-fraco pequeno" style={{ margin: "4px 0 0" }}>
            Uma sala de disputa de mentira, com concorrentes virtuais e as regras do pregão (prorrogação de 2 minutos, hora fixa ou aberto e fechado). O robô
            usa exatamente estas configurações.
          </p>
        </div>
        <button className="botao acento" onClick={() => setSimulando(true)} disabled={!comMinimo.length} title={comMinimo.length ? "" : "Preencha o valor mínimo de pelo menos um item"}>
          <FlaskConical /> Abrir o simulador
        </button>
      </section>

      <section className="cartao robo-acoes">
        <div>
          <h2>
            <PlugZap size={17} /> No Compras.gov.br
          </h2>
          <p className="texto-fraco pequeno" style={{ margin: "4px 0 0" }}>
            <Info size={13} /> Em preparação: o robô vai rodar pelo aplicativo do Windows, numa janela onde vocês mesmos entram no gov.br. Falta mapear a sala de disputa
            do Compras.gov.br numa sessão real (o robô só observa, sem dar lances).
          </p>
        </div>
      </section>

      {simulando && (
        <Suspense fallback={null}>
          <SimuladorRobo licitacao={licitacao} itens={participando} cotacoes={cotacoes} config={config} aoFechar={() => setSimulando(false)} />
        </Suspense>
      )}
    </>
  );
}
