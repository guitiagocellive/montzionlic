import { Hono } from "hono";
import { podeVer } from "../../shared/permissoes";
import { type Ambiente, exigirLogin } from "../auth";
import { calcularAlertas, gerarSeNecessario } from "../notificacoes";
import { lerJson } from "../validacao";

export const rotasNotificacoes = new Hono<Ambiente>();
rotasNotificacoes.use(exigirLogin);

rotasNotificacoes.get("/notificacoes", async (c) => {
  await gerarSeNecessario(c.env.DB);
  const id = c.get("usuario").id;
  const [lista, contagem] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, tipo, titulo, mensagem, link, lida_em, criado_em FROM notificacoes
        WHERE usuario_id = ? ORDER BY criado_em DESC, id DESC LIMIT 40`,
    ).bind(id),
    c.env.DB.prepare("SELECT COUNT(*) AS total FROM notificacoes WHERE usuario_id = ? AND lida_em IS NULL").bind(id),
  ]);
  return c.json({
    notificacoes: (lista.results as {
      id: number;
      tipo: string;
      titulo: string;
      mensagem: string | null;
      link: string | null;
      lida_em: number | null;
      criado_em: number;
    }[]).map((n) => ({
      id: n.id,
      tipo: n.tipo,
      titulo: n.titulo,
      mensagem: n.mensagem,
      link: n.link,
      lida: n.lida_em != null,
      criadoEm: n.criado_em,
    })),
    naoLidas: (contagem.results[0] as { total: number }).total,
  });
});

// Marca como lidas: { ids: [1, 2] } ou { todas: true }
rotasNotificacoes.post("/notificacoes/lidas", async (c) => {
  const corpo = await lerJson(c);
  const id = c.get("usuario").id;
  const agora = Date.now();
  if (corpo?.todas === true) {
    await c.env.DB.prepare("UPDATE notificacoes SET lida_em = ? WHERE usuario_id = ? AND lida_em IS NULL")
      .bind(agora, id)
      .run();
  } else if (Array.isArray(corpo?.ids) && corpo.ids.length > 0 && corpo.ids.length <= 90) {
    const ids = corpo.ids.filter((x): x is number => Number.isInteger(x));
    if (ids.length === 0) return c.json({ erro: "Lista inválida." }, 400);
    await c.env.DB.prepare(
      `UPDATE notificacoes SET lida_em = ? WHERE usuario_id = ? AND lida_em IS NULL AND id IN (${ids.map(() => "?").join(", ")})`,
    )
      .bind(agora, id, ...ids)
      .run();
  } else {
    return c.json({ erro: "Requisição inválida." }, 400);
  }
  return c.json({ ok: true });
});

// Central de alertas (calculada na hora).
rotasNotificacoes.get("/alertas", async (c) => {
  const p = c.get("usuario").permissoes;
  return c.json({ alertas: await calcularAlertas(c.env.DB, (m) => podeVer(p, m)) });
});
