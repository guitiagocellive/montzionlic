# Pendências combinadas

Lista do que foi combinado e ainda falta fazer (ou melhorar). Atualizar sempre que algo for feito.

## Em andamento / a melhorar aos poucos

- [x] **1. Buscar licitações (PNCP)** — aba Licitações → "Buscar licitações".
  - [x] Busca por palavra-chave, nº da licitação, estado (UF), modalidade e situação (recebendo propostas ou todas).
  - [x] Link para o PNCP e para o sistema de origem (ex.: Compras.gov).
  - [x] "Adicionar ao quadro": cria o card em "Para estudar" com órgão, UASG, número, objeto, modalidade,
        data/hora da sessão, portal, valor estimado, registro de preço, itens e o edital anexado.
  - [x] Marca as licitações que já estão no quadro.
  - [x] Filtro por data da sessão (hoje, amanhã, 3/7/15/30 dias, datas), município, UASG, órgão/CNPJ,
        registro de preço, esfera e faixa de valor; ordenar por sessão mais próxima.
  - [x] Link do portal da disputa (Compras.gov.br etc.) além do PNCP.
  - [x] Prévia de todos os arquivos do PNCP dentro da plataforma (PDF, imagens, .zip) e lista de itens.
  - [x] "Adicionar ao quadro" anexa todos os arquivos (não só o edital).
  - [x] Janela ao clicar no card em etapas (Dados, Itens, Arquivos) com Anterior/Próxima.
  - [x] Ao adicionar ao quadro, escolher os itens de que vai participar (selecionar/desmarcar todos).
  - [x] Filtro por plataforma da disputa e registro de preço na área principal.
  - [x] Busca no formato do Siga Pregão (lupa recolhida, nº e UASG abertos, pesquisa avançada em cartão animado).
  - [ ] Continuar ajustando com o uso (ordem, destaque, resumo).
  - [ ] Buscas salvas e aviso diário de licitações novas que batem com os nichos.

## A fazer

- [ ] **2. Robô de lances** (Licitações → Disputas)
  - [x] Página Disputas central (como o Siga Pregão): lista as disputas da conta do Compras.gov.br, itens com
        lance mínimo, desconto (%), melhor lance, meu lance, cronômetro, ligar/parar por item, "Permitir lances
        com 4 casas decimais" e "Não aguardar os segundos finais para enviar lances".
  - [x] Sempre espera os 10 segundos finais; cobre até o lance mínimo; no fim vai no mínimo.
  - [x] Ponte no aplicativo do Windows (janela do Compras.gov.br logada pela própria pessoa no gov.br).
  - [x] Login: abre o login de fornecedor e acha a sessão em qualquer janela/pop-up do Compras.gov.br
        (antes abria a sala de disputa direto e caía no login de governo).
  - [x] Da Área de Trabalho do Fornecedor para a sala de disputa: a ponte acha o item no menu e abre sozinha
        (testado com menu simulado; conferir o nome real do item no `montzion.log` se não abrir).
  - [ ] Validar numa disputa real (os campos foram mapeados pelo código da sala de disputa; testado com
        um Compras.gov.br simulado).
- [ ] **Aplicativo do Windows em janela própria (WebView2)**: compilado, mas ainda não testado num Windows de
      verdade. Conferir: abre com nome/ícone do Montzion, links externos vão para o navegador, "Entrar no
      Compras.gov.br" abre a janela própria e o robô lista as disputas. Se der erro, mandar o
      `%LOCALAPPDATA%\Montzion\montzion.log`.
- [ ] **6. Links diretos para emitir certidões** na Documentação (Receita/PGFN, FGTS, TST, Estado,
      Município), com o aviso de vencimento levando ao site certo.
- [ ] **7. Busca geral (Ctrl+K)** — achar licitação, empenho ou fornecedor pelo número, órgão ou produto.

## Ideias guardadas (não combinadas ainda)

- Banco de preços (histórico de preços ganhos e dos concorrentes por produto).
- Pedir cotação ao fornecedor por WhatsApp/e-mail com mensagem pronta.
- Pedido de atestado de capacidade técnica gerado em PDF.
- Avisos por e-mail (sessão amanhã, entrega vencendo, certidão vencendo).
- Backup: exportar todos os dados em Excel/zip.
- Verificação em duas etapas no login.
- Ler empenhos que chegam por e-mail (Cloudflare Email Routing + IA).
- Assinatura de código do instalador do Windows (tira o aviso do SmartScreen; certificado pago).
