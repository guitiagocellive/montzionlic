-- Modelo visual e cor padrão da proposta em PDF de cada empresa.
ALTER TABLE empresas ADD COLUMN modelo_pdf TEXT NOT NULL DEFAULT 'classico';
ALTER TABLE empresas ADD COLUMN cor_pdf TEXT NOT NULL DEFAULT '#1f3b8a';
