import { Check, ChevronDown, Download, LogIn, Play, RefreshCw, Square, TriangleAlert, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { podeEditar, podeVer } from "../../shared/permissoes";
import { type CompraDisputa, type ConfigItemRobo, FASES, ITEM_ROBO_PADRAO, type ItemDisputa, lerCompra, lerItemDisputa, SEGUNDOS_FINAIS } from "../../shared/robo";
import type { Usuario } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { avisar, Vazio } from "../components/Ui";
import { paraNumero } from "../formato";
import { link } from "../rota";
import { noAplicativo, type PainelRobo, ponte, temPonte } from "../robo/ponte";

// Página Disputas: o robô roda dentro do aplicativo (recebe os lances em tempo real e responde na hora).
// Aqui só mostramos o que ele vê, guardamos a configuração de cada item e registramos os lances.

const EM_DISPUTA = new Set(["LA", "AL", "LF", "DM", "DF"]);
const ENCERRADAS = new Set(["E", "FE", "JE", "HE", "AE", "AR", "AC", "PE", "PR", "JR", "D1", "D2", "JT", "B3"]);
const abaDoItem = (fase: string) => (EM_DISPUTA.has(fase) ? "disputa" : ENCERRADAS.has(fase) ? "encerrados" : "aguardando");

const moeda = (v: number | null, quatro: boolean) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: quatro ? 4 : 2, maximumFractionDigits: quatro ? 4 : 2 });

const relogio = (seg: number) => {
  const s = Math.max(0, Math.floor(seg));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

const textoNumero = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

interface CompraNaTela {
  compra: CompraDisputa;
  itens: ItemDisputa[];
  lida: boolean;
  emDisputa: boolean;
  erro: string;
}

export function Disputas({ usuario }: { usuario: Usuario }) {
  const pode = podeVer(usuario.permissoes, "orcamento") && podeEditar(usuario.permissoes, "licitacoes");
  const [ligada, setLigada] = useState(temPonte());
  const [antigo, setAntigo] = useState(false); // aplicativo sem o motor novo
  const [painel, setPainel] = useState<PainelRobo | null>(null);
  const [lidoEm, setLidoEm] = useState(Date.now());
  const [agora, setAgora] = useState(Date.now());
  const [aba, setAba] = useState<"pregao" | "dispensa">("dispensa");
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [abaItens, setAbaItens] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, ConfigItemRobo>>({});
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [entrando, setEntrando] = useState(false);
  const mexidas = useRef(new Set<string>());
  const configCarregada = useRef(new Set<string>());
  const lancesEnviados = useRef(new Set<number>());
  const configRef = useRef(config);
  configRef.current = config;

  // A ponte pode aparecer um pouco depois da página carregar.
  useEffect(() => {
    if (ligada) return;
    const t = setInterval(() => temPonte() && setLigada(true), 1000);
    return () => clearInterval(t);
  }, [ligada]);

  // Painel do robô: pergunta ao aplicativo (no próprio computador, sem ir ao Compras.gov.br) várias vezes por segundo.
  useEffect(() => {
    if (!ligada) return;
    let vivo = true;
    let erros = 0;
    const ler = async () => {
      try {
        const p = await ponte.painel();
        if (!vivo) return;
        erros = 0;
        setPainel(p);
        setLidoEm(Date.now());
      } catch (e) {
        if (/Pedido desconhecido|desconhecido/i.test(mensagemDeErro(e))) setAntigo(true);
        if (++erros > 3 && vivo) setPainel(null);
      }
    };
    ler();
    const t = setInterval(ler, 300);
    const r = setInterval(() => setAgora(Date.now()), 250);
    return () => {
      vivo = false;
      clearInterval(t);
      clearInterval(r);
    };
  }, [ligada]);

  const compras: CompraNaTela[] = useMemo(
    () =>
      (painel?.compras ?? [])
        .map((c) => {
          const compra = lerCompra({ chaveCompra: c.chave, ...c.info });
          return compra ? { compra, itens: c.itens.map(lerItemDisputa).filter((i) => i.numero > 0), lida: c.lida, emDisputa: c.emDisputa, erro: c.erro } : null;
        })
        .filter((x): x is CompraNaTela => !!x),
    [painel],
  );

  // Configuração dos itens: vem da plataforma (vale para a equipe) e vai para o robô do aplicativo.
  const chavesCompras = compras.map((c) => c.compra.chave).join(",");
  useEffect(() => {
    const faltam = chavesCompras.split(",").filter((k) => k && !configCarregada.current.has(k));
    if (!faltam.length) return;
    faltam.forEach((k) => configCarregada.current.add(k));
    api<{ itens: Record<string, ConfigItemRobo> }>(`/robo/itens?compras=${encodeURIComponent(faltam.join(","))}`)
      .then((r) => {
        setConfig((atual) => {
          const novo = { ...r.itens, ...atual };
          ponte.configurar(novo).catch(() => {});
          return novo;
        });
        setTextos((t) => {
          const novo = { ...t };
          for (const [k, c] of Object.entries(r.itens)) {
            novo[`${k}:minimo`] ??= textoNumero(c.minimo);
            novo[`${k}:desconto`] ??= textoNumero(c.desconto);
          }
          return novo;
        });
      })
      .catch((e) => {
        faltam.forEach((k) => configCarregada.current.delete(k));
        avisar(mensagemDeErro(e), "erro");
      });
  }, [chavesCompras]);

  // Lances que o robô deu: registra na plataforma e avisa o aplicativo que já registrou.
  useEffect(() => {
    const novos = (painel?.lances ?? []).filter((l) => !lancesEnviados.current.has(l.id));
    if (!novos.length) return;
    novos.forEach((l) => lancesEnviados.current.add(l.id));
    Promise.all(
      novos.map((l) => api("/robo/lances", { corpo: { compra: l.compra, item: l.item, valor: l.valor, ok: l.ok, mensagem: l.mensagem ?? "" } }).catch(() => {})),
    ).then(() => ponte.confirmar(novos.map((l) => l.id)).catch(() => {}));
  }, [painel?.lances]);

  // Como no Siga Pregão: compra com disputa acontecendo já aparece aberta.
  useEffect(() => {
    const abrir = compras.filter((c) => c.itens.some((i) => abaDoItem(i.fase) !== "encerrados") && !mexidas.current.has(c.compra.chave)).map((c) => c.compra.chave);
    if (abrir.some((k) => !abertas.has(k))) setAbertas((s) => new Set([...s, ...abrir]));
  }, [compras, abertas]);

  // Abre na aba (pregões ou dispensas) onde há disputa.
  const temDispensa = compras.some((c) => c.compra.modalidade === "dispensa");
  const temPregao = compras.some((c) => c.compra.modalidade !== "dispensa");
  useEffect(() => {
    if (aba === "dispensa" && !temDispensa && temPregao) setAba("pregao");
    if (aba === "pregao" && !temPregao && temDispensa) setAba("dispensa");
  }, [temDispensa, temPregao]); // eslint-disable-line react-hooks/exhaustive-deps

  // Salva a configuração de um item: no robô do aplicativo na hora, na plataforma um instante depois.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function mudarItem(k: string, novo: Partial<ConfigItemRobo>) {
    const item = { ...(configRef.current[k] ?? ITEM_ROBO_PADRAO), ...novo };
    const todos = { ...configRef.current, [k]: item };
    configRef.current = todos;
    setConfig(todos);
    ponte.configurar(todos).catch((e) => avisar(mensagemDeErro(e), "erro"));
    clearTimeout(timers.current.get(k));
    timers.current.set(
      k,
      setTimeout(() => api(`/robo/itens/${encodeURIComponent(k)}`, { metodo: "PUT", corpo: { item } }).catch((e) => avisar(mensagemDeErro(e), "erro")), 500),
    );
  }

  function alternarRobo(k: string, item: ItemDisputa) {
    const cfg = config[k] ?? ITEM_ROBO_PADRAO;
    if (!cfg.ligado && !(cfg.minimo && cfg.minimo > 0)) return avisar("Informe o lance mínimo antes de ligar o robô.", "erro");
    if (!cfg.ligado && item.nossoLance != null && cfg.minimo! > item.nossoLance) avisar("O lance mínimo está acima do seu lance atual: o robô não vai baixar.", "erro");
    mudarItem(k, { ligado: !cfg.ligado });
  }

  async function entrar(mostrar = false) {
    setEntrando(true);
    try {
      await ponte.entrar(mostrar);
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setTimeout(() => setEntrando(false), 1500);
    }
  }

  const visiveis = compras.filter((c) => (aba === "pregao" ? c.compra.modalidade !== "dispensa" : c.compra.modalidade === "dispensa"));
  // Em cima: compras com disputa acontecendo (ou ainda sendo verificadas). Embaixo, recolhidas: sem disputa agora.
  const ativas = visiveis.filter((c) => !c.lida || c.emDisputa);
  const semDisputa = visiveis.filter((c) => c.lida && !c.emDisputa);
  const ultimoLance = painel?.ultimoLance ?? null;

  const cartaoCompra = ({ compra: c, itens, lida, erro }: CompraNaTela) => {
    const aberta = abertas.has(c.chave);
    const robo = Object.entries(config).some(([k, v]) => v.ligado && k.startsWith(`${c.chave}:`));
    const emLances = itens.some((i) => EM_DISPUTA.has(i.fase));
    const abaAtual = abaItens[c.chave] ?? (emLances ? "disputa" : itens.some((i) => abaDoItem(i.fase) === "aguardando") ? "aguardando" : "disputa");
    const conta = (a: string) => itens.filter((i) => abaDoItem(i.fase) === a).length;
    const atraso = (agora - lidoEm) / 1000;
    return (
      <article key={c.chave} className={`compra-disputa ${aberta ? "aberta" : ""}`}>
        <button
          className="compra-disputa-topo"
          onClick={() => {
            mexidas.current.add(c.chave);
            setAbertas((s) => {
              const n = new Set(s);
              if (n.has(c.chave)) n.delete(c.chave);
              else n.add(c.chave);
              return n;
            });
          }}
          aria-expanded={aberta}
        >
          <span>
            <strong>
              {c.titulo}
              {c.uasg && ` | UASG ${c.uasg}`}
              {c.orgao && ` - ${c.orgao}`}
            </strong>
            <span className="chips-compra">
              {c.modoDisputa && <span className="chip">{c.modoDisputa}</span>}
              {!lida && <span className="chip">Verificando…</span>}
              {emLances && <span className="chip azul">Itens em fase de lances</span>}
              {robo && <span className="chip verde">Robô ligado</span>}
            </span>
          </span>
          <ChevronDown className="seta" />
        </button>

        {aberta && (
          <div className="compra-disputa-corpo">
            <div className="segmentado pequeno abas-itens-disputa">
              {[
                ["aguardando", "Aguardando disputa"],
                ["disputa", "Em disputa"],
                ["encerrados", "Encerrados"],
              ].map(([a, nome]) => (
                <button key={a} className={abaAtual === a ? "ativo" : ""} onClick={() => setAbaItens((s) => ({ ...s, [c.chave]: a }))}>
                  {nome} ({conta(a)})
                </button>
              ))}
            </div>
            {erro && <p className="alerta erro">{erro}</p>}
            {!lida && (
              <p className="texto-fraco carregando-linha">
                <RefreshCw className="girando" /> Lendo os itens…
              </p>
            )}
            {itens
              .filter((i) => abaDoItem(i.fase) === abaAtual)
              .map((i) => {
                const k = `${c.chave}:${i.numero}`;
                const cfg = config[k] ?? ITEM_ROBO_PADRAO;
                const restante = i.restanteSeg == null ? null : i.restanteSeg - atraso;
                const situacao = i.situacao === "G" ? "ganhando" : i.situacao === "E" ? "empatado" : i.situacao === "P" ? "perdendo" : "";
                const nosso = i.melhorLance != null && i.nossoLance != null && i.melhorLance >= i.nossoLance;
                const msg = painel?.mensagens[k];
                return (
                  <div key={k} className={`item-disputa ${situacao} ${cfg.ligado ? "robo-ligado" : ""}`}>
                    <div className="item-disputa-titulo">
                      <strong>
                        ITEM {i.numero}
                        {i.descricao && ` - ${i.descricao}`}
                      </strong>
                      {situacao && <span className={`selo-situacao ${situacao}`}>{situacao.toUpperCase()}</span>}
                    </div>
                    <div className="item-disputa-grade">
                      <label className="campo">
                        <span>lance mínimo (R$)</span>
                        <span className="entrada">
                          <input
                            inputMode="decimal"
                            value={textos[`${k}:minimo`] ?? textoNumero(cfg.minimo)}
                            onChange={(e) => {
                              setTextos((t) => ({ ...t, [`${k}:minimo`]: e.target.value }));
                              mudarItem(k, { minimo: paraNumero(e.target.value) });
                            }}
                            aria-label={`Lance mínimo do item ${i.numero}`}
                          />
                        </span>
                      </label>
                      <label className="campo">
                        <span>desconto (%)</span>
                        <span className="entrada">
                          <input
                            inputMode="decimal"
                            value={textos[`${k}:desconto`] ?? textoNumero(cfg.desconto)}
                            onChange={(e) => {
                              setTextos((t) => ({ ...t, [`${k}:desconto`]: e.target.value }));
                              const n = paraNumero(e.target.value);
                              if (n != null && n >= 0 && n <= 50) mudarItem(k, { desconto: n });
                            }}
                            aria-label={`Desconto do item ${i.numero}`}
                          />
                        </span>
                      </label>
                      <div className="valor-disputa">
                        <span>Melhor lance</span>
                        <strong className={nosso ? "texto-verde" : "texto-perigo"}>
                          {moeda(i.melhorLance, cfg.quatroCasas)} <em className={`selo-quem ${nosso ? "voce" : ""}`}>{nosso ? "VOCÊ" : "CONCORRENTE"}</em>
                        </strong>
                      </div>
                      <div className="valor-disputa">
                        <span>Meu lance</span>
                        <strong className={nosso ? "texto-verde" : "texto-perigo"}>{moeda(i.nossoLance, cfg.quatroCasas)}</strong>
                      </div>
                      <div className={`cronometro-disputa ${restante != null && restante <= SEGUNDOS_FINAIS ? "final" : ""}`}>
                        {i.fase === "AL" ? "aleatório" : restante != null ? relogio(restante) : "—"}
                      </div>
                      <button
                        className={`botao-robo ${cfg.ligado ? "ligado" : ""}`}
                        onClick={() => alternarRobo(k, i)}
                        aria-label={cfg.ligado ? `Parar o robô no item ${i.numero}` : `Ligar o robô no item ${i.numero}`}
                        title={cfg.ligado ? "Parar o robô" : "Ligar o robô"}
                      >
                        {cfg.ligado ? <Square /> : <Play />}
                      </button>
                    </div>
                    <div className="item-disputa-opcoes">
                      <label>
                        <input type="checkbox" checked={cfg.quatroCasas} onChange={(e) => mudarItem(k, { quatroCasas: e.target.checked })} /> Permitir lances com 4 casas decimais
                      </label>
                      <label>
                        <input type="checkbox" checked={cfg.naoAguardar} onChange={(e) => mudarItem(k, { naoAguardar: e.target.checked })} /> Não aguardar os segundos finais para
                        enviar lances
                      </label>
                    </div>
                    <div className="item-disputa-rodape">
                      <span className="texto-fraco pequeno">{FASES[i.fase] ?? i.fase}</span>
                      <span className={`mensagem-robo ${msg?.erro ? "erro" : ""}`}>{cfg.ligado ? (msg?.texto ?? "Robô ligado") : "Robô parado"}</span>
                    </div>
                  </div>
                );
              })}
            {lida && itens.filter((i) => abaDoItem(i.fase) === abaAtual).length === 0 && <p className="texto-fraco pequeno">Nenhum item aqui.</p>}
          </div>
        )}
      </article>
    );
  };

  if (!pode)
    return (
      <section className="cartao">
        <Vazio icone={<TriangleAlert />} titulo="Sem permissão">
          Para usar o robô de lances é preciso ver o orçamento e editar licitações.
        </Vazio>
      </section>
    );

  const fase = painel?.fase ?? "sem-login";
  const passo = (feito: boolean, atual: boolean, texto: string) => (
    <li className={feito ? "feito" : atual ? "atual" : ""}>
      <span className="marca-passo">{feito ? <Check /> : atual ? <RefreshCw className="girando" /> : null}</span>
      {texto}
    </li>
  );

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Disputas</h1>
          <p className="texto-suave">
            Robô de lances do Compras.gov.br: recebe cada lance na hora, espera os últimos {SEGUNDOS_FINAIS} segundos e cobre até o seu lance mínimo.
          </p>
        </div>
      </div>

      {!ligada && noAplicativo() ? (
        <section className="cartao disputas-aviso entrar">
          <RefreshCw className="girando" />
          <div>
            <h2>Ligando o robô de lances…</h2>
            <p className="texto-suave">
              Você já está no aplicativo Montzion (versão {window.montzionApp?.versao}). O robô liga sozinho em alguns segundos. Se esta mensagem continuar por mais de 1
              minuto, feche o Montzion e abra de novo pelo atalho.
            </p>
          </div>
        </section>
      ) : !ligada || antigo ? (
        <section className="cartao disputas-aviso entrar">
          <Download />
          <div>
            <h2>{antigo ? "Atualize o aplicativo Montzion" : "O robô funciona pelo aplicativo do Windows"}</h2>
            <p className="texto-suave">
              {antigo
                ? "Esta versão do aplicativo ainda usa o robô antigo. Baixe o instalador e abra: ele atualiza sozinho, sem perder nada."
                : "Abra a plataforma pelo aplicativo Montzion: é nele que o robô roda, recebe os lances em tempo real e responde na hora. Sua senha e seu certificado não passam pela plataforma."}
            </p>
            <a className="botao acento" {...link("/configuracoes/aplicativo")}>
              <Download /> Baixar o aplicativo
            </a>
          </div>
        </section>
      ) : fase === "sem-login" || fase === "aguardando-login" ? (
        <section className="cartao disputas-aviso entrar">
          <LogIn />
          <div>
            <h2>{fase === "aguardando-login" ? "Entre com a sua conta gov.br na janela que abriu" : "Entre na sua conta do Compras.gov.br"}</h2>
            <p className="texto-suave">
              Abre a janela de login do gov.br (certificado ou senha). Quando você entrar, ela fecha sozinha e as suas disputas aparecem aqui, só as que estão
              acontecendo.
            </p>
            <button className="botao acento" onClick={() => entrar(fase === "aguardando-login")} disabled={entrando}>
              <LogIn /> {fase === "aguardando-login" ? "Mostrar a janela de login" : "Entrar com gov.br"}
            </button>
          </div>
        </section>
      ) : fase === "entrando" || fase === "buscando" || (fase === "erro-lista" && !compras.length) ? (
        <section className="cartao disputas-aviso entrar">
          {fase === "erro-lista" ? <TriangleAlert /> : <RefreshCw className="girando" />}
          <div>
            <h2>{fase === "erro-lista" ? "Não consegui buscar as disputas" : "Entrando no Compras.gov.br…"}</h2>
            <ol className="passos-login">
              {passo(true, false, "Login no gov.br")}
              {passo(fase !== "entrando", fase === "entrando", "Entrando na sala de disputa")}
              {passo(false, fase === "buscando", "Buscando as disputas que estão acontecendo")}
            </ol>
            {painel?.aviso && <p className={fase === "erro-lista" ? "alerta erro" : "texto-suave"}>{painel.aviso}</p>}
            {(fase === "erro-lista" || /janela/i.test(painel?.aviso ?? "")) && (
              <div className="linha-acoes">
                {fase === "erro-lista" && (
                  <button className="botao acento" onClick={() => ponte.atualizar().catch((e) => avisar(mensagemDeErro(e), "erro"))}>
                    <RefreshCw /> Tentar de novo
                  </button>
                )}
                <button className="botao secundario" onClick={() => entrar(true)}>
                  Mostrar a janela do Compras.gov.br
                </button>
              </div>
            )}
          </div>
        </section>
      ) : (
        <>
          <div className="disputas-topo">
            <div className="segmentado pequeno">
              <button className={aba === "pregao" ? "ativo" : ""} onClick={() => setAba("pregao")}>
                Pregões eletrônicos
              </button>
              <button className={aba === "dispensa" ? "ativo" : ""} onClick={() => setAba("dispensa")}>
                Dispensas eletrônicas
              </button>
            </div>
            <span className={`chip ${painel?.tempoReal ? "verde" : "amarelo"}`} title={painel?.tempoReal ? "Recebendo cada lance na hora" : "Sem o canal em tempo real: consultando o Compras.gov.br"}>
              <Zap size={13} /> {painel?.tempoReal ? "Tempo real" : "Consultando"}
            </span>
            {ultimoLance && (
              <span className="texto-fraco pequeno" title="Tempo entre o lance do concorrente chegar e o nosso lance sair">
                último lance em {ultimoLance.reacaoMs} ms
              </span>
            )}
            <span className="texto-fraco pequeno">
              {new Date(agora).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (horário de Brasília)
            </span>
            <button className="botao-icone" onClick={() => ponte.atualizar().catch((e) => avisar(mensagemDeErro(e), "erro"))} aria-label="Atualizar disputas" title="Atualizar disputas">
              <RefreshCw />
            </button>
          </div>

          {fase === "erro-lista" && painel?.aviso && <p className="alerta erro">{painel.aviso}</p>}

          {ativas.length === 0 ? (
            <section className="cartao">
              <Vazio icone={<TriangleAlert />} titulo={`Nenhuma ${aba === "pregao" ? "disputa de pregão" : "dispensa"} acontecendo agora`}>
                Quando uma disputa sua começar no Compras.gov.br, ela aparece aqui sozinha.
                {(painel?.descartadas ?? 0) > 0 && ` ${painel!.descartadas} compra(s) já encerrada(s), revogada(s) ou deserta(s) ficaram de fora.`}
              </Vazio>
            </section>
          ) : (
            <div className="lista-disputas">{ativas.map(cartaoCompra)}</div>
          )}
          {semDisputa.length > 0 && (
            <details className="sem-disputa">
              <summary>
                <ChevronDown className="seta" /> Sem disputa agora ({semDisputa.length})
                <span className="texto-fraco pequeno"> · se a disputa começar, ela sobe sozinha</span>
              </summary>
              <div className="lista-disputas">{semDisputa.map(cartaoCompra)}</div>
            </details>
          )}
        </>
      )}
    </>
  );
}
