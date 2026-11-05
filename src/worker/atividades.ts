// Histórico dos cards: eventos automáticos e comentários.

export type AlvoAtividade = { licitacao_id: number } | { execucao_id: number };

export function comandoEvento(db: D1Database, alvo: AlvoAtividade, usuarioId: number | null, texto: string) {
  const licitacaoId = "licitacao_id" in alvo ? alvo.licitacao_id : null;
  const execucaoId = "execucao_id" in alvo ? alvo.execucao_id : null;
  return db
    .prepare(
      "INSERT INTO atividades (licitacao_id, execucao_id, usuario_id, tipo, texto, criado_em) VALUES (?, ?, ?, 'evento', ?, ?)",
    )
    .bind(licitacaoId, execucaoId, usuarioId, texto.slice(0, 500), Date.now());
}

/** Registra um evento sem atrapalhar a ação principal se der erro. */
export async function registrarEvento(db: D1Database, alvo: AlvoAtividade, usuarioId: number | null, texto: string) {
  try {
    await comandoEvento(db, alvo, usuarioId, texto).run();
  } catch (err) {
    console.error("Falha ao registrar histórico", err);
  }
}
