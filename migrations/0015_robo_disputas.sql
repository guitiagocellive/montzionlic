-- Robô de lances central (página Disputas): configuração por item da sala de disputa do Compras.gov.br
-- e registro dos lances que ele enviou. A configuração por licitação (0014) deixou de ser usada.
DROP TABLE IF EXISTS robo_config;

CREATE TABLE robo_itens (
  chave TEXT PRIMARY KEY, -- "<chaveCompra>:<numero do item>"
  compra TEXT NOT NULL,
  dados TEXT NOT NULL,
  atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em INTEGER NOT NULL
);
CREATE INDEX idx_robo_itens_compra ON robo_itens(compra);

CREATE TABLE robo_lances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compra TEXT NOT NULL,
  item INTEGER NOT NULL,
  valor REAL NOT NULL,
  ok INTEGER NOT NULL,
  mensagem TEXT,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em INTEGER NOT NULL
);
CREATE INDEX idx_robo_lances_compra ON robo_lances(compra, criado_em);
