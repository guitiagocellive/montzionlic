-- Usuários do time
CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'membro' CHECK (papel IN ('admin', 'membro')),
  ativo INTEGER NOT NULL DEFAULT 1,
  trocar_senha INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessões de login (guardamos só o hash do token, nunca o token)
CREATE TABLE sessoes (
  id TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em INTEGER NOT NULL,
  criado_em INTEGER NOT NULL
);
CREATE INDEX idx_sessoes_usuario ON sessoes(usuario_id);

-- Tentativas de login com falha (proteção contra força bruta)
CREATE TABLE tentativas_login (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  criado_em INTEGER NOT NULL
);
CREATE INDEX idx_tentativas_email ON tentativas_login(email, criado_em);
