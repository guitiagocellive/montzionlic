-- Proposta cadastrada no Compras.gov.br pela plataforma (cadastro com um clique): quando e quantos itens.
-- O card do quadro mostra "Alterar no Compras" em vez de "Cadastrar" quando há proposta cadastrada.
ALTER TABLE licitacoes ADD COLUMN compras_cadastrado_em TEXT;
ALTER TABLE licitacoes ADD COLUMN compras_itens INTEGER;
