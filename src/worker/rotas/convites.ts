import { Hono } from "hono";
import { ACESSO_TOTAL, resolverPermissoes, validarPermissoes } from "../../shared/permissoes";
import { type Ambiente, exigirAdmin, exigirLogin, iniciarSessao } from "../auth";
import { lerConfiguracoes } from "../configuracoes";
import { gerarHashSenha, gerarToken, sha256 } from "../crypto";
import { notificar } from "../notificacoes";
import { emailValido, idDaRota, lerJson, normalizarEmail, problemaNaSenha, texto } from "../validacao";

const DIA = 86_400_000;
const COR = /^#[0-9a-f]{6}$/i;

interface LinhaConvite {
  id: number;
  email: string | null;
  papel: "admin" | "membro";
  permissoes: string | null;
  cor: string | null;
  cargo: string | null;
  expira_em: number;
  usado_em: number | null;
}

// ---------- Administração (só admin) ----------
export const rotasConvites = new Hono<Ambiente>();
rotasConvites.use(exigirLogin, exigirAdmin);

rotasConvites.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cv.id, cv.email, cv.papel, cv.cargo, cv.cor, cv.permissoes, cv.expira_em, cv.usado_em,
            cv.criado_em, u.nome AS usado_por_nome
       FROM convites cv LEFT JOIN usuarios u ON u.id = cv.usado_por
      ORDER BY cv.id DESC LIMIT 50`,
  ).all<LinhaConvite & { criado_em: string; usado_por_nome: string | null }>();
  return c.json({
    convites: results.map((cv) => ({ ...cv, permissoes: resolverPermissoes(cv.papel, cv.permissoes) })),
  });
});

// Cria um link de convite. O link completo só aparece nesta resposta.
rotasConvites.post("/", async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);

  const papel = corpo.papel ?? "membro";
  if (papel !== "admin" && papel !== "membro") return c.json({ erro: "Perfil inválido." }, 400);
  const permissoes = papel === "admin" ? ACESSO_TOTAL : validarPermissoes(corpo.permissoes);
  if (!permissoes) return c.json({ erro: "Permissões inválidas." }, 400);

  const email = corpo.email ? normalizarEmail(corpo.email) : null;
  if (email && !emailValido(email)) return c.json({ erro: "E-mail inválido." }, 400);
  const cor = typeof corpo.cor === "string" && COR.test(corpo.cor) ? corpo.cor.toLowerCase() : null;
  const cargo = texto(corpo.cargo).slice(0, 80) || null;
  const dias = Number(corpo.validade_dias ?? 7);
  if (!Number.isInteger(dias) || dias < 1 || dias > 30) return c.json({ erro: "Validade entre 1 e 30 dias." }, 400);

  if (email) {
    const existe = await c.env.DB.prepare("SELECT 1 FROM usuarios WHERE email = ?").bind(email).first();
    if (existe) return c.json({ erro: "Já existe uma conta com esse e-mail." }, 409);
  }

  const token = gerarToken();
  const convite = await c.env.DB.prepare(
    `INSERT INTO convites (token_hash, email, papel, permissoes, cor, cargo, criado_por, expira_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, expira_em`,
  )
    .bind(await sha256(token), email, papel, JSON.stringify(permissoes), cor, cargo, c.get("usuario").id, Date.now() + dias * DIA)
    .first<{ id: number; expira_em: number }>();

  const link = `${new URL(c.req.url).origin}/convite/${token}`;
  return c.json({ convite, link }, 201);
});

rotasConvites.delete("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Convite inválido." }, 400);
  await c.env.DB.prepare("DELETE FROM convites WHERE id = ? AND usado_em IS NULL").bind(id).run();
  return c.json({ ok: true });
});

// ---------- Público (quem recebeu o link) ----------
export const rotasConvitePublico = new Hono<Ambiente>();

async function buscarConvite(db: D1Database, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const cv = await db
    .prepare("SELECT id, email, papel, permissoes, cor, cargo, expira_em, usado_em FROM convites WHERE token_hash = ?")
    .bind(await sha256(token))
    .first<LinhaConvite>();
  if (!cv || cv.usado_em || cv.expira_em < Date.now()) return null;
  return cv;
}

rotasConvitePublico.get("/:token", async (c) => {
  const cv = await buscarConvite(c.env.DB, c.req.param("token"));
  if (!cv) return c.json({ erro: "Este convite é inválido, expirou ou já foi usado." }, 404);
  const config = await lerConfiguracoes(c.env.DB);
  return c.json({ email: cv.email, empresa: config.empresa_nome || null, cargo: cv.cargo });
});

rotasConvitePublico.post("/:token", async (c) => {
  const cv = await buscarConvite(c.env.DB, c.req.param("token"));
  if (!cv) return c.json({ erro: "Este convite é inválido, expirou ou já foi usado." }, 404);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);

  const nome = texto(corpo.nome);
  const email = cv.email ?? normalizarEmail(corpo.email);
  if (!nome) return c.json({ erro: "Informe seu nome." }, 400);
  if (!emailValido(email)) return c.json({ erro: "E-mail inválido." }, 400);
  const erroSenha = problemaNaSenha(corpo.senha);
  if (erroSenha) return c.json({ erro: erroSenha }, 400);

  const existe = await c.env.DB.prepare("SELECT 1 FROM usuarios WHERE email = ?").bind(email).first();
  if (existe) return c.json({ erro: "Já existe uma conta com esse e-mail. Entre pela tela de login." }, 409);

  const hash = await gerarHashSenha(corpo.senha as string);
  // Marca o convite como usado primeiro (só um cadastro por link, mesmo com cliques duplos).
  const marcado = await c.env.DB.prepare(
    "UPDATE convites SET usado_em = ? WHERE id = ? AND usado_em IS NULL AND expira_em > ?",
  )
    .bind(Date.now(), cv.id, Date.now())
    .run();
  if (marcado.meta.changes !== 1) return c.json({ erro: "Este convite já foi usado." }, 409);

  const novo = await c.env.DB.prepare(
    `INSERT INTO usuarios (nome, email, senha_hash, papel, permissoes, cor, cargo)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, '#8b5cf6'), ?) RETURNING id`,
  )
    .bind(nome, email, hash, cv.papel, cv.permissoes, cv.cor, cv.cargo)
    .first<{ id: number }>();
  await c.env.DB.prepare("UPDATE convites SET usado_por = ? WHERE id = ?").bind(novo!.id, cv.id).run();

  await notificar(
    c.env.DB,
    { soAdmins: true, exceto: novo!.id },
    {
      tipo: "equipe",
      titulo: `${nome} entrou no time`,
      mensagem: `Cadastro feito pelo link de convite (${email}).`,
      link: "/configuracoes/equipe",
      chave: `entrou:${novo!.id}`,
    },
  ).catch(() => {});

  await iniciarSessao(c, novo!.id);
  return c.json({ ok: true }, 201);
});
