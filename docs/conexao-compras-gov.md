# Conexão com o Compras.gov.br — análise e decisões (novembro de 2026)

## Como o mercado faz (o que é público)
- **Siga Pregão (Máquina de Lances):** programa no computador; a pessoa entra no Comprasnet dentro dele e o programa
  lista as disputas e dá os lances. É o mesmo modelo do aplicativo Montzion.
  Fonte: https://www.sigapregao.com.br/maquina-de-lances/
- **Effecti, ConLicitação, Licitei, Licitech:** robô e monitoramento de chat anunciados, sem documentação técnica
  pública do mecanismo; alguns usam extensão de navegador na página da disputa (Licitech), outros servidores próprios
  (Licitei). São declarações comerciais, não auditadas.
- **Integra Compras (Serpro, 2026):** API oficial e paga, só de **leitura** de Chat de Mensagens e Chat de Diligências.
  Não envia mensagens, lances nem anexos. Fonte: https://www.serpro.gov.br/menu/noticias/noticias-2026/integra-compras
- **Dados abertos (dadosabertos.compras.gov.br):** públicos, sem disputa ao vivo nem dados da conta.
- Não há API pública oficial para **enviar lances, propostas ou anexos** por terceiros.

## Decisão: aplicativo local com a sessão da própria pessoa
- O login (gov.br, certificado) acontece na janela oficial no computador da pessoa; senha e certificado nunca passam
  pela plataforma nem por servidores nossos.
- O aplicativo usa o **token da sessão** que a página oficial guarda e fala **direto** com as mesmas APIs que a página
  usa (`desktop/direto.go`). A página só é usada para gerar o **captcha invisível** (um por vez), nas telas que exigem.
- Tempo real das disputas: o mesmo canal STOMP/WebSocket da sala oficial (`desktop/stomp.go`).
- Só endereços de **fornecedor** de uma lista fechada (`desktop/compras_acesso.go`, com teste); ações pedem confirmação.

### Por que não um "worker na nuvem" (proposta do briefing)
- Exigiria levar a sessão do gov.br da pessoa para um servidor nosso (credencial sensível, possível vínculo com
  dispositivo/IP, renovação de token e captcha que depende de navegador).
- O captcha é invisível e roda na página oficial; não contornamos captcha.
- O robô já roda sem a página da plataforma aberta (fica no aplicativo). Para não depender do computador ligado
  seria preciso um navegador oficial rodando 24 h numa máquina dedicada — opção futura, não necessária agora.
- Itens do briefing que valem e já existem: lista fechada de operações, registro de cada lance, limite mínimo,
  pausa, decisão determinística (regra testada), reconciliação pela leitura do item depois do lance.

## Diagnóstico real que guiou a versão 3.1.3
- Lista de participações **sem captcha volta vazia** (200, sem cabeçalhos de página): agora repete com captcha e,
  se ainda vier vazia, usa a página oficial.
- "Itens" exige `situacoes` (1,2,3,4,5,6,7,8,9,13,14).
- Chat de compra sem mensagens responde 404 (não é erro).
- A página "disputa" sem compra redireciona para "compra-nao-encontrada": o captcha passa a ser gerado em
  qualquer página da sala (ex.: "Minhas participações"), sem recarregar em laço.
- "Propostas iniciais" vem como lista de itens com as propostas dentro.

## Desempenho (medido no Compras.gov.br simulado)
- Lista do Acompanhamento após o login: 44 s → 4 s; Disputas: 1–2 s.
- Reabrir: a última leitura fica no computador (`%LOCALAPPDATA%\Montzion\acompanhamento.json`) e aparece em 0,1 s.
- A plataforma só baixa o painel quando ele muda (versão).
