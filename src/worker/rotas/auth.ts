import { Hono } from "hono";
import {
  type Ambiente,
  type LinhaUsuario,
  CAMPOS_USUARIO,
  encerrarSessao,
  exigirLogin,
  iniciarSessao,
  paraUsuario,
} from "../auth";
import { HASH_FALSO, gerarHashSenha, verificarSenha } from "../crypto";
import {
  emailValido,
  lerJson,
  normalizarEmail,
  problemaNaSenha,
  texto,
} from "../validacao";

const MINUTO = 60 * 1000;
const MAX_TENTATIVAS = 5;
const JANELA_TENTATIVAS = 15 * MINUTO;

export const rotasAuth = new Hono<Ambiente>();

// Diz se o sistema ainda não tem nenhum usuário (primeiro acesso).
rotasAuth.get("/setup", async (c) => {
  const linha = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM usuarios").first<{
    total: number;
  }>();
  return c.json({ precisaConfigurar: (linha?.total ?? 0) === 0 });
});

// Cria o primeiro administrador. Só funciona enquanto não existir nenhum usuário.
rotasAuth.post("/setup", async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);

  const nome = texto(corpo.nome);
  const email = normalizarEmail(corpo.email);
  if (!nome) return c.json({ erro: "Informe seu nome." }, 400);
  if (!emailValido(email)) return c.json({ erro: "E-mail inválido." }, 400);
  const erroSenha = problemaNaSenha(corpo.senha);
  if (erroSenha) return c.json({ erro: erroSenha }, 400);

  const hash = await gerarHashSenha(corpo.senha as string);
  const resultado = await c.env.DB.prepare(
    `INSERT INTO usuarios (nome, email, senha_hash, papel)
     SELECT ?, ?, ?, 'admin'
     WHERE NOT EXISTS (SELECT 1 FROM usuarios)`,
  )
    .bind(nome, email, hash)
    .run();

  if (resultado.meta.changes !== 1) {
    return c.json({ erro: "O sistema já foi configurado." }, 409);
  }

  await iniciarSessao(c, resultado.meta.last_row_id);
  return c.json({ ok: true });
});

rotasAuth.post("/login", async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);

  const email = normalizarEmail(corpo.email);
  const senha = typeof corpo.senha === "string" ? corpo.senha : "";
  if (!email || !senha) return c.json({ erro: "Informe e-mail e senha." }, 400);

  const agora = Date.now();
  const tentativas = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM tentativas_login WHERE email = ? AND criado_em > ?",
  )
    .bind(email, agora - JANELA_TENTATIVAS)
    .first<{ total: number }>();
  if ((tentativas?.total ?? 0) >= MAX_TENTATIVAS) {
    return c.json(
      { erro: "Muitas tentativas com senha errada. Aguarde 15 minutos e tente de novo." },
      429,
    );
  }

  const usuario = await c.env.DB.prepare(
    `SELECT ${CAMPOS_USUARIO}, senha_hash FROM usuarios WHERE email = ?`,
  )
    .bind(email)
    .first<LinhaUsuario & { senha_hash: string }>();

  // Sempre calcula o hash, mesmo sem usuário, para não revelar e-mails cadastrados.
  const senhaCorreta = await verificarSenha(senha, usuario?.senha_hash ?? HASH_FALSO);

  if (!usuario || !senhaCorreta || usuario.ativo !== 1) {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO tentativas_login (email, criado_em) VALUES (?, ?)").bind(
        email,
        agora,
      ),
      c.env.DB.prepare("DELETE FROM tentativas_login WHERE criado_em < ?").bind(
        agora - 24 * 60 * MINUTO,
      ),
    ]);
    return c.json({ erro: "E-mail ou senha incorretos." }, 401);
  }

  await c.env.DB.prepare("DELETE FROM tentativas_login WHERE email = ?").bind(email).run();
  await iniciarSessao(c, usuario.id);
  return c.json({ usuario: paraUsuario(usuario) });
});

rotasAuth.post("/logout", async (c) => {
  await encerrarSessao(c);
  return c.json({ ok: true });
});

rotasAuth.get("/eu", exigirLogin, (c) => c.json({ usuario: c.get("usuario") }));

// Troca a própria senha. Encerra as outras sessões do usuário.
rotasAuth.post("/senha", exigirLogin, async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);

  const usuario = c.get("usuario");
  const senhaAtual = typeof corpo.senhaAtual === "string" ? corpo.senhaAtual : "";
  const erroSenha = problemaNaSenha(corpo.novaSenha);
  if (erroSenha) return c.json({ erro: erroSenha }, 400);

  const linha = await c.env.DB.prepare("SELECT senha_hash FROM usuarios WHERE id = ?")
    .bind(usuario.id)
    .first<{ senha_hash: string }>();
  if (!linha || !(await verificarSenha(senhaAtual, linha.senha_hash))) {
    return c.json({ erro: "A senha atual está incorreta." }, 400);
  }
  if (senhaAtual === corpo.novaSenha) {
    return c.json({ erro: "A nova senha precisa ser diferente da atual." }, 400);
  }

  const hash = await gerarHashSenha(corpo.novaSenha as string);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE usuarios SET senha_hash = ?, trocar_senha = 0, atualizado_em = datetime('now') WHERE id = ?",
    ).bind(hash, usuario.id),
    c.env.DB.prepare("DELETE FROM sessoes WHERE usuario_id = ? AND id <> ?").bind(
      usuario.id,
      c.get("sessaoId"),
    ),
  ]);
  return c.json({ ok: true });
});
