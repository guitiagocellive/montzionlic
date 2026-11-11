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

/** Situação da disputa depois da sessão (etapa "Boa colocação"). */
export const SITUACOES_DISPUTA = [
  "Aguardando convocação",
  "Proposta e anexos enviados",
  "Em análise da proposta",
  "Em análise da documentação",
  "Em diligência",
  "Aceita / habilitada",
  "Recurso / contrarrazão",
  "Sessão suspensa",
  "Aguardando homologação",
  "Homologada",
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

/**
 * A cotação que vai para a proposta: a marcada como "usar na proposta";
 * sem marcação, a de menor preço de venda.
 */
export function cotacaoDaProposta<C extends { id: number; item_id: number | null; custo_unitario: number | null; frete: number | null; escolhida?: number | null }>(
  cotacoes: C[],
  item: { id: number; quantidade: number | null },
  impostoPercentual: number,
  lucroPercentual: number,
): { cotacao: C; calculo: CalculoPreco } | null {
  const opcoes = cotacoes
    .filter((c) => c.item_id === item.id)
    .map((cotacao) => ({
      cotacao,
      calculo: calcularPreco({
        custoUnitario: cotacao.custo_unitario ?? 0,
        frete: cotacao.frete ?? 0,
        quantidade: item.quantidade ?? 1,
        impostoPercentual,
        lucroPercentual,
      }),
    }));
  if (!opcoes.length) return null;
  return opcoes.find((o) => o.cotacao.escolhida) ?? opcoes.reduce((a, b) => (b.calculo.precoVenda < a.calculo.precoVenda ? b : a));
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

// Documentos de habilitação, agrupados como na Lei 14.133/2021 (art. 62 a 69).
export const HABILITACOES = [
  {
    chave: "juridica",
    nome: "Habilitação jurídica",
    lei: "art. 66",
    categorias: ["Contrato social", "Documentos dos sócios", "Requerimento de empresário / CCMEI", "Procuração"],
  },
  {
    chave: "fiscal",
    nome: "Habilitação fiscal, social e trabalhista",
    lei: "art. 68",
    categorias: [
      "Cartão CNPJ",
      "Inscrição estadual / municipal",
      "CND Federal (Receita/PGFN)",
      "Certidão Estadual",
      "Certidão Municipal",
      "CRF – FGTS",
      "CNDT – Trabalhista",
    ],
  },
  {
    chave: "economica",
    nome: "Habilitação econômico-financeira",
    lei: "art. 69",
    categorias: ["Balanço patrimonial", "Demonstrações contábeis (DRE)", "Certidão de Falência"],
  },
  {
    chave: "tecnica",
    nome: "Qualificação técnica",
    lei: "art. 67",
    categorias: ["Atestado de capacidade técnica", "Registro em conselho profissional", "Alvará / Licença"],
  },
  {
    chave: "outros",
    nome: "Cadastros, declarações e outros",
    lei: "",
    categorias: ["SICAF", "Declarações", "Outro"],
  },
] as const;

export const CATEGORIAS_DOCUMENTO: string[] = HABILITACOES.flatMap((h) => [...h.categorias]);

export function habilitacaoDaCategoria(categoria: string) {
  return HABILITACOES.find((h) => (h.categorias as readonly string[]).includes(categoria)) ?? HABILITACOES[HABILITACOES.length - 1];
}

export const RESULTADOS_ITEM = [
  { chave: "ganho", nome: "Ganhamos" },
  { chave: "acompanhando", nome: "Acompanhando" },
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
