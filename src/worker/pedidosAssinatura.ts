// Pedidos de assinatura: o servidor assina o resumo do PDF e devolve um pedido de uso único.
// Quando o PDF assinado é enviado com esse pedido, o arquivo ganha o selo "Assinado digitalmente".

const VALIDADE_MS = 15 * 60 * 1000;

export async function criarPedido(db: D1Database, usuarioId: number, titular: string): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO pedidos_assinatura (id, usuario_id, titular, criado_em) VALUES (?, ?, ?, ?)")
    .bind(id, usuarioId, titular, Date.now())
    .run();
  return id;
}

/** Confere o pedido (da mesma pessoa, recente e ainda não usado). Devolve o titular ou null. */
export async function pedidoValido(db: D1Database, id: string, usuarioId: number): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const linha = await db
    .prepare("SELECT titular, criado_em, arquivo_id, avulso_id FROM pedidos_assinatura WHERE id = ? AND usuario_id = ?")
    .bind(id, usuarioId)
    .first<{ titular: string; criado_em: number; arquivo_id: number | null; avulso_id: number | null }>();
  if (!linha || linha.arquivo_id || linha.avulso_id || Date.now() - linha.criado_em > VALIDADE_MS) return null;
  return linha.titular;
}

export function comandoUsarPedido(db: D1Database, id: string, arquivoId: number) {
  return db.prepare("UPDATE pedidos_assinatura SET arquivo_id = ? WHERE id = ?").bind(arquivoId, id);
}

export function comandoUsarPedidoAvulso(db: D1Database, id: string, avulsoId: number) {
  return db.prepare("UPDATE pedidos_assinatura SET avulso_id = ? WHERE id = ?").bind(avulsoId, id);
}
