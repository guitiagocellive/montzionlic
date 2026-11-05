-- Certificado digital A1 da empresa (só um ativo). A chave privada fica
-- criptografada com o segredo CHAVE_CERTIFICADO do Worker; a senha não é guardada.
CREATE TABLE certificado_digital (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  titular TEXT NOT NULL,
  documento TEXT,
  emissor TEXT,
  serial TEXT,
  valido_de TEXT NOT NULL,
  valido_ate TEXT NOT NULL,
  chave_cifrada TEXT NOT NULL,
  certificado TEXT NOT NULL,
  cadeia TEXT NOT NULL,
  enviado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Arquivos assinados digitalmente
ALTER TABLE arquivos ADD COLUMN assinado_em INTEGER;
ALTER TABLE arquivos ADD COLUMN assinado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE arquivos ADD COLUMN assinatura_titular TEXT;

-- Logo da empresa e texto de declaração da proposta em PDF
INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES
  ('empresa_logo_chave', '""'),
  ('proposta_declaracao', '"Declaramos que nos preços propostos estão incluídas todas as despesas com tributos, fretes, encargos sociais e demais custos diretos e indiretos necessários ao fornecimento, e que concordamos com todas as condições do edital."');
