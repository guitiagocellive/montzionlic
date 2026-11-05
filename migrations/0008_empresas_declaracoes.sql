-- Várias empresas (cada proposta escolhe a empresa que participa), contas por empresa,
-- biblioteca de declarações/condições da proposta e o rascunho da proposta de cada licitação.

CREATE TABLE empresas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cnpj TEXT,
  ie TEXT,
  endereco TEXT,
  cidade TEXT,
  telefone TEXT,
  email TEXT,
  representante_nome TEXT,
  representante_cpf TEXT,
  representante_rg TEXT,
  representante_cargo TEXT,
  logo_chave TEXT,
  marca_dagua INTEGER NOT NULL DEFAULT 1,
  padrao INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Traz os dados da empresa que estavam nas configurações (se já tinham sido preenchidos).
INSERT INTO empresas (nome, cnpj, ie, endereco, cidade, telefone, email, representante_nome, representante_cpf, representante_cargo, logo_chave, padrao)
SELECT (SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'empresa_nome'), (SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'empresa_cnpj'), (SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'empresa_ie'), (SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'empresa_endereco'), (SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'empresa_cidade'),
       (SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'empresa_telefone'), (SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'empresa_email'), (SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'representante_nome'), (SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'representante_cpf'),
       (SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'representante_cargo'), NULLIF((SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'empresa_logo_chave'), ''), 1
 WHERE COALESCE((SELECT json_extract(valor, '$') FROM configuracoes WHERE chave = 'empresa_nome'), '') <> '';

-- Conta de uma empresa específica (vazio = serve para qualquer empresa).
ALTER TABLE contas_bancarias ADD COLUMN empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE;

-- Declarações e condições que entram na proposta. "padrao" = já vem marcada.
CREATE TABLE declaracoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL DEFAULT 'declaracao' CHECK (tipo IN ('declaracao', 'condicao')),
  titulo TEXT NOT NULL,
  texto TEXT NOT NULL,
  padrao INTEGER NOT NULL DEFAULT 1,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO declaracoes (tipo, titulo, texto, padrao, ordem) VALUES
  ('condicao', 'Conformidade com o edital', 'Proposta de acordo com todos os preceitos elencados na minuta do edital e seus anexos, bem como os requisitos do Termo de Referência, anexo ao Edital.', 1, 1),
  ('condicao', 'Casas decimais', 'Preço unitário e total com duas casas decimais, em moeda corrente nacional, expressos em algarismos.', 1, 2),
  ('condicao', 'Custos incluídos', 'Nos preços estão incluídos todos os custos que se fizeram indispensáveis à perfeita execução do objeto da licitação.', 1, 3),
  ('declaracao', 'DECLARAÇÃO DE ELABORAÇÃO INDEPENDENTE DE PROPOSTA', 'Para fins do disposto no Termo de Referência em referência, declaramos, sob penas da lei, em especial o Art. 299 do Código Penal Brasileiro que:
a) A intenção de apresentar a proposta e sua elaboração foi feita de maneira independente, não sendo informado a, discutido com ou recebido de, no todo ou em parte, direta ou indiretamente, qualquer participante, potencial ou de fato, do certame acima mencionado;
b) Não houve tentativa, por qualquer meio ou por qualquer pessoa, de influência na decisão de qualquer outro participante, potencial ou de fato, do pleito em referência, quanto à participação ou não do referido certame;
c) Que o conteúdo desta proposta não foi e nem será, no todo ou em parte, direta ou indiretamente, comunicado ou discutido com qualquer integrante da Administração ou outro participante, potencial ou de fato, antes da abertura oficial das propostas;
d) Que está plenamente ciente do teor e da extensão desta declaração e que detém plenos poderes e informações para firmá-la.', 1, 4),
  ('declaracao', 'DECLARAÇÃO DE CIÊNCIA E COMPROMISSO', 'Declaramos ciência e concordância de todas as cláusulas e manifestamos nosso pleno acordo em cumprir o estabelecido no Termo de Referência deste certame e responsabilizar-se pelas transações efetuadas em nosso nome, assumindo como firmes e verdadeiros todos os atos praticados diretamente ou por seu representante.', 1, 5),
  ('declaracao', 'DECLARAÇÃO DO PREÇO INTEGRAL', 'Declaramos que nos preços cotados na nossa proposta estão incluídas todas as despesas relativas à entrega dos produtos, bem como de todos os tributos e encargos de qualquer natureza que, direta ou indiretamente, incidam sobre o valor do eventual fornecimento, inclusive todos os custos para atendimento dos direitos trabalhistas assegurados na Constituição Federal, nas leis trabalhistas, nas normas infralegais, nas convenções coletivas de trabalho e nos termos de ajustamento de conduta vigentes.', 1, 6),
  ('declaracao', 'DECLARAÇÃO DE VISTORIA PRÉVIA', 'Declaramos ter pleno conhecimento das características e condições do objeto requerido na presente licitação, e que foi nos oferecida oportunidade de vistoria prévia à elaboração desta proposta. Desta forma, assumimos completa responsabilidade pelos imprevistos e problemas decorrentes de eventuais desconhecimentos acerca das características e/ou condições requeridas no objeto.', 1, 7),
  ('declaracao', 'DECLARAÇÃO DE INEXISTÊNCIA DE FATOS SUPERVENIENTES', 'Declaramos, na forma dos art. 63 e 69 da Lei nº 14.133/2021, que não estamos em processo de falência ou concordata, que, até a presente data, inexistem fatos impeditivos para nossa habilitação no presente certame, e que estamos cientes da obrigatoriedade de declarar ocorrências posteriores, na forma do inciso IV, do item 7.1 da IN MARE Nº 05/95.', 1, 8),
  ('declaracao', 'DECLARAÇÃO DE HABILITAÇÃO', 'Declaramos, na forma do inciso I, art. 63, da Lei nº 14.133/2021, que cumprimos plenamente os requisitos de habilitação exigidos no Termo de Referência da presente licitação.', 1, 9),
  ('declaracao', 'DECLARAÇÃO RELATIVA AO TRABALHO DE MENORES', 'Declaramos, em obediência ao inciso XXXIII do art. 7º da Constituição Federal, que não empregamos menor de dezoito anos em trabalho noturno, perigoso ou insalubre e não empregamos menor de dezesseis anos. Ressalva: emprega menor, a partir de quatorze anos, na condição de aprendiz.', 1, 10),
  ('declaracao', 'DECLARAÇÃO DO DECRETO Nº 7.203/2010', 'Declaramos, conforme disposto no § 3º do art. 3º do Decreto nº 7.203/2010, que os administradores ou sócios com poder de direção desta empresa não são cônjuges, companheiros ou parentes em linha reta ou colateral, por consanguinidade ou afinidade, até o terceiro grau, de detentor de cargo em comissão ou função de confiança que atue na área responsável pela demanda desta contratação.', 1, 11),
  ('declaracao', 'DECLARAÇÃO DO DECRETO Nº 38.365/2017', 'Declaramos, conforme disposto no Decreto nº 38.365/2017, que não produzimos ou veiculamos conteúdo discriminatório contra a mulher ou minorias em condições de vulnerabilidade.', 1, 12),
  ('declaracao', 'DECLARAÇÃO DO DECRETO Nº 9.579/2018', 'Declaramos, conforme disposto no art. 51 do Decreto n.º 9.579/2018 que cumprimos a cota de aprendizes estabelecida.', 1, 13),
  ('declaracao', 'DECLARAÇÃO DA LEI Nº 9.605/1998', 'Declaramos, sob as penas da Lei, que não estamos sob pena de interdição temporária de direitos, de que trata o art. 10 da Lei nº 9.605/1998.', 1, 14),
  ('declaracao', 'DECLARAÇÃO DE ATENDIMENTO AOS REQUISITOS DE SUSTENTABILIDADE', 'Declaramos estar em conformidade com o previsto no art. 2º da Lei Distrital nº 4.770/2012, combinado com o Decreto nº 7.746/2012, que regulamenta o art. 5º da Lei nº 14.133/2021, os quais estabelecem a implementação de critérios, práticas e ações de logística sustentável no âmbito da Administração Pública do Distrito Federal direta, autárquica e fundacional e das empresas estatais dependentes, devendo ser observados os requisitos ambientais com menor impacto ambiental em relação aos seus similares.', 1, 15);

-- Rascunho da proposta de cada licitação (empresa, banco, prazos, declarações, itens...).
CREATE TABLE propostas_licitacao (
  licitacao_id INTEGER PRIMARY KEY REFERENCES licitacoes(id) ON DELETE CASCADE,
  dados TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
