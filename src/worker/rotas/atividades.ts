import { Hono } from "hono";
import { podeVer } from "../../shared/permissoes";
import { type Ambiente, exigirLogin } from "../auth";
import { notificar } from "../notificacoes";
import { idDaRota, lerJson } from "../validacao";

// Comentários e histórico de licitações e empenhos.
export const rotasAtividades = new Hono<Ambiente>();
rotasAtividades.use(exigirLogin);

function alvoDaConsulta(licitacao: unknown, execucao: unknown) {
  const l = idDaRota(String(licitacao ?? ""));
  const e = idDaRota(String(execucao ?? ""));
  if (l) return { coluna: "licitacao_id", id: l, modulo: "licitacoes" as const, link: `/licitacoes/${l}?aba=atividade` };
  if (e) return { coluna: "execucao_id", id: e, modulo: "posganho" as const, link: `/pos-ganho/${e}?aba=atividade` };
  return null;
}

rotasAtividades.get("/", async (c) => {
  const alvo = alvoDaConsulta(c.req.query("licitacao_id"), c.req.query("execucao_id"));
  if (!alvo) return c.json({ erro: "Informe a licitação ou o empenho." }, 400);
  if (!podeVer(c.get("usuario").permissoes, alvo.modulo)) return c.json({ erro: "Sem acesso." }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.tipo, a.texto, a.criado_em, a.usuario_id, u.nome AS usuario_nome, u.cor AS usuario_cor,
            CASE WHEN u.foto_chave IS NOT NULL THEN '/api/fotos/' || u.id || '?v=' || substr(u.foto_chave, -8) END AS usuario_foto
       FROM atividades a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.${alvo.coluna} = ?
      ORDER BY a.criado_em DESC, a.id DESC LIMIT 200`,
  )
    .bind(alvo.id)
    .all();
  return c.json({ atividades: results });
});

// Novo comentário. "mencoes" = ids das pessoas citadas com @ (recebem notificação).
rotasAtividades.post("/", async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const alvo = alvoDaConsulta(corpo.licitacao_id, corpo.execucao_id);
  if (!alvo) return c.json({ erro: "Informe a licitação ou o empenho." }, 400);
  const usuario = c.get("usuario");
  if (!podeVer(usuario.permissoes, alvo.modulo)) return c.json({ erro: "Sem acesso." }, 403);

  const texto = typeof corpo.texto === "string" ? corpo.texto.trim() : "";
  if (!texto) return c.json({ erro: "Escreva o comentário." }, 400);
  if (texto.length > 4000) return c.json({ erro: "Comentário longo demais." }, 400);

  const tabela = alvo.coluna === "licitacao_id" ? "licitacoes" : "execucoes";
  const existe = await c.env.DB.prepare(`SELECT 1 FROM ${tabela} WHERE id = ?`).bind(alvo.id).first();
  if (!existe) return c.json({ erro: "Card não encontrado." }, 404);

  const atividade = await c.env.DB.prepare(
    `INSERT INTO atividades (${alvo.coluna}, usuario_id, tipo, texto, criado_em) VALUES (?, ?, 'comentario', ?, ?) RETURNING id`,
  )
    .bind(alvo.id, usuario.id, texto, Date.now())
    .first<{ id: number }>();

  const mencoes = Array.isArray(corpo.mencoes)
    ? [...new Set(corpo.mencoes.filter((x): x is number => Number.isInteger(x) && x !== usuario.id))].slice(0, 20)
    : [];
  if (mencoes.length > 0) {
    await notificar(
      c.env.DB,
      { usuarioIds: mencoes, modulo: alvo.modulo },
      {
        tipo: "mencao",
        titulo: `${usuario.nome} mencionou você`,
        mensagem: texto.length > 140 ? `${texto.slice(0, 140)}…` : texto,
        link: alvo.link,
        chave: `mencao:${atividade!.id}`,
      },
    );
  }
  return c.json({ id: atividade!.id }, 201);
});

// Apaga um comentário (o autor ou um administrador).
rotasAtividades.delete("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Comentário inválido." }, 400);
  const usuario = c.get("usuario");
  const linha = await c.env.DB.prepare("SELECT usuario_id, tipo FROM atividades WHERE id = ?")
    .bind(id)
    .first<{ usuario_id: number | null; tipo: string }>();
  if (!linha || linha.tipo !== "comentario") return c.json({ erro: "Comentário não encontrado." }, 404);
  if (linha.usuario_id !== usuario.id && usuario.papel !== "admin") {
    return c.json({ erro: "Você só pode apagar os seus comentários." }, 403);
  }
  await c.env.DB.prepare("DELETE FROM atividades WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
