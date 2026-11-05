-- =========================================================
-- Perfil, permissões, configurações, convites e notificações
-- =========================================================

-- Perfil e acesso de cada pessoa do time
ALTER TABLE usuarios ADD COLUMN cargo TEXT;
ALTER TABLE usuarios ADD COLUMN cor TEXT NOT NULL DEFAULT '#8b5cf6';
ALTER TABLE usuarios ADD COLUMN tema TEXT NOT NULL DEFAULT 'escuro';
ALTER TABLE usuarios ADD COLUMN foto_chave TEXT;
-- JSON: { "licitacoes": "editar", "orcamento": "ver", ... }. Vazio = acesso total (compatível com contas antigas).
ALTER TABLE usuarios ADD COLUMN permissoes TEXT;

-- Configurações gerais da empresa (chave → valor em JSON)
CREATE TABLE configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO configuracoes (chave, valor) VALUES
  ('empresa_nome', '""'),
  ('empresa_cnpj', '""'),
  ('margem_padrao', '20'),
  ('imposto_padrao', '0'),
  ('alerta_sessao_dias', '3'),
  ('alerta_entrega_dias', '3'),
  ('alerta_ata_dias', '30');

-- Convites por link para entrar no time
CREATE TABLE convites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT COLLATE NOCASE,
  papel TEXT NOT NULL DEFAULT 'membro' CHECK (papel IN ('admin', 'membro')),
  permissoes TEXT,
  cor TEXT,
  cargo TEXT,
  criado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  expira_em INTEGER NOT NULL,
  usado_em INTEGER,
  usado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notificações (sino). "chave" evita avisar a mesma coisa duas vezes.
CREATE TABLE notificacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensagem TEXT,
  link TEXT,
  chave TEXT NOT NULL,
  lida_em INTEGER,
  criado_em INTEGER NOT NULL,
  UNIQUE (usuario_id, chave)
);
CREATE INDEX idx_notificacoes_usuario ON notificacoes(usuario_id, lida_em, criado_em);
