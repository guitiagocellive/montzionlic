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

export const ponte = {
  estado: () => chamar<EstadoPonte>("estado", {}, 8_000),
  entrar: () => chamar<{ ok: boolean }>("entrar"),
  /** Lista de compras em disputa do fornecedor (a página oficial carrega e o aplicativo lê). */
  compras: (atualizar: boolean) => chamar<{ compras: unknown; capturadaEm: number | null }>("compras", { atualizar }, 150_000),
  itens: (compra: string) => chamar<unknown>("itens", { compra }, 15_000),
  lance: (compra: string, item: number, valor: number, fase: string) => chamar<RespostaLance>("lance", { compra, item, valor, fase }, 15_000),
};
