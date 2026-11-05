import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Usuario } from "../shared/tipos";
import { gerarToken, sha256 } from "./crypto";

export type Ambiente = {
  Bindings: Env;
  Variables: { usuario: Usuario; sessaoId: string };
};

const COOKIE = "sessao";
const DIA = 24 * 60 * 60 * 1000;
const DURACAO_SESSAO = 30 * DIA;
const RENOVAR_QUANDO_FALTAR = 15 * DIA;

export interface LinhaUsuario {
  id: number;
  nome: string;
  email: string;
  papel: "admin" | "membro";
  ativo: number;
  trocar_senha: number;
  criado_em: string;
}

export const CAMPOS_USUARIO = "id, nome, email, papel, ativo, trocar_senha, criado_em";

export function paraUsuario(l: LinhaUsuario): Usuario {
  return {
    id: l.id,
    nome: l.nome,
    email: l.email,
    papel: l.papel,
    ativo: l.ativo === 1,
    trocarSenha: l.trocar_senha === 1,
    criadoEm: l.criado_em,
  };
}

function gravarCookie(c: Context, token: string, expira: number) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    expires: new Date(expira),
  });
}

/** Cria uma sessão nova para o usuário e grava o cookie. */
export async function iniciarSessao(c: Context<Ambiente>, usuarioId: number) {
  const token = gerarToken();
  const agora = Date.now();
  const expira = agora + DURACAO_SESSAO;
  await c.env.DB.prepare(
    "INSERT INTO sessoes (id, usuario_id, expira_em, criado_em) VALUES (?, ?, ?, ?)",
  )
    .bind(await sha256(token), usuarioId, expira, agora)
    .run();
  gravarCookie(c, token, expira);
}

export async function encerrarSessao(c: Context<Ambiente>) {
  const token = getCookie(c, COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessoes WHERE id = ?").bind(await sha256(token)).run();
  }
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Exige um usuário logado e ativo. */
export const exigirLogin: MiddlewareHandler<Ambiente> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ erro: "Não autenticado." }, 401);

  const sessaoId = await sha256(token);
  const linha = await c.env.DB.prepare(
    `SELECT s.expira_em, u.id, u.nome, u.email, u.papel, u.ativo, u.trocar_senha, u.criado_em
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.id = ?`,
  )
    .bind(sessaoId)
    .first<LinhaUsuario & { expira_em: number }>();

  const agora = Date.now();
  if (!linha || linha.expira_em < agora || linha.ativo !== 1) {
    if (linha) await c.env.DB.prepare("DELETE FROM sessoes WHERE id = ?").bind(sessaoId).run();
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ erro: "Sessão expirada. Entre novamente." }, 401);
  }

  // Renova a sessão de quem usa o sistema com frequência.
  if (linha.expira_em - agora < RENOVAR_QUANDO_FALTAR) {
    const novaExpiracao = agora + DURACAO_SESSAO;
    await c.env.DB.prepare("UPDATE sessoes SET expira_em = ? WHERE id = ?")
      .bind(novaExpiracao, sessaoId)
      .run();
    gravarCookie(c, token, novaExpiracao);
  }

  c.set("usuario", paraUsuario(linha));
  c.set("sessaoId", sessaoId);
  await next();
};

/** Exige que o usuário logado seja administrador. Use depois de `exigirLogin`. */
export const exigirAdmin: MiddlewareHandler<Ambiente> = async (c, next) => {
  if (c.get("usuario").papel !== "admin") {
    return c.json({ erro: "Apenas administradores podem fazer isso." }, 403);
  }
  await next();
};
