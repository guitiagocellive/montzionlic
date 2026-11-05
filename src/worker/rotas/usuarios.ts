import { Hono } from "hono";
import {
  type Ambiente,
  type LinhaUsuario,
  CAMPOS_USUARIO,
  exigirAdmin,
  exigirLogin,
  paraUsuario,
} from "../auth";
import { ACESSO_TOTAL, validarPermissoes } from "../../shared/permissoes";
import { gerarHashSenha } from "../crypto";
import {
  emailValido,
  lerJson,
  normalizarEmail,
  problemaNaSenha,
  texto,
} from "../validacao";

// Gestão do time. Todas as rotas exigem administrador.
export const rotasUsuarios = new Hono<Ambiente>();
rotasUsuarios.use(exigirLogin, exigirAdmin);

const COR = /^#[0-9a-f]{6}$/i;

function papelValido(valor: unknown): valor is "admin" | "membro" {
  return valor === "admin" || valor === "membro";
}

rotasUsuarios.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${CAMPOS_USUARIO} FROM usuarios ORDER BY ativo DESC, nome COLLATE NOCASE`,
  ).all<LinhaUsuario>();
  return c.json({ usuarios: results.map(paraUsuario) });
});

// Cria um membro do time com senha provisória (ele troca no primeiro acesso).
rotasUsuarios.post("/", async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);

  const nome = texto(corpo.nome);
  const email = normalizarEmail(corpo.email);
  const papel = corpo.papel ?? "membro";
  if (!nome) return c.json({ erro: "Informe o nome." }, 400);
  if (!emailValido(email)) return c.json({ erro: "E-mail inválido." }, 400);
  if (!papelValido(papel)) return c.json({ erro: "Perfil inválido." }, 400);
  const erroSenha = problemaNaSenha(corpo.senha);
  if (erroSenha) return c.json({ erro: erroSenha }, 400);

  const existe = await c.env.DB.prepare("SELECT 1 FROM usuarios WHERE email = ?")
    .bind(email)
    .first();
  if (existe) return c.json({ erro: "Já existe um usuário com esse e-mail." }, 409);

  const permissoes = papel === "admin" ? ACESSO_TOTAL : corpo.permissoes === undefined ? ACESSO_TOTAL : validarPermissoes(corpo.permissoes);
  if (!permissoes) return c.json({ erro: "Permissões inválidas." }, 400);
  const cor = typeof corpo.cor === "string" && COR.test(corpo.cor) ? corpo.cor.toLowerCase() : "#8b5cf6";
  const cargo = texto(corpo.cargo).slice(0, 80) || null;

  const hash = await gerarHashSenha(corpo.senha as string);
  const linha = await c.env.DB.prepare(
    `INSERT INTO usuarios (nome, email, senha_hash, papel, trocar_senha, permissoes, cor, cargo)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?) RETURNING ${CAMPOS_USUARIO}`,
  )
    .bind(nome, email, hash, papel, JSON.stringify(permissoes), cor, cargo)
    .first<LinhaUsuario>();

  return c.json({ usuario: paraUsuario(linha!) }, 201);
});

// Edita nome, perfil, status (ativo/inativo) ou redefine a senha de um membro.
rotasUsuarios.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ erro: "Usuário inválido." }, 400);

  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);

  const alvo = await c.env.DB.prepare(`SELECT ${CAMPOS_USUARIO} FROM usuarios WHERE id = ?`)
    .bind(id)
    .first<LinhaUsuario>();
  if (!alvo) return c.json({ erro: "Usuário não encontrado." }, 404);

  const ehVoceMesmo = id === c.get("usuario").id;
  const sets: string[] = [];
  const valores: unknown[] = [];
  let encerrarSessoes = false;

  if (corpo.nome !== undefined) {
    const nome = texto(corpo.nome);
    if (!nome) return c.json({ erro: "Informe o nome." }, 400);
    sets.push("nome = ?");
    valores.push(nome);
  }

  if (corpo.papel !== undefined) {
    if (!papelValido(corpo.papel)) return c.json({ erro: "Perfil inválido." }, 400);
    if (ehVoceMesmo && corpo.papel !== alvo.papel) {
      return c.json({ erro: "Você não pode alterar o seu próprio perfil." }, 400);
    }
    sets.push("papel = ?");
    valores.push(corpo.papel);
  }

  if (corpo.ativo !== undefined) {
    if (typeof corpo.ativo !== "boolean") return c.json({ erro: "Status inválido." }, 400);
    if (ehVoceMesmo && !corpo.ativo) {
      return c.json({ erro: "Você não pode desativar a sua própria conta." }, 400);
    }
    sets.push("ativo = ?");
    valores.push(corpo.ativo ? 1 : 0);
    if (!corpo.ativo) encerrarSessoes = true;
  }

  if (corpo.cargo !== undefined) {
    const cargo = texto(corpo.cargo);
    if (cargo.length > 80) return c.json({ erro: "Cargo longo demais." }, 400);
    sets.push("cargo = ?");
    valores.push(cargo || null);
  }

  if (corpo.cor !== undefined) {
    if (typeof corpo.cor !== "string" || !COR.test(corpo.cor)) return c.json({ erro: "Cor inválida." }, 400);
    sets.push("cor = ?");
    valores.push(corpo.cor.toLowerCase());
  }

  if (corpo.permissoes !== undefined) {
    const permissoes = validarPermissoes(corpo.permissoes);
    if (!permissoes) return c.json({ erro: "Permissões inválidas." }, 400);
    sets.push("permissoes = ?");
    valores.push(JSON.stringify(permissoes));
  }

  if (corpo.novaSenha !== undefined) {
    const erroSenha = problemaNaSenha(corpo.novaSenha);
    if (erroSenha) return c.json({ erro: erroSenha }, 400);
    sets.push("senha_hash = ?", "trocar_senha = ?");
    valores.push(await gerarHashSenha(corpo.novaSenha as string), ehVoceMesmo ? 0 : 1);
    if (!ehVoceMesmo) encerrarSessoes = true;
  }

  if (sets.length === 0) return c.json({ erro: "Nada para alterar." }, 400);

  sets.push("atualizado_em = datetime('now')");
  const comandos = [
    c.env.DB.prepare(`UPDATE usuarios SET ${sets.join(", ")} WHERE id = ?`).bind(...valores, id),
  ];
  if (encerrarSessoes) {
    comandos.push(c.env.DB.prepare("DELETE FROM sessoes WHERE usuario_id = ?").bind(id));
  }
  await c.env.DB.batch(comandos);

  const atualizado = await c.env.DB.prepare(`SELECT ${CAMPOS_USUARIO} FROM usuarios WHERE id = ?`)
    .bind(id)
    .first<LinhaUsuario>();
  return c.json({ usuario: paraUsuario(atualizado!) });
});
