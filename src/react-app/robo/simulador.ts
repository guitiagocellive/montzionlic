// Sala de disputa falsa para testar o robô de lances sem risco.
// Imita as regras do pregão eletrônico: modo aberto (lance nos 2 minutos finais prorroga por mais 2),
// hora fixa (como na dispensa) e aberto e fechado (fim aleatório e depois um lance fechado).
import { type ConfigItemRobo, type ConfigRobo, decidir, type EstadoItem, type FaseDisputa, centavosAbaixo } from "../../shared/robo";

export type ModoSimulacao = "aberto" | "fixo" | "aberto-fechado";

export interface ItemSimulado {
  id: number;
  numero: string;
  descricao: string;
  quantidade: number;
  /** Nossa proposta inicial (por unidade). */
  proposta: number;
  /** Valor de referência do edital (por unidade), usado para os concorrentes. */
  referencia: number;
  config: ConfigItemRobo;
}

export interface OpcoesSimulacao {
  modo: ModoSimulacao;
  duracaoMs: number;
  concorrentes: number;
  semente: number;
}

export interface Lance {
  t: number;
  quem: string; // "Nós" ou "Empresa A"...
  valor: number;
  fechado?: boolean;
}

interface Concorrente {
  nome: string;
  piso: number;
  lance: number;
  /** "atirador" só age perto do fim; "rapido" cobre logo. */
  estilo: "atirador" | "rapido";
  proximaAcao: number | null;
  desistiu: boolean;
  fechadoEnviado: boolean;
}

export interface ItemEmDisputa {
  item: ItemSimulado;
  fase: FaseDisputa;
  fimAberta: number; // tempo (ms) em que a etapa com cronômetro acaba
  fimAleatorio: number | null;
  fimFechada: number | null;
  nosso: number;
  nossoFechadoEnviado: boolean;
  concorrentes: Concorrente[];
  lances: Lance[];
  ultimaDecisao: string;
  prorrogacoes: number;
  aguardarAte: number;
}

export interface Simulacao {
  t: number;
  opcoes: OpcoesSimulacao;
  geral: Pick<ConfigRobo, "segundosFinais" | "naoAguardar">;
  itens: ItemEmDisputa[];
  registro: { t: number; texto: string; tipo: "nosso" | "concorrente" | "info" }[];
  rand: () => number;
}

const PRORROGACAO = 120_000;
const NOMES = ["Empresa A", "Empresa B", "Empresa C", "Empresa D", "Empresa E"];

/** Números "aleatórios" repetíveis (mesma semente = mesma disputa). */
function gerador(semente: number) {
  let a = semente >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function criarSimulacao(itens: ItemSimulado[], opcoes: OpcoesSimulacao, geral: Pick<ConfigRobo, "segundosFinais" | "naoAguardar">): Simulacao {
  const rand = gerador(opcoes.semente);
  const emDisputa = itens.map((item): ItemEmDisputa => {
    const minimo = item.config.minimo ?? item.proposta * 0.85;
    const concorrentes = Array.from({ length: opcoes.concorrentes }, (_, k): Concorrente => {
      // Pisos espalhados em volta do nosso mínimo: às vezes dá para ganhar, às vezes não.
      const piso = centavosAbaixo(minimo * (0.86 + rand() * 0.3));
      const inicial = centavosAbaixo(Math.max(item.referencia, item.proposta) * (0.97 + rand() * 0.12));
      return { nome: NOMES[k], piso, lance: Math.max(inicial, piso), estilo: rand() < 0.5 ? "atirador" : "rapido", proximaAcao: null, desistiu: false, fechadoEnviado: false };
    });
    return {
      item,
      fase: "aberta",
      fimAberta: opcoes.duracaoMs,
      fimAleatorio: null,
      fimFechada: null,
      nosso: item.proposta,
      nossoFechadoEnviado: false,
      concorrentes,
      lances: [{ t: 0, quem: "Nós", valor: item.proposta }, ...concorrentes.map((c) => ({ t: 0, quem: c.nome, valor: c.lance }))],
      ultimaDecisao: "",
      prorrogacoes: 0,
      aguardarAte: 0,
    };
  });
  return { t: 0, opcoes, geral, itens: emDisputa, registro: [{ t: 0, texto: "Disputa iniciada", tipo: "info" }], rand };
}

/** Classificação atual (menor valor vence; empate: quem deu o lance primeiro). */
export function classificacao(d: ItemEmDisputa): { quem: string; valor: number; t: number }[] {
  const ultimo = new Map<string, Lance>();
  for (const l of d.lances) {
    const atual = ultimo.get(l.quem);
    if (!atual || l.valor < atual.valor) ultimo.set(l.quem, l);
  }
  return Array.from(ultimo.values())
    .map((l) => ({ quem: l.quem, valor: l.valor, t: l.t }))
    .sort((a, b) => a.valor - b.valor || a.t - b.t);
}

export function posicaoNossa(d: ItemEmDisputa) {
  return classificacao(d).findIndex((x) => x.quem === "Nós") + 1;
}

function registrarLance(sim: Simulacao, d: ItemEmDisputa, quem: string, valor: number, fechado = false) {
  d.lances.push({ t: sim.t, quem, valor, fechado });
  if (quem === "Nós") d.nosso = valor;
  else {
    const c = d.concorrentes.find((x) => x.nome === quem);
    if (c) c.lance = valor;
  }
  // Modo aberto: lance nos 2 minutos finais prorroga por mais 2 minutos.
  if (!fechado && d.fase === "aberta" && sim.opcoes.modo === "aberto" && d.fimAberta - sim.t < PRORROGACAO) {
    d.fimAberta = sim.t + PRORROGACAO;
    d.prorrogacoes++;
  }
  const texto = `Item ${d.item.numero}: ${quem} ${fechado ? "lance fechado de" : "deu"} ${valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`;
  sim.registro.push({ t: sim.t, texto, tipo: quem === "Nós" ? "nosso" : "concorrente" });
}

function estadoParaRobo(sim: Simulacao, d: ItemEmDisputa): EstadoItem {
  const rank = classificacao(d);
  return {
    fase: d.fase,
    restanteMs: d.fase === "aberta" ? Math.max(d.fimAberta - sim.t, 0) : null,
    melhorLance: rank[0]?.valor ?? null,
    nossoLance: d.nosso,
    somosPrimeiro: rank[0]?.quem === "Nós",
    fechadoEnviado: d.nossoFechadoEnviado,
  };
}

function agirConcorrentes(sim: Simulacao, d: ItemEmDisputa) {
  const rank = classificacao(d);
  const melhor = rank[0];
  for (const c of d.concorrentes) {
    if (d.fase === "fechada") {
      if (c.fechadoEnviado) continue;
      c.fechadoEnviado = true;
      // Só o melhor e quem está até 10% acima podem dar o lance fechado.
      if (c.lance > melhor.valor * 1.1) continue;
      const v = Math.max(c.piso, centavosAbaixo(melhor.valor * (0.97 + sim.rand() * 0.02)));
      if (v < c.lance) registrarLance(sim, d, c.nome, v, true);
      continue;
    }
    if (c.desistiu || melhor.quem === c.nome) {
      c.proximaAcao = null;
      continue;
    }
    if (c.proximaAcao == null) {
      // Decide quando vai reagir.
      const restante = d.fase === "aberta" ? d.fimAberta - sim.t : 20_000;
      const espera = c.estilo === "rapido" ? 2_000 + sim.rand() * 10_000 : Math.max(restante - (3_000 + sim.rand() * 15_000), 1_000 + sim.rand() * 3_000);
      c.proximaAcao = sim.t + espera;
    }
    if (sim.t < c.proximaAcao) continue;
    c.proximaAcao = null;
    const alvo = centavosAbaixo(melhor.valor * (1 - (0.003 + sim.rand() * 0.012)));
    if (alvo >= c.piso) registrarLance(sim, d, c.nome, alvo);
    else if (c.lance > c.piso) registrarLance(sim, d, c.nome, c.piso);
    else c.desistiu = true;
  }
}

function agirRobo(sim: Simulacao, d: ItemEmDisputa) {
  if (sim.t < d.aguardarAte) return;
  const decisao = decidir(estadoParaRobo(sim, d), d.item.config, sim.geral);
  if (decisao.motivo !== d.ultimaDecisao && decisao.acao === "aguardar") {
    d.ultimaDecisao = decisao.motivo;
  }
  if (decisao.acao === "enviar" && decisao.valor != null) {
    d.ultimaDecisao = decisao.motivo;
    if (d.fase === "fechada") d.nossoFechadoEnviado = true;
    registrarLance(sim, d, "Nós", decisao.valor, d.fase === "fechada");
    d.aguardarAte = sim.t + 400; // tempo da internet até o lance aparecer
  }
}

/** Avança a simulação dt milissegundos. */
export function avancar(sim: Simulacao, dt: number) {
  sim.t += dt;
  for (const d of sim.itens) {
    if (d.fase === "encerrada") continue;
    if (d.fase === "aberta" && sim.t >= d.fimAberta) {
      if (sim.opcoes.modo === "aberto-fechado") {
        d.fase = "aleatoria";
        d.fimAleatorio = sim.t + sim.rand() * 120_000;
        sim.registro.push({ t: sim.t, texto: `Item ${d.item.numero}: começou o tempo aleatório (fim desconhecido)`, tipo: "info" });
      } else {
        d.fase = "encerrada";
        sim.registro.push({ t: sim.t, texto: `Item ${d.item.numero}: disputa encerrada`, tipo: "info" });
        continue;
      }
    }
    if (d.fase === "aleatoria" && d.fimAleatorio != null && sim.t >= d.fimAleatorio) {
      d.fase = "fechada";
      d.fimFechada = sim.t + 30_000;
      sim.registro.push({ t: sim.t, texto: `Item ${d.item.numero}: etapa fechada (um lance final)`, tipo: "info" });
    }
    if (d.fase === "fechada" && d.fimFechada != null && sim.t >= d.fimFechada) {
      d.fase = "encerrada";
      sim.registro.push({ t: sim.t, texto: `Item ${d.item.numero}: disputa encerrada`, tipo: "info" });
      continue;
    }
    agirRobo(sim, d);
    agirConcorrentes(sim, d);
  }
}

export const terminou = (sim: Simulacao) => sim.itens.every((d) => d.fase === "encerrada");

export interface ResultadoItem {
  numero: string;
  descricao: string;
  posicao: number;
  nosso: number;
  minimo: number | null;
  vencedor: { quem: string; valor: number };
  nossosLances: number;
  margemSobreMinimo: number | null; // (nosso - mínimo) x quantidade
}

export function resultado(sim: Simulacao): ResultadoItem[] {
  return sim.itens.map((d) => {
    const rank = classificacao(d);
    const minimo = d.item.config.minimo;
    return {
      numero: d.item.numero,
      descricao: d.item.descricao,
      posicao: posicaoNossa(d),
      nosso: d.nosso,
      minimo,
      vencedor: { quem: rank[0].quem, valor: rank[0].valor },
      nossosLances: d.lances.filter((l) => l.quem === "Nós").length - 1,
      margemSobreMinimo: minimo ? (d.nosso - minimo) * d.item.quantidade : null,
    };
  });
}

/** Roda a disputa inteira de uma vez (para comparar estratégias com a mesma semente). */
export function simularAteOFim(itens: ItemSimulado[], opcoes: OpcoesSimulacao, geral: Pick<ConfigRobo, "segundosFinais" | "naoAguardar">) {
  const sim = criarSimulacao(itens, opcoes, geral);
  for (let passos = 0; !terminou(sim) && passos < 200_000; passos++) avancar(sim, 100);
  return resultado(sim);
}
