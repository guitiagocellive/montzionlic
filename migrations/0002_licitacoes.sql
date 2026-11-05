-- =========================================================
-- Seção 1: Licitações (antes de ganhar)
-- =========================================================

CREATE TABLE licitacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  etapa TEXT NOT NULL DEFAULT 'estudar',
  posicao REAL NOT NULL DEFAULT 0,
  uasg TEXT,
  numero TEXT,
  orgao TEXT,
  objeto TEXT,
  modalidade TEXT,
  nicho TEXT,
  data_sessao TEXT,          -- AAAA-MM-DD
  horario TEXT,              -- HH:MM
  portal TEXT,
  registro_preco INTEGER NOT NULL DEFAULT 0,
  fase TEXT,
  valor_estimado REAL,
  link TEXT,
  observacoes TEXT,
  lucro_percentual REAL NOT NULL DEFAULT 20,
  imposto_percentual REAL NOT NULL DEFAULT 0,
  responsavel_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_licitacoes_etapa ON licitacoes(etapa, posicao);
CREATE INDEX idx_licitacoes_sessao ON licitacoes(data_sessao);

-- Itens do edital
CREATE TABLE licitacao_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  licitacao_id INTEGER NOT NULL REFERENCES licitacoes(id) ON DELETE CASCADE,
  numero TEXT,
  descricao TEXT,
  quantidade REAL,
  unidade TEXT,
  valor_referencia REAL,
  participar INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_itens_licitacao ON licitacao_itens(licitacao_id);

-- Fornecedores
CREATE TABLE fornecedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  nicho TEXT,
  vendedor TEXT,
  telefone TEXT,
  email TEXT,
  site TEXT,
  catalogo TEXT,
  cnpj TEXT,
  cidade TEXT,
  uf TEXT,
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fornecedores_nicho ON fornecedores(nicho);

-- Produtos cotados para cada item
CREATE TABLE cotacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  licitacao_id INTEGER NOT NULL REFERENCES licitacoes(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES licitacao_itens(id) ON DELETE CASCADE,
  produto TEXT,
  marca TEXT,
  fornecedor_id INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
  fornecedor_nome TEXT,
  custo_unitario REAL,
  frete REAL,
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cotacoes_licitacao ON cotacoes(licitacao_id);

-- =========================================================
-- Seção 2: Pós-ganho (empenhos e atas)
-- =========================================================

CREATE TABLE execucoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  licitacao_id INTEGER NOT NULL REFERENCES licitacoes(id) ON DELETE CASCADE,
  etapa TEXT NOT NULL DEFAULT 'aguardando_empenho',
  posicao REAL NOT NULL DEFAULT 0,
  numero_empenho TEXT,
  data_empenho TEXT,
  prazo_dias INTEGER,
  prazo_tipo TEXT NOT NULL DEFAULT 'corridos',
  data_limite TEXT,
  registro_preco INTEGER NOT NULL DEFAULT 0,
  fat_razao_social TEXT,
  fat_cnpj TEXT,
  fat_endereco TEXT,
  fat_email TEXT,
  fat_telefone TEXT,
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_execucoes_etapa ON execucoes(etapa, posicao);
CREATE INDEX idx_execucoes_licitacao ON execucoes(licitacao_id);

CREATE TABLE execucao_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execucao_id INTEGER NOT NULL REFERENCES execucoes(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES licitacao_itens(id) ON DELETE SET NULL,
  item_numero TEXT,
  produto TEXT,
  quantidade REAL,
  valor_unitario REAL,
  custo_unitario REAL
);
CREATE INDEX idx_execucao_itens ON execucao_itens(execucao_id);

CREATE TABLE atas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  licitacao_id INTEGER REFERENCES licitacoes(id) ON DELETE SET NULL,
  numero_licitacao TEXT,
  numero_ata TEXT,
  orgao_gerenciador TEXT,
  data_inicio TEXT,
  data_fim TEXT,
  prazo_entrega INTEGER,
  prazo_tipo TEXT NOT NULL DEFAULT 'corridos',
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_atas_fim ON atas(data_fim);

CREATE TABLE ata_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ata_id INTEGER NOT NULL REFERENCES atas(id) ON DELETE CASCADE,
  item_numero TEXT,
  produto TEXT,
  unidade TEXT,
  quantidade REAL,
  valor_unitario REAL
);
CREATE INDEX idx_ata_itens ON ata_itens(ata_id);

-- =========================================================
-- Arquivos (guardados no R2) e análises da IA
-- =========================================================

CREATE TABLE arquivos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  licitacao_id INTEGER REFERENCES licitacoes(id) ON DELETE CASCADE,
  execucao_id INTEGER REFERENCES execucoes(id) ON DELETE CASCADE,
  chave TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  tipo_mime TEXT,
  tamanho INTEGER,
  categoria TEXT,
  enviado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_arquivos_licitacao ON arquivos(licitacao_id);
CREATE INDEX idx_arquivos_execucao ON arquivos(execucao_id);

CREATE TABLE analises_ia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arquivo_id INTEGER NOT NULL REFERENCES arquivos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  resultado TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_analises_arquivo ON analises_ia(arquivo_id);
