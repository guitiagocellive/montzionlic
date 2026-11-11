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
  - [ ] Continuar ajustando com o uso (ordem, destaque, resumo).
  - [ ] Buscas salvas e aviso diário de licitações novas que batem com os nichos.

## A fazer

- [ ] **2. Robô de lances (sala de lances)**
  - [x] Fase 1: aba "Robô de lances" na licitação (valor mínimo por item, sugestão pelo orçamento, redução,
        lance fechado, "Não aguardar os segundos finais para enviar o lance", padrão 30 s finais) e simulador
        (aberto com prorrogação, hora fixa, aberto e fechado) com comparação das estratégias.
  - [ ] Fase 2: mapear a sala de disputa do Compras.gov.br numa sessão real (robô só observando).
  - [ ] Fase 3: robô no aplicativo do Windows (janela onde a pessoa entra no gov.br; modo observação →
        com confirmação → automático), registrando os lances na plataforma.
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
