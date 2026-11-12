-- Acompanhamento: favoritos e apelidos das compras do Compras.gov.br (valem para a equipe toda).
CREATE TABLE acompanhamento_marcas (
  chave TEXT PRIMARY KEY,           -- chave da compra (17 dígitos)
  favorito INTEGER NOT NULL DEFAULT 0,
  apelido TEXT,
  atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
