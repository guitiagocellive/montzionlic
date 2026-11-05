import type { Context } from "hono";
import { SENHA_MINIMA } from "../shared/tipos";

/** Lê o corpo JSON da requisição. Devolve null se não for JSON válido. */
export async function lerJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const corpo = await c.req.json();
    return corpo && typeof corpo === "object" && !Array.isArray(corpo) ? corpo : null;
  } catch {
    return null;
  }
}

export function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export function normalizarEmail(valor: unknown): string {
  return texto(valor).toLowerCase();
}

export function emailValido(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Devolve uma mensagem de erro se a senha for fraca, ou null se estiver ok. */
export function problemaNaSenha(senha: unknown): string | null {
  if (typeof senha !== "string" || senha.length < SENHA_MINIMA) {
    return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  }
  if (senha.length > 200) return "A senha é longa demais.";
  return null;
}
