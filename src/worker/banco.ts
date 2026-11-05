import type { Campos } from "./validacao";

// Ajudantes para montar INSERT/UPDATE a partir de campos já validados.
// Os nomes de tabela e coluna vêm sempre do código (esquemas), nunca do usuário.

export async function inserir<T = Record<string, unknown>>(
  db: D1Database,
  tabela: string,
  campos: Campos,
): Promise<T> {
  const { colunas, valores } = campos;
  const sql =
    colunas.length === 0
      ? `INSERT INTO ${tabela} DEFAULT VALUES RETURNING *`
      : `INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES (${colunas
          .map(() => "?")
          .join(", ")}) RETURNING *`;
  return (await db
    .prepare(sql)
    .bind(...valores)
    .first<T>())!;
}

export function comandoAtualizar(
  db: D1Database,
  tabela: string,
  id: number,
  campos: Campos,
  marcarAtualizacao = true,
): D1PreparedStatement | null {
  const sets = campos.colunas.map((c) => `${c} = ?`);
  if (sets.length === 0) return null;
  if (marcarAtualizacao) sets.push("atualizado_em = datetime('now')");
  return db
    .prepare(`UPDATE ${tabela} SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...campos.valores, id);
}

export async function buscar<T = Record<string, unknown>>(
  db: D1Database,
  tabela: string,
  id: number,
): Promise<T | null> {
  return db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).bind(id).first<T>();
}

/** Junta campos extras (calculados no servidor) aos campos lidos do corpo. */
export function comExtras(campos: Campos, extras: Record<string, unknown>): Campos {
  const colunas = [...campos.colunas];
  const valores = [...campos.valores];
  for (const [coluna, valor] of Object.entries(extras)) {
    const i = colunas.indexOf(coluna);
    if (i >= 0) valores[i] = valor;
    else {
      colunas.push(coluna);
      valores.push(valor);
    }
  }
  return { colunas, valores };
}
