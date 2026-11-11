// Robô de lances: a regra de decisão (igual no simulador e, depois, na sala de disputa do Compras.gov.br).
//
// Padrão: espera os segundos finais do cronômetro do item e só então dá o menor lance que coloca a empresa
// em 1º lugar. Se não der para ser 1º sem passar do valor mínimo, dá o valor mínimo (melhor colocação
// possível) e para. Nunca envia abaixo do mínimo.
// Com "Não aguardar os segundos finais", dá o lance assim que perde o 1º lugar.

export interface ConfigItemRobo {
  ativo: boolean;
  /** Valor mínimo (por unidade). Abaixo disso o robô nunca vai. */
  minimo: number | null;
  /** Quanto baixar a cada lance: em reais ou em % do melhor lance. */
  reducaoTipo: "valor" | "percentual";
  reducao: number;
  /** Lance da etapa fechada (modo aberto e fechado). Vazio = o valor mínimo. */
  lanceFechado: number | null;
}

export interface ConfigRobo {
  /** Segundos finais do cronômetro em que o robô começa a dar lances (padrão 30). */
  segundosFinais: number;
  /** Liga = dá lance assim que perde o 1º lugar, sem esperar os segundos finais. */
  naoAguardar: boolean;
  /** Lucro mínimo (%) usado para sugerir o valor mínimo a partir do orçamento. */
  lucroMinimo: number;
  itens: Record<string, ConfigItemRobo>;
}

export const CONFIG_ROBO_PADRAO: ConfigRobo = { segundosFinais: 30, naoAguardar: false, lucroMinimo: 0, itens: {} };

export const ITEM_ROBO_PADRAO: ConfigItemRobo = { ativo: true, minimo: null, reducaoTipo: "valor", reducao: 0.01, lanceFechado: null };

/**
 * Etapas da disputa de um item:
 * - aguardando: ainda não começou;
 * - aberta: lances abertos com cronômetro (o fim pode ser prorrogado);
 * - aleatoria: fim aleatório, sem cronômetro (modo aberto e fechado);
 * - fechada: lance final fechado (modo aberto e fechado);
 * - encerrada.
 */
export type FaseDisputa = "aguardando" | "aberta" | "aleatoria" | "fechada" | "encerrada";

export interface EstadoItem {
  fase: FaseDisputa;
  /** Tempo restante no cronômetro do item, em milissegundos (null quando não há cronômetro). */
  restanteMs: number | null;
  melhorLance: number | null;
  nossoLance: number | null;
  somosPrimeiro: boolean;
  /** Na etapa fechada: o lance fechado já foi enviado? */
  fechadoEnviado?: boolean;
}

export type TipoDecisao =
  | "inativo"
  | "sem-minimo"
  | "sem-proposta"
  | "encerrado"
  | "aguardando-inicio"
  | "primeiro"
  | "esperando-final"
  | "lance"
  | "minimo"
  | "no-minimo"
  | "fechado"
  | "fechado-enviado";

export interface Decisao {
  acao: "aguardar" | "enviar";
  tipo: TipoDecisao;
  valor?: number;
  motivo: string;
}

/** Arredonda para baixo em centavos (o lance nunca sobe por arredondamento). */
export function centavosAbaixo(v: number): number {
  return Math.floor(v * 100 + 1e-6) / 100;
}

/** Arredonda para cima em centavos (o mínimo nunca desce por arredondamento). */
export function centavosAcima(v: number): number {
  return Math.ceil(v * 100 - 1e-6) / 100;
}

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Próximo lance para cobrir o melhor lance. */
export function lanceParaCobrir(melhor: number, item: Pick<ConfigItemRobo, "reducaoTipo" | "reducao">): number {
  const reducao = Math.max(item.reducao || 0, 0);
  const alvo = item.reducaoTipo === "percentual" ? melhor * (1 - reducao / 100) : melhor - reducao;
  // Sempre baixa pelo menos 1 centavo.
  return Math.min(centavosAbaixo(alvo), centavosAbaixo(melhor - 0.01));
}

export function decidir(estado: EstadoItem, item: ConfigItemRobo | undefined, geral: Pick<ConfigRobo, "segundosFinais" | "naoAguardar">): Decisao {
  if (!item || !item.ativo) return { acao: "aguardar", tipo: "inativo", motivo: "Robô desligado neste item" };
  if (item.minimo == null || !(item.minimo > 0)) return { acao: "aguardar", tipo: "sem-minimo", motivo: "Sem valor mínimo: o robô não age" };
  const minimo = centavosAcima(item.minimo);
  if (estado.fase === "encerrada") return { acao: "aguardar", tipo: "encerrado", motivo: "Disputa encerrada" };
  if (estado.fase === "aguardando") return { acao: "aguardar", tipo: "aguardando-inicio", motivo: "Aguardando o início da disputa" };
  if (estado.nossoLance == null) return { acao: "aguardar", tipo: "sem-proposta", motivo: "Sem proposta nossa neste item" };

  // Etapa fechada: um único lance, sem ver os outros.
  if (estado.fase === "fechada") {
    if (estado.fechadoEnviado) return { acao: "aguardar", tipo: "fechado-enviado", motivo: "Lance fechado já enviado" };
    const desejado = item.lanceFechado != null && item.lanceFechado >= minimo ? centavosAbaixo(item.lanceFechado) : minimo;
    if (desejado >= estado.nossoLance) return { acao: "aguardar", tipo: "fechado-enviado", motivo: "Nosso lance já é o melhor que dá para a etapa fechada" };
    return { acao: "enviar", tipo: "fechado", valor: desejado, motivo: `Lance fechado de ${reais(desejado)}` };
  }

  if (estado.somosPrimeiro) return { acao: "aguardar", tipo: "primeiro", motivo: "Em 1º lugar" };

  // Espera os segundos finais (só quando há cronômetro; no fim aleatório não dá para saber o fim).
  const janela = Math.max(geral.segundosFinais || 0, 1) * 1000;
  if (!geral.naoAguardar && estado.fase === "aberta" && estado.restanteMs != null && estado.restanteMs > janela) {
    return { acao: "aguardar", tipo: "esperando-final", motivo: `Esperando os ${geral.segundosFinais} segundos finais` };
  }

  if (estado.nossoLance <= minimo) return { acao: "aguardar", tipo: "no-minimo", motivo: "Já está no valor mínimo: melhor colocação possível" };

  const melhor = estado.melhorLance ?? estado.nossoLance;
  const alvo = lanceParaCobrir(melhor, item);
  if (alvo >= minimo) {
    if (alvo >= estado.nossoLance) return { acao: "aguardar", tipo: "primeiro", motivo: "Em 1º lugar" };
    return { acao: "enviar", tipo: "lance", valor: alvo, motivo: `Cobrindo o melhor lance (${reais(melhor)}) com ${reais(alvo)}` };
  }
  return { acao: "enviar", tipo: "minimo", valor: minimo, motivo: `Não dá para ser 1º acima do mínimo: lance no mínimo (${reais(minimo)})` };
}

/** Lê a configuração salva (completa com os padrões e descarta valores inválidos). */
export function normalizarConfig(bruto: unknown): ConfigRobo {
  const b = (bruto && typeof bruto === "object" ? bruto : {}) as Partial<ConfigRobo>;
  const numero = (v: unknown, padrao: number, min = 0, max = Infinity) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : padrao;
  };
  const itens: Record<string, ConfigItemRobo> = {};
  for (const [id, v] of Object.entries(b.itens && typeof b.itens === "object" ? b.itens : {})) {
    if (!/^\d+$/.test(id) || !v || typeof v !== "object") continue;
    const i = v as Partial<ConfigItemRobo>;
    const minimo = i.minimo == null || (i.minimo as unknown) === "" ? null : numero(i.minimo, 0, 0);
    const fechado = i.lanceFechado == null || (i.lanceFechado as unknown) === "" ? null : numero(i.lanceFechado, 0, 0);
    itens[id] = {
      ativo: i.ativo !== false,
      minimo: minimo && minimo > 0 ? minimo : null,
      reducaoTipo: i.reducaoTipo === "percentual" ? "percentual" : "valor",
      reducao: numero(i.reducao, 0.01, 0, i.reducaoTipo === "percentual" ? 50 : 1e9),
      lanceFechado: fechado && fechado > 0 ? fechado : null,
    };
  }
  return {
    segundosFinais: Math.round(numero(b.segundosFinais, 30, 3, 600)),
    naoAguardar: b.naoAguardar === true,
    lucroMinimo: numero(b.lucroMinimo, 0, -50, 90),
    itens,
  };
}
