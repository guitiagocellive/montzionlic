import { CalendarClock, ChevronDown, Layers, Loader2, MapPin, Save, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { lerAnexos } from "../../../shared/acompanhamento";
import { mensagemDeErro } from "../../api";
import { avisar } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import { ErroCompras } from "../../robo/ErroCompras";
import { BotaoAnexo, Declaracoes, type EnvioFeito } from "./CadastroProposta";
import {
  carregarCompra,
  type CompraCarregada,
  type DadosProposta,
  enderecoDoFornecedor,
  enviarProposta,
  FE,
  type ItemProposta,
  paraNumero,
  prazoEncerrado,
  problemaDaProposta,
  type PropostaDoItem,
  textoNumero,
  textoReferencia,
  textoValor,
  txt,
  valorSugerido,
} from "./comprasCadastro";
import { pedir } from "./ItemCompras";
import { itemEnviado, JanelaResultado } from "./ResultadoProposta";
import { carregarFicha, licitacaoDaCompra, type SugestaoItem, sugestoesDoQuadro } from "./sugestoesQuadro";

// Licitação na aba Cadastradas (proposta enviada, sessão ainda não aberta): a mesma estrutura da tela
// "Cadastrar propostas" do Compras.gov.br — prazo, endereço do fornecedor, termo/declarações e os itens (ou grupos
// com os itens dentro), cada um com quantidade, valor estimado, o seu valor, marca e modelo — com o visual do
// Montzion. Dá para alterar, cadastrar o que falta e excluir; cada envio pede confirmação.

const dataHora = (s: string) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
};

function faltam(s: string) {
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "";
  const h = (t - Date.now()) / 3_600_000;
  if (h <= 0) return "";
  if (h < 1) return `faltam ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `faltam ${Math.round(h)} h`;
  return `faltam ${Math.round(h / 24)} dias`;
}

const valorTexto = (it: ItemProposta, v: number | null | undefined) =>
  v == null ? "—" : it.desconto ? `${textoNumero(v)}%` : formatarMoeda(v);

export function PropostaCadastrada({ chave, nome, cnpj: cnpjDado }: { chave: string; nome: string; cnpj: string }) {
  const [estado, setEstado] = useState<{ carregando: boolean; erro: string }>({ carregando: true, erro: "" });
  const [dados, setDados] = useState<CompraCarregada | null>(null);
  const [vez, setVez] = useState(0);
  const recarregar = useCallback(() => setVez((v) => v + 1), []);

  useEffect(() => {
    let vivo = true;
    setEstado((e) => ({ ...e, carregando: true, erro: "" }));
    carregarCompra(chave).then(
      (d) => {
        if (!vivo) return;
        setDados(d);
        setEstado({ carregando: false, erro: "" });
      },
      (e) => vivo && setEstado({ carregando: false, erro: mensagemDeErro(e) }),
    );
    return () => {
      vivo = false;
    };
  }, [chave, vez]);

  if (estado.carregando && !dados)
    return (
      <div className="carregando-compra">
        <Loader2 className="girando" size={18} />
        <span>Abrindo a proposta no Compras.gov.br…</span>
      </div>
    );
  if (estado.erro && !dados) return <ErroCompras erro={estado.erro} aoTentar={recarregar} />;
  if (!dados) return null;
  return <Conteudo chave={chave} nome={nome} dados={dados} cnpj={cnpjDado || dados.cnpj} recarregar={recarregar} />;
}

function Conteudo({ chave, nome, dados, cnpj, recarregar }: { chave: string; nome: string; dados: CompraCarregada; cnpj: string; recarregar: () => void }) {
  const { compra, participacao, declaracoes } = dados;
  // O que foi salvo/excluído nesta janela (null = excluída): o Compras às vezes demora a devolver na releitura.
  const [mudadas, setMudadas] = useState<Map<number, PropostaDoItem | null>>(new Map());
  const itens = useMemo(() => dados.itens.map((i) => (mudadas.has(i.numero) ? { ...i, proposta: mudadas.get(i.numero) ?? null } : i)), [dados.itens, mudadas]);
  const [envio, setEnvio] = useState<EnvioFeito | null>(null);
  const [verTermo, setVerTermo] = useState(false);
  const [verMeEpp, setVerMeEpp] = useState(false);
  const [alterarDecl, setAlterarDecl] = useState(false);
  const [doQuadro, setDoQuadro] = useState<Map<number, SugestaoItem> | null>(null);
  useEffect(() => {
    let vivo = true;
    licitacaoDaCompra(chave)
      .then(async (id) => {
        if (!id) return;
        const { ficha, rascunho } = await carregarFicha(id);
        if (vivo) setDoQuadro(sugestoesDoQuadro(dados.itens, ficha, rascunho));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [chave, dados.itens]);

  const participando = participacao.isFornecedorParticipante === true;
  const encerrado = prazoEncerrado(compra);
  const liberado = participando && !encerrado;
  const fim = txt(compra.dataHoraFimPropostas);
  const endereco = enderecoDoFornecedor(participacao);
  const orgao = [txt(compra.numeroUasg) || chave.slice(0, 6).replace(/^0+/, ""), txt(compra.nomeUasg)].filter(Boolean).join(" - ");
  const simples = itens.filter((i) => !i.grupo);
  const comProposta = simples.filter((i) => i.proposta);
  const total = comProposta.reduce((s, i) => s + (i.desconto ? 0 : (i.proposta?.valor ?? 0) * (i.porValorTotal ? 1 : (i.proposta?.quantidade ?? i.quantidade ?? 0))), 0);
  // Abre o primeiro item sem proposta (ou o primeiro de todos); os grupos já vêm abertos.
  const [abertos, setAbertos] = useState<Set<number>>(() => {
    const primeiro = simples.find((i) => !i.proposta) ?? simples[0];
    return new Set([...(primeiro ? [primeiro.numero] : []), ...itens.filter((i) => i.grupo).map((i) => i.numero)]);
  });
  const alternar = (n: number) =>
    setAbertos((a) => {
      const b = new Set(a);
      if (b.has(n)) b.delete(n);
      else b.add(n);
      return b;
    });

  function enviado(it: ItemProposta, d: DadosProposta, alterada: boolean) {
    const proposta: PropostaDoItem = { valor: d.valor, quantidade: d.quantidade, marca: d.marca, modelo: d.modelo, pais: it.proposta?.pais ?? "BRA", margem: it.proposta?.margem ?? "0" };
    setMudadas((m) => new Map(m).set(it.numero, proposta));
    const todos = simples.map((i) => (i.numero === it.numero ? { ...i, proposta } : i));
    const faltamItens = todos.filter((i) => !i.proposta);
    if (!faltamItens.length) setEnvio({ resultado: { ok: true, alterada, itens: todos.map((i) => itemEnviado(i)) }, orgao, fim: fim ? dataHora(fim) : "" });
    else
      avisar(
        `Proposta do item ${it.numero} ${alterada ? "alterada" : "cadastrada"}. ${faltamItens.length === 1 ? `Falta o item ${faltamItens[0].numero}` : `Faltam ${faltamItens.length} itens`} para concluir.`,
        "sucesso",
      );
    recarregar();
  }
  const falhou = (it: ItemProposta, d: DadosProposta, alterada: boolean, mensagem: string, tentar: () => void) =>
    setEnvio({ resultado: { ok: false, alterada, item: itemEnviado(it, d), mensagem }, orgao, fim: fim ? dataHora(fim) : "", tentar });
  const excluido = (it: ItemProposta) => {
    setMudadas((m) => new Map(m).set(it.numero, null));
    recarregar();
  };

  const linha = (it: ItemProposta) => (
    <ItemComoCompras
      key={`${it.numero}-${doQuadro ? 1 : 0}`}
      chave={chave}
      cnpj={cnpj}
      item={it}
      sugestao={doQuadro?.get(it.numero) ?? null}
      liberado={liberado}
      aberto={abertos.has(it.numero)}
      aoAlternar={() => alternar(it.numero)}
      aoEnviado={enviado}
      aoFalhar={falhou}
      aoExcluido={excluido}
    />
  );

  return (
    <div className="cp-cadastro">
      <section className="cp-bloco cp-prazo">
        <CalendarClock size={16} />
        <span>
          Data limite de entrega de propostas: <strong>{fim ? dataHora(fim) : "—"}</strong>
        </span>
        {encerrado ? <span className="chip vermelho">Prazo encerrado</span> : fim && faltam(fim) && <span className="chip amarelo">{faltam(fim)}</span>}
      </section>

      {endereco && (
        <section className="cp-bloco">
          <h3>Endereço do fornecedor</h3>
          <div className="cp-endereco">
            <MapPin size={15} />
            {endereco.logradouro && (
              <span>
                Logradouro: <strong>{endereco.logradouro}</strong>
              </span>
            )}
            {endereco.municipio && (
              <span>
                Município: <strong>{endereco.municipio}</strong>
              </span>
            )}
            {endereco.uf && (
              <span>
                UF: <strong>{endereco.uf}</strong>
              </span>
            )}
          </div>
        </section>
      )}

      <section className="cp-bloco">
        <h3>Termo/declarações</h3>
        {alterarDecl ? (
          <Declaracoes
            chave={chave}
            participacao={participacao}
            textos={declaracoes}
            encerrado={encerrado}
            editando
            aoSalvar={() => {
              setAlterarDecl(false);
              recarregar();
            }}
          />
        ) : (
          <div className="cp-termo">
            <div className="cp-termo-linha">
              <input type="checkbox" checked={participando} readOnly disabled aria-label="Termo de Aceitação" />
              <span>
                <button className="botao-link sem-margem" onClick={() => setVerTermo((v) => !v)}>
                  Termo de Aceitação.
                </button>{" "}
                <strong>Declaro que cumpro e estou ciente de todas as declarações contidas no termo de aceitação.</strong>
              </span>
            </div>
            {verTermo && (
              <div className="cp-textos">
                {declaracoes.length ? declaracoes.map((t, i) => <p key={i}>{t}</p>) : <p className="texto-fraco">O Compras.gov.br não devolveu o texto do termo desta compra.</p>}
              </div>
            )}
            <button className="cp-sanfona" onClick={() => setVerMeEpp((v) => !v)} aria-expanded={verMeEpp}>
              <ChevronDown size={16} /> Declaração para fornecedores ME/EPP e equiparados
            </button>
            {verMeEpp && (
              <dl className="cp-declaracoes">
                <div>
                  <dt>ME/EPP ou equiparada (art. 3º da LC 123/2006)</dt>
                  <dd>{participacao.declaracaoMeEpp === true ? "Sim" : participacao.declaracaoMeEpp === false ? "Não" : "—"}</dd>
                </div>
                {participacao.exigeDeclaracaoProgramasIntegridade === true && (
                  <div>
                    <dt>Programa de integridade</dt>
                    <dd>{participacao.declaracaoProgramasIntegridade === true ? "Sim" : "Não"}</dd>
                  </div>
                )}
                {participacao.exigeDeclaracaoEquidadeGenero === true && (
                  <div>
                    <dt>Equidade entre mulheres e homens</dt>
                    <dd>{txt(participacao.declaracaoEquidadeGenero) && txt(participacao.declaracaoEquidadeGenero) !== "N" ? "Sim" : "Não"}</dd>
                  </div>
                )}
              </dl>
            )}
            {!encerrado && (
              <button className="botao-link sem-margem pequeno" onClick={() => setAlterarDecl(true)}>
                {participando ? "Alterar declarações" : "Aceitar as declarações"}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="cp-itens">
        <div className="cp-itens-topo">
          <h3>Itens</h3>
          <span className={`chip ${comProposta.length === simples.length && simples.length ? "verde" : "amarelo"}`}>
            {comProposta.length} de {simples.length} com proposta
          </span>
          {total > 0 && <strong>{formatarMoeda(total)}</strong>}
        </div>
        {!participando && <p className="alerta aviso">Aceite as declarações para o Compras.gov.br liberar os itens.</p>}
        {itens.length === 0 && participando && <p className="texto-fraco">O Compras.gov.br não devolveu os itens desta compra agora.</p>}
        <ul className="cp-lista">
          {itens
            .filter((i) => i.grupoDe == null)
            .map((it) =>
              it.grupo ? (
                <GrupoComoCompras key={`g${it.numero}`} grupo={it} itens={itens.filter((x) => x.grupoDe === it.numero)} aberto={abertos.has(it.numero)} aoAlternar={() => alternar(it.numero)}>
                  {itens.filter((x) => x.grupoDe === it.numero).map(linha)}
                </GrupoComoCompras>
              ) : (
                linha(it)
              ),
            )}
        </ul>
      </section>

      {envio && (
        <JanelaResultado
          resultado={envio.resultado}
          nome={nome}
          orgao={envio.orgao}
          fim={envio.fim}
          emCadastradas
          aoFechar={() => setEnvio(null)}
          aoTentar={
            envio.tentar &&
            (() => {
              const t = envio.tentar!;
              setEnvio(null);
              t();
            })
          }
        />
      )}
    </div>
  );
}

function situacaoGrupo(itens: ItemProposta[]) {
  const feitos = itens.filter((i) => i.proposta).length;
  if (itens.length && feitos === itens.length) return { texto: "Proposta cadastrada", classe: "ok" };
  if (feitos) return { texto: `Proposta incompleta (${feitos} de ${itens.length} itens)`, classe: "parcial" };
  return { texto: "Proposta não cadastrada", classe: "falta" };
}

function GrupoComoCompras({ grupo, itens, aberto, aoAlternar, children }: { grupo: ItemProposta; itens: ItemProposta[]; aberto: boolean; aoAlternar: () => void; children: React.ReactNode }) {
  const sit = situacaoGrupo(itens);
  const meu = itens.every((i) => i.proposta && !i.desconto)
    ? itens.reduce((s, i) => s + (i.proposta?.valor ?? 0) * (i.porValorTotal ? 1 : (i.proposta?.quantidade ?? i.quantidade ?? 0)), 0)
    : null;
  return (
    <li className={`cp-grupo ${aberto ? "aberto" : ""}`}>
      <button className="cp-cabeca cp-cabeca-grupo" onClick={aoAlternar} aria-expanded={aberto}>
        <span className="cp-nome">
          <Layers size={16} />
          <strong>{grupo.nomeGrupo.toUpperCase()}</strong>
          <span className="texto-fraco">| {itens.length} {itens.length === 1 ? "item" : "itens"}</span>
        </span>
        <span />
        <dl className="cp-dados-item">
          <dt>Valor estimado (total)</dt>
          <dd>{grupo.referencia.tipo === "valor" ? formatarMoeda(grupo.referencia.valor) : textoReferencia(grupo.referencia)}</dd>
          {meu != null && sit.classe === "ok" && (
            <>
              <dt>Meu valor (total)</dt>
              <dd className="cp-meu">{formatarMoeda(meu)}</dd>
            </>
          )}
          <dd className={`cp-situacao ${sit.classe}`}>{sit.texto}</dd>
        </dl>
        <ChevronDown size={18} className="cp-seta" />
      </button>
      {aberto && <ul className="cp-lista cp-sub">{itens.length ? children : <li className="texto-fraco pequeno">Não consegui ler os itens deste grupo agora.</li>}</ul>}
    </li>
  );
}

function ItemComoCompras({
  chave,
  cnpj,
  item: it,
  sugestao,
  liberado,
  aberto,
  aoAlternar,
  aoEnviado,
  aoFalhar,
  aoExcluido,
}: {
  chave: string;
  cnpj: string;
  item: ItemProposta;
  sugestao: SugestaoItem | null;
  liberado: boolean;
  aberto: boolean;
  aoAlternar: () => void;
  aoEnviado: (it: ItemProposta, d: DadosProposta, alterada: boolean) => void;
  aoFalhar: (it: ItemProposta, d: DadosProposta, alterada: boolean, mensagem: string, tentar: () => void) => void;
  aoExcluido: (it: ItemProposta) => void;
}) {
  const p = it.proposta;
  const inicial = p ? null : (sugestao ?? valorSugerido(it, { venda: null, custo: null, valorDigitado: null, marca: "", modelo: "" }));
  const original = {
    valor: it.desconto ? textoNumero(p?.valor ?? inicial?.valor) : textoValor(p ? p.valor : inicial?.valor),
    quantidade: textoNumero(p?.quantidade ?? it.quantidade ?? sugestao?.quantidade),
    marca: p?.marca ?? inicial?.marca ?? "",
    modelo: p?.modelo ?? inicial?.modelo ?? "",
  };
  const [valor, setValor] = useState(original.valor);
  const [quantidade, setQuantidade] = useState(original.quantidade);
  const [marca, setMarca] = useState(original.marca);
  const [modelo, setModelo] = useState(original.modelo);
  const [ocupado, setOcupado] = useState(false);
  const [anexos, setAnexos] = useState<{ nome: string; id: string }[] | null>(null);
  const v = paraNumero(valor);
  const q = it.srp ? (paraNumero(quantidade) ?? it.quantidade) : (it.quantidade ?? paraNumero(quantidade));
  const mudou = !p || v !== p.valor || q !== (p.quantidade ?? it.quantidade) || marca !== p.marca || modelo !== p.modelo;
  const problema = problemaDaProposta(it, { valor: v ?? undefined, quantidade: q ?? undefined, marca, modelo });
  const totalItem = !it.desconto && v != null && q != null ? (it.porValorTotal ? v : v * q) : null;
  const acimaEstimado = !it.desconto && v != null && it.valorEstimado != null && v > it.valorEstimado + 1e-9;
  const caminhoAnexos = `${FE}/v1/compras/${chave}/itens/${it.numero}/participacao/${cnpj}/anexos`;
  const id = (campo: string) => `cp-${campo}-${chave}-${it.numero}`;

  const carregarAnexos = useCallback(async () => {
    if (!cnpj || !it.anexoObrigatorio || !p) return;
    try {
      setAnexos(lerAnexos((await pedir({ caminho: caminhoAnexos })).dados).map((a) => ({ nome: a.nome, id: a.id })));
    } catch {
      setAnexos([]);
    }
  }, [caminhoAnexos, cnpj, it.anexoObrigatorio, p]);
  useEffect(() => {
    if (aberto) carregarAnexos();
  }, [aberto, carregarAnexos]);

  function desfazer() {
    setValor(original.valor);
    setQuantidade(original.quantidade);
    setMarca(original.marca);
    setModelo(original.modelo);
  }

  async function salvar(semPerguntar = false) {
    const texto = `${p ? "Alterar" : "Cadastrar"} a proposta do item ${it.numero}?\n\n${it.desconto ? `Desconto: ${valor}%` : `Valor unitário: ${formatarMoeda(v)}`} · Quantidade: ${q}${it.material ? `\nMarca: ${marca} · Modelo: ${modelo}` : ""}`;
    if (!semPerguntar && !window.confirm(texto)) return;
    const d: DadosProposta = { valor: v!, quantidade: q!, marca, modelo };
    setOcupado(true);
    try {
      await enviarProposta(chave, it, d);
      aoEnviado(it, d, !!p);
    } catch (e) {
      aoFalhar(it, d, !!p, mensagemDeErro(e), () => void salvar(true));
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    if (!window.confirm(`Excluir a proposta do item ${it.numero} no Compras.gov.br?`)) return;
    setOcupado(true);
    try {
      await pedir({ metodo: "DELETE", caminho: `${FE}/v1/compras/${chave}/itens/${it.numero}/participacao` });
      avisar(`Proposta do item ${it.numero} excluída.`);
      aoExcluido(it);
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setOcupado(false);
    }
  }

  const rotuloEstimado = it.porValorTotal ? "Valor estimado (total)" : "Valor estimado (unitário)";
  const rotuloMeu = it.desconto ? "Meu desconto" : it.porValorTotal ? "Meu valor (total)" : "Meu valor (unitário)";
  const detalhada = it.descricaoDetalhada && it.descricaoDetalhada !== it.descricao ? it.descricaoDetalhada : "";

  return (
    <li className={`cp-item ${aberto ? "aberto" : ""} ${p ? "com-proposta" : ""}`}>
      <div className="cp-cabeca">
        <button className="cp-nome" onClick={aoAlternar} aria-expanded={aberto} title={aberto ? "Recolher" : "Abrir o item"}>
          <span className="cp-numero">{it.numero}</span>
          <strong>{it.descricao.toUpperCase()}</strong>
        </button>
        <dl className="cp-dados-item">
          <dt>Quantidade solicitada</dt>
          <dd>{it.quantidade ?? "—"}</dd>
          <dt>Unidade fornecimento</dt>
          <dd>{it.unidade || "—"}</dd>
        </dl>
        <dl className="cp-dados-item">
          <dt>{rotuloEstimado}</dt>
          <dd>{it.desconto ? "—" : it.referencia.tipo === "valor" ? formatarMoeda(it.referencia.valor) : textoReferencia(it.referencia)}</dd>
          {p ? (
            <>
              <dt>{rotuloMeu}</dt>
              <dd className="cp-meu">{valorTexto(it, p.valor)}</dd>
            </>
          ) : (
            <dd className="cp-situacao falta">Proposta não cadastrada</dd>
          )}
        </dl>
        <div className="cp-acoes">
          {p && liberado && (
            <button className="botao-icone" onClick={excluir} disabled={ocupado} aria-label={`Excluir a proposta do item ${it.numero}`} title="Excluir a proposta">
              <Trash2 size={15} />
            </button>
          )}
          <button className="botao-icone cp-seta" onClick={aoAlternar} aria-expanded={aberto} aria-label={aberto ? "Recolher o item" : "Abrir o item"}>
            <ChevronDown size={18} />
          </button>
        </div>
      </div>
      {aberto && (
        <div className="cp-corpo">
          {detalhada && (
            <div className="cp-descricao">
              <span className="texto-fraco pequeno">Descrição detalhada</span>
              <p>{detalhada}</p>
            </div>
          )}
          <div className="cp-campos">
            <div className="cp-campo">
              <label htmlFor={id("qtd")}>Quantidade ofertada</label>
              {it.srp ? (
                <div className="entrada">
                  <input id={id("qtd")} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} inputMode="decimal" disabled={!liberado || ocupado} aria-label={`Quantidade do item ${it.numero}`} />
                </div>
              ) : (
                <span className="cp-valor-fixo" id={id("qtd")}>
                  {q ?? "—"}
                </span>
              )}
            </div>
            <div className="cp-campo">
              <label htmlFor={id("valor")}>{it.desconto ? "Desconto (%)" : it.porValorTotal ? "Valor total (R$)" : "Valor unitário (R$)"}</label>
              <div className="entrada">
                <input
                  id={id("valor")}
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  inputMode="decimal"
                  placeholder={it.desconto ? "10,5" : "0,00"}
                  disabled={!liberado || ocupado}
                  aria-label={`Valor do item ${it.numero}`}
                />
              </div>
            </div>
            <div className="cp-campo">
              <span className="cp-rotulo">Valor total</span>
              <span className={`cp-valor-fixo ${acimaEstimado ? "texto-vermelho" : ""}`}>{totalItem != null ? formatarMoeda(totalItem) : "—"}</span>
            </div>
            {it.material && (
              <>
                <div className="cp-campo">
                  <label htmlFor={id("marca")}>Marca/Fabricante</label>
                  <div className="entrada">
                    <input id={id("marca")} value={marca} onChange={(e) => setMarca(e.target.value)} maxLength={100} disabled={!liberado || ocupado} aria-label={`Marca do item ${it.numero}`} />
                  </div>
                </div>
                <div className="cp-campo largo">
                  <label htmlFor={id("modelo")}>Modelo/Versão</label>
                  <div className="entrada">
                    <input id={id("modelo")} value={modelo} onChange={(e) => setModelo(e.target.value)} maxLength={100} disabled={!liberado || ocupado} aria-label={`Modelo do item ${it.numero}`} />
                  </div>
                </div>
              </>
            )}
          </div>
          {it.anexoObrigatorio && p && (
            <div className="anexos-item-proposta">
              <span className="pequeno">Este item exige anexo da proposta:</span>
              {(anexos ?? []).map((a) => (
                <span key={a.id || a.nome} className="chip verde">
                  {a.nome}
                </span>
              ))}
              {liberado && <BotaoAnexo caminho={caminhoAnexos} numero={it.numero} aoEnviar={carregarAnexos} />}
            </div>
          )}
          <div className="cp-rodape">
            <span className="cp-avisos">
              {acimaEstimado && <span className="texto-vermelho pequeno">Valor acima da referência do órgão ({formatarMoeda(it.valorEstimado)}).</span>}
              {!p && inicial?.origem && !acimaEstimado && <span className={`pequeno ${inicial.aviso ? "texto-amarelo" : "texto-fraco"}`}>{inicial.aviso || `Valor preenchido: ${inicial.origem.toLowerCase()}`}</span>}
              {liberado && mudou && problema && <span className="texto-fraco pequeno">{problema}</span>}
            </span>
            {liberado && (
              <span className="cp-botoes">
                {p && mudou && (
                  <button className="botao secundario pequeno" onClick={desfazer} disabled={ocupado}>
                    <Undo2 size={14} /> Desfazer alterações
                  </button>
                )}
                <button className="botao acento pequeno" onClick={() => salvar()} disabled={ocupado || !!problema || !mudou}>
                  {ocupado ? <Loader2 className="girando" /> : <Save />} {p ? "Salvar" : "Cadastrar"}
                </button>
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
