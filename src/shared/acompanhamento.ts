// Acompanhamento das participações no Compras.gov.br (aba "Acompanhamento").
// O aplicativo do Windows lê as listas oficiais com a sessão da pessoa e repassa os dados como vieram;
// aqui eles viram uma forma simples para a tela: compras, itens com colocação e chance, mensagens e avisos.
// Os nomes dos campos seguem a Área do Fornecedor do Compras.gov.br; quando algum faltar, a tela mostra "—".

type Bruto = Record<string, unknown>;

const obj = (v: unknown): Bruto => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : {});
const texto = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const numero = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const primeiro = (...v: unknown[]) => v.find((x) => x != null && x !== "");

/**
 * CNPJ/CPF só com números (com os zeros à esquerda). O Compras.gov.br escreve a mesma empresa de jeitos diferentes
 * (com pontuação, como número...), então toda comparação "é a minha empresa?" passa por aqui.
 */
export function idEmpresa(v: unknown): string {
  const d = texto(typeof v === "number" ? v.toFixed(0) : v).replace(/\D/g, "");
  if (!d) return "";
  if (d.length > 11 && d.length < 14) return d.padStart(14, "0");
  if (d.length < 11) return d.padStart(11, "0");
  return d;
}

export const FASES_COMPRA: Record<string, string> = {
  "1": "Aguardando abertura",
  "2": "Análise de propostas",
  "3": "Disputa",
  "4": "Seleção de fornecedores",
  "5": "Carregando",
  "6": "Aguardando publicação",
  "99": "Disputa agendada",
};

export const SITUACOES_COMPRA: Record<string, string> = {
  PD: "Publicada",
  RE: "Revogada",
  AN: "Anulada",
  SU: "Suspensa",
  FR: "Fracassada",
  DE: "Deserta",
};

export const SITUACOES_PROPOSTA: Record<string, string> = {
  "1": "Proposta desclassificada",
  "2": "Proposta desclassificada",
  "9": "Proposta desclassificada",
  "3": "Proposta aceita",
  "4": "Habilitado",
  "5": "Inabilitado",
  "6": "Adjudicada",
  "7": "Pendente aceite para assumir cota",
  "8": "Recusou assumir cota",
};

const SITUACOES_ITEM: Record<string, string> = {
  "2": "Cancelado",
  "3": "Anulado",
  "13": "Anulado",
  "4": "Revogado",
  "14": "Revogado",
  "5": "Suspenso",
  "6": "Deserto",
  "7": "Fracassado",
  "8": "Fracassado",
  "9": "Fracassado",
};

const FASES_ITEM: Record<string, string> = {
  AS: "Aguardando abertura",
  AP: "Análise de propostas",
  F: "Aguardando disputa",
  AA: "Aguardando abertura",
  LS: "Abertura suspensa",
  LA: "Em disputa",
  LF: "Etapa fechada",
  AL: "Em disputa (aleatório)",
  FE: "Aguardando encerramento",
  AF: "Aguardando disputa fechada",
  AM: "Desempate ME/EPP",
  DM: "Desempate ME/EPP",
  DF: "Disputa final",
  JT: "Julgamento técnico",
  E: "Disputa encerrada",
};

const DESCLASSIFICADA = new Set(["1", "2", "9"]);

export function modalidadePelaChave(chave: string) {
  const m = chave.slice(6, 8);
  return m === "05" ? "Pregão" : m === "06" ? "Dispensa" : m === "03" ? "Concorrência" : m === "08" ? "Cotação" : "Compra";
}

/** "17000705900122026" → "90012/2026" */
export function numeroPelaChave(chave: string) {
  if (!/^\d{17}$/.test(chave)) return chave;
  return `${chave.slice(8, 13).replace(/^0+(?=\d)/, "")}/${chave.slice(13)}`;
}

function chaveDe(x: Bruto): string {
  const c = { ...obj(x.compraFaseExterna), ...obj(x.dadosCompra), ...obj(x.compra) };
  const direta = texto(primeiro(x.chaveCompra, c.chaveCompra));
  if (direta) return direta;
  for (const fonte of [x, c]) {
    for (const k of ["idCompra", "identificadorCompra", "chave", "id", "codigoCompra"]) {
      const v = texto(fonte[k]);
      if (/^\d{17}$/.test(v)) return v;
    }
  }
  const uasg = texto(primeiro(x.numeroUasg, c.numeroUasg, c.uasg, x.uasg, c.codigoUasg, x.codigoUasg, c.codigoUnidade)).replace(/\D/g, "");
  const mod = texto(primeiro(x.modalidade, c.modalidade, c.codigoModalidade)).replace(/\D/g, "");
  const num = texto(primeiro(x.numeroCompra, c.numeroCompra, c.numero)).replace(/\D/g, "");
  const ano = texto(primeiro(x.anoCompra, c.anoCompra, c.ano)).replace(/\D/g, "");
  if (!uasg || !mod || !num || ano.length !== 4) return "";
  return uasg.padStart(6, "0") + mod.padStart(2, "0") + num.padStart(5, "0") + ano;
}

export interface Participacao {
  chave: string;
  modalidade: string;
  numero: string;
  uasg: string;
  orgao: string;
  objeto: string;
  fase: string;
  /** Fase da compra no Compras.gov.br (1 propostas, 2 análise, 3 disputa, 4 seleção de fornecedores...). */
  faseCodigo: string;
  situacao: string;
  abertura: string | null;
  linkPncp: string | null;
  encerrada: boolean;
  /** Da lista de participações (sem abrir a compra): diligência ou convocação de remanescentes em andamento. */
  diligencia: boolean;
  convocacaoRemanescentes: boolean;
}

export function lerParticipacao(bruto: unknown): Participacao | null {
  const x = obj(bruto);
  const c = { ...x, ...obj(x.compraFaseExterna), ...obj(x.dadosCompra), ...obj(x.compra) };
  const chave = chaveDe(x);
  if (!chave) return null;
  const faseCod = texto(numero(c.faseCompraFaseExterna) ?? c.faseCompraFaseExterna);
  const sitCod = texto(c.situacaoCompraFaseExterna);
  const sit = SITUACOES_COMPRA[sitCod] ?? "";
  return {
    chave,
    modalidade: modalidadePelaChave(chave),
    numero: numeroPelaChave(chave),
    uasg: texto(primeiro(c.numeroUasg, c.uasg)) || chave.slice(0, 6),
    orgao: texto(primeiro(c.nomeUasg, c.nomeUnidade, c.unidadeOrgao && obj(c.unidadeOrgao).nome, c.orgao, c.nomeOrgao)),
    objeto: texto(primeiro(c.objeto, c.descricaoObjeto)),
    fase: sit && sitCod !== "PD" ? sit : (FASES_COMPRA[faseCod] ?? (c.homologada ? "Homologada" : "")),
    faseCodigo: faseCod,
    situacao: sit,
    abertura: texto(primeiro(c.dataHoraAbertura, c.dataHoraPrevisaoAbertura, c.dataHoraInicioDisputa)) || null,
    linkPncp: texto(c.linkPncp) || null,
    encerrada: ["RE", "AN", "FR", "DE"].includes(sitCod) || !!c.homologada,
    diligencia: x.possuiDiligenciaEmAndamento === true,
    convocacaoRemanescentes: x.possuiConvRemanescentesEmAndamento === true,
  };
}

export type Chance = "ganhou" | "alta" | "media" | "baixa" | "fora" | "aguardando" | "encerrado";

export const ROTULO_CHANCE: Record<Chance, string> = {
  ganhou: "Ganhou",
  alta: "Chance boa",
  media: "Chance média",
  baixa: "Chance baixa",
  fora: "Fora",
  aguardando: "Aguardando",
  encerrado: "Item encerrado",
};

export interface Pendencia {
  tipo: "anexos" | "negociacao" | "diligencia" | "cota";
  rotulo: string;
}

export interface ItemAcomp {
  numero: number;
  descricao: string;
  quantidade: number | null;
  participantes: number | null;
  colocacao: number | null;
  situacao: string; // situação da proposta (aceita, habilitado...)
  codigoSituacao: string;
  fase: string;
  meuValor: number | null;
  melhorValor: number | null;
  marca: string;
  modelo: string;
  motivo: string;
  pendencias: Pendencia[];
  chatAberto: boolean;
  chance: Chance;
  explicacao: string;
  /** Sessão de julgamento/habilitação (usada na fase recursal). */
  sessao: number;
  prazoIntencao: string;
  /** Situação do item como o Compras.gov.br escreve ("Aguardando julgamento"...). */
  etapa: string;
  valorEstimado: number | null;
  /** A sua proposta como veio na lista de itens (reserva quando a tela do item demora). */
  propostaBruta: unknown;
  /** Se você tem proposta neste item (os outros itens da compra aparecem em "Todos os itens"). */
  participa: boolean;
}

const PENDENCIAS: [string, Pendencia["tipo"], string][] = [
  ["situacaoUltimaSolicitacaoAnexos", "anexos", "Envio de anexos / proposta ajustada"],
  ["situacaoUltimaNegociacao", "negociacao", "Negociação de valor"],
  ["situacaoUltimaDiligencia", "diligencia", "Diligência"],
  ["situacaoUltimaSolicitacaoAssumirCota", "cota", "Assumir cota"],
];

/**
 * Valor unitário de um campo de valor do Compras.gov.br. Na tela do item ele vem como
 * { valorCalculado: { valorUnitario, valorTotal }, valorInformado }; em outras telas, como número.
 */
const valorDe = (v: unknown): number | null => {
  if (v == null) return null;
  const n = numero(v);
  if (n != null) return n;
  const o = obj(v);
  if (o.valorUnitario != null) return numero(o.valorUnitario);
  if (o.valorCalculado != null) return valorDe(o.valorCalculado);
  return numero(primeiro(o.valorInformado, o.valor));
};

/** Valor total (unitário × quantidade) quando o Compras.gov.br informa. */
const totalDe = (v: unknown): number | null => {
  const o = obj(v);
  if (o.valorTotal != null) return numero(o.valorTotal);
  return o.valorCalculado != null && typeof o.valorCalculado === "object" ? totalDe(o.valorCalculado) : null;
};

export function lerItemAcomp(bruto: unknown): ItemAcomp | null {
  const x = obj(bruto);
  const n = numero(primeiro(x.numero, x.numeroItem, x.identificador));
  if (n == null) return null;
  const p = obj(primeiro(x.propostaItem, x.proposta));
  const valores = obj(p.valores);
  const codigoSituacao = texto(primeiro(p.situacao, x.situacaoProposta));
  const situacaoItem = texto(numero(x.situacao) ?? x.situacao);
  const fase = FASES_ITEM[texto(x.fase)] ?? "";
  const colocacao = numero(primeiro(p.classificacao, x.classificacao, x.posicao, x.classificacaoPropostaFornecedor));
  const participantes = numero(primeiro(x.qtdeParticipantes, x.quantidadeParticipantes, x.qtdePropostas));
  const pendencias: Pendencia[] = PENDENCIAS.filter(([campo]) => texto(primeiro(p[campo], x[campo])) === "S").map(([, tipo, rotulo]) => ({ tipo, rotulo }));
  const desclassificado = DESCLASSIFICADA.has(codigoSituacao) || x.desclassificado === true || p.desclassificado === true;
  const item: ItemAcomp = {
    numero: n,
    descricao: texto(primeiro(x.descricao, x.descricaoDetalhada, x.nome, x.descricaoItem)) || `Item ${n}`,
    quantidade: numero(primeiro(x.quantidadeSolicitada, x.quantidade, p.quantidadeOfertada)),
    participantes,
    colocacao,
    situacao: SITUACOES_PROPOSTA[codigoSituacao] ?? (SITUACOES_ITEM[situacaoItem] || ""),
    codigoSituacao,
    fase,
    meuValor: valorDe(primeiro(valores.valorNegociado, valores.valorPropostaInicialOuLances, valores.valorPropostaInicial, x.melhorValorFornecedor)),
    melhorValor: valorDe(primeiro(p.melhorValorAtual, x.melhorValorGeral, x.melhorValor)),
    marca: texto(primeiro(p.marcaFabricante, x.marcaFabricante)),
    modelo: texto(primeiro(p.modeloVersao, x.modeloVersao)),
    motivo: texto(primeiro(p.motivoDesclassificacao, x.motivoDesclassificacao, x.justificativaDesclassificacao)),
    pendencias,
    chatAberto: p.canalChatAberto === true,
    chance: "aguardando",
    explicacao: "",
    sessao: numero(primeiro(x.numeroSessaoJulgHab, x.sessaoJulgamentoHabilitacao)) ?? 1,
    prazoIntencao: texto(primeiro(obj(x.prazosFaseRecursal).dataHoraLimiteIRJulgamento, obj(x.prazosFaseRecursal).dataHoraLimiteIRHabilitacao)),
    etapa: texto(primeiro(x.descricaoSituacao, x.situacaoDescricao, x.detalheSituacao, x.descricaoFase, x.situacaoSelecao)) || fase,
    valorEstimado: valorDe(primeiro(x.valorEstimado, x.valorUnitarioEstimado, x.valorEstimadoUnitario)),
    propostaBruta: Object.keys(p).length ? p : null,
    participa: true,
  };
  const { chance, explicacao } = calcularChance(item, situacaoItem, desclassificado);
  item.chance = chance;
  item.explicacao = explicacao;
  return item;
}

/**
 * Chance de ser chamado (convocado) no item, pela colocação e pela situação da proposta.
 * No pregão o pregoeiro analisa a 1ª colocada; se for recusada ou inabilitada, chama a próxima.
 */
export function calcularChance(it: Pick<ItemAcomp, "colocacao" | "codigoSituacao" | "pendencias" | "chatAberto" | "participantes">, situacaoItem = "", desclassificado = false): { chance: Chance; explicacao: string } {
  if (SITUACOES_ITEM[situacaoItem]) return { chance: "encerrado", explicacao: `O item foi ${SITUACOES_ITEM[situacaoItem].toLowerCase()}.` };
  const s = it.codigoSituacao;
  if (s === "6") return { chance: "ganhou", explicacao: "Item adjudicado para você." };
  if (desclassificado) return { chance: "fora", explicacao: "Sua proposta foi desclassificada neste item." };
  if (s === "5") return { chance: "fora", explicacao: "Você foi inabilitado neste item." };
  if (s === "8") return { chance: "fora", explicacao: "Você recusou assumir a cota." };
  if (it.pendencias.length || it.chatAberto) return { chance: "alta", explicacao: "O pregoeiro chamou você neste item: responda dentro do prazo." };
  if (s === "4") return { chance: "alta", explicacao: "Você foi habilitado: falta a adjudicação." };
  if (s === "3") return { chance: "alta", explicacao: "Sua proposta foi aceita: falta a habilitação." };
  const c = it.colocacao;
  if (c == null) return { chance: "aguardando", explicacao: "A colocação aparece depois da disputa." };
  const de = it.participantes ? ` de ${it.participantes}` : "";
  // Boa até o 4º lugar, média do 5º ao 8º, baixa do 9º em diante (é comum o pregoeiro recusar várias à frente).
  if (c === 1) return { chance: "alta", explicacao: `Você está em 1º${de}: é o primeiro a ser analisado.` };
  if (c <= 4) return { chance: "alta", explicacao: `Você está em ${c}º${de}: é chamado se ${c - 1 === 1 ? "o 1º for recusado" : `as ${c - 1} empresas à frente forem recusadas`}.` };
  if (c <= 8) return { chance: "media", explicacao: `Você está em ${c}º${de}: precisa que ${c - 1} empresas à frente sejam recusadas.` };
  return { chance: "baixa", explicacao: `Você está em ${c}º${de}: precisa que ${c - 1} empresas à frente sejam recusadas.` };
}

export interface MensagemAcomp {
  id: string;
  quem: "pregoeiro" | "sistema" | "voce";
  texto: string;
  dataHora: string;
  item: number | null;
  remetente: string;
  destinatario: string;
}

export function lerMensagem(bruto: unknown): MensagemAcomp | null {
  const x = obj(bruto);
  const t = texto(primeiro(x.texto, x.mensagem, x.conteudo));
  if (!t) return null;
  const tipo = texto(primeiro(x.tipoRemetente, obj(x.remetente).tipo));
  const quem = tipo === "3" || /GOVERNO|PREGOEIRO/i.test(tipo) ? "pregoeiro" : tipo === "1" || /FORNECEDOR/i.test(tipo) ? "voce" : "sistema";
  const dataHora = texto(primeiro(x.dataHora, x.dataHoraEnvio, x.dataHoraMensagem, x.data));
  return {
    id: texto(x.id) || `${dataHora}|${t.slice(0, 40)}`,
    quem,
    texto: t,
    dataHora,
    item: numero(primeiro(x.identificadorItem, x.numeroItem, x.item)),
    remetente: idEmpresa(x.identificadorRemetente),
    destinatario: idEmpresa(x.identificadorDestinatario),
  };
}

export interface DetalheBruto {
  participacao?: unknown;
  itens?: unknown[];
  /** De onde vieram os itens: "selecao" e "disputa" só trazem os seus; "itens" traz todos da compra. */
  origemItens?: string;
  /** Todos os itens da compra (com e sem proposta sua), quando lidos. */
  todosItens?: unknown[];
  mensagens?: unknown[];
  erros?: string[];
  em: number;
}

export interface PainelAcompanhamento {
  andamento: unknown[] | null;
  finalizadas: unknown[] | null;
  detalhes: Record<string, DetalheBruto> | null;
  em: number;
  /** Erro da última leitura ("erro" não serve: a ponte trata qualquer campo "erro" como falha do pedido). */
  problema: string;
  buscando: boolean;
  conectado: boolean;
  fase: string;
  agora: number;
  cnpj?: string;
  /** Muda quando algo muda; com "igual" o aplicativo só avisa que nada mudou desde a versão pedida. */
  versao?: number;
  igual?: boolean;
  /** A lista veio da última leitura guardada no computador (ainda sem leitura nova). */
  deCache?: boolean;
  /** Totais informados pelo Compras.gov.br (mesmo sem baixar todas as páginas). */
  totalAndamento?: number;
  totalFinalizadas?: number;
  /** Compras sendo lidas agora (abertas pela pessoa). */
  lendo?: Record<string, boolean> | null;
}

export interface CompraAcomp extends Participacao {
  itens: ItemAcomp[];
  mensagens: MensagemAcomp[];
  lidaEm: number | null;
  erros: string[];
  /** Da sua participação na compra. */
  meEpp: boolean | null;
  uf: string;
  /** A sua empresa nesta compra (CNPJ/CPF só com números), como o Compras.gov.br devolve na sua participação. */
  meuCnpj: string;
  /** Itens da compra em que você não tem proposta (para ver tudo da licitação). */
  outrosItens: ItemAcomp[];
}

export function montarCompras(lista: unknown[] | null, detalhes: Record<string, DetalheBruto> | null): CompraAcomp[] {
  const vistas = new Set<string>();
  const saida: CompraAcomp[] = [];
  for (const b of lista ?? []) {
    const p = lerParticipacao(b);
    if (!p || vistas.has(p.chave)) continue;
    vistas.add(p.chave);
    const d = detalhes?.[p.chave];
    // A leitura da compra completa (participação) pode trazer dados que faltam na lista.
    const extra = d?.participacao ? lerParticipacao({ chaveCompra: p.chave, ...obj(d.participacao), ...obj(obj(d.participacao).compra) }) : null;
    const lidos = (d?.itens ?? []).map(lerItemAcomp).filter((x): x is ItemAcomp => !!x);
    // "selecao" e "disputa" já vêm só com os itens em que você tem proposta; a lista geral ("itens") traz todos.
    // Se a lista geral não disser em quais itens você tem proposta, mostra todos como antes.
    const soMeus = d?.origemItens === "selecao" || d?.origemItens === "disputa" || !lidos.some((i) => !!i.propostaBruta);
    const itens = soMeus ? lidos : lidos.filter((i) => !!i.propostaBruta);
    const meus = new Set(itens.map((i) => i.numero));
    const outrosItens = [...(soMeus ? (d?.todosItens ?? []).map(lerItemAcomp) : lidos.filter((i) => !i.propostaBruta))]
      .filter((x): x is ItemAcomp => !!x && !meus.has(x.numero))
      .map((i) => ({ ...i, participa: false, chance: "aguardando" as Chance, explicacao: "Você não tem proposta neste item." }))
      .sort((a, b) => a.numero - b.numero);
    const mensagens = (d?.mensagens ?? [])
      .map(lerMensagem)
      .filter((x): x is MensagemAcomp => !!x)
      .sort((a, b) => dataDe(a.dataHora) - dataDe(b.dataHora));
    saida.push({
      ...p,
      orgao: p.orgao || extra?.orgao || "",
      objeto: p.objeto || extra?.objeto || "",
      fase: p.fase || extra?.fase || "",
      abertura: p.abertura || extra?.abertura || null,
      itens: itens.sort((a, b) => a.numero - b.numero),
      mensagens,
      lidaEm: d?.em ?? null,
      erros: d?.erros ?? [],
      meEpp: d?.participacao && obj(d.participacao).declaracaoMeEpp != null ? obj(d.participacao).declaracaoMeEpp === true : null,
      uf: texto(primeiro(obj(obj(obj(d?.participacao).participante).endereco).uf, obj(obj(d?.participacao).participante).uf)),
      outrosItens,
      meuCnpj: idEmpresa(primeiro(obj(obj(d?.participacao).participante).identificacao, obj(d?.participacao).identificacaoParticipante, obj(d?.participacao).identificacaoFornecedor)),
    });
  }
  return saida;
}

/** Data do Compras.gov.br ("2026-11-12T14:03:00" ou "12/11/2026 14:03:00") em milissegundos. */
export function dataDe(s: string): number {
  if (!s) return 0;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), Number(br[4] ?? 0), Number(br[5] ?? 0), Number(br[6] ?? 0)).getTime();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export interface AvisoAcomp {
  chave: string;
  compra: string;
  urgente: boolean;
  titulo: string;
  mensagem: string;
  dataHora: number;
}

const resumo = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Avisos que merecem atenção: chamados do pregoeiro (anexos, negociação, diligência, cota), mudanças na
 * situação da proposta e mensagens do pregoeiro. A chave não muda entre leituras (não repete a notificação).
 */
export function avisosDe(compras: CompraAcomp[], agora = Date.now()): AvisoAcomp[] {
  const avisos: AvisoAcomp[] = [];
  for (const c of compras) {
    const nome = `${c.modalidade} ${c.numero}`;
    for (const it of c.itens) {
      for (const p of it.pendencias) {
        avisos.push({
          chave: `acomp:${c.chave}:${it.numero}:${p.tipo}`,
          compra: c.chave,
          urgente: true,
          titulo: `Convocação no ${nome}, item ${it.numero}`,
          mensagem: `${p.rotulo} solicitada pelo pregoeiro. ${resumo(it.descricao, 80)}`,
          dataHora: c.lidaEm ?? agora,
        });
      }
      if (["3", "4", "6", "5", "1", "2", "9"].includes(it.codigoSituacao)) {
        const bom = ["3", "4", "6"].includes(it.codigoSituacao);
        avisos.push({
          chave: `acomp:${c.chave}:${it.numero}:sit:${it.codigoSituacao}`,
          compra: c.chave,
          urgente: !bom,
          titulo: `${it.situacao} no ${nome}, item ${it.numero}`,
          mensagem: it.motivo ? `Motivo: ${resumo(it.motivo)}` : resumo(it.descricao, 100),
          dataHora: c.lidaEm ?? agora,
        });
      }
    }
    for (const m of c.mensagens) {
      if (m.quem !== "pregoeiro") continue;
      const quando = dataDe(m.dataHora);
      if (quando && agora - quando > 3 * 86_400_000) continue; // só as dos últimos 3 dias
      avisos.push({
        chave: `acomp:${c.chave}:msg:${m.id}`.slice(0, 190),
        compra: c.chave,
        urgente: /convoc|anexo|prazo|negocia|dilig/i.test(m.texto),
        titulo: `Mensagem do pregoeiro no ${nome}${m.item ? `, item ${m.item}` : ""}`,
        mensagem: resumo(m.texto),
        dataHora: quando || agora,
      });
    }
  }
  return avisos.sort((a, b) => Number(b.urgente) - Number(a.urgente) || b.dataHora - a.dataHora);
}

// ---------- Detalhe do item (telas do fornecedor no Compras.gov.br) ----------

export interface PropostaEmpresa {
  cnpj: string;
  empresa: string;
  colocacao: number | null;
  valor: number | null;
  valorInicial: number | null;
  marca: string;
  modelo: string;
  quantidade: number | null;
  situacao: string;
  motivo: string;
  desclassificada: boolean;
  convocada: boolean;
  meEpp: boolean;
  uf: string;
  /** Valores unitários como na tela "Proposta" do Compras.gov.br. */
  valorProposta: number | null;
  valorOfertado: number | null;
  valorNegociado: number | null;
  /** Totais (unitário × quantidade ofertada), quando o Compras.gov.br informa. */
  totalProposta: number | null;
  totalOfertado: number | null;
  totalNegociado: number | null;
  /** Valor que o pregoeiro sugeriu na negociação. */
  valorSugerido: number | null;
  /** Quantos anexos a empresa mandou no item (vem na lista, sem abrir os anexos). */
  quantidadeAnexos: number | null;
  chatAberto: boolean;
  pendencias: Pendencia[];
  dataLimite: string;
  /** Código da situação da proposta no Compras.gov.br (3 aceita, 4 habilitada, 6 adjudicada...). */
  codigo: string;
}

export function lerProposta(bruto: unknown): PropostaEmpresa {
  const p = obj(bruto);
  const part = obj(p.participante);
  const valores = obj(p.valores);
  const sit = texto(p.situacao);
  return {
    cnpj: idEmpresa(primeiro(part.identificacao, p.identificacaoParticipante, p.identificacao)),
    empresa: texto(primeiro(part.nome, p.nomeParticipante, p.razaoSocial)) || "Empresa",
    colocacao: numero(primeiro(p.classificacao, p.posicao)),
    valor: valorDe(primeiro(valores.valorNegociado, valores.valorPropostaInicialOuLances, valores.valorPropostaInicial, p.valor)),
    valorInicial: valorDe(valores.valorPropostaInicial),
    marca: texto(p.marcaFabricante),
    modelo: texto(p.modeloVersao),
    quantidade: numero(p.quantidadeOfertada),
    situacao: SITUACOES_PROPOSTA[sit] ?? "",
    motivo: texto(primeiro(p.motivoDesclassificacao, p.justificativaDesclassificacao)),
    desclassificada: DESCLASSIFICADA.has(sit) || sit === "5" || p.desclassificado === true,
    convocada: PENDENCIAS.some(([campo]) => texto(p[campo]) === "S") || p.canalChatAberto === true,
    meEpp: part.porte === "ME" || part.porte === "EPP" || p.declaracaoMeEpp === true || part.declaracaoMeEpp === true,
    uf: texto(primeiro(obj(part.endereco).uf, part.uf, p.uf, p.ufFornecedor)),
    valorProposta: valorDe(valores.valorPropostaInicial),
    valorOfertado: valorDe(primeiro(valores.valorPropostaInicialOuLances, valores.valorPropostaInicial)),
    valorNegociado: valorDe(valores.valorNegociado),
    totalProposta: totalDe(valores.valorPropostaInicial),
    totalOfertado: totalDe(primeiro(valores.valorPropostaInicialOuLances, valores.valorPropostaInicial)),
    totalNegociado: totalDe(valores.valorNegociado),
    valorSugerido: valorDe(valores.valorSugeridoNegociacao),
    quantidadeAnexos: numero(p.quantidadeDeAnexos),
    chatAberto: p.canalChatAberto === true,
    pendencias: PENDENCIAS.filter(([campo]) => texto(p[campo]) === "S").map(([, tipo, rotulo]) => ({ tipo, rotulo })),
    dataLimite: texto(primeiro(p.dataHoraLimiteAtendimento, p.dataHoraLimiteEnvioAnexos)),
    codigo: sit,
  };
}

/** Resposta de "item com as propostas": a sua proposta (propostaItem) e as de todas (propostasItem). */
export function lerItemComPropostas(dados: unknown, meuCnpjBruto: string) {
  const meuCnpj = idEmpresa(meuCnpjBruto);
  // Na fase de seleção a resposta é uma lista com o item (e as propostas dentro dele).
  const d = Array.isArray(dados) && dados.length && obj(dados[0]).propostasItem ? obj(dados[0]) : obj(dados);
  if (Array.isArray(dados) && dados.length && obj(dados[0]).propostasItem) dados = d;
  const todas = propostasDoItem(dados).map((p, i) => ({ ...p, colocacao: p.colocacao ?? i + 1 }));
  const minhaBruta = d.propostaItem ? lerProposta(d.propostaItem) : null;
  const minha = (meuCnpj && todas.find((p) => p.cnpj === meuCnpj)) || minhaBruta;
  return {
    todas,
    minha: minha ? { ...minhaBruta, ...minha, colocacao: minha.colocacao ?? minhaBruta?.colocacao ?? null } : null,
    participantes: numero(primeiro(d.qtdeParticipantes, d.quantidadeParticipantes)) ?? (todas.length || null),
    descricao: texto(primeiro(d.descricao, d.descricaoDetalhada)),
    situacaoItem: texto(primeiro(d.descricaoSituacao, d.situacaoDescricao, d.detalheSituacao)),
    sessao: numero(primeiro(d.numeroSessaoJulgHab)) ?? 1,
  };
}

/** Item com as propostas de todas as empresas ("propostasItem"), na ordem de classificação. */
export function propostasDoItem(dados: unknown, numeroItem?: number): PropostaEmpresa[] {
  // Às vezes vem uma lista de itens, cada um com as propostas dentro (propostasIniciais / propostasItem).
  if (Array.isArray(dados) && dados.some((x) => Array.isArray(obj(x).propostasIniciais) || Array.isArray(obj(x).propostasItem))) {
    const comPropostas = dados.filter((x) => Array.isArray(obj(x).propostasIniciais) || Array.isArray(obj(x).propostasItem));
    dados = comPropostas.find((x) => numeroItem != null && numero(obj(x).numero) === numeroItem) ?? comPropostas[0];
  }
  const d = obj(dados);
  const lista = Array.isArray(dados) ? dados : Array.isArray(d.propostasItem) ? d.propostasItem : Array.isArray(d.propostas) ? d.propostas : Array.isArray(d.propostasIniciais) ? d.propostasIniciais : [];
  return (lista as unknown[]).map(lerProposta).sort((a, b) => (a.colocacao ?? 999) - (b.colocacao ?? 999) || (a.valor ?? 0) - (b.valor ?? 0));
}

export interface AnexoCompras {
  id: string;
  nome: string;
  dataHora: string;
  tipo: string;
  tamanho: number | null;
  url: string;
}

export function lerAnexos(dados: unknown): AnexoCompras[] {
  const d = obj(dados);
  const lista = Array.isArray(dados) ? dados : (primeiro(d.anexos, d.arquivos, d.content, d.lista) as unknown[]) ?? [];
  return (Array.isArray(lista) ? lista : [])
    .map((b) => {
      const a = obj(b);
      // No Compras.gov.br o anexo é identificado pelo "nome" (nome guardado no servidor) e mostrado pelo
      // "nomeOriginal" (o nome do arquivo que a empresa enviou); não tem "id".
      return {
        id: texto(primeiro(a.id, a.identificador, a.sequencial, a.codigo, a.nome)),
        nome: texto(primeiro(a.nomeOriginal, a.nome, a.nomeArquivo, a.descricao)) || "Arquivo",
        dataHora: texto(primeiro(a.dataHoraInclusao, a.dataHora, a.dataHoraEnvio, a.dataInclusao)),
        tipo: texto(primeiro(a.tipoAnexoDescricao, a.tipoAnexo, a.tipo, a.fase)),
        tamanho: numero(primeiro(a.tamanho, a.tamanhoArquivo)),
        url: texto(a.url),
      };
    })
    .filter((a) => a.id || a.url);
}

export interface LanceCompras {
  valor: number | null;
  dataHora: string;
  empresa: string;
  cnpj: string;
  meu: boolean;
}

export function lerLances(dados: unknown, meuCnpj = ""): LanceCompras[] {
  const d = obj(dados);
  const lista = Array.isArray(dados) ? dados : (primeiro(d.lances, d.content, d.lista) as unknown[]) ?? [];
  return (Array.isArray(lista) ? lista : [])
    .map((b) => {
      const l = obj(b);
      const part = obj(l.participante);
      const cnpj = idEmpresa(primeiro(part.identificacao, l.identificacaoParticipante, l.identificacaoFornecedor, l.identificacao));
      return {
        valor: valorDe(primeiro(l.valor, l.valorInformado, l.valorCalculado, l.valorLance)),
        dataHora: texto(primeiro(l.dataHora, l.dataHoraLance, l.dataHoraEnvio)),
        empresa: texto(primeiro(part.nome, l.nomeParticipante)) || (cnpj ? "" : "Fornecedor"),
        cnpj,
        meu: l.meuLance === true || l.proprio === true || (!!meuCnpj && cnpj === meuCnpj),
      };
    })
    .sort((a, b) => dataDe(b.dataHora) - dataDe(a.dataHora));
}

export interface RecursoEmpresa {
  cnpj: string;
  empresa: string;
  intencao: string;
  etapa: string;
  dataIntencao: string;
  situacaoRecurso: string;
  dataRecurso: string;
  temRecurso: boolean;
  contrarrazoes: { cnpj: string; empresa: string; situacao: string; dataHora: string }[];
}

export interface FaseRecursal {
  prazos: { rotulo: string; dataHora: string }[];
  empresas: RecursoEmpresa[];
  decisao: { situacao: string; fundamentacao: string; responsavel: string; dataHora: string } | null;
  revisao: { situacao: string; fundamentacao: string; responsavel: string; dataHora: string } | null;
}

const SITUACAO_RECURSO: Record<string, string> = { R: "Rascunho", C: "Cadastrado", D: "Desistiu" };
const SITUACAO_DECISAO: Record<string, string> = { P: "Procede", N: "Não procede", M: "Mantida (não procede)", R: "Revertida" };
const ETAPAS: Record<string, string> = { JP: "Julgamento da proposta", HF: "Habilitação" };

export function lerFaseRecursal(dados: unknown): FaseRecursal | null {
  const d = obj(dados);
  if (!Object.keys(d).length) return null;
  const pz = obj(primeiro(d.prazos, d.prazosFaseRecursal));
  const rotulos: [string, string][] = [
    ["dataHoraLimiteIRJulgamento", "Intenção de recurso (julgamento)"],
    ["dataHoraLimiteIRHabilitacao", "Intenção de recurso (habilitação)"],
    ["dataHoraLimiteRecurso", "Envio do recurso"],
    ["dataHoraLimiteContrarrazao", "Contrarrazões"],
    ["dataHoraLimiteDecisao", "Decisão"],
  ];
  const decisao = (v: unknown) => {
    const x = obj(v);
    if (!Object.keys(x).length) return null;
    return {
      situacao: SITUACAO_DECISAO[texto(x.situacao)] ?? texto(x.situacao),
      fundamentacao: texto(primeiro(x.fundamentacao, x.justificativa)),
      responsavel: texto(primeiro(x.responsavel, obj(x.responsavel).nome)),
      dataHora: texto(x.dataHora),
    };
  };
  const participacoes = Array.isArray(d.participacoes) ? d.participacoes : [];
  return {
    prazos: rotulos.filter(([k]) => texto(pz[k])).map(([k, rotulo]) => ({ rotulo, dataHora: texto(pz[k]) })),
    empresas: participacoes.map((b) => {
      const p = obj(b);
      const intencao = obj(primeiro(p.intencaoRecurso, p.intencao, Array.isArray(p.intencoesRecurso) ? p.intencoesRecurso[0] : null));
      const recurso = obj(p.recurso);
      const contras = Array.isArray(primeiro(p.contrarrazoes, recurso.contrarrazoes)) ? (primeiro(p.contrarrazoes, recurso.contrarrazoes) as unknown[]) : [];
      return {
        cnpj: idEmpresa(primeiro(p.identificacaoParticipante, obj(p.participante).identificacao)),
        empresa: texto(primeiro(p.nomeParticipante, p.razaoSocial, obj(p.participante).nome)),
        intencao: texto(primeiro(intencao.motivacao, intencao.texto, p.motivacao)),
        etapa: ETAPAS[texto(primeiro(intencao.etapaSelecaoFornecedores, p.etapaSelecaoFornecedores))] ?? "",
        dataIntencao: texto(primeiro(intencao.dataHora, p.dataHoraIntencao)),
        situacaoRecurso: SITUACAO_RECURSO[texto(recurso.situacao)] ?? texto(recurso.situacao),
        dataRecurso: texto(primeiro(recurso.dataHora, recurso.dataHoraCadastro)),
        temRecurso: Object.keys(recurso).length > 0,
        contrarrazoes: contras.map((c) => {
          const x = obj(c);
          return {
            cnpj: idEmpresa(primeiro(x.identificacaoParticipante, obj(x.participante).identificacao)),
            empresa: texto(primeiro(x.nomeParticipante, obj(x.participante).nome)),
            situacao: SITUACAO_RECURSO[texto(x.situacao)] ?? texto(x.situacao),
            dataHora: texto(x.dataHora),
          };
        }),
      };
    }),
    decisao: decisao(d.decisao),
    revisao: decisao(d.revisaoDecisao),
  };
}

export function cnpjFormatadoAcomp(c: string) {
  const d = c.replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c;
}
