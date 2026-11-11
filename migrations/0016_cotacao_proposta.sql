-- Produto cotado vira a fonte da proposta: descritivo próprio e qual cotação vai para a proposta.
ALTER TABLE cotacoes ADD COLUMN descricao TEXT;           -- descritivo do produto (vai na proposta)
ALTER TABLE cotacoes ADD COLUMN escolhida INTEGER NOT NULL DEFAULT 0; -- 1 = usar na proposta
