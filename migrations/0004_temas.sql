-- Tema preferido de cada pessoa para o modo claro e para o modo escuro.
-- A coluna "tema" continua guardando o modo: claro, escuro ou sistema.
ALTER TABLE usuarios ADD COLUMN tema_claro TEXT NOT NULL DEFAULT 'ceu';
ALTER TABLE usuarios ADD COLUMN tema_escuro TEXT NOT NULL DEFAULT 'oceano';
