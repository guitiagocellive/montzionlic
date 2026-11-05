-- Financeiro do empenho: nota fiscal, frete/despesas e pagamento.
ALTER TABLE execucoes ADD COLUMN nota_fiscal TEXT;
ALTER TABLE execucoes ADD COLUMN data_nota TEXT;
ALTER TABLE execucoes ADD COLUMN frete REAL;
ALTER TABLE execucoes ADD COLUMN outras_despesas REAL;
ALTER TABLE execucoes ADD COLUMN data_pagamento TEXT;
ALTER TABLE execucoes ADD COLUMN valor_recebido REAL;

-- Acompanhamento da disputa (ações da etapa "Boa colocação" e afins).
ALTER TABLE licitacoes ADD COLUMN acompanhar INTEGER NOT NULL DEFAULT 1;
ALTER TABLE licitacoes ADD COLUMN colocacao INTEGER;
ALTER TABLE licitacoes ADD COLUMN situacao_disputa TEXT;
ALTER TABLE licitacoes ADD COLUMN data_reabertura TEXT;
ALTER TABLE licitacoes ADD COLUMN hora_reabertura TEXT;
