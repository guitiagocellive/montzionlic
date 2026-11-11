import { Hono } from "hono";
import { type Ambiente, exigirLogin, exigirModulo } from "../auth";

// Inteligência de mercado: repassa a "pesquisa de preços" dos dados abertos do Compras.gov.br
// (quem venceu, marca, preço, órgão e estado de cada item comprado). O navegador não consegue
// consultar direto (a API não libera outros sites), então o servidor busca e repassa, sem
// processar nada (cabe no plano grátis). Respostas iguais ficam guardadas por 12 horas.

export const rotasMercado = new Hono<Ambiente>();
rotasMercado.use(exigirLogin, exigirModulo("licitacoes"));

const API = "https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial";
export const POR_PAGINA_MERCADO = 500;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

rotasMercado.get("/precos", async (c) => {
  const pdm = c.req.query("pdm") ?? "";
  const pagina = Number(c.req.query("pagina") ?? "1");
  const inicio = c.req.query("inicio") ?? "";
  const fim = c.req.query("fim") ?? "";
  // "tamanho=10" só conta quantos registros existem (para ordenar os produtos do catálogo).
  const tamanho = c.req.query("tamanho") === "10" ? 10 : POR_PAGINA_MERCADO;
  if (!/^\d{1,7}$/.test(pdm) || !Number.isInteger(pagina) || pagina < 1 || pagina > 400 || !DATA.test(inicio) || !DATA.test(fim)) {
    return c.json({ erro: "Pesquisa inválida." }, 400);
  }
  const p = new URLSearchParams({
    pagina: String(pagina),
    tamanhoPagina: String(tamanho),
    tipo: "codigoPdm",
    codigo: pdm,
    dataCompraInicio: inicio,
    dataCompraFim: fim,
  });
  const url = `${API}?${p}`;

  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const chave = new Request(url);
  const guardada = await cache?.match(chave).catch(() => undefined);
  if (guardada) return new Response(guardada.body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": "HIT" } });

  let resposta: Response | null = null;
  for (let tentativa = 0; tentativa < 3 && !resposta; tentativa++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (r.ok && r.body) resposta = r;
      else if (r.status === 400) return c.json({ erro: "O Compras.gov.br recusou a pesquisa." }, 400);
    } catch {
      /* tenta de novo */
    }
  }
  if (!resposta?.body) return c.json({ erro: "O Compras.gov.br não respondeu agora. Tente de novo em instantes." }, 502);

  // Repassa em fluxo e guarda uma cópia (sem carregar tudo na memória do servidor).
  const [paraVoce, paraGuardar] = resposta.body.tee();
  if (cache) {
    c.executionCtx.waitUntil(
      cache
        .put(chave, new Response(paraGuardar, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=43200" } }))
        .catch(() => {}),
    );
  } else {
    paraGuardar.cancel().catch(() => {});
  }
  return new Response(paraVoce, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Cache": "MISS" } });
});
