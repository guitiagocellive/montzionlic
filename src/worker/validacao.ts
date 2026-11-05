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

// ---------------------------------------------------------
// Leitura genérica de campos para inserir/atualizar tabelas
// ---------------------------------------------------------

export type TipoCampo =
  | "texto"
  | "textoLongo"
  | "numero"
  | "inteiro"
  | "data"
  | "hora"
  | "bool"
  | "id"
  | readonly string[];

export type Esquema = Record<string, TipoCampo>;

export type Campos = { colunas: string[]; valores: unknown[] };

/**
 * Lê do corpo só os campos do esquema (os outros são ignorados).
 * Campo ausente é ignorado; vazio ("" ou null) vira NULL.
 */
export function lerCampos(
  corpo: Record<string, unknown>,
  esquema: Esquema,
): Campos | { erro: string } {
  const colunas: string[] = [];
  const valores: unknown[] = [];

  for (const [campo, tipo] of Object.entries(esquema)) {
    if (!(campo in corpo)) continue;
    const bruto = corpo[campo];
    const vazio = bruto === null || bruto === "";
    let valor: unknown = null;

    if (tipo === "bool") {
      valor = bruto === true || bruto === 1 || bruto === "true" ? 1 : 0;
    } else if (vazio) {
      valor = null;
    } else if (Array.isArray(tipo)) {
      if (!tipo.includes(bruto as string)) return { erro: `Valor inválido em "${campo}".` };
      valor = bruto;
    } else if (tipo === "texto" || tipo === "textoLongo") {
      if (typeof bruto !== "string" && typeof bruto !== "number") {
        return { erro: `Valor inválido em "${campo}".` };
      }
      const t = String(bruto).trim();
      const limite = tipo === "texto" ? 500 : 20_000;
      if (t.length > limite) return { erro: `O campo "${campo}" é longo demais.` };
      valor = t || null;
    } else if (tipo === "numero" || tipo === "inteiro" || tipo === "id") {
      const n = typeof bruto === "number" ? bruto : Number(String(bruto).replace(",", "."));
      if (!Number.isFinite(n)) return { erro: `Número inválido em "${campo}".` };
      if ((tipo === "inteiro" || tipo === "id") && !Number.isInteger(n)) {
        return { erro: `Número inteiro esperado em "${campo}".` };
      }
      if (tipo === "id" && n <= 0) return { erro: `Valor inválido em "${campo}".` };
      valor = n;
    } else if (tipo === "data") {
      if (typeof bruto !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(bruto)) {
        return { erro: `Data inválida em "${campo}".` };
      }
      valor = bruto;
    } else if (tipo === "hora") {
      if (typeof bruto !== "string" || !/^\d{2}:\d{2}$/.test(bruto)) {
        return { erro: `Horário inválido em "${campo}".` };
      }
      valor = bruto;
    }

    colunas.push(campo);
    valores.push(valor);
  }
  return { colunas, valores };
}

export function temErro(c: Campos | { erro: string }): c is { erro: string } {
  return "erro" in c;
}

/** Converte o parâmetro de rota em id numérico (ou null se inválido). */
export function idDaRota(valor: string | undefined): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}
