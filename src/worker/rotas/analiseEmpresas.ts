import { Hono } from "hono";
import { type Ambiente, exigirLogin, exigirModulo } from "../auth";
import { lerJson } from "../validacao";

// Análise de empresas — dados públicos além das vitórias do PNCP:
// - /propostas: o aplicativo manda as propostas de todas as empresas nas licitações em que a sua empresa
//   participou (telas "Todas as propostas" do Compras.gov.br). Vira uma base própria.
// - /participacoes: resumo de um CNPJ nessa base (participações, vitórias, derrotas, desclassificações, motivos).
// - /penalidades: Consulta Consolidada de Pessoa Jurídica do TCU (inidôneos TCU, CNIA/CNJ, CEIS e CNEP).
export const rotasAnaliseEmpresas = new Hono<Ambiente>();
rotasAnaliseEmpresas.use(exigirLogin, exigirModulo("licitacoes"));

const CNPJ = /^\d{14}$/;
const COMPRA = /^\d{17}$/;
const RESULTADOS = new Set(["vitoria", "derrota", "desclassificada", "inabilitada", "andamento"]);
const texto = (v: unknown, max = 300) => (v == null ? null : String(v).slice(0, max) || null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

rotasAnaliseEmpresas.post("/propostas", async (c) => {
  const corpo = await lerJson(c);
  const lista = Array.isArray(corpo?.propostas) ? (corpo.propostas as Record<string, unknown>[]).slice(0, 400) : [];
  const agora = Date.now();
  const comandos = lista
    .filter((p) => COMPRA.test(String(p.compra ?? "")) && CNPJ.test(String(p.cnpj ?? "")) && Number.isInteger(p.item) && RESULTADOS.has(String(p.resultado ?? "")))
    .map((p) =>
      c.env.DB.prepare(
        `INSERT INTO propostas_compras (compra, item, cnpj, empresa, uf, me_epp, descricao, quantidade, valor, colocacao, situacao, resultado, motivo, orgao, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (compra, item, cnpj) DO UPDATE SET empresa = excluded.empresa, uf = excluded.uf, me_epp = excluded.me_epp, descricao = excluded.descricao,
           quantidade = excluded.quantidade, valor = excluded.valor, colocacao = excluded.colocacao, situacao = excluded.situacao, resultado = excluded.resultado,
           motivo = excluded.motivo, orgao = excluded.orgao, atualizado_em = excluded.atualizado_em`,
      ).bind(
        String(p.compra),
        Number(p.item),
        String(p.cnpj),
        texto(p.empresa, 200),
        texto(p.uf, 2),
        p.meEpp === true ? 1 : p.meEpp === false ? 0 : null,
        texto(p.descricao, 300),
        num(p.quantidade),
        num(p.valor),
        Number.isInteger(p.colocacao) ? Number(p.colocacao) : null,
        texto(p.situacao, 10),
        String(p.resultado),
        texto(p.motivo, 500),
        texto(p.orgao, 200),
        agora,
      ),
    );
  for (let i = 0; i < comandos.length; i += 100) await c.env.DB.batch(comandos.slice(i, i + 100));
  return c.json({ ok: true, gravadas: comandos.length });
});

rotasAnaliseEmpresas.get("/participacoes", async (c) => {
  const cnpj = c.req.query("cnpj") ?? "";
  if (!CNPJ.test(cnpj)) return c.json({ erro: "CNPJ inválido." }, 400);
  const db = c.env.DB;
  const [totais, motivos, recentes, base] = await db.batch([
    db
      .prepare(
        `SELECT COUNT(DISTINCT compra) AS licitacoes, COUNT(*) AS itens,
           SUM(resultado = 'vitoria') AS vitorias, SUM(resultado = 'derrota') AS derrotas,
           SUM(resultado = 'desclassificada') AS desclassificadas, SUM(resultado = 'inabilitada') AS inabilitadas,
           SUM(resultado = 'andamento') AS andamento,
           SUM(COALESCE(valor, 0) * COALESCE(quantidade, 1)) AS valorDisputado,
           SUM(CASE WHEN resultado = 'vitoria' THEN COALESCE(valor, 0) * COALESCE(quantidade, 1) ELSE 0 END) AS valorVencido,
           MAX(empresa) AS empresa
         FROM propostas_compras WHERE cnpj = ?`,
      )
      .bind(cnpj),
    db
      .prepare(
        `SELECT resultado, COALESCE(NULLIF(TRIM(motivo), ''), 'Sem motivo informado') AS motivo, COUNT(*) AS vezes
         FROM propostas_compras WHERE cnpj = ? AND resultado IN ('desclassificada', 'inabilitada')
         GROUP BY resultado, COALESCE(NULLIF(TRIM(motivo), ''), 'Sem motivo informado') ORDER BY vezes DESC LIMIT 150`,
      )
      .bind(cnpj),
    db
      .prepare(
        `SELECT compra, item, descricao, valor, quantidade, colocacao, resultado, motivo, orgao, atualizado_em AS em
         FROM propostas_compras WHERE cnpj = ? ORDER BY atualizado_em DESC LIMIT 60`,
      )
      .bind(cnpj),
    db.prepare(`SELECT COUNT(DISTINCT compra) AS licitacoes, COUNT(DISTINCT cnpj) AS empresas FROM propostas_compras`),
  ]);
  return c.json({ totais: totais.results[0] ?? {}, motivos: motivos.results, recentes: recentes.results, base: base.results[0] ?? {} });
});

rotasAnaliseEmpresas.get("/penalidades", async (c) => {
  const cnpj = c.req.query("cnpj") ?? "";
  if (!CNPJ.test(cnpj)) return c.json({ erro: "CNPJ inválido." }, 400);
  const url = `https://certidoes-apf.apps.tcu.gov.br/api/rest/publico/certidoes/${cnpj}?seEmitirPDF=false`;
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const chave = new Request(url);
  const guardada = await cache?.match(chave).catch(() => undefined);
  if (guardada) return new Response(guardada.body, { headers: { "Content-Type": "application/json; charset=utf-8" } });
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) continue;
      const corpo = await r.text();
      if (cache) c.executionCtx.waitUntil(cache.put(chave, new Response(corpo, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=43200" } })).catch(() => {}));
      return new Response(corpo, { headers: { "Content-Type": "application/json; charset=utf-8" } });
    } catch {
      /* tenta de novo */
    }
  }
  return c.json({ erro: "A consulta de penalidades do TCU não respondeu agora." }, 502);
});
