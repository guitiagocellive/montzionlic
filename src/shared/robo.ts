// Robô de lances do Compras.gov.br: a regra de decisão de cada item.
//
// Sempre espera os 10 segundos finais do cronômetro do item para dar lance (para não comer margem
// nem atiçar o concorrente antes da hora). Aí dá o menor lance que coloca a empresa em 1º.
// Se não der para ser 1º sem passar do lance mínimo, dá o lance mínimo (melhor colocação possível).
// Nunca envia abaixo do lance mínimo.
// "Não aguardar os segundos finais" faz ele cobrir assim que perde o 1º lugar.

/** Segundos finais em que o robô começa a dar lances. */
export const SEGUNDOS_FINAIS = 10;

/** Configuração do robô para um item (guardada na plataforma). */
export interface ConfigItemRobo {
  ligado: boolean;
  /** Lance mínimo (valor do item na disputa). Abaixo disso o robô nunca vai. */
  minimo: number | null;
  /** Quanto baixar do melhor lance a cada lance (%). O intervalo mínimo do edital sempre é respeitado. */
  desconto: number;
  naoAguardar: boolean;
  /** Lances com 4 casas decimais (senão, centavos). */
  quatroCasas: boolean;
}

export const ITEM_ROBO_PADRAO: ConfigItemRobo = { ligado: false, minimo: null, desconto: 0.5, naoAguardar: false, quatroCasas: false };

/** Fases do item no Compras.gov.br (FaseItemEnum). */
export const FASES: Record<string, string> = {
  AS: "Aguardando abertura da sessão",
  AP: "Pendente da análise de propostas",
  F: "Aguardando disputa",
  AA: "Aguardando abertura",
  LS: "Abertura suspensa",
  LA: "Etapa aberta",
  AL: "Etapa aberta (encerramento aleatório)",
  LF: "Etapa fechada",
  AF: "Aguardando disputa fechada",
  FE: "Aguardando encerramento",
  RA: "Aguardando decisão sobre reinício",
  AM: "Aguardando desempate ME/EPP",
  DM: "Em desempate ME/EPP",
  DF: "Em disputa final",
  E: "Disputa encerrada",
};

/** O que o robô sabe de cada item, lido da sala de disputa. */
export interface EstadoItem {
  fase: string; // código do FaseItemEnum
  /** Segundos que faltam no cronômetro (null quando não há cronômetro). */
  restanteSeg: number | null;
  melhorLance: number | null;
  nossoLance: number | null;
  /** G = ganhando, E = empatado, P = perdendo. */
  situacao: string | null;
  /** Intervalo mínimo entre lances exigido no edital. */
  variacaoMinima: number | null;
  tipoVariacao: "V" | "P" | null;
}

export type TipoDecisao = "desligado" | "sem-minimo" | "aguardando-fase" | "ganhando" | "aguardando-final" | "lance" | "minimo" | "no-minimo" | "fechada" | "sem-proposta";

export interface Decisao {
  acao: "aguardar" | "enviar";
  tipo: TipoDecisao;
  valor?: number;
  motivo: string;
}

const casas = (quatro: boolean) => (quatro ? 10_000 : 100);

/** Arredonda para baixo (o lance nunca sobe por arredondamento). */
export function arredondarAbaixo(v: number, quatro = false) {
  const f = casas(quatro);
  return Math.floor(v * f + 1e-6) / f;
}

/** Arredonda para cima (o mínimo nunca desce por arredondamento). */
export function arredondarAcima(v: number, quatro = false) {
  const f = casas(quatro);
  return Math.ceil(v * f - 1e-6) / f;
}

const reais = (v: number, quatro = false) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: quatro ? 4 : 2, maximumFractionDigits: quatro ? 4 : 2 });

/** Quanto precisa baixar a partir de um valor, respeitando o intervalo mínimo do edital. */
export function passoMinimo(base: number, estado: Pick<EstadoItem, "variacaoMinima" | "tipoVariacao">, quatro: boolean) {
  const menor = 1 / casas(quatro);
  if (!estado.variacaoMinima || estado.variacaoMinima <= 0) return menor;
  const v = estado.tipoVariacao === "P" ? (base * estado.variacaoMinima) / 100 : estado.variacaoMinima;
  return Math.max(arredondarAcima(v, quatro), menor);
}

const FASES_DE_LANCE = new Set(["LA", "AL", "DF", "LF"]);

export function decidir(estado: EstadoItem, item: ConfigItemRobo | undefined): Decisao {
  if (!item?.ligado) return { acao: "aguardar", tipo: "desligado", motivo: "Robô parado neste item" };
  if (item.minimo == null || !(item.minimo > 0)) return { acao: "aguardar", tipo: "sem-minimo", motivo: "Informe o lance mínimo para o robô agir" };
  const q = item.quatroCasas;
  const minimo = arredondarAcima(item.minimo, q);
  if (!FASES_DE_LANCE.has(estado.fase)) return { acao: "aguardar", tipo: "aguardando-fase", motivo: FASES[estado.fase] ?? "Aguardando a fase de lances" };
  if (estado.nossoLance == null) return { acao: "aguardar", tipo: "sem-proposta", motivo: "Sem lance nosso neste item" };

  // Etapa fechada: lance único, sem ver os outros. Vai no mínimo.
  if (estado.fase === "LF") {
    if (minimo >= estado.nossoLance) return { acao: "aguardar", tipo: "fechada", motivo: "Etapa fechada: nosso lance já está no mínimo" };
    return { acao: "enviar", tipo: "fechada", valor: minimo, motivo: `Etapa fechada: lance único no mínimo (${reais(minimo, q)})` };
  }

  if (estado.situacao === "G") return { acao: "aguardar", tipo: "ganhando", motivo: "Ganhando" };

  // Espera os 10 segundos finais (no encerramento aleatório não há cronômetro: qualquer segundo pode ser o último).
  if (!item.naoAguardar && estado.fase === "LA" && estado.restanteSeg != null && estado.restanteSeg > SEGUNDOS_FINAIS) {
    return { acao: "aguardar", tipo: "aguardando-final", motivo: `Aguardando entrar nos últimos ${SEGUNDOS_FINAIS} segundos para enviar lance` };
  }

  if (estado.nossoLance <= minimo) return { acao: "aguardar", tipo: "no-minimo", motivo: "No lance mínimo: melhor colocação possível" };

  const melhor = estado.melhorLance ?? estado.nossoLance;
  // Cobrir o melhor: desconto escolhido, nunca menos que o intervalo do edital.
  const desconto = arredondarAcima((melhor * Math.max(item.desconto || 0, 0)) / 100, q);
  const alvo = arredondarAbaixo(melhor - Math.max(desconto, passoMinimo(melhor, estado, q)), q);
  if (alvo >= minimo && alvo < estado.nossoLance) {
    return { acao: "enviar", tipo: "lance", valor: alvo, motivo: `Cobrindo o melhor lance (${reais(melhor, q)}) com ${reais(alvo, q)}` };
  }
  // Não dá para ser 1º acima do mínimo: vai no mínimo, se ele ainda baixa o nosso lance o suficiente.
  if (minimo <= arredondarAbaixo(estado.nossoLance - passoMinimo(estado.nossoLance, estado, q), q)) {
    return { acao: "enviar", tipo: "minimo", valor: minimo, motivo: `Não dá para ser 1º acima do mínimo: lance no mínimo (${reais(minimo, q)})` };
  }
  return { acao: "aguardar", tipo: "no-minimo", motivo: "No lance mínimo: melhor colocação possível" };
}

/** Lê a configuração salva de um item (completa com os padrões e descarta valores inválidos). */
export function normalizarItem(bruto: unknown): ConfigItemRobo {
  const b = (bruto && typeof bruto === "object" ? bruto : {}) as Partial<ConfigItemRobo>;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  const minimo = b.minimo == null || (b.minimo as unknown) === "" ? null : num(b.minimo);
  const desconto = num(b.desconto);
  return {
    ligado: b.ligado === true,
    minimo: minimo != null && Number.isFinite(minimo) && minimo > 0 ? minimo : null,
    desconto: Number.isFinite(desconto) && desconto >= 0 && desconto <= 50 ? desconto : ITEM_ROBO_PADRAO.desconto,
    naoAguardar: b.naoAguardar === true,
    quatroCasas: b.quatroCasas === true,
  };
}

// ---------------- Leitura dos dados do Compras.gov.br ----------------

const numero = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const valorDe = (v: unknown): number | null => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return numero(o.valorCalculado) ?? numero(o.valorInformado);
  }
  return numero(v);
};

export interface ItemDisputa extends EstadoItem {
  numero: number;
  descricao: string;
  quantidade: number | null;
  valorEstimado: number | null;
}

/** Converte um item vindo de /comprasnet-disputa/v1/compras/{compra}/itens/em-disputa. */
export function lerItemDisputa(bruto: Record<string, unknown>): ItemDisputa {
  const tipo = String(bruto.tipoVariacaoMinimaEntreLances ?? "").toUpperCase();
  return {
    numero: numero(bruto.numero) ?? 0,
    descricao: String(bruto.descricao ?? bruto.descricaoDetalhada ?? bruto.identificacao ?? ""),
    quantidade: numero(bruto.quantidade),
    valorEstimado: numero(bruto.valorEstimado),
    fase: String(bruto.fase ?? ""),
    restanteSeg: numero(bruto.tempoRestanteEmSegundos),
    melhorLance: valorDe(bruto.melhorValorGeral),
    nossoLance: valorDe(bruto.melhorValorFornecedor),
    situacao: bruto.situacaoParticipanteDisputa == null ? null : String(bruto.situacaoParticipanteDisputa),
    variacaoMinima: numero(bruto.variacaoMinimaEntreLances),
    tipoVariacao: tipo === "P" || tipo === "V" ? (tipo as "P" | "V") : null,
  };
}

/** A resposta pode vir como lista ou dentro de um objeto (paginação). */
export function listaDe(bruto: unknown): Record<string, unknown>[] {
  if (Array.isArray(bruto)) return bruto as Record<string, unknown>[];
  if (bruto && typeof bruto === "object") {
    for (const k of ["itens", "content", "data", "registros", "resultado", "compras"]) {
      const v = (bruto as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

export interface CompraDisputa {
  chave: string;
  titulo: string;
  uasg: string;
  orgao: string;
  modalidade: string; // "pregao" | "dispensa" | outro
  modoDisputa: string;
  /** Pela situação/fase que o Compras.gov.br informa, a disputa já acabou (ou a compra foi revogada etc.). */
  encerrada: boolean;
  ano: number;
}

// Situação da compra (SituacaoCompraFaseExternaEnum): revogada, anulada, fracassada e deserta não têm mais disputa.
const SITUACOES_SEM_DISPUTA = new Set(["RE", "AN", "FR", "DE"]);
// Fase da compra (FaseCompraFaseExternaEnum): 4 = seleção de fornecedores (disputa já passou), 5 e 6 = ainda nem publicada.
const FASES_SEM_DISPUTA = new Set(["4", "5", "6"]);

// Códigos de modalidade do Compras.gov.br (ModalidadeCompraEnum da sala de disputa).
const NOMES_MODALIDADE: Record<string, string> = {
  "1": "Convite",
  "2": "Tomada de preço",
  "3": "Concorrência eletrônica",
  "4": "Concorrência internacional",
  "5": "Pregão eletrônico",
  "6": "Dispensa eletrônica",
  "7": "Inexigibilidade",
  "8": "Cotação eletrônica",
  "12": "Credenciamento",
};

/** Chave da compra como a sala de disputa monta: UASG (6) + modalidade (2) + número (5) + ano. */
export function chaveDaCompra(b: Record<string, unknown>): string {
  const uasg = String(b.numeroUasg ?? b.uasg ?? "").replace(/\D/g, "");
  const mod = String(b.modalidade ?? "").replace(/\D/g, "");
  const numero = String(b.numeroCompra ?? b.numero ?? "").replace(/\D/g, "");
  const ano = String(b.anoCompra ?? b.ano ?? "").replace(/\D/g, "");
  if (!uasg || !mod || !numero || ano.length !== 4) return "";
  return uasg.padStart(6, "0") + mod.padStart(2, "0") + numero.padStart(5, "0") + ano;
}

/** Converte uma compra vinda da lista de disputas do fornecedor. */
export function lerCompra(b: Record<string, unknown>): CompraDisputa | null {
  const chave = String(b.chaveCompra ?? b.chave ?? "") || chaveDaCompra(b) || String(b.id ?? "");
  if (!chave) return null;
  const mod = String(b.modalidade ?? b.modalidadeCompra ?? "").toUpperCase();
  const textoMod = String(b.descricaoModalidade ?? b.modalidadeDescricao ?? "");
  // Dispensa (6) e cotação eletrônica (8) ficam na aba Dispensas; pregão, concorrência e o resto, na de Pregões.
  const dispensa = /DISPENSA|COTA[ÇC]/i.test(textoMod) || mod === "6" || mod === "8" || mod === "DISPENSA" || mod === "D";
  const numeroCompra = b.numeroCompra ?? b.numero;
  const ano = b.anoCompra ?? b.ano;
  const id = String(b.identificacao ?? (numeroCompra ? `${String(numeroCompra).padStart(5, "0")}${ano ? `/${ano}` : ""}` : chave));
  const nomeMod = textoMod ? (/eletr/i.test(textoMod) ? textoMod : `${textoMod} eletrônica`.replace(/Pregão eletrônica/i, "Pregão eletrônico")) : NOMES_MODALIDADE[mod] ?? (dispensa ? "Dispensa eletrônica" : "Pregão eletrônico");
  return {
    chave,
    titulo: /^(dispensa|preg|concorr|cota)/i.test(id) ? id : `${nomeMod} ${id}`,
    uasg: String(b.numeroUasg ?? b.uasg ?? b.codigoUasg ?? ""),
    orgao: String(b.nomeUasg ?? b.orgao ?? b.nomeOrgao ?? ""),
    modalidade: dispensa ? "dispensa" : "pregao",
    modoDisputa: String(b.descricaoModoDisputa ?? b.modoDisputa ?? ""),
    encerrada: SITUACOES_SEM_DISPUTA.has(String(b.situacaoCompraFaseExterna ?? "")) || FASES_SEM_DISPUTA.has(String(b.faseCompraFaseExterna ?? "")),
    ano: Number(ano) || 0,
  };
}
