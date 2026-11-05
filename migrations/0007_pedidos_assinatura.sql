-- Cada assinatura feita pelo servidor gera um pedido de uso único. O PDF assinado
-- montado no navegador só ganha o selo "Assinado digitalmente" se trouxer um pedido válido.
CREATE TABLE pedidos_assinatura (
  id TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titular TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  arquivo_id INTEGER REFERENCES arquivos(id) ON DELETE SET NULL
);
