-- Licitação importada do PNCP (número de controle, ex.: 00070532000103-1-000047/2026).
ALTER TABLE licitacoes ADD COLUMN pncp_id TEXT;
CREATE INDEX idx_licitacoes_pncp ON licitacoes(pncp_id);
