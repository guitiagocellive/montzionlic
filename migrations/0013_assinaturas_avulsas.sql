-- Documentos assinados fora das licitações (página "Assinar documentos").
CREATE TABLE assinaturas_avulsas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chave TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  tamanho INTEGER,
  titular TEXT NOT NULL,
  assinado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  assinado_em INTEGER NOT NULL
);
CREATE INDEX idx_assinaturas_avulsas_data ON assinaturas_avulsas(assinado_em);

-- O pedido de assinatura também pode ser usado por um documento avulso.
ALTER TABLE pedidos_assinatura ADD COLUMN avulso_id INTEGER REFERENCES assinaturas_avulsas(id) ON DELETE SET NULL;
