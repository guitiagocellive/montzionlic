import { Hono } from "hono";
import { podeEditar, podeVer } from "../../shared/permissoes";
import { normalizarItem } from "../../shared/robo";
import { type Ambiente, exigirLogin } from "../auth";
import { lerJson } from "../validacao";

// Robô de lances (página Disputas). Os lances são dados pelo aplicativo do Windows, direto no Compras.gov.br;
// aqui fica a configuração de cada item (lance mínimo, desconto...) e o registro dos lances enviados.
export const rotasRobo = new Hono<Ambiente>();
rotasRobo.use(exigirLogin);

const CHAVE = /^[\w.-]{1,80}:\d{1,6}$/;
const COMPRA = /^[\w.-]{1,80}$/;

const podeUsar = (c: { get: (k: "usuario") => { permissoes: Parameters<typeof podeVer>[0] } }) => {
  const p = c.get("usuario").permissoes;
  return podeVer(p, "orcamento") && podeEditar(p, "licitacoes");
};

// Configuração dos itens das compras pedidas (?compras=a,b)
rotasRobo.get("/itens", async (c) => {
  if (!podeUsar(c)) return c.json({ erro: "Você não tem permissão para usar o robô." }, 403);
  const compras = (c.req.query("compras") ?? "").split(",").filter((x) => COMPRA.test(x)).slice(0, 50);
  if (!compras.length) return c.json({ itens: {} });
  const { results } = await c.env.DB.prepare(`SELECT chave, dados FROM robo_itens WHERE compra IN (${compras.map(() => "?").join(",")})`)
    .bind(...compras)
    .all<{ chave: string; dados: string }>();
  const itens: Record<string, unknown> = {};
  for (const r of results) {
    try {
      itens[r.chave] = normalizarItem(JSON.parse(r.dados));
    } catch {
      /* ignora registro inválido */
    }
  }
  return c.json({ itens });
});

rotasRobo.put("/itens/:chave", async (c) => {
  if (!podeUsar(c)) return c.json({ erro: "Você não tem permissão para usar o robô." }, 403);
  const chave = c.req.param("chave");
  if (!CHAVE.test(chave)) return c.json({ erro: "Item inválido." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const item = normalizarItem(corpo.item);
  await c.env.DB.prepare(
    `INSERT INTO robo_itens (chave, compra, dados, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(chave) DO UPDATE SET dados = excluded.dados, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em`,
  )
    .bind(chave, chave.split(":")[0], JSON.stringify(item), c.get("usuario").id, Date.now())
    .run();
  return c.json({ item });
});

// Registro de um lance enviado pelo robô (ou da falha ao enviar)
rotasRobo.post("/lances", async (c) => {
  if (!podeUsar(c)) return c.json({ erro: "Você não tem permissão para usar o robô." }, 403);
  const corpo = await lerJson(c);
  const compra = String(corpo?.compra ?? "");
  const item = Number(corpo?.item);
  const valor = Number(corpo?.valor);
  if (!COMPRA.test(compra) || !Number.isInteger(item) || !Number.isFinite(valor)) return c.json({ erro: "Lance inválido." }, 400);
  await c.env.DB.prepare("INSERT INTO robo_lances (compra, item, valor, ok, mensagem, usuario_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(compra, item, valor, corpo?.ok ? 1 : 0, String(corpo?.mensagem ?? "").slice(0, 300), c.get("usuario").id, Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

rotasRobo.get("/lances", async (c) => {
  if (!podeUsar(c)) return c.json({ erro: "Você não tem permissão para usar o robô." }, 403);
  const compra = c.req.query("compra") ?? "";
  if (!COMPRA.test(compra)) return c.json({ lances: [] });
  const { results } = await c.env.DB.prepare(
    `SELECT l.item, l.valor, l.ok, l.mensagem, l.criado_em, u.nome AS usuario_nome
       FROM robo_lances l LEFT JOIN usuarios u ON u.id = l.usuario_id
      WHERE l.compra = ? ORDER BY l.criado_em DESC LIMIT 100`,
  )
    .bind(compra)
    .all();
  return c.json({ lances: results });
});
