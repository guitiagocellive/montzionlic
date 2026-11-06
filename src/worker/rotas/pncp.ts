import { Hono } from "hono";
import { type Ambiente, exigirLogin, exigirModulo } from "../auth";
import { extensaoDe, nomeDoArquivo, tipoPorExtensao, URL_ARQUIVO_PNCP } from "../pncp";

export const rotasPncp = new Hono<Ambiente>();
rotasPncp.use(exigirLogin, exigirModulo("licitacoes"));

// Repassa um arquivo do PNCP para a prévia na plataforma (sem guardar nada).
rotasPncp.get("/arquivo", async (c) => {
  const url = c.req.query("url") ?? "";
  if (!URL_ARQUIVO_PNCP.test(url)) return c.json({ erro: "Endereço de arquivo do PNCP inválido." }, 400);
  let resposta: Response | null = null;
  for (let tentativa = 0; tentativa < 2 && !resposta; tentativa++) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      if (r.ok) resposta = r;
    } catch {
      /* tenta de novo */
    }
  }
  if (!resposta?.body) return c.json({ erro: "O PNCP não entregou o arquivo agora. Tente de novo." }, 502);
  const nome = nomeDoArquivo(resposta) || "arquivo";
  const ext = extensaoDe(nome);
  const cabecalhos = new Headers({
    "Content-Type": ext ? tipoPorExtensao(ext) : resposta.headers.get("content-type") ?? "application/octet-stream",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(nome)}`,
    "X-Nome-Arquivo": encodeURIComponent(nome),
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  const tamanho = resposta.headers.get("content-length");
  if (tamanho) cabecalhos.set("Content-Length", tamanho);
  // Repassa em fluxo, sem carregar o arquivo inteiro na memória do servidor.
  return new Response(resposta.body, { headers: cabecalhos });
});
