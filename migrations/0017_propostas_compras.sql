-- Base própria de propostas (Análise de empresas): propostas de todas as empresas nas licitações em que a
-- empresa usuária participou, lidas pelo aplicativo nas telas "Todas as propostas" do Compras.gov.br.
CREATE TABLE IF NOT EXISTS propostas_compras (
  compra TEXT NOT NULL,          -- chave da compra (UASG + modalidade + número + ano)
  item INTEGER NOT NULL,
  cnpj TEXT NOT NULL,
  empresa TEXT,
  uf TEXT,
  me_epp INTEGER,
  descricao TEXT,
  quantidade REAL,
  valor REAL,                    -- valor unitário final (negociado, lance ou proposta)
  colocacao INTEGER,
  situacao TEXT,                 -- situação da proposta no Compras.gov.br
  resultado TEXT,                -- vitoria | derrota | desclassificada | inabilitada | andamento
  motivo TEXT,
  orgao TEXT,
  atualizado_em INTEGER NOT NULL,
  PRIMARY KEY (compra, item, cnpj)
);
CREATE INDEX IF NOT EXISTS idx_propostas_cnpj ON propostas_compras (cnpj);
