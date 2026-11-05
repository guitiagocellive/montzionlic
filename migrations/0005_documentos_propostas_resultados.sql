-- =========================================================
-- Documentação da empresa (cofre de certidões)
-- =========================================================
CREATE TABLE documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'Outro',
  emissao TEXT,
  validade TEXT,
  observacoes TEXT,
  arquivo_chave TEXT,
  arquivo_nome TEXT,
  arquivo_tipo TEXT,
  arquivo_tamanho INTEGER,
  atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_documentos_validade ON documentos(validade);

-- =========================================================
-- Proposta comercial: contas bancárias e modelos (.docx)
-- =========================================================
CREATE TABLE contas_bancarias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apelido TEXT NOT NULL,
  banco TEXT NOT NULL,
  codigo_banco TEXT,
  agencia TEXT,
  conta TEXT,
  tipo TEXT,
  pix TEXT,
  titular TEXT,
  padrao INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE modelos_proposta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  chave TEXT NOT NULL UNIQUE,
  arquivo_nome TEXT NOT NULL,
  tamanho INTEGER,
  padrao INTEGER NOT NULL DEFAULT 0,
  enviado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================
-- Comentários e histórico dos cards
-- =========================================================
CREATE TABLE atividades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  licitacao_id INTEGER REFERENCES licitacoes(id) ON DELETE CASCADE,
  execucao_id INTEGER REFERENCES execucoes(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,            -- comentario | evento
  texto TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);
CREATE INDEX idx_atividades_licitacao ON atividades(licitacao_id, criado_em);
CREATE INDEX idx_atividades_execucao ON atividades(execucao_id, criado_em);

-- =========================================================
-- Resultado da disputa (por licitação e por item)
-- =========================================================
ALTER TABLE licitacoes ADD COLUMN data_resultado TEXT;
ALTER TABLE licitacoes ADD COLUMN motivo_perda TEXT;
ALTER TABLE licitacoes ADD COLUMN observacao_resultado TEXT;

ALTER TABLE licitacao_itens ADD COLUMN resultado TEXT;        -- ganho | perdido | cancelado
ALTER TABLE licitacao_itens ADD COLUMN colocacao INTEGER;
ALTER TABLE licitacao_itens ADD COLUMN nosso_lance REAL;
ALTER TABLE licitacao_itens ADD COLUMN vencedor TEXT;
ALTER TABLE licitacao_itens ADD COLUMN valor_vencedor REAL;
ALTER TABLE licitacao_itens ADD COLUMN motivo_perda TEXT;

-- =========================================================
-- Saldo das atas: empenho ligado à ata e ao item da ata
-- =========================================================
ALTER TABLE execucoes ADD COLUMN ata_id INTEGER REFERENCES atas(id) ON DELETE SET NULL;
ALTER TABLE execucao_itens ADD COLUMN ata_item_id INTEGER REFERENCES ata_itens(id) ON DELETE SET NULL;
CREATE INDEX idx_execucao_itens_ata ON execucao_itens(ata_item_id);

-- =========================================================
-- Novas configurações
-- =========================================================
INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES
  ('empresa_endereco', '""'),
  ('empresa_cidade', '""'),
  ('empresa_telefone', '""'),
  ('empresa_email', '""'),
  ('empresa_ie', '""'),
  ('representante_nome', '""'),
  ('representante_cpf', '""'),
  ('representante_cargo', '""'),
  ('validade_proposta_padrao', '60'),
  ('alerta_documento_dias', '15');
