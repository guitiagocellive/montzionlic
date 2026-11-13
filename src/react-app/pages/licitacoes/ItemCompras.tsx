import { ErroCompras } from "../../robo/ErroCompras";
import { BellRing, ChevronDown, Download, FileText, FileUp, Gavel, Loader2, MessageSquare, Paperclip, Send, ShieldQuestion, Trash2, UserRound, Users } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  idEmpresa,
  type AnexoCompras,
  cnpjFormatadoAcomp,
  type CompraAcomp,
  dataDe,
  type FaseRecursal,
  type ItemAcomp,
  lerAnexos,
  lerFaseRecursal,
  lerItemComPropostas,
  lerMensagem,
  lerProposta,
  type MensagemAcomp,
  type PropostaEmpresa,
  propostasDoItem,
  calcularChance,
  ROTULO_CHANCE,
} from "../../../shared/acompanhamento";
import { mensagemDeErro } from "../../api";
import { avisar } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import { type PedidoFornecedor, ponte } from "../../robo/ponte";

// "Ver item" do Compras.gov.br dentro da plataforma, no mesmo desenho da tela oficial:
// Minha proposta (classificação, declarações, UF, chat, proposta, anexos, diligências, recursos e lances) e
// Todas as propostas (empresas em ordem; a seta abre o chat, a proposta, os anexos e as diligências de cada uma).
// Quem consulta é o aplicativo, com a sua sessão do gov.br; as ações só vão depois de você confirmar.

const FE = "/comprasnet-fase-externa";

export const COR_CHANCE: Record<string, string> = { ganhou: "verde", alta: "verde", media: "amarelo", baixa: "vermelho", fora: "cinza", aguardando: "azul", encerrado: "cinza" };

export async function pedir(p: PedidoFornecedor) {
  const r = await ponte.fornecedor(p);
  if (r.status >= 400 || r.status === 0) {
    const m = (r.mensagem ?? "").trim();
    throw new Error(m && m !== "[]" && m !== "{}" ? m : `O Compras.gov.br respondeu ${r.status || "sem dados"}.`);
  }
  return r;
}

/** Tela do fornecedor e, se ela não existir para esta compra, a tela pública com a mesma informação. */
async function consultar(caminhoV: string, opcoes: { captcha?: boolean; query?: string } = {}) {
  const { captcha = true, query = "" } = opcoes;
  try {
    return (await pedir({ caminho: `${FE}${caminhoV}`, captcha, query })).dados;
  } catch (e) {
    if (!/40[34]|não encontr|not found|no static resource/i.test(mensagemDeErro(e))) throw e;
    return (await pedir({ caminho: `${FE}/public${caminhoV}`, captcha: true, query })).dados;
  }
}

function salvarArquivo(r: { base64?: string; nome?: string; tipo?: string }, nomePadrao: string) {
  if (!r.base64) throw new Error("O Compras.gov.br não devolveu o arquivo.");
  const bin = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bin], { type: r.tipo || "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = r.nome && r.nome !== "arquivo" ? r.nome : nomePadrao;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function lerArquivo(f: File) {
  if (f.size > 30 * 1024 * 1024) throw new Error("O Compras.gov.br aceita arquivos de até 30 MB.");
  if (f.name.length > 150) throw new Error("O nome do arquivo pode ter até 150 caracteres.");
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
  return { nome: f.name, tipo: f.type || "application/octet-stream", base64: btoa(s) };
}

const dataHora = (s: string) => {
  const t = dataDe(s);
  return t ? new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
};
const hora = (s: string) => {
  const t = dataDe(s);
  return t ? new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
};
const moeda4 = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 }));

// Respostas já lidas nesta sessão: abrir e fechar um item (ou trocar de aba) mostra na hora o que já veio,
// e relê por trás se tiver mais de 1 minuto.
const memoria = new Map<string, { em: number; dados: unknown; pedido?: Promise<unknown> }>();
const VALIDADE = 60_000;

/** Lê (ou reaproveita) uma consulta ao Compras.gov.br; pedidos iguais ao mesmo tempo viram um só. */
export function lerComMemoria<T>(chave: string, carregar: () => Promise<T>, forcar = false): Promise<T> {
  const m = memoria.get(chave);
  if (m?.pedido) return m.pedido as Promise<T>;
  if (!forcar && m && Date.now() - m.em < VALIDADE) return Promise.resolve(m.dados as T);
  const pedido = carregar().then(
    (dados) => {
      memoria.set(chave, { em: Date.now(), dados });
      return dados;
    },
    (e) => {
      if (m && m.em > 0) memoria.set(chave, { em: m.em, dados: m.dados });
      else memoria.delete(chave);
      throw e;
    },
  );
  memoria.set(chave, { em: m?.em ?? 0, dados: m?.dados, pedido });
  return pedido;
}

export function jaLido<T>(chave: string): T | null {
  const m = memoria.get(chave);
  return m && m.em > 0 ? (m.dados as T) : null;
}

/** Carrega quando a parte aparece, com "tentar de novo"; mostra na hora o que já foi lido. */
function useCarga<T>(ativo: boolean, carregar: () => Promise<T>, chave: string) {
  const [estado, setEstado] = useState<{ carregando: boolean; erro: string; dados: T | null }>(() => ({ carregando: false, erro: "", dados: jaLido<T>(chave) }));
  const [vez, setVez] = useState(0);
  const ref = useRef(carregar);
  ref.current = carregar;
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    const antes = jaLido<T>(chave);
    setEstado({ carregando: antes == null, erro: "", dados: antes });
    lerComMemoria(chave, () => ref.current(), vez > 0)
      .then((dados) => vivo && setEstado({ carregando: false, erro: "", dados }))
      .catch((e) => vivo && setEstado((x) => ({ ...x, carregando: false, erro: mensagemDeErro(e) })));
    return () => {
      vivo = false;
    };
  }, [ativo, vez, chave]);
  return { ...estado, recarregar: useCallback(() => setVez((v) => v + 1), []) };
}

function Estado({ carregando, erro, recarregar, children }: { carregando: boolean; erro: string; recarregar: () => void; children: ReactNode }) {
  if (carregando)
    return (
      <p className="texto-suave carregando-marcas">
        <Loader2 className="girando" size={16} /> Consultando o Compras.gov.br…
      </p>
    );
  if (erro)
    return (
      <ErroCompras erro={erro} aoTentar={recarregar} />
    );
  return <>{children}</>;
}

/** Bloco que abre e fecha, como "Chat", "Proposta", "Anexos" e "Diligências" da tela oficial. */
function Secao({ titulo, aberta: inicial = false, extra, children }: { titulo: string; aberta?: boolean; extra?: ReactNode; children: (aberta: boolean) => ReactNode }) {
  const [aberta, setAberta] = useState(inicial);
  return (
    <section className={`secao-compras ${aberta ? "aberta" : ""}`}>
      <button className="titulo-secao-compras" onClick={() => setAberta((v) => !v)} aria-expanded={aberta}>
        <ChevronDown size={16} /> {titulo} {extra}
      </button>
      {aberta && <div className="corpo-secao-compras">{children(aberta)}</div>}
    </section>
  );
}

/** Propostas do item (a sua e as de todas as empresas), como a tela do item no Compras.gov.br. */
export async function carregarPropostas(compra: CompraAcomp, numeroItem: number, cnpj: string) {
  const base = `/v1/compras/${compra.chave}/itens/${numeroItem}`;
  // 1) tela da fase de seleção ("Todas as propostas" oficial); 2) item com as propostas; 3) propostas iniciais.
  const naoExiste = (e: unknown) => /40[034]|não encontr|not found|sem dados/i.test(mensagemDeErro(e));
  try {
    const d = await consultar(`/v1/compras/${compra.chave}/em-selecao-fornecedores/itens/${numeroItem}/propostas`, { query: "ordenacao-propostas=P", captcha: false });
    const lido = lerItemComPropostas(d, cnpj);
    if (lido.todas.length) return { ...lido, iniciais: false };
  } catch (e) {
    if (!naoExiste(e)) throw e;
  }
  try {
    return { ...lerItemComPropostas(await consultar(`${base}/propostas`), cnpj), iniciais: false };
  } catch (e) {
    if (!naoExiste(e)) throw e;
    const d = await consultar(`${base}/propostas-iniciais`).catch(() => {
      throw e;
    });
    return { ...lerItemComPropostas({ propostasItem: propostasDoItem(d, numeroItem) }, cnpj), iniciais: true };
  }
}
export type PropostasDoItem = Awaited<ReturnType<typeof carregarPropostas>>;
export const chavePropostas = (compra: CompraAcomp, numeroItem: number) => `propostas:${compra.chave}:${numeroItem}`;

/** Lê as propostas de vários itens por trás (2 de cada vez), para os cartões já mostrarem a análise. */
export async function preCarregarPropostas(compra: CompraAcomp, itens: number[], cnpj: string, aoLer: () => void, parar: () => boolean) {
  const fila = itens.filter((n) => !jaLido(chavePropostas(compra, n)));
  const trabalhar = async () => {
    for (let n = fila.shift(); n != null && !parar(); n = fila.shift()) {
      try {
        await lerComMemoria(chavePropostas(compra, n), () => carregarPropostas(compra, n, cnpj));
        aoLer();
      } catch {
        /* o item mostra o erro quando for aberto */
      }
    }
  };
  await Promise.all([trabalhar(), trabalhar()]);
}

/** Análise rápida do item a partir das propostas: quem está à frente, desclassificadas e a distância para a 1ª válida. */
export function analisarPropostas(dados: PropostasDoItem | null, cnpj: string) {
  if (!dados?.todas.length) return null;
  const todas = dados.todas;
  const minhaPos = todas.findIndex((p) => p.cnpj === cnpj);
  const aFrente = minhaPos > 0 ? todas.slice(0, minhaPos) : [];
  const validas = todas.filter((p) => !p.desclassificada);
  const primeiraValida = validas[0] ?? null;
  const minha = minhaPos >= 0 ? todas[minhaPos] : null;
  const meu = minha ? (minha.valorNegociado ?? minha.valorOfertado ?? minha.valor) : null;
  const dela = primeiraValida ? (primeiraValida.valorNegociado ?? primeiraValida.valorOfertado ?? primeiraValida.valor) : null;
  const posicaoValida = minha && !minha.desclassificada ? validas.findIndex((p) => p.cnpj === cnpj) + 1 : null;
  return {
    minhaColocacao: minha ? (minha.colocacao ?? minhaPos + 1) : null,
    total: todas.length,
    desclassificadas: todas.filter((p) => p.desclassificada).length,
    aFrente: aFrente.length,
    aFrenteValidas: aFrente.filter((p) => !p.desclassificada).length,
    aFrenteSemAnexos: aFrente.filter((p) => !p.desclassificada && p.quantidadeAnexos === 0).length,
    posicaoValida,
    souPrimeira: !!minha && primeiraValida?.cnpj === cnpj,
    diferenca: meu != null && dela != null && primeiraValida?.cnpj !== cnpj ? meu - dela : null,
    diferencaPct: meu != null && dela ? ((meu - dela) / dela) * 100 : null,
    primeiraValida,
  };
}

/**
 * Situação do item para você, pela sua proposta (quando as propostas já foram lidas) ou pela lista de itens:
 * chance, explicação e um texto curto do momento (adjudicada, aguardando o pregoeiro...).
 */
export function estadoDoItem(item: ItemAcomp, dados: PropostasDoItem | null, cnpj: string) {
  const analise = analisarPropostas(dados, cnpj);
  const minha = dados?.minha ?? null;
  const situacaoItem = dados?.situacaoItem ?? "";
  if (!minha) {
    return { chance: item.chance, explicacao: item.explicacao, momento: item.situacao || item.etapa || "", colocacao: item.colocacao, total: item.participantes, analise };
  }
  const pendencias = minha.pendencias.length ? minha.pendencias : item.pendencias;
  const { chance, explicacao } = calcularChance(
    { colocacao: analise?.posicaoValida ?? minha.colocacao, codigoSituacao: minha.codigo, pendencias, chatAberto: minha.chatAberto || item.chatAberto, participantes: analise?.total ?? null },
    "",
    minha.desclassificada,
  );
  const homologado = /homolog/i.test(situacaoItem) || /homolog/i.test(item.etapa);
  let momento = "";
  if (minha.codigo === "6") momento = homologado ? "Adjudicada e homologada para você" : "Adjudicada para você — aguardando homologação";
  else if (minha.desclassificada) momento = minha.situacao || "Proposta desclassificada";
  else if (minha.codigo === "5") momento = "Inabilitada";
  else if (pendencias.length) momento = `Convocada: ${pendencias.map((p) => p.rotulo.toLowerCase()).join(", ")}`;
  else if (minha.codigo === "4") momento = "Habilitada — aguardando adjudicação";
  else if (minha.codigo === "3") momento = "Proposta aceita — aguardando habilitação";
  else if (analise?.souPrimeira) momento = "1ª colocada — aguardando o pregoeiro analisar a sua proposta";
  else if (analise?.posicaoValida) momento = `Na fila: ${analise.posicaoValida}ª entre as propostas válidas`;
  else momento = minha.situacao || situacaoItem || item.etapa || "";
  return { chance, explicacao, momento, colocacao: analise?.minhaColocacao ?? minha.colocacao, total: analise?.total ?? item.participantes, analise };
}

/** Mensagens da compra sobre este item: se o pregoeiro falou com você e qual foi a última. */
export function conversaDoItem(mensagens: MensagemAcomp[], numeroItem: number, cnpj: string) {
  const doItem = mensagens.filter((m) => m.item === numeroItem);
  const paraVoce = doItem.filter((m) => m.quem === "pregoeiro" && !!cnpj && (m.destinatario === cnpj || m.texto.replace(/\D/g, "").includes(cnpj)));
  const ultima = [...paraVoce].sort((a, b) => dataDe(b.dataHora) - dataDe(a.dataHora))[0] ?? null;
  return { total: doItem.length, paraVoce: paraVoce.length, ultima };
}

type Aba = "minha" | "todos" | "lances";

export function ItemCompras({
  compra,
  item,
  cnpj,
  abaInicial = "minha",
  participa = true,
}: {
  compra: CompraAcomp;
  item: ItemAcomp;
  cnpj: string;
  abaInicial?: Aba;
  /** Item sem proposta sua: mostra só os participantes e os lances. */
  participa?: boolean;
}) {
  const [aba, setAba] = useState<Aba>(participa ? abaInicial : "todos");
  const dados = useCarga(true, () => carregarPropostas(compra, item.numero, cnpj), chavePropostas(compra, item.numero));
  const nomes = useMemo(() => new Map((dados.dados?.todas ?? []).map((p) => [p.cnpj, p.empresa])), [dados.dados]);
  // Reserva: a sua proposta como veio na lista de itens (aparece na hora, antes da tela do item responder).
  const minha = dados.dados?.minha ?? (item.propostaBruta ? lerProposta(item.propostaBruta) : null);
  const participantes = dados.dados?.participantes ?? item.participantes;
  const estado = estadoDoItem(item, dados.dados, cnpj);
  const colocacao = estado.colocacao ?? minha?.colocacao ?? item.colocacao;
  const analise = estado.analise;
  const conversa = conversaDoItem(compra.mensagens, item.numero, cnpj);
  const pendencias = item.pendencias.length ? item.pendencias : (minha?.pendencias ?? []);
  const convocadoAnexos = pendencias.some((p) => p.tipo === "anexos");
  const emDiligencia = pendencias.some((p) => p.tipo === "diligencia");

  return (
    <div className="item-compras">
      <div className="abas-compras" role="tablist">
        {participa && (
          <button role="tab" aria-selected={aba === "minha"} className={aba === "minha" ? "ativo" : ""} onClick={() => setAba("minha")}>
            <UserRound size={15} /> Minha participação
          </button>
        )}
        <button role="tab" aria-selected={aba === "todos"} className={aba === "todos" ? "ativo" : ""} onClick={() => setAba("todos")}>
          <Users size={15} /> Todos os participantes{participantes ? ` (${participantes})` : ""}
        </button>
        <button role="tab" aria-selected={aba === "lances"} className={aba === "lances" ? "ativo" : ""} onClick={() => setAba("lances")}>
          <Gavel size={15} /> Lances
        </button>
      </div>

      {aba === "minha" && (
        <div className="painel-compras">
          {pendencias.length > 0 && (
            <div className="faixa-pendencias">
              <BellRing size={16} />
              <span>
                <strong>Convocação aberta:</strong> {pendencias.map((p) => p.rotulo).join(" · ")}
                {minha?.dataLimite && <> — prazo {dataHora(minha.dataLimite)}</>}
              </span>
            </div>
          )}
          <div className="resumo-minha-proposta">
            <div className="destaque">
              <span>Classificação</span>
              <strong>{colocacao != null ? `${colocacao}º` : "—"}</strong>
              <small>{participantes ? `de ${participantes} propostas` : ""}</small>
            </div>
            <div>
              <span>Chance</span>
              <span className={`chip ${COR_CHANCE[estado.chance]}`}>{ROTULO_CHANCE[estado.chance]}</span>
              <small>{estado.explicacao}</small>
            </div>
            <div>
              <span>Situação</span>
              <strong className={minha?.desclassificada ? "texto-vermelho" : estado.chance === "ganhou" ? "texto-verde" : ""}>{estado.momento || "—"}</strong>
              {dados.dados?.situacaoItem && <small>Item: {dados.dados.situacaoItem}</small>}
              {minha?.motivo && <small className="texto-vermelho">Motivo: {minha.motivo}</small>}
            </div>
            <div>
              <span>Declarações</span>
              <strong>ME/EPP: {minha?.meEpp || compra.meEpp ? "Sim" : compra.meEpp === false || minha ? "Não" : "—"}</strong>
              <small>UF {minha?.uf || compra.uf || "—"}</small>
            </div>
          </div>

          <ul className="analise-item">
            {analise?.souPrimeira && <li className="bom">Você é a 1ª proposta válida: é a próxima (ou a atual) a ser analisada pelo pregoeiro.</li>}
            {analise && !analise.souPrimeira && analise.aFrenteValidas > 0 && (
              <li>
                {analise.aFrenteValidas === 1 ? "1 empresa válida à sua frente" : `${analise.aFrenteValidas} empresas válidas à sua frente`}
                {analise.aFrente > analise.aFrenteValidas ? ` (e ${analise.aFrente - analise.aFrenteValidas} já desclassificada${analise.aFrente - analise.aFrenteValidas > 1 ? "s" : ""})` : ""}.
                {analise.aFrenteSemAnexos > 0 && <strong> {analise.aFrenteSemAnexos} sem anexos — se o edital exige, tende a ser recusada.</strong>}
              </li>
            )}
            {analise?.diferenca != null && analise.diferenca > 0 && (
              <li>
                Seu valor está {formatarMoeda(analise.diferenca)} acima da 1ª válida{analise.diferencaPct != null ? ` (${analise.diferencaPct.toFixed(1).replace(".", ",")}%)` : ""}.
              </li>
            )}
            {conversa.paraVoce > 0 && (
              <li className="atencao">
                O pregoeiro falou com você neste item{conversa.paraVoce > 1 ? ` (${conversa.paraVoce} mensagens)` : ""}
                {conversa.ultima ? `: “${resumir(conversa.ultima.texto, 110)}”` : "."}
              </li>
            )}
            {!analise && dados.carregando && (
              <li className="texto-fraco">
                <Loader2 className="girando" size={13} /> Lendo as propostas do item…
              </li>
            )}
          </ul>

          <section className="cartao-secao-compras">
            <h4>
              <FileText size={15} /> Minha proposta
            </h4>
            <Estado carregando={dados.carregando && !minha} erro={minha ? "" : dados.erro} recarregar={dados.recarregar}>
              {minha ? <DadosProposta p={minha} quantidadeItem={item.quantidade} /> : <p className="texto-fraco">O Compras.gov.br ainda não mostra a sua proposta deste item.</p>}
            </Estado>
          </section>

          <div className="colunas-minha-participacao">
            <section className="cartao-secao-compras">
              <h4>
                <MessageSquare size={15} /> Conversa com o pregoeiro
              </h4>
              <Chat compra={compra} item={item} cnpj={cnpj} nomes={nomes} participante={cnpj} podeEscrever />
            </section>
            <div className="pilha-secoes">
              <section className="cartao-secao-compras">
                <h4>
                  <Paperclip size={15} /> Anexos que enviei
                </h4>
                <MeusAnexos compra={compra} item={item} cnpj={cnpj} convocado={convocadoAnexos || !!minha?.convocada} />
              </section>
              <section className="cartao-secao-compras">
                <h4>
                  <ShieldQuestion size={15} /> Diligências
                </h4>
                <Diligencias compra={compra} item={item} cnpj={cnpj} podeEnviar={emDiligencia} />
              </section>
            </div>
          </div>
          <Secao titulo="Recursos (intenção, recurso e contrarrazão)">{() => <Recursos compra={compra} item={item} cnpj={cnpj} nomes={nomes} />}</Secao>
        </div>
      )}

      {aba === "todos" && (
        <Estado carregando={dados.carregando} erro={dados.erro} recarregar={dados.recarregar}>
          <TodasPropostas compra={compra} item={item} cnpj={cnpj} lista={dados.dados?.todas ?? []} iniciais={!!dados.dados?.iniciais} nomes={nomes} analise={analise} />
        </Estado>
      )}

      {aba === "lances" && <Lances compra={compra} item={item} cnpj={cnpj} nomes={nomes} />}
    </div>
  );
}

const resumir = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function DadosProposta({ p, quantidadeItem }: { p: PropostaEmpresa; quantidadeItem?: number | null }) {
  const q = p.quantidade ?? quantidadeItem ?? null;
  const total = (unit: number | null, informado: number | null) => (informado != null ? informado : unit != null && q != null ? unit * q : null);
  const linha = (rotulo: string, unit: number | null, informado: number | null, destaque = false) => (
    <div className={destaque ? "destaque" : ""}>
      <span>{rotulo}</span>
      <strong>{unit != null ? moeda4(unit) : "—"}</strong>
      <small>{total(unit, informado) != null ? `Total ${moeda4(total(unit, informado))}` : ""}</small>
    </div>
  );
  const atual = p.valorNegociado != null ? "negociado" : "ofertado";
  return (
    <div className="dados-proposta-compras">
      {linha("Valor inicial (proposta)", p.valorProposta, p.totalProposta)}
      {linha("Valor ofertado (após lances)", p.valorOfertado, p.totalOfertado, atual === "ofertado")}
      {linha("Valor negociado", p.valorNegociado, p.totalNegociado, atual === "negociado")}
      {p.valorSugerido != null && linha("Sugerido pelo pregoeiro", p.valorSugerido, null)}
      <div>
        <span>Quantidade ofertada</span>
        <strong>{q ?? "—"}</strong>
      </div>
      <div>
        <span>Marca / fabricante</span>
        <strong>{p.marca || "—"}</strong>
      </div>
      <div>
        <span>Modelo / versão</span>
        <strong>{p.modelo || "—"}</strong>
      </div>
      {(p.situacao || p.motivo) && (
        <div className="largura-toda">
          <span>Situação</span>
          <strong className={p.desclassificada ? "texto-vermelho" : ""}>{p.situacao || "—"}</strong>
          {p.motivo && <span className="motivo-acomp">Motivo: {p.motivo}</span>}
        </div>
      )}
    </div>
  );
}

// ---------- Chat do item ----------

/** Chat do item com uma empresa (a sua, em "Minha proposta", ou a de cada colocada, em "Todas as propostas"). */
function Chat({
  compra,
  item,
  cnpj,
  nomes,
  empresa,
  participante,
  podeEscrever,
}: {
  compra: CompraAcomp;
  item: ItemAcomp;
  cnpj: string;
  nomes: Map<string, string>;
  empresa?: PropostaEmpresa;
  participante?: string;
  podeEscrever?: boolean;
}) {
  const de = participante ?? empresa?.cnpj ?? "";
  const carga = useCarga(
    true,
    async () => {
      const query = `size=300&page=0&legadoAsp=false${de ? `&identificadorParticipante=${de}` : ""}`;
      // O Compras.gov.br responde 404 quando não há mensagens com essa empresa no item.
      const r = await pedir({ caminho: `/comprasnet-mensagem/v2/chat/${compra.chave}/itens/${item.numero}`, query, captcha: true }).catch((e) => {
        if (/404|não encontr|not found/i.test(mensagemDeErro(e))) return { dados: [] };
        throw e;
      });
      const lista = Array.isArray(r.dados) ? r.dados : [];
      return lista
        .map(lerMensagem)
        .filter((m): m is MensagemAcomp => !!m)
        .sort((a, b) => dataDe(a.dataHora) - dataDe(b.dataHora));
    },
    `${compra.chave}:${item.numero}:${de}`,
  );
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (caixa.current) caixa.current.scrollTop = caixa.current.scrollHeight;
  }, [carga.dados]);

  const quem = (m: MensagemAcomp) => {
    if (m.quem === "sistema") return "Sistema";
    if (m.quem === "pregoeiro") {
      const para = m.destinatario ? (m.destinatario === cnpj ? "você" : nomes.get(m.destinatario) || cnpjFormatadoAcomp(m.destinatario)) : "";
      return para ? `Pregoeiro → ${para}` : "Pregoeiro";
    }
    if (!m.remetente || m.remetente === cnpj) return "Você";
    return nomes.get(m.remetente) || empresa?.empresa || cnpjFormatadoAcomp(m.remetente);
  };
  // Mesmo lado da tela oficial: pregoeiro à esquerda, fornecedor e sistema à direita.
  const lado = (m: MensagemAcomp) => (m.quem === "pregoeiro" ? "pregoeiro" : m.quem === "voce" && m.remetente && m.remetente !== cnpj ? "outra" : m.quem);

  async function enviar() {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await ponte.mensagem(compra.chave, item.numero, texto.trim());
      setTexto("");
      avisar("Mensagem enviada ao pregoeiro.");
      carga.recarregar();
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setEnviando(false);
    }
  }

  let dia = "";
  return (
    <Estado carregando={carga.carregando && !carga.dados} erro={carga.erro} recarregar={carga.recarregar}>
      <div className="chat-compras" ref={caixa}>
        {(carga.dados ?? []).length === 0 ? (
          <p className="texto-fraco pequeno">Nenhuma mensagem neste item.</p>
        ) : (
          (carga.dados ?? []).map((m) => {
            const d = m.dataHora ? new Date(dataDe(m.dataHora)).toLocaleDateString("pt-BR") : "";
            const mostrarDia = d && d !== dia;
            dia = d || dia;
            return (
              <div key={m.id} className="linha-chat">
                {mostrarDia && <span className="dia-chat">{d}</span>}
                <div className={`msg-compras ${lado(m)}`}>
                  <span className="quem-acomp">{quem(m)}</span>
                  <span>{m.texto}</span>
                  <span className="hora-chat">{hora(m.dataHora)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
      {podeEscrever && (
        <>
          <div className="enviar-compras">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Nova mensagem"
              rows={2}
              maxLength={2000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar();
              }}
            />
            <button className="botao acento" onClick={enviar} disabled={enviando || !texto.trim()}>
              {enviando ? <Loader2 className="girando" /> : <Send />} Enviar mensagem
            </button>
          </div>
          <p className="texto-fraco pequeno">O Compras.gov.br só aceita mensagem quando o pregoeiro abre a conversa para você (por exemplo, numa convocação).</p>
        </>
      )}
    </Estado>
  );
}

// ---------- Anexos ----------

function ListaAnexos({ anexos, baixar, excluir, vazio = "Nenhum anexo enviado." }: { anexos: AnexoCompras[]; baixar: (a: AnexoCompras) => Promise<void>; excluir?: (a: AnexoCompras) => Promise<void>; vazio?: string }) {
  const [ocupado, setOcupado] = useState("");
  if (!anexos.length) return <p className="texto-fraco pequeno">{vazio}</p>;
  const fazer = async (a: AnexoCompras, f: (a: AnexoCompras) => Promise<void>) => {
    setOcupado(a.id || a.url);
    try {
      await f(a);
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setOcupado("");
    }
  };
  return (
    <ul className="anexos-compras">
      {anexos.map((a) => (
        <li key={a.id || a.url}>
          <span className="nome-anexo-compras">{a.nome}</span>
          <span className="texto-fraco pequeno">{dataHora(a.dataHora)}</span>
          <button className="botao-icone" aria-label={`Baixar ${a.nome}`} disabled={!!ocupado} onClick={() => fazer(a, baixar)}>
            {ocupado === (a.id || a.url) ? <Loader2 className="girando" size={15} /> : <Download size={15} />}
          </button>
          {excluir && (
            <button className="botao-icone" aria-label={`Excluir ${a.nome}`} disabled={!!ocupado} onClick={() => fazer(a, excluir)}>
              <Trash2 size={15} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function EnviarArquivo({ rotulo, desativado, confirmar, enviar }: { rotulo: string; desativado?: boolean; confirmar: (nome: string) => string; enviar: (arquivo: { nome: string; tipo: string; base64: string }) => Promise<void> }) {
  const [enviando, setEnviando] = useState(false);
  return (
    <label className={`botao acento pequeno ${enviando || desativado ? "desativado" : ""}`} title={desativado ? "Para enviar o arquivo é necessário estar ciente dos termos do anexo" : ""}>
      {enviando ? <Loader2 className="girando" /> : <FileUp />} {enviando ? "Enviando…" : rotulo}
      <input
        type="file"
        hidden
        disabled={enviando || desativado}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || !window.confirm(confirmar(f.name))) return;
          setEnviando(true);
          try {
            await enviar(await lerArquivo(f));
            avisar("Arquivo enviado ao Compras.gov.br.");
          } catch (x) {
            avisar(mensagemDeErro(x), "erro");
          } finally {
            setEnviando(false);
          }
        }}
      />
    </label>
  );
}

/** Anexos de uma empresa no item, como o site logado lista ("participacao/{cnpj}/anexos", em páginas); a tela pública é a reserva. */
async function anexosDaEmpresa(compra: CompraAcomp, numeroItem: number, cnpjEmpresa: string) {
  try {
    const todos: AnexoCompras[] = [];
    for (let pagina = 0; pagina < 10; pagina++) {
      const lidos = lerAnexos((await pedir({ caminho: `${FE}/v1/compras/${compra.chave}/itens/${numeroItem}/participacao/${cnpjEmpresa}/anexos`, captcha: false, query: `pagina=${pagina}&tamanhoPagina=20` })).dados);
      todos.push(...lidos);
      if (lidos.length < 20) break;
    }
    return todos;
  } catch {
    return lerAnexos((await pedir({ caminho: `${FE}/public/v1/compras/${compra.chave}/itens/${numeroItem}/participacoes/${cnpjEmpresa}/anexos`, captcha: true })).dados);
  }
}

const baixarAnexo = async (compra: CompraAcomp, item: ItemAcomp, cnpjEmpresa: string, a: AnexoCompras, minha: boolean) => {
  if (a.url) return salvarArquivo(await pedir({ url: a.url }), a.nome);
  void minha;
  const id = encodeURIComponent(a.id);
  // O site logado baixa o anexo de qualquer empresa por "participacao/{cnpj}"; a tela pública (com captcha) é a reserva.
  const r = await pedir({ caminho: `${FE}/v2/compras/${compra.chave}/itens/${item.numero}/participacao/${cnpjEmpresa}/anexos/${id}`, captcha: false, baixar: true }).catch(() =>
    pedir({ caminho: `${FE}/public/v2/compras/${compra.chave}/itens/${item.numero}/participacoes/${cnpjEmpresa}/anexos/${id}`, captcha: true, baixar: true }),
  );
  salvarArquivo(r, a.nome);
};

function MeusAnexos({ compra, item, cnpj, convocado }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; convocado: boolean }) {
  const caminho = `${FE}/v1/compras/${compra.chave}/itens/${item.numero}/participacao/${cnpj}/anexos`;
  const carga = useCarga(
    !!cnpj,
    async () => {
      // Como a tela oficial: em páginas (todos os anexos do item, da fase de propostas e das convocações).
      const todos: AnexoCompras[] = [];
      for (let pagina = 0; pagina < 10; pagina++) {
        const lidos = lerAnexos((await pedir({ caminho, captcha: false, query: `pagina=${pagina}&tamanhoPagina=20` })).dados);
        todos.push(...lidos);
        if (lidos.length < 20) break;
      }
      return todos;
    },
    `meus-anexos:${caminho}`,
  );
  const [ciente, setCiente] = useState(false);
  if (!cnpj) return <p className="texto-fraco">Entre no Compras.gov.br para ver os seus anexos.</p>;
  return (
    <>
      {convocado ? (
        <div className="termo-anexos">
          <p>É necessário o registro de ciência sobre o acesso irrestrito às informações para iniciar o envio de anexo.</p>
          <p>
            Declaro ciência de que todos os documentos e informações apresentados relacionados a este procedimento de contratação serão divulgados com acesso irrestrito
            para consulta pública no sistema. Dessa forma, documentos pessoais serão inseridos exclusivamente no SICAF, nos termos da Instrução Normativa vigente.
          </p>
          <label className="ciente-anexos">
            <input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} /> Ciente
          </label>
          <div className="linha-acoes">
            <EnviarArquivo
              rotulo="Anexar arquivo"
              desativado={!ciente}
              confirmar={(n) => `Enviar "${n}" ao Compras.gov.br como anexo do item ${item.numero}?`}
              enviar={async (arquivo) => {
                await pedir({ metodo: "POST", caminho, arquivo });
                carga.recarregar();
              }}
            />
            <span className="texto-fraco pequeno">PDF, DOC, XLS, ZIP e outros, até 30 MB cada.</span>
          </div>
        </div>
      ) : (
        <p className="texto-fraco pequeno">O envio de anexos só fica liberado quando o pregoeiro convoca você neste item.</p>
      )}
      <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
        <ListaAnexos
          anexos={carga.dados ?? []}
          baixar={(a) => baixarAnexo(compra, item, cnpj, a, true)}
          excluir={
            convocado
              ? async (a) => {
                  if (!window.confirm(`Excluir "${a.nome}" do Compras.gov.br?`)) return;
                  await pedir({ metodo: "DELETE", caminho: `${caminho}/${encodeURIComponent(a.id)}` });
                  carga.recarregar();
                }
              : undefined
          }
        />
      </Estado>
    </>
  );
}

function AnexosEmpresa({ compra, item, empresa, aoContar }: { compra: CompraAcomp; item: ItemAcomp; empresa: PropostaEmpresa; aoContar?: (n: number) => void }) {
  const caminho = `/v1/compras/${compra.chave}/itens/${item.numero}/participacoes/${empresa.cnpj}/anexos`;
  const carga = useCarga(true, () => anexosDaEmpresa(compra, item.numero, empresa.cnpj), caminho);
  useEffect(() => {
    if (carga.dados) aoContar?.(carga.dados.length);
  }, [carga.dados, aoContar]);
  return (
    <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
      <ListaAnexos anexos={carga.dados ?? []} baixar={(a) => baixarAnexo(compra, item, empresa.cnpj, a, false)} />
    </Estado>
  );
}

// ---------- Diligências ----------

const SITUACAO_DILIGENCIA: Record<string, string> = { A: "Em andamento", E: "Encerrada", C: "Cancelada", EM_ANDAMENTO: "Em andamento", ENCERRADA: "Encerrada", CANCELADA: "Cancelada" };

interface Diligencia {
  id: string;
  situacao: string;
  motivo: string;
  criadaEm: string;
  encerradaEm: string;
  prazoAnexos: string;
  pedeAnexos: boolean;
}

function lerDiligencias(dados: unknown): Diligencia[] {
  const lista = Array.isArray(dados) ? dados : dados && typeof dados === "object" ? [dados] : [];
  return (lista as Record<string, unknown>[]).map((d, i) => ({
    id: String(d.id ?? d.sequencial ?? i + 1),
    situacao: SITUACAO_DILIGENCIA[String(d.situacao ?? "")] ?? String(d.situacao ?? ""),
    motivo: String(d.motivo ?? d.descricao ?? d.texto ?? ""),
    criadaEm: String(d.dataHoraCriacao ?? d.dataHoraInicio ?? ""),
    encerradaEm: String(d.dataHoraEncerramento ?? ""),
    prazoAnexos: String(d.dataHoraLimiteEnvioAnexos ?? d.dataHoraLimite ?? ""),
    pedeAnexos: String(d.situacaoUltimaSolicitacaoAnexos ?? "") === "S",
  }));
}

function Diligencias({ compra, item, cnpj, podeEnviar }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; podeEnviar?: boolean }) {
  const base = `${FE}/v1/compras/${compra.chave}/itens/${item.numero}/participacoes/${cnpj}/diligencias`;
  const carga = useCarga(!!cnpj, async () => lerDiligencias((await pedir({ caminho: base, captcha: true })).dados), base);
  const [aberta, setAberta] = useState<string | null>(null);
  if (!cnpj) return null;
  const lista = carga.dados ?? [];
  return (
    <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
      {lista.length === 0 ? (
        <p className="texto-fraco pequeno">Nenhuma diligência neste item.</p>
      ) : (
        <ul className="diligencias-compras">
          {lista.map((d) => (
            <li key={d.id} className={d.situacao === "Em andamento" ? "andamento" : ""}>
              <button className="linha-diligencia" onClick={() => setAberta(aberta === d.id ? null : d.id)} aria-expanded={aberta === d.id}>
                <span>
                  <strong>{d.motivo || `Diligência ${d.id}`}</strong>
                  <small className="texto-fraco">
                    {[d.criadaEm && `Aberta em ${dataHora(d.criadaEm)}`, d.prazoAnexos && `Prazo dos anexos ${dataHora(d.prazoAnexos)}`, d.encerradaEm && `Encerrada em ${dataHora(d.encerradaEm)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                {d.situacao && <span className={`chip ${d.situacao === "Em andamento" ? "amarelo" : "cinza"}`}>{d.situacao}</span>}
                <ChevronDown size={16} className="seta-todas" />
              </button>
              {aberta === d.id && <DetalheDiligencia base={base} compra={compra} item={item} cnpj={cnpj} id={d.id} />}
            </li>
          ))}
        </ul>
      )}
      {podeEnviar && (
        <div className="linha-acoes">
          <EnviarArquivo
            rotulo="Enviar documento da diligência"
            confirmar={(n) => `Enviar "${n}" ao Compras.gov.br como resposta à diligência do item ${item.numero}?`}
            enviar={async (arquivo) => {
              await pedir({ metodo: "POST", caminho: `${base}/anexos-participante`, arquivo });
              carga.recarregar();
            }}
          />
        </div>
      )}
    </Estado>
  );
}

function DetalheDiligencia({ base, compra, item, cnpj, id }: { base: string; compra: CompraAcomp; item: ItemAcomp; cnpj: string; id: string }) {
  const carga = useCarga(true, async () => obj((await pedir({ caminho: `${base}/${id}`, captcha: true })).dados), `${base}/${id}`);
  const d = carga.dados ?? {};
  const baixar = (origem: "governo" | "participante") => async (a: AnexoCompras) => {
    const caminho = `${FE}/v2/compras/${compra.chave}/itens/${item.numero}/participacoes/${cnpj}/diligencias/anexos-${origem}/${encodeURIComponent(a.id)}`;
    salvarArquivo(await pedir({ caminho, captcha: true, baixar: true }), a.nome);
  };
  return (
    <div className="detalhe-diligencia">
      <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
        {typeof d.analise === "string" && d.analise && (
          <p>
            <b>Análise:</b> {d.analise}
          </p>
        )}
        {typeof d.conclusao === "string" && d.conclusao && (
          <p>
            <b>Conclusão:</b> {d.conclusao}
          </p>
        )}
        <span className="texto-suave pequeno">Arquivos do pregoeiro</span>
        <ListaAnexos anexos={lerAnexos(d.anexosGoverno ?? [])} baixar={baixar("governo")} vazio="Nenhum arquivo do pregoeiro." />
        <span className="texto-suave pequeno">Arquivos que você enviou</span>
        <ListaAnexos anexos={lerAnexos(d.anexosParticipante ?? [])} baixar={baixar("participante")} vazio="Nenhum arquivo enviado." />
      </Estado>
    </div>
  );
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// ---------- Todos os participantes ----------

function TodasPropostas({
  compra,
  item,
  cnpj,
  lista,
  iniciais,
  nomes,
  analise,
}: {
  compra: CompraAcomp;
  item: ItemAcomp;
  cnpj: string;
  lista: PropostaEmpresa[];
  iniciais: boolean;
  nomes: Map<string, string>;
  analise: ReturnType<typeof analisarPropostas>;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [anexos, setAnexos] = useState<Record<string, number | "lendo" | "erro">>({});
  const [conferindo, setConferindo] = useState(false);
  const minhaPos = lista.findIndex((p) => p.cnpj === cnpj);
  const aFrente = (minhaPos > 0 ? lista.slice(0, minhaPos) : []).filter((p) => p.cnpj && !p.desclassificada).slice(0, 10);
  // O Compras.gov.br já diz quantos anexos cada empresa mandou; só confere um a um se não disser.
  const qtdAnexos = (p: PropostaEmpresa) => (typeof anexos[p.cnpj] === "number" ? (anexos[p.cnpj] as number) : p.quantidadeAnexos);
  const semContagem = aFrente.filter((p) => p.quantidadeAnexos == null && typeof anexos[p.cnpj] !== "number");

  async function conferirAnexos() {
    setConferindo(true);
    for (const p of semContagem) {
      setAnexos((a) => ({ ...a, [p.cnpj]: "lendo" }));
      try {
        const lidos = await anexosDaEmpresa(compra, item.numero, p.cnpj);
        setAnexos((a) => ({ ...a, [p.cnpj]: lidos.length }));
      } catch {
        setAnexos((a) => ({ ...a, [p.cnpj]: "erro" }));
      }
    }
    setConferindo(false);
  }
  const conhecidas = aFrente.filter((p) => qtdAnexos(p) != null);
  const semAnexos = conhecidas.filter((p) => qtdAnexos(p) === 0);

  if (!lista.length) return <p className="texto-fraco">O Compras.gov.br ainda não mostra as propostas deste item (elas aparecem depois da disputa).</p>;
  return (
    <div className="painel-compras">
      <div className="resumo-todos">
        <span>
          <strong>{lista.length}</strong> propostas
        </span>
        <span>
          <strong>{analise?.desclassificadas ?? 0}</strong> desclassificadas
        </span>
        {minhaPos >= 0 && (
          <span>
            Você: <strong>{lista[minhaPos].colocacao ?? minhaPos + 1}º</strong>
            {analise?.posicaoValida ? ` · ${analise.posicaoValida}ª entre as válidas` : ""}
          </span>
        )}
        {iniciais && <span className="texto-fraco">Propostas iniciais (antes da disputa)</span>}
      </div>
      {aFrente.length > 0 && (
        <div className="conferir-anexos">
          {semContagem.length > 0 && (
            <button className="botao secundario pequeno" onClick={conferirAnexos} disabled={conferindo}>
              {conferindo ? <Loader2 className="girando" /> : <Paperclip />} Conferir anexos de quem está à sua frente
            </button>
          )}
          {conhecidas.length === aFrente.length && (
            <span className={semAnexos.length ? "texto-verde" : "texto-suave"}>
              {semAnexos.length
                ? aFrente.length === 1
                  ? "A empresa à sua frente não enviou anexos: se o edital exige, ela tende a ser recusada e você sobe."
                  : `${semAnexos.length} de ${aFrente.length} empresas à sua frente não enviaram anexos: se o edital exige, elas tendem a ser recusadas e você sobe.`
                : aFrente.length === 1
                  ? "A empresa à sua frente enviou anexos."
                  : "Todas as empresas à sua frente enviaram anexos."}
            </span>
          )}
        </div>
      )}
      <ol className="todas-propostas">
        {lista.map((p, i) => {
          const minha = !!cnpj && p.cnpj === cnpj;
          const chave = p.cnpj || String(i);
          const aberto = aberta === chave;
          const n = anexos[p.cnpj] === "lendo" ? "lendo" : qtdAnexos(p);
          return (
            <li key={chave} className={`${minha ? "minha" : ""} ${p.desclassificada ? "fora" : ""} ${aberto ? "aberta" : ""}`}>
              <button className="linha-todas" onClick={() => setAberta(aberto ? null : chave)} aria-expanded={aberto}>
                <span className="posicao-proposta">{p.colocacao ?? i + 1}º</span>
                <span className="nome-todas">
                  <span>
                    {p.empresa} {minha && <span className="chip azul">Você</span>}
                  </span>
                  <small>
                    {cnpjFormatadoAcomp(p.cnpj)}
                    {p.uf ? ` · ${p.uf}` : ""}
                    {p.meEpp ? " · ME/EPP" : ""}
                    {p.marca ? ` · ${p.marca}${p.modelo ? ` ${p.modelo}` : ""}` : ""}
                  </small>
                  {p.desclassificada && p.motivo && <small className="texto-vermelho">Motivo: {resumir(p.motivo, 140)}</small>}
                </span>
                <span className="valores-todas">
                  <span>
                    <small>Ofertado</small> {moeda4(p.valorOfertado ?? p.valor)}
                  </span>
                  {p.valorNegociado != null && (
                    <span>
                      <small>Negociado</small> {moeda4(p.valorNegociado)}
                    </span>
                  )}
                </span>
                <span className="chips-todas">
                  {p.desclassificada && <span className="chip vermelho">{p.situacao || "Desclassificada"}</span>}
                  {!p.desclassificada && p.situacao && <span className="chip verde">{p.situacao}</span>}
                  {p.convocada && <span className="chip amarelo">Convocada</span>}
                  {n === "lendo" && <Loader2 className="girando" size={13} />}
                  {n === 0 && <span className="chip vermelho">Sem anexos</span>}
                  {typeof n === "number" && n > 0 && <span className="chip cinza">{n === 1 ? "1 anexo" : `${n} anexos`}</span>}
                </span>
                <ChevronDown className="seta-todas" size={18} />
              </button>
              {aberto && (
                <div className="detalhe-empresa">
                  <section className="cartao-secao-compras">
                    <h4>
                      <FileText size={15} /> Proposta
                    </h4>
                    <DadosProposta p={p} quantidadeItem={item.quantidade} />
                  </section>
                  <div className="colunas-minha-participacao">
                    <section className="cartao-secao-compras">
                      <h4>
                        <MessageSquare size={15} /> Conversa com o pregoeiro
                      </h4>
                      <Chat compra={compra} item={item} cnpj={cnpj} nomes={nomes} empresa={p} participante={p.cnpj} />
                    </section>
                    <div className="pilha-secoes">
                      <section className="cartao-secao-compras">
                        <h4>
                          <Paperclip size={15} /> Anexos
                        </h4>
                        {minha ? (
                          <MeusAnexos compra={compra} item={item} cnpj={cnpj} convocado={false} />
                        ) : (
                          <AnexosEmpresa compra={compra} item={item} empresa={p} aoContar={(c) => setAnexos((a) => (a[p.cnpj] === c ? a : { ...a, [p.cnpj]: c }))} />
                        )}
                      </section>
                      <section className="cartao-secao-compras">
                        <h4>
                          <ShieldQuestion size={15} /> Diligências
                        </h4>
                        <Diligencias compra={compra} item={item} cnpj={p.cnpj} />
                      </section>
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- Lances ----------

interface LanceItem {
  valor: number | null;
  dataHora: string;
  cnpj: string;
  excluido: boolean;
  melhorDoParticipante: boolean;
}

/** Lances do item como a tela "Lances" do Compras.gov.br (em páginas; o fornecedor consulta com captcha). */
async function lerLancesDoItem(caminho: string, paginas = 5): Promise<LanceItem[]> {
  const todos: LanceItem[] = [];
  for (let pagina = 0; pagina < paginas; pagina++) {
    const query = `pagina=${pagina}&tamanhoPagina=100`;
    const r = await pedir({ caminho, query, captcha: true }).catch(() => pedir({ caminho, query, captcha: false }));
    const lista = Array.isArray(r.dados) ? (r.dados as Record<string, unknown>[]) : [];
    for (const l of lista) {
      const v = l.valor && typeof l.valor === "object" ? (l.valor as Record<string, unknown>) : null;
      const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" && !Number.isNaN(Number(x)) ? Number(x) : null);
      const part = l.participante && typeof l.participante === "object" ? (l.participante as Record<string, unknown>) : {};
      todos.push({
        valor: v ? (num(v.valorCalculado) ?? num((v.valorCalculado as Record<string, unknown> | undefined)?.valorUnitario) ?? num(v.valorInformado)) : num(l.valor ?? l.valorInformado ?? l.valorCalculado),
        dataHora: String(l.dataHoraInclusao ?? l.dataHora ?? l.dataHoraLance ?? l.dataHoraEnvio ?? ""),
        cnpj: idEmpresa(l.identificacaoParticipante ?? l.identificacao ?? part.identificacao),
        excluido: l.excluido === true,
        melhorDoParticipante: l.melhorDoParticipante === true,
      });
    }
    if (lista.length < 100) break;
  }
  return todos;
}

function Lances({ compra, item, cnpj, nomes }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; nomes: Map<string, string> }) {
  const base = `/comprasnet-disputa/v1/compras/${compra.chave}/itens/${item.numero}/lances`;
  const melhores = useCarga(true, () => lerLancesDoItem(`${base}/por-participante`, 2), `lances-melhores:${base}`);
  const todos = useCarga(true, () => lerLancesDoItem(base), `lances-todos:${base}`);
  const propostas = jaLido<PropostasDoItem>(chavePropostas(compra, item.numero));
  const minha = propostas?.minha ?? null;
  const meuValor = minha ? (minha.valorOfertado ?? minha.valor) : item.meuValor;
  // A lista de lances não diz de quem é cada lance; o seu é reconhecido pela empresa (quando vem) ou pelo seu valor.
  const eMeu = (l: LanceItem) => (l.cnpj ? l.cnpj === cnpj : meuValor != null && l.valor != null && Math.abs(l.valor - meuValor) < 0.00005);
  const ranking = (melhores.dados ?? []).filter((l) => !l.excluido && l.valor != null).sort((a, b) => (a.valor ?? 0) - (b.valor ?? 0));
  const lista = [...(todos.dados ?? [])].sort((a, b) => dataDe(b.dataHora) - dataDe(a.dataHora));
  const meus = lista.filter((l) => !l.excluido && eMeu(l)).length;
  return (
    <div className="painel-compras">
      <section className="cartao-secao-compras">
        <h4>
          <Gavel size={15} /> Melhor lance de cada participante
        </h4>
        <Estado carregando={melhores.carregando} erro={melhores.erro} recarregar={melhores.recarregar}>
          {ranking.length === 0 ? (
            <p className="texto-fraco pequeno">O Compras.gov.br não mostra lances neste item (pode não ter tido disputa, ou ela ainda não começou).</p>
          ) : (
            <table className="tabela-lances-compras">
              <thead>
                <tr>
                  <th>Posição</th>
                  <th>Participante</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((l, i) => (
                  <tr key={i} className={eMeu(l) ? "meu" : ""}>
                    <td>{i + 1}º</td>
                    <td>{eMeu(l) ? "Você" : l.cnpj ? nomes.get(l.cnpj) || cnpjFormatadoAcomp(l.cnpj) : "Fornecedor"}</td>
                    <td>{moeda4(l.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Estado>
      </section>
      <section className="cartao-secao-compras">
        <h4>
          <Gavel size={15} /> Todos os lances {lista.length ? `(${lista.length}${meus ? ` · ${meus} seus` : ""})` : ""}
        </h4>
        <Estado carregando={todos.carregando} erro={todos.erro} recarregar={todos.recarregar}>
          {lista.length === 0 ? (
            <p className="texto-fraco pequeno">Nenhum lance registrado neste item.</p>
          ) : (
            <div className="rolagem-lances">
              <table className="tabela-lances-compras tabela-todos-lances">
                <thead>
                  <tr>
                    <th>Data/hora</th>
                    <th>Valor</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((l, i) => (
                    <tr key={i} className={`${eMeu(l) ? "meu" : ""} ${l.excluido ? "excluido" : ""}`}>
                      <td>{dataHoraSeg(l.dataHora)}</td>
                      <td>{moeda4(l.valor)}</td>
                      <td>{[l.excluido && "Excluído pelo pregoeiro", eMeu(l) && "Seu lance", l.melhorDoParticipante && "Melhor do participante"].filter(Boolean).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Estado>
      </section>
    </div>
  );
}

const dataHoraSeg = (s: string) => {
  const t = dataDe(s);
  return t ? new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
};

// ---------- Recursos ----------

function Recursos({ compra, item, cnpj, nomes }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; nomes: Map<string, string> }) {
  const caminho = `/v1/compras/${compra.chave}/itens/${item.numero}/fase-recursal/${item.sessao}`;
  const carga = useCarga(
    true,
    async () => {
      const d = await consultar(caminho).catch(async (e) => {
        if (!cnpj) throw e;
        return (await pedir({ caminho: `${FE}/v1/compras/${compra.chave}/itens/${item.numero}/fase-recursal-fornecedor/${item.sessao}`, captcha: false })).dados;
      });
      return lerFaseRecursal(d);
    },
    caminho,
  );
  const [ocupado, setOcupado] = useState(false);
  const fase: FaseRecursal | null = carga.dados ?? null;
  const v1 = `${FE}/v1/compras/${compra.chave}/itens/${item.numero}`;
  const minha = fase?.empresas.find((e) => e.cnpj === cnpj);
  const nome = (c: string, n: string) => (c === cnpj ? "Você" : n || nomes.get(c) || cnpjFormatadoAcomp(c));
  const prazoAberto = (rotulo: RegExp) => fase?.prazos.some((p) => rotulo.test(p.rotulo) && dataDe(p.dataHora) > Date.now()) ?? false;

  async function acao(texto: string, p: PedidoFornecedor) {
    if (!window.confirm(texto)) return;
    setOcupado(true);
    try {
      await pedir(p);
      avisar("Feito no Compras.gov.br.");
      carga.recarregar();
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setOcupado(false);
    }
  }

  async function baixarArquivos(caminhoV2: string, rotulo: string) {
    try {
      const dados = await consultar(caminhoV2);
      const anexos = lerAnexos(Array.isArray(dados) ? dados : [dados]);
      if (!anexos.length) return avisar("Sem arquivos.", "erro");
      for (const a of anexos) salvarArquivo(await pedir(a.url ? { url: a.url } : { caminho: `${FE}${caminhoV2}`, captcha: true, baixar: true }), a.nome || rotulo);
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    }
  }

  return (
    <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
      {fase?.prazos.length ? (
        <div className="prazos-recurso">
          {fase.prazos.map((p) => (
            <span key={p.rotulo} className={dataDe(p.dataHora) > Date.now() ? "aberto" : ""}>
              <b>{p.rotulo}</b> até {dataHora(p.dataHora)}
            </span>
          ))}
        </div>
      ) : (
        <p className="texto-fraco pequeno">Este item ainda não tem fase recursal aberta.</p>
      )}
      <div className="linha-acoes">
        {prazoAberto(/julgamento/i) && (
          <button
            className="botao secundario pequeno"
            disabled={ocupado}
            onClick={() => acao(`Registrar intenção de recurso no JULGAMENTO DA PROPOSTA do item ${item.numero}?`, { metodo: "POST", caminho: `${v1}/intencoes-recurso`, corpo: { etapaSelecaoFornecedores: "JP" } })}
          >
            Intenção de recurso (julgamento)
          </button>
        )}
        {prazoAberto(/habilitação/i) && (
          <button
            className="botao secundario pequeno"
            disabled={ocupado}
            onClick={() => acao(`Registrar intenção de recurso na HABILITAÇÃO do item ${item.numero}?`, { metodo: "POST", caminho: `${v1}/intencoes-recurso`, corpo: { etapaSelecaoFornecedores: "HF" } })}
          >
            Intenção de recurso (habilitação)
          </button>
        )}
        {(minha?.intencao || minha?.etapa) && prazoAberto(/recurso$/i) && (
          <EnviarArquivo
            rotulo="Enviar recurso (arquivo)"
            confirmar={(n) => `Enviar "${n}" como RECURSO do item ${item.numero}? Depois, clique em "Concluir envio do recurso".`}
            enviar={async (arquivo) => {
              await pedir({ metodo: "POST", caminho: `${v1}/recursos`, arquivo });
              carga.recarregar();
            }}
          />
        )}
        {minha?.temRecurso && (
          <button className="botao acento pequeno" disabled={ocupado} onClick={() => acao(`Concluir o envio do recurso do item ${item.numero}? Depois disso não dá para mudar.`, { metodo: "PUT", caminho: `${v1}/recursos`, corpo: null })}>
            Concluir envio do recurso
          </button>
        )}
      </div>
      {fase && fase.empresas.length > 0 && (
        <ul className="recursos-compras">
          {fase.empresas.map((e) => (
            <li key={e.cnpj}>
              <strong>{nome(e.cnpj, e.empresa)}</strong>
              {e.intencao || e.etapa ? (
                <span>
                  Intenção de recurso{e.etapa ? ` (${e.etapa})` : ""} {e.dataIntencao && <span className="texto-fraco pequeno">{dataHora(e.dataIntencao)}</span>}
                  {e.intencao && <q>{e.intencao}</q>}
                </span>
              ) : null}
              {e.temRecurso && (
                <span>
                  Recurso: {e.situacaoRecurso || "enviado"} {e.dataRecurso && <span className="texto-fraco pequeno">{dataHora(e.dataRecurso)}</span>}{" "}
                  <button className="botao-link sem-margem" onClick={() => baixarArquivos(`/v2/compras/${compra.chave}/itens/${item.numero}/fase-recursal/${item.sessao}/recursos/${e.cnpj}/arquivos`, "recurso")}>
                    Baixar recurso
                  </button>
                </span>
              )}
              {e.contrarrazoes.map((c) => (
                <span key={c.cnpj} className="contrarrazao-compras">
                  Contrarrazão de {nome(c.cnpj, c.empresa)}: {c.situacao || "enviada"}{" "}
                  <button
                    className="botao-link sem-margem"
                    onClick={() => baixarArquivos(`/v2/compras/${compra.chave}/itens/${item.numero}/fase-recursal/${item.sessao}/recursos/${e.cnpj}/contrarrazoes/${c.cnpj}/arquivos`, "contrarrazao")}
                  >
                    Baixar
                  </button>
                </span>
              ))}
              {e.temRecurso && e.cnpj !== cnpj && prazoAberto(/contrarraz/i) && (
                <div className="linha-acoes">
                  <EnviarArquivo
                    rotulo="Enviar contrarrazão"
                    confirmar={(n) => `Enviar "${n}" como CONTRARRAZÃO ao recurso de ${nome(e.cnpj, e.empresa)}? Depois, clique em "Concluir contrarrazão".`}
                    enviar={async (arquivo) => {
                      await pedir({ metodo: "POST", caminho: `${v1}/recursos/${e.cnpj}/contrarrazoes`, arquivo });
                      carga.recarregar();
                    }}
                  />
                  {e.contrarrazoes.some((c) => c.cnpj === cnpj) && (
                    <button className="botao acento pequeno" disabled={ocupado} onClick={() => acao("Concluir o envio da contrarrazão? Depois disso não dá para mudar.", { metodo: "PUT", caminho: `${v1}/recursos/${e.cnpj}/contrarrazoes`, corpo: null })}>
                      Concluir contrarrazão
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {(fase?.decisao || fase?.revisao) && (
        <div className="decisao-recurso">
          {[fase.decisao && { t: "Decisão do pregoeiro", d: fase.decisao }, fase.revisao && { t: "Decisão da autoridade", d: fase.revisao }]
            .filter((x): x is { t: string; d: NonNullable<FaseRecursal["decisao"]> } => !!x)
            .map(({ t, d }) => (
              <div key={t}>
                <strong>
                  {t}: {d.situacao}
                </strong>
                <span className="texto-fraco pequeno">{[d.responsavel, dataHora(d.dataHora)].filter(Boolean).join(" · ")}</span>
                {d.fundamentacao && <p>{d.fundamentacao}</p>}
              </div>
            ))}
          <button className="botao-link sem-margem" onClick={() => baixarArquivos(`/v2/compras/${compra.chave}/itens/${item.numero}/fase-recursal/${item.sessao}/arquivos`, "decisao")}>
            Baixar arquivos da decisão
          </button>
        </div>
      )}
    </Estado>
  );
}

