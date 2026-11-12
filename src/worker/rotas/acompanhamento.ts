import { Hono } from "hono";
import { podeVer, resolverPermissoes } from "../../shared/permissoes";
import { type Ambiente, exigirLogin, exigirModulo } from "../auth";
import { lerJson } from "../validacao";

// Aba Acompanhamento: o aplicativo do Windows lê as participações no Compras.gov.br e a página manda para cá
// só os avisos (convocações, mudanças de situação, mensagens do pregoeiro) para aparecerem no sino da equipe.
// A chave de cada aviso não muda entre leituras, então o mesmo aviso nunca aparece duas vezes.
export const rotasAcompanhamento = new Hono<Ambiente>();
rotasAcompanhamento.use(exigirLogin, exigirModulo("licitacoes"));

const CHAVE = /^acomp:\d{17}:[\w:.|/ -]{1,170}$/;

rotasAcompanhamento.post("/avisos", async (c) => {
  const corpo = await lerJson(c);
  const avisos = (Array.isArray(corpo?.avisos) ? (corpo.avisos as unknown[]) : [])
    .slice(0, 40)
    .map((b) => (b ?? {}) as Record<string, unknown>)
    .map((a) => ({
      chave: String(a.chave ?? ""),
      compra: String(a.compra ?? ""),
      titulo: String(a.titulo ?? "").trim().slice(0, 160),
      mensagem: String(a.mensagem ?? "").slice(0, 300),
      tipo: a.urgente ? "acompanhamento_urgente" : "acompanhamento",
    }))
    .filter((a) => CHAVE.test(a.chave) && /^\d{17}$/.test(a.compra) && a.titulo);
  if (!avisos.length) return c.json({ ok: true, aceitos: 0 });

  // Para toda a equipe que vê Licitações (uma consulta e uma gravação em lote).
  const { results } = await c.env.DB.prepare("SELECT id, papel, permissoes FROM usuarios WHERE ativo = 1").all<{ id: number; papel: string; permissoes: string | null }>();
  const alvos = results.filter((u) => podeVer(resolverPermissoes(u.papel, u.permissoes), "licitacoes"));
  const agora = Date.now();
  const comandos = alvos.flatMap((u) =>
    avisos.map((a) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO notificacoes (usuario_id, tipo, titulo, mensagem, link, chave, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(u.id, a.tipo, a.titulo, a.mensagem || null, `/licitacoes/acompanhamento?compra=${a.compra}`, a.chave, agora),
    ),
  );
  for (let i = 0; i < comandos.length; i += 500) await c.env.DB.batch(comandos.slice(i, i + 500));
  return c.json({ ok: true, aceitos: avisos.length });
});

// Favoritos e apelidos das compras (a equipe toda vê os mesmos).
rotasAcompanhamento.get("/marcas", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT chave, favorito, apelido FROM acompanhamento_marcas").all<{ chave: string; favorito: number; apelido: string | null }>();
  const marcas: Record<string, { favorito: boolean; apelido: string }> = {};
  for (const r of results) marcas[r.chave] = { favorito: !!r.favorito, apelido: r.apelido ?? "" };
  return c.json({ marcas });
});

rotasAcompanhamento.put("/marcas/:chave", async (c) => {
  const chave = c.req.param("chave");
  if (!/^\d{17}$/.test(chave)) return c.json({ erro: "Compra inválida." }, 400);
  const corpo = (await lerJson(c)) ?? {};
  const atual = await c.env.DB.prepare("SELECT favorito, apelido FROM acompanhamento_marcas WHERE chave = ?").bind(chave).first<{ favorito: number; apelido: string | null }>();
  const favorito = "favorito" in corpo ? !!corpo.favorito : !!atual?.favorito;
  const apelido = "apelido" in corpo ? String(corpo.apelido ?? "").trim().slice(0, 80) : (atual?.apelido ?? "");
  const usuario = c.get("usuario");
  if (!favorito && !apelido) {
    await c.env.DB.prepare("DELETE FROM acompanhamento_marcas WHERE chave = ?").bind(chave).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO acompanhamento_marcas (chave, favorito, apelido, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(chave) DO UPDATE SET favorito = excluded.favorito, apelido = excluded.apelido, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em`,
    )
      .bind(chave, favorito ? 1 : 0, apelido || null, usuario?.id ?? null)
      .run();
  }
  return c.json({ ok: true, favorito, apelido });
});
