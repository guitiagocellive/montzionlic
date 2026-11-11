-- Robô de lances: configuração por licitação (segundos finais, "não aguardar", valor mínimo por item...).
CREATE TABLE robo_config (
  licitacao_id INTEGER PRIMARY KEY REFERENCES licitacoes(id) ON DELETE CASCADE,
  dados TEXT NOT NULL,
  atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em INTEGER NOT NULL
);
