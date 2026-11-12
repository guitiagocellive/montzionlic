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
  const c = obj(x.compra);
  const direta = texto(primeiro(x.chaveCompra, c.chaveCompra, x.chave));
  if (direta) return direta;
  const uasg = texto(primeiro(x.numeroUasg, c.numeroUasg, c.uasg)).replace(/\D/g, "");
  const mod = texto(primeiro(x.modalidade, c.modalidade)).replace(/\D/g, "");
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
  situacao: string;
  abertura: string | null;
  linkPncp: string | null;
  encerrada: boolean;
}

export function lerParticipacao(bruto: unknown): Participacao | null {
  const x = obj(bruto);
  const c = { ...x, ...obj(x.compra) };
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
    situacao: sit,
    abertura: texto(primeiro(c.dataHoraAbertura, c.dataHoraPrevisaoAbertura, c.dataHoraInicioDisputa)) || null,
    linkPncp: texto(c.linkPncp) || null,
    encerrada: ["RE", "AN", "FR", "DE"].includes(sitCod) || !!c.homologada,
  };
}

export type Chance = "ganhou" | "alta" | "media" | "baixa" | "fora" | "aguardando" | "encerrado";

export const ROTULO_CHANCE: Record<Chance, string> = {
  ganhou: "Ganhou",
  alta: "Chance alta",
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
}

const PENDENCIAS: [string, Pendencia["tipo"], string][] = [
  ["situacaoUltimaSolicitacaoAnexos", "anexos", "Envio de anexos / proposta ajustada"],
  ["situacaoUltimaNegociacao", "negociacao", "Negociação de valor"],
  ["situacaoUltimaDiligencia", "diligencia", "Diligência"],
  ["situacaoUltimaSolicitacaoAssumirCota", "cota", "Assumir cota"],
];

const valorDe = (v: unknown): number | null => {
  if (v == null) return null;
  const n = numero(v);
  if (n != null) return n;
  const o = obj(v);
  return numero(primeiro(o.valorCalculado, o.valorInformado, o.valor, o.valorUnitario));
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
  if (c === 1) return { chance: "alta", explicacao: `Você está em 1º${de}: é o primeiro a ser analisado.` };
  if (c === 2) return { chance: "media", explicacao: `Você está em 2º${de}: é chamado se o 1º for recusado ou inabilitado.` };
  if (c === 3) return { chance: "baixa", explicacao: `Você está em 3º${de}: precisa que os 2 primeiros sejam recusados.` };
  return { chance: "baixa", explicacao: `Você está em ${c}º${de}: precisa que ${c - 1} empresas à frente sejam recusadas.` };
}

export interface MensagemAcomp {
  id: string;
  quem: "pregoeiro" | "sistema" | "voce";
  texto: string;
  dataHora: string;
  item: number | null;
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
  };
}

export interface DetalheBruto {
  participacao?: unknown;
  itens?: unknown[];
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
}

export interface CompraAcomp extends Participacao {
  itens: ItemAcomp[];
  mensagens: MensagemAcomp[];
  lidaEm: number | null;
  erros: string[];
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
    const itens = (d?.itens ?? []).map(lerItemAcomp).filter((x): x is ItemAcomp => !!x);
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
