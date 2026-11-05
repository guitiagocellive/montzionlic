export class ErroApi extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Chama a API do Worker e devolve o JSON. Lança ErroApi com a mensagem do servidor. */
export async function api<T>(caminho: string, opcoes: { metodo?: string; corpo?: unknown } = {}) {
  const resposta = await fetch(`/api${caminho}`, {
    method: opcoes.metodo ?? (opcoes.corpo === undefined ? "GET" : "POST"),
    headers: opcoes.corpo === undefined ? undefined : { "Content-Type": "application/json" },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
    credentials: "same-origin",
  });

  let dados: unknown = null;
  try {
    dados = await resposta.json();
  } catch {
    // resposta sem JSON
  }

  if (!resposta.ok) {
    const mensagem =
      (dados as { erro?: string } | null)?.erro ?? "Não foi possível completar a ação.";
    if (resposta.status === 401 && caminho !== "/auth/login") {
      window.dispatchEvent(new Event("sessao-expirada"));
    }
    throw new ErroApi(mensagem, resposta.status);
  }
  return dados as T;
}

export function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : "Algo deu errado. Tente novamente.";
}
