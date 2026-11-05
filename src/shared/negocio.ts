// Regras de negócio compartilhadas entre o backend e o frontend.
// Para renomear uma etapa, basta trocar o "nome" aqui (a chave deve continuar igual).

export interface Etapa {
  chave: string;
  nome: string;
  cor: string;
}

/** Etapas do quadro de licitações (antes de ganhar). */
export const ETAPAS_LICITACAO: Etapa[] = [
  { chave: "estudar", nome: "Para estudar", cor: "#818cf8" },
  { chave: "fazer", nome: "Para fazer", cor: "#a78bfa" },
  { chave: "orcamento", nome: "Orçamento", cor: "#e879f9" },
  { chave: "boa_colocacao", nome: "Boa colocação", cor: "#fbbf24" },
  { chave: "perdida", nome: "Perdidas", cor: "#fb7185" },
  { chave: "ganha", nome: "Ganhas", cor: "#34d399" },
];

/** Etapas do quadro de pós-ganho (empenhos). */
export const ETAPAS_EXECUCAO: Etapa[] = [
  { chave: "aguardando_empenho", nome: "Aguardando empenho", cor: "#818cf8" },
  { chave: "empenho_recebido", nome: "Empenho recebido", cor: "#a78bfa" },
  { chave: "material_comprado", nome: "Material comprado", cor: "#e879f9" },
  { chave: "aguardando_entrega", nome: "Aguardando entrega", cor: "#fbbf24" },
  { chave: "entrega_realizada", nome: "Entrega realizada", cor: "#38bdf8" },
  { chave: "solicitar_atestado", nome: "Solicitar atestado", cor: "#f472b6" },
  { chave: "concluido", nome: "Concluído", cor: "#34d399" },
];

/** Etapas em que a entrega ainda não foi feita (usadas para alertar atrasos). */
export const ETAPAS_ANTES_DA_ENTREGA = [
  "aguardando_empenho",
  "empenho_recebido",
  "material_comprado",
  "aguardando_entrega",
];

export const ETAPAS_LICITACAO_ATIVAS = ["estudar", "fazer", "orcamento", "boa_colocacao"];

export const MODALIDADES = [
  "Pregão eletrônico",
  "Pregão presencial",
  "Dispensa eletrônica",
  "Dispensa",
  "Concorrência eletrônica",
  "Concorrência",
  "Inexigibilidade",
  "Credenciamento",
  "Leilão",
  "Outra",
];

export const PORTAIS = [
  "Compras.gov.br",
  "BLL Compras",
  "Licitações-e (Banco do Brasil)",
  "Portal de Compras Públicas",
  "BNC Compras",
  "Licitanet",
  "Compras BR",
  "Portal do próprio órgão",
];

export const FASES = [
  "Análise do edital",
  "Cadastro de proposta",
  "Disputa de lances",
  "Aceitação",
  "Habilitação",
  "Recurso",
  "Adjudicada",
  "Homologada",
];

export const CATEGORIAS_ARQUIVO = [
  "Edital",
  "Termo de referência",
  "Anexo",
  "Proposta",
  "Empenho",
  "Nota fiscal",
  "Atestado",
  "Ata",
  "Outro",
];

export function nomeEtapa(etapas: Etapa[], chave: string): string {
  return etapas.find((e) => e.chave === chave)?.nome ?? chave;
}

// ---------------------------------------------------------
// Cálculo de preço de venda
// ---------------------------------------------------------

export interface CalculoPreco {
  /** Custo unitário já com o frete dividido pela quantidade. */
  custoUnitarioComFrete: number;
  /** Preço que só paga custo + impostos (lucro zero). */
  precoMinimo: number;
  /** Preço que garante o lucro desejado. */
  precoVenda: number;
  /** Lucro por unidade vendendo no preço de venda. */
  lucroUnitario: number;
  totalVenda: number;
  totalCusto: number;
  lucroTotal: number;
  /** false quando imposto + lucro chegam a 100% ou mais (cálculo impossível). */
  valido: boolean;
}

/**
 * Impostos e lucro são calculados sobre o preço de venda (forma usual em licitações):
 *   preço = custo ÷ (1 − imposto% − lucro%)
 */
export function calcularPreco(params: {
  custoUnitario: number;
  frete: number;
  quantidade: number;
  impostoPercentual: number;
  lucroPercentual: number;
}): CalculoPreco {
  const quantidade = params.quantidade > 0 ? params.quantidade : 1;
  const custoUnitarioComFrete = (params.custoUnitario || 0) + (params.frete || 0) / quantidade;
  const imposto = (params.impostoPercentual || 0) / 100;
  const lucro = (params.lucroPercentual || 0) / 100;

  const divisorMinimo = 1 - imposto;
  const divisorVenda = 1 - imposto - lucro;
  const valido = divisorMinimo > 0 && divisorVenda > 0;

  const precoMinimo = valido ? custoUnitarioComFrete / divisorMinimo : 0;
  const precoVenda = valido ? custoUnitarioComFrete / divisorVenda : 0;
  const lucroUnitario = valido ? precoVenda * lucro : 0;

  return {
    custoUnitarioComFrete,
    precoMinimo,
    precoVenda,
    lucroUnitario,
    totalVenda: precoVenda * quantidade,
    totalCusto: custoUnitarioComFrete * quantidade,
    lucroTotal: lucroUnitario * quantidade,
    valido,
  };
}

// ---------------------------------------------------------
// Datas e prazos
// ---------------------------------------------------------

export type TipoPrazo = "corridos" | "uteis";

function paraData(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function paraIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/**
 * Soma dias a uma data (AAAA-MM-DD). Em dias úteis, pula sábados e domingos
 * (feriados não são considerados).
 */
export function somarPrazo(inicio: string, dias: number, tipo: TipoPrazo): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !Number.isFinite(dias) || dias < 0) return null;
  const data = paraData(inicio);
  if (tipo === "corridos") {
    data.setUTCDate(data.getUTCDate() + dias);
    return paraIso(data);
  }
  let restantes = dias;
  while (restantes > 0) {
    data.setUTCDate(data.getUTCDate() + 1);
    const diaSemana = data.getUTCDay();
    if (diaSemana !== 0 && diaSemana !== 6) restantes--;
  }
  return paraIso(data);
}

/** Diferença em dias entre hoje e a data (negativo = já passou). */
export function diasAte(iso: string, hojeIso: string): number {
  return Math.round((paraData(iso).getTime() - paraData(hojeIso).getTime()) / 86_400_000);
}

// ---------------------------------------------------------
// Documentação, resultado da disputa
// ---------------------------------------------------------

export const CATEGORIAS_DOCUMENTO = [
  "CND Federal (Receita/PGFN)",
  "CRF – FGTS",
  "CNDT – Trabalhista",
  "Certidão Estadual",
  "Certidão Municipal",
  "Certidão de Falência",
  "SICAF",
  "Contrato social",
  "Balanço patrimonial",
  "Atestado de capacidade técnica",
  "Alvará / Licença",
  "Procuração",
  "Outro",
];

export const RESULTADOS_ITEM = [
  { chave: "ganho", nome: "Ganhamos" },
  { chave: "perdido", nome: "Perdemos" },
  { chave: "cancelado", nome: "Cancelado / fracassado" },
];

export const MOTIVOS_PERDA = [
  "Preço",
  "Inabilitação (documentação)",
  "Desclassificação técnica",
  "Proposta fora do prazo",
  "Recurso de concorrente",
  "Licitação deserta / fracassada",
  "Licitação revogada / anulada",
  "Desistência",
  "Outro",
];
