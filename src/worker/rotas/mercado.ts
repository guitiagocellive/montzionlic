import { type Context, Hono } from "hono";
import { type Ambiente, exigirLogin, exigirModulo } from "../auth";

// Inteligência de mercado e Análise de empresas: repassa consultas aos dados abertos oficiais
// (dadosabertos.compras.gov.br). O navegador não consegue consultar direto (a API não libera outros
// sites), então o servidor busca e repassa, sem processar nada (cabe no plano grátis).
// Respostas iguais ficam guardadas por 12 horas.

export const rotasMercado = new Hono<Ambiente>();
rotasMercado.use(exigirLogin, exigirModulo("licitacoes"));

const BASE = "https://dadosabertos.compras.gov.br";
export const POR_PAGINA_MERCADO = 500;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CNPJ = /^\d{14}$/;

/** Busca no portal de dados abertos (com 3 tentativas e cache de 12 h) e repassa a resposta em fluxo. */
async function repassar(c: Context<Ambiente>, caminho: string, params: Record<string, string>) {
  const url = `${BASE}${caminho}?${new URLSearchParams(params)}`;
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
      else if (r.status === 404) return c.json({ resultado: [], totalRegistros: 0, totalPaginas: 0 });
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
}

const paginaValida = (v: string | undefined) => {
  const n = Number(v ?? "1");
  return Number.isInteger(n) && n >= 1 && n <= 400 ? n : 0;
};

// Pesquisa de preços (Inteligência de mercado): itens vencidos de um produto do catálogo.
rotasMercado.get("/precos", async (c) => {
  const pdm = c.req.query("pdm") ?? "";
  // "item" = código exato do item no catálogo (CATMAT), em vez do grupo de produtos (PDM).
  const item = c.req.query("item") ?? "";
  const pagina = paginaValida(c.req.query("pagina"));
  const inicio = c.req.query("inicio") ?? "";
  const fim = c.req.query("fim") ?? "";
  const codigo = item || pdm;
  if (!/^\d{1,9}$/.test(codigo) || !pagina || !DATA.test(inicio) || !DATA.test(fim)) return c.json({ erro: "Pesquisa inválida." }, 400);
  // "tamanho=10" só conta quantos registros existem (para ordenar os produtos do catálogo).
  const tamanho = c.req.query("tamanho") === "10" ? 10 : POR_PAGINA_MERCADO;
  return repassar(c, "/modulo-pesquisa-preco/1_consultarMaterial", {
    pagina: String(pagina),
    tamanhoPagina: String(tamanho),
    tipo: item ? "codigoItemCatalogo" : "codigoPdm",
    codigo,
    dataCompraInicio: inicio,
    dataCompraFim: fim,
  });
});

// ---------- Análise de empresas ----------

// Cadastro do fornecedor (razão social, CNAE, porte, cidade, se pode licitar).
rotasMercado.get("/fornecedor", async (c) => {
  const cnpj = c.req.query("cnpj") ?? "";
  const ativo = c.req.query("ativo") === "false" ? "false" : "true";
  if (!CNPJ.test(cnpj)) return c.json({ erro: "CNPJ inválido." }, 400);
  return repassar(c, "/modulo-fornecedor/1_consultarFornecedor", { pagina: "1", tamanhoPagina: "10", cnpj, ativo });
});

// Itens vencidos (resultados publicados no PNCP, de todas as plataformas). Janela de até 365 dias.
rotasMercado.get("/vitorias", async (c) => {
  const cnpj = c.req.query("cnpj") ?? "";
  const pagina = paginaValida(c.req.query("pagina"));
  const inicio = c.req.query("inicio") ?? "";
  const fim = c.req.query("fim") ?? "";
  if (!CNPJ.test(cnpj) || !pagina || !DATA.test(inicio) || !DATA.test(fim)) return c.json({ erro: "Pesquisa inválida." }, 400);
  return repassar(c, "/modulo-contratacoes/3_consultarResultadoItensContratacoes_PNCP_14133", {
    pagina: String(pagina),
    tamanhoPagina: String(POR_PAGINA_MERCADO),
    niFornecedor: cnpj,
    dataResultadoPncpInicial: inicio,
    dataResultadoPncpFinal: fim,
  });
});

// Descrição dos itens vencidos (itens do PNCP em que a empresa é a vencedora). Janela de até 365 dias.
rotasMercado.get("/itens-vencidos", async (c) => {
  const cnpj = c.req.query("cnpj") ?? "";
  const pagina = paginaValida(c.req.query("pagina"));
  const inicio = c.req.query("inicio") ?? "";
  const fim = c.req.query("fim") ?? "";
  if (!CNPJ.test(cnpj) || !pagina || !DATA.test(inicio) || !DATA.test(fim)) return c.json({ erro: "Pesquisa inválida." }, 400);
  return repassar(c, "/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133", {
    pagina: String(pagina),
    tamanhoPagina: String(POR_PAGINA_MERCADO),
    codFornecedor: cnpj,
    dataInclusaoPncpInicial: inicio,
    dataInclusaoPncpFinal: fim,
  });
});

// Nome e cidade de um órgão comprador (UASG).
rotasMercado.get("/uasg", async (c) => {
  const codigo = c.req.query("codigo") ?? "";
  if (!/^\d{1,8}$/.test(codigo)) return c.json({ erro: "Código inválido." }, 400);
  const statusUasg = c.req.query("ativo") === "false" ? "false" : "true";
  return repassar(c, "/modulo-uasg/1_consultarUasg", { pagina: "1", codigoUasg: codigo, statusUasg });
});
