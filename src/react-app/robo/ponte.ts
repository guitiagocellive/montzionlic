// Conversa com o aplicativo Montzion para Windows (a "ponte" do robô).
// O aplicativo abre o navegador com a plataforma e uma janela do Compras.gov.br onde a pessoa entra com o gov.br.
// Ele coloca a função window.montzionRobo nesta página: por ela pedimos a lista de disputas, os itens e os lances,
// e ele responde chamando window.__montzionRoboResposta. Nada disso passa pelo servidor da plataforma.

declare global {
  interface Window {
    montzionRobo?: (mensagem: string) => void;
    __montzionRoboResposta?: (id: number, dados: unknown) => void;
    /** Colocado pela janela própria do aplicativo (versão 2.0.2 em diante). */
    montzionApp?: { versao: string; janelaPropria: boolean };
  }
}

type Pendente = { ok: (v: unknown) => void; erro: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

let proximo = 1;
const pendentes = new Map<number, Pendente>();

function instalarResposta() {
  window.__montzionRoboResposta = (id, dados) => {
    const p = pendentes.get(id);
    if (!p) return;
    pendentes.delete(id);
    clearTimeout(p.timer);
    const d = dados as { erro?: string } | null;
    if (d && typeof d === "object" && typeof d.erro === "string") p.erro(new Error(d.erro));
    else p.ok(dados);
  };
}

/** Está dentro do aplicativo Montzion (janela própria), mesmo que o robô ainda esteja ligando. */
export const noAplicativo = () => typeof window !== "undefined" && !!window.montzionApp;

export const temPonte = () => typeof window !== "undefined" && typeof window.montzionRobo === "function";

export function chamar<T>(tipo: string, dados: Record<string, unknown> = {}, tempoMs = 20_000): Promise<T> {
  if (!temPonte()) return Promise.reject(new Error("Abra a plataforma pelo aplicativo Montzion para Windows para usar o robô."));
  instalarResposta();
  const id = proximo++;
  return new Promise<T>((ok, erro) => {
    const timer = setTimeout(() => {
      pendentes.delete(id);
      erro(new Error("O aplicativo não respondeu a tempo."));
    }, tempoMs);
    pendentes.set(id, { ok: ok as (v: unknown) => void, erro, timer });
    window.montzionRobo!(JSON.stringify({ id, tipo, ...dados }));
  });
}

export interface EstadoPonte {
  conectado: boolean; // logado no Compras.gov.br
  janela: boolean; // a janela do Compras.gov.br está aberta
  portal?: boolean; // já entrou na Área de Trabalho do Fornecedor, mas ainda não na sala de disputa
  versao?: string;
}

export interface RespostaLance {
  ok: boolean;
  status: number;
  mensagem?: string;
}

/** O que o motor do robô (dentro do aplicativo) está vendo agora. */
export interface PainelRobo {
  versao: string;
  fase: "sem-login" | "aguardando-login" | "entrando" | "buscando" | "pronto" | "erro-lista";
  aviso: string;
  conectado: boolean;
  tempoReal: boolean;
  direto: boolean;
  descartadas: number;
  listaEm: number;
  agora: number;
  compras: { chave: string; info: Record<string, unknown>; lida: boolean; emDisputa: boolean; erro: string; itens: Record<string, unknown>[] }[];
  mensagens: Record<string, { texto: string; erro?: boolean }>;
  lances: { id: number; compra: string; item: number; valor: number; ok: boolean; mensagem: string; em: number; reacaoMs: number }[];
  ultimoLance: { valor: number; em: number; reacaoMs: number } | null;
}

export const ponte = {
  estado: () => chamar<EstadoPonte & { motor?: boolean; fase?: string; aviso?: string }>("estado", {}, 8_000),
  /** Abre a janela de login do gov.br (mostrar = abre mesmo se já estiver logado). */
  entrar: (mostrar = false) => chamar<{ ok: boolean; jaLogado?: boolean }>("entrar", { atualizar: mostrar }),
  painel: () => chamar<PainelRobo>("painel", {}, 5_000),
  configurar: (config: Record<string, unknown>) => chamar<{ ok: boolean }>("configurar", { config }, 5_000),
  confirmar: (ids: number[]) => chamar<{ ok: boolean }>("confirmar", { ids }, 5_000),
  atualizar: () => chamar<{ ok: boolean }>("atualizar", {}, 5_000),
  /** Últimas linhas do registro do aplicativo, sem chaves nem documentos (para mandar ao suporte). */
  diagnostico: () => chamar<{ texto: string }>("diagnostico", {}, 10_000),
  /** Lista de compras em disputa do fornecedor (a página oficial carrega e o aplicativo lê). */
  compras: (atualizar: boolean) => chamar<{ compras: unknown; capturadaEm: number | null }>("compras", { atualizar }, 150_000),
  itens: (compra: string) => chamar<unknown>("itens", { compra }, 15_000),
  lance: (compra: string, item: number, valor: number, fase: string) => chamar<RespostaLance>("lance", { compra, item, valor, fase }, 15_000),
};
