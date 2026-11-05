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

/** Envia um arquivo (multipart) para a API. */
export async function enviarArquivo<T>(caminho: string, dados: FormData): Promise<T> {
  const resposta = await fetch(`/api${caminho}`, {
    method: "POST",
    body: dados,
    credentials: "same-origin",
  });
  const json = (await resposta.json().catch(() => null)) as (T & { erro?: string }) | null;
  if (!resposta.ok) {
    throw new ErroApi(json?.erro ?? "Não foi possível enviar o arquivo.", resposta.status);
  }
  return json as T;
}
