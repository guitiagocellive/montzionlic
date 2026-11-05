-- Cada documento de habilitação pertence a uma empresa (agora podem ser várias).
ALTER TABLE documentos ADD COLUMN empresa_id INTEGER REFERENCES empresas(id) ON DELETE SET NULL;
UPDATE documentos SET empresa_id = (SELECT id FROM empresas ORDER BY padrao DESC, id LIMIT 1);
