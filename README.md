# Montzion Licitações

Plataforma interna de gestão de licitações. Roda inteira na Cloudflare:

- **Cloudflare Workers** com [Hono](https://hono.dev) — API em `src/worker`
- **Cloudflare D1** (SQLite) — banco de dados, migrações em `migrations/`
- **React + Vite** — telas em `src/react-app`, servidas pelo próprio Worker

## O que já existe

- **Primeiro acesso:** na primeira vez que o site abre, ele pede para criar o administrador.
  Depois disso essa tela some.
- **Login com e-mail e senha:** senhas guardadas com PBKDF2-SHA256 (nunca em texto puro),
  sessão em cookie `HttpOnly` válida por 30 dias.
- **Senha errada não bloqueia:** o usuário pode tentar de novo quantas vezes precisar.
- **Equipe (só administradores):** adicionar pessoas com senha provisória, mudar perfil
  (Administrador/Membro), desativar/reativar e redefinir senha.
- **Senha provisória:** quem recebe uma senha provisória é obrigado a criar a própria no primeiro acesso.
- **Minha conta:** cada pessoa pode trocar a própria senha.

Não existe cadastro público: só um administrador adiciona pessoas.

## Layout

- **Menu horizontal (balão no topo):** escolhe a área — Visão geral, Licitações, Pós-ganho, Financeiro,
  Documentação. No celular, a barra rola de lado.
- **Menu lateral (cápsula):** as funções da área escolhida, incluindo o **painel daquela área** (Licitações e
  Pós-ganho). No celular, vira uma cápsula fixa embaixo.
- **Topo:** tema claro/escuro, sino de notificações, configurações (engrenagem) e menu da conta.

## Configurações (engrenagem)

- **Meu perfil:** foto, nome, cargo e cor no time.
- **Aparência:** modo claro, escuro ou automático; tema claro (Céu ou Lavanda) e tema escuro
  (Oceano ou Grafite). Barras com efeito de vidro fosco. Novas paletas ficam em `estilos.css`
  (`[data-paleta="..."]`) e na lista `TEMAS_CLAROS`/`TEMAS_ESCUROS` de `src/shared/tipos.ts`.
- **Empresas** (admin): uma ou mais empresas participantes, cada uma com logo (e marca d'água opcional),
  dados cadastrais e representante legal (nome, CPF, RG, cargo).
- **Margens e prazos** (admin): margem de lucro, impostos e validade padrão das licitações novas.
- **Alertas** (admin): com quantos dias de antecedência avisar sessões, entregas e atas.
- **Propostas** (admin): biblioteca de declarações e condições (já vem com as declarações usuais; as marcadas
  entram em toda proposta nova), contas bancárias (de uma empresa ou de todas) e modelos do Word.
- **Certificado digital** (admin): cadastro do certificado A1 (.pfx/.p12 + senha), validade e troca.
  O .pfx é aberto no navegador: a senha não é enviada nem guardada. A chave fica criptografada com o
  segredo `CHAVE_CERTIFICADO` do Worker e nunca volta para o navegador.
  Quem pode assinar é definido em Equipe e acessos → **Assinatura digital** (Editar = pode assinar).
  O sistema avisa 30 dias antes do certificado vencer.
- **Equipe e acessos** (admin): convite por link (uso único, com validade), perfil, cor e acesso por
  área (sem acesso / ver / editar). O servidor bloqueia o que a pessoa não pode ver ou editar.

## Notificações e alertas

- O sino mostra avisos de sessões próximas, sessões sem orçamento, entregas e atas vencendo,
  licitação ganha, responsável atribuído e novo membro. Também pode avisar pelo navegador.
- O servidor confere de hora em hora (cron do Worker) e também quando alguém abre o sino.
- A tela **Alertas** mostra tudo o que precisa de atenção agora.

## Módulos

**Seção 1 — Licitações (antes de ganhar)**
- **Quadro Kanban** com as etapas Para estudar → Para fazer → Orçamento → Boa colocação → Perdidas / Ganhas
  (arrastar e soltar; nomes das etapas em `src/shared/negocio.ts`).
- **Ficha da licitação** em 4 etapas: Dados, Itens, Arquivos e IA, Orçamento.
- **Orçamento automático:** preço de venda = custo com frete ÷ (1 − impostos − lucro).
- **IA gratuita (Workers AI):** lê edital/termo de referência (PDF, imagem, Word, Excel), resume,
  preenche os dados e importa os itens. Limite grátis diário (~8 a 10 editais).
- **Análise de empresas:** Licitações → Análise de empresas (como no Siga Pregão). Digite o CNPJ de um concorrente (ou
  o seu) e o período (últimos 12 meses por padrão): cadastro (razão social, cidade, porte, CNAE, se pode licitar),
  **vitórias** (itens vencidos, licitações, órgãos, cancelados), **valores** (homologado, compras diretas e registrado
  em atas), **vitórias por modalidade**, mapa e gráfico por mês, produtos que mais vence, órgãos que mais compram dela
  (com nome), estados e a lista dos itens vencidos com link para o PNCP. Fonte: resultados oficiais do PNCP (todas as
  plataformas que publicam lá) e cadastro de fornecedores do Compras.gov.br; a base aberta só traz as vitórias
  (disputas perdidas, desclassificações e inabilitações não são publicadas).
- **Inteligência de mercado:** Licitações → Inteligência de mercado (no estilo da Análise de Mercado do Siga Pregão).
  Ao digitar, aparecem **sugestões** do catálogo oficial do governo; o período já vem nos **últimos 12 meses** (atalhos
  3/6/24 meses ou datas no calendário). Mostra o **mapa do Brasil** (marca que mais vence em cada estado, ou volume de
  compras), o valor total homologado e os **ângulos de análise**: **Correspondências** (as compras encontradas, com
  órgão, vencedor, marca e preço), **Estados**, **Marcas** (e os modelos mais vencedores) e **Empresas** (com CNPJ),
  por vitórias ou valor homologado e com o preço unitário mediano. Clicar num estado (no mapa ou na lista) filtra
  marcas, empresas e correspondências. Cada lista baixa em CSV. Ao lado do mapa, o **gráfico do valor homologado por
  mês** (meses recentes "em consolidação") e o valor total. O bloco "Como os números são calculados" explica por que
  outras plataformas podem mostrar valores diferentes (busca por palavra solta, participantes em vez de vencedores,
  outras plataformas de compra).
  - Fonte: dados abertos do Compras.gov.br (pesquisa de preços), grátis e sem login; entram as compras feitas pelo
    Compras.gov.br (federal e estados/municípios que usam). O servidor só repassa e guarda as respostas por 12 h; a
    soma é feita no navegador (cabe no plano grátis). Analisa até 20 mil itens (os mais recentes) por pesquisa.
  - A marca é digitada pelo fornecedor; a plataforma padroniza (tira modelos, códigos e palavras do produto) e preços
    absurdos (mais de 50× o típico) ficam de fora. Mapa dos estados: `public/dados/mapa-brasil.json` (svg-maps de
    Victor Cazanave, licença CC BY 4.0). O catálogo de produtos fica em `public/dados/pdms.json`
    (atualizar com `python3 -I scripts/baixar-pdms.py public/dados/pdms.json`).
- **Buscar licitações (PNCP):** Licitações → Buscar licitações, no formato do Siga Pregão. Barra compacta: a **lupa**
  fica recolhida e se abre ao clicar (busca por palavra: notebook, uniforme…), os campos **Nº da licitação** e
  **UASG ou CNPJ do órgão** ficam abertos, a **data da sessão** (hoje, amanhã, 3/7/15/30 dias ou datas) e o botão da
  **Pesquisa avançada**, que abre num cartão animado com palavras-chave separadas por ";", período, tipo de item
  (material/serviço), situação, estados, municípios (lista do IBGE), portais de compra, modalidades, modo de disputa,
  órgão, faixa de valor e outros filtros (exclusiva ME/EPP, excluir ou só registro de preço, esfera). Ordena por
  publicação, sessão mais próxima ou relevância.
  - Cada resultado mostra sessão (com aviso de "hoje"/"amanhã"), UASG, valor estimado, SRP, modo de disputa e os links
    para o **PNCP** e para o **portal da disputa** (Compras.gov.br, BLL, BNC, Licitações-e, Portal de Compras
    Públicas…), direto na licitação quando o PNCP informa.
  - Prévia do PDF dentro da plataforma também no celular; .zip mostra o que tem dentro. A prévia dos arquivos na ficha
    da licitação usa o mesmo leitor.
  - O card é criado em "Para estudar" com os dados, os itens escolhidos e **todos os arquivos** anexados.
  - Filtros que o PNCP não faz (data da sessão, plataforma, UASG, CNPJ, nº, vários municípios) são aplicados aqui depois de
    baixar até 3.000 resultados por consulta; a tela avisa quando é preciso afinar a busca.
  - A pesquisa sai do navegador; só o download dos arquivos passa pelo servidor (`/api/pncp/arquivo`).
- **Acompanhamento** (Licitações → Acompanhamento, pelo aplicativo do Windows), no mesmo desenho do Compras.gov.br e
  separado do quadro:
  - **Lista de participações** (filtro Em andamento / Propostas / Disputa / Seleção de fornecedores / Finalizadas), cada
    uma com modalidade e número, UASG - órgão, objeto, etapa e etiquetas: **Chance boa** (até o 4º lugar), **média**
    (5º a 8º), **baixa** (9º em diante), **Convocado**, **Pregoeiro falou com você**.
  - **Janela da compra** (pop-up): etapas (Propostas → Disputa → Seleção de fornecedores → Remanescentes) e os itens com
    situação, colocação ("3º de 21"), chance e convocações; botão **Ver item**; mensagens da compra.
  - **Ver item**: **Minha proposta** (classificação, declarações ME/EPP, UF, chat com envio de mensagem, proposta com
    valor proposta/ofertado/negociado unitário e total, quantidade, marca e modelo, anexos, diligências, recursos e
    lances) e **Todas as propostas** (empresas em ordem; a seta abre o chat dela com o pregoeiro, a proposta, os anexos
    para baixar e as diligências; botão "Conferir anexos das empresas à sua frente").
  - **Anexos só com convocação** e depois de marcar **"Ciente"** (como na tela oficial); diligência e recursos só quando
    o prazo está aberto. Toda ação pede confirmação.
  - Avisos (convocações, situação da proposta, mensagens do pregoeiro) também vão para o **sino** da equipe.
  - **Cadastrar proposta** (botão no topo e, nas compras em fase de propostas, dentro da janela da compra): informa
    UASG, modalidade, número e ano; aceita as **declarações** (texto oficial, ME/EPP, programa de integridade e equidade
    de gênero quando exigidos) e cadastra, altera ou exclui a **proposta de cada item** (valor unitário ou desconto,
    quantidade, marca e modelo para materiais; anexo quando o item exige). Cada envio pede confirmação.
  - **Rápido**: o aplicativo consulta o Compras.gov.br direto com a sessão do gov.br (`desktop/direto.go`); a página
    oficial só gera o captcha, um por vez e só nas telas que exigem (ele aprende quais são). A página da plataforma só
    baixa o painel de novo quando algo muda (versão).
  - O aplicativo relê a lista a cada 3 minutos (10 por página, como a tela oficial, que responde 206) e lê na hora a
    compra que você abre. Só aceita endereços de fornecedor de uma **lista fechada** (`desktop/compras_acesso.go`, com
    teste), no máximo 40 consultas por minuto.
  Código: `desktop/acompanhamento.go`, `desktop/compras_acesso.go`, `src/shared/acompanhamento.ts`,
  `src/react-app/pages/licitacoes/Acompanhamento.tsx`, `src/react-app/pages/licitacoes/ItemCompras.tsx`.
- **Disputas / robô de lances** (Licitações → Disputas): o robô roda **dentro do aplicativo do Windows**
  (`desktop/motor.go`), não na página — continua dando lances mesmo com a página fechada.
  - **Login como no Siga Pregão:** "Entrar com gov.br" abre uma janela direto no login de fornecedor do gov.br
    (o mesmo do botão "Entrar com Gov.br" do Compras.gov.br). Quando o gov.br devolve para o Compras.gov.br, a
    janela some e o aplicativo entra sozinho na sala de disputa (lê o menu da Área de Trabalho e abre o item da
    sala). A página mostra os passos (login, sala de disputa, buscando disputas). A senha e o certificado não
    passam pela plataforma.
  - **Tempo real:** o aplicativo conecta no mesmo canal da sala oficial (STOMP sobre WebSocket em
    `/comprasnet-websocket/socket/websocket`, tópicos `/topic/compra/{chave}` e
    `/topic/disputa/fornec/{chave}/{cnpj}`) e recebe cada lance novo na hora. A cada aviso o robô decide e já
    envia o lance direto ao Compras.gov.br (no simulador, ~1 ms depois do lance do concorrente; na vida real soma
    o tempo da internet). Um tique de 100 ms cuida do cronômetro (10 segundos finais).
  - **Sessão:** o token fica na janela escondida do Compras.gov.br; o aplicativo lê, usa nos pedidos diretos e,
    se vencer sem a sala renovar, renova (`/comprasnet-usuario/v2/sessao/fornecedor/retoken`). Se o pedido
    direto falhar, usa a própria janela por 5 min. Sem o tempo real, cai para consultas (0,5 s nos segundos
    finais com robô ligado).
  - **Lista:** só compras em disputa (fora revogadas, anuladas, desertas, fracassadas e fase 4); sem item em
    disputa agora vão para "Sem disputa agora". A lista é pedida com o captcha invisível da própria sala.
  - **Página:** lê o painel do aplicativo (no próprio computador, sem ir ao Compras.gov.br), manda a configuração
    de cada item (lance mínimo, desconto, 4 casas, "Não aguardar") e registra os lances na plataforma
    (`/api/robo`). Mostra "Tempo real"/"Consultando" e o tempo do último lance.
  - Regra igual em `src/shared/robo.ts` e `desktop/regra.go` (com testes em `desktop/regra_test.go`):
    **sempre espera os 10 segundos finais**, dá o menor lance que coloca a empresa em 1º (respeitando o
    intervalo mínimo do edital) e, se não der, vai no lance mínimo.
- **Datas** sempre pelo calendário da plataforma (`components/Calendario.tsx`): data única ou período início–fim
  com atalhos; o campo `Campo type="date"` já usa o calendário.
- **Fornecedores** por nicho, com WhatsApp, site e catálogo.
- **Calendário** e **Painel** com números reais.

- **Proposta comercial:** na aba Proposta de cada licitação você escolhe a **empresa participante**, o **banco**,
  preenche nº da contratação, nº da proposta, data, validade, prazo de entrega e garantia, ajusta produto, marca e
  valor de cada item, marca as **declarações** e acrescenta declarações **só daquela licitação**. Tudo fica salvo
  sozinho naquela licitação. O PDF sai completo (logo em todas as páginas, dados da empresa, banco, representante,
  itens, total por extenso, condições, declarações, local/data e assinatura). Também gera em Word com os **seus
  modelos** (.docx): campos entre chaves, ex.: `{orgao}`; tabela de itens com `{#itens}` … `{/itens}`; declarações
  com `{#declaracoes}{titulo} {texto}{/declaracoes}` e condições com `{#condicoes}{texto}{/condicoes}`.
  Modelo de exemplo em `public/modelos/modelo-proposta.docx`.
- **De onde a proposta puxa cada item:** a descrição e a marca vêm do **produto cotado** (campo "Descritivo do
  produto" da cotação; sem descritivo, o nome do produto). O produto é o marcado **"Usar na proposta"** no Orçamento
  ou, sem marcação, o mais barato. O valor vem do **lance final** registrado no Resultado; sem lance, do preço de
  venda da cotação. Se a cotação ou o lance mudam depois, a proposta se atualiza; o que foi digitado à mão na
  proposta fica (com um botão para voltar ao automático). Um lance novo no Resultado sempre entra na proposta.
- **Assinar documentos** (Documentação → Assinar documentos): envie um ou vários PDFs (declarações, contratos,
  atas, ofícios…), escolha a página e o lugar do carimbo em cada um e assine com o certificado A1 da empresa. O PDF
  assinado é baixado na hora e fica guardado na lista da página (ver, baixar, excluir, procurar) ou, se preferir,
  direto numa licitação, na categoria escolhida. A página também lista o que foi assinado dentro das licitações e dos
  empenhos. Precisa da permissão "Assinatura digital" (editar) para assinar.
- **Criar documentos** (Documentação → Criar documentos): declarações, ofícios e cartas em PDF com o logo e os dados
  da empresa. Preencha título e texto (botões colocam campos como `{empresa}`, `{cnpj}`, `{representante}`, `{cpf}` e,
  com uma licitação escolhida, `{orgao}`, `{licitacao}`, `{objeto}`), ou comece de uma declaração da biblioteca. Local
  (padrão "Brasília/DF"), data de hoje e assinatura do responsável legal entram sozinhos. Mesmos modelos visuais da
  proposta, pré-visualização, baixar, assinar com o certificado (vai para "Assinar documentos" ou para a licitação) e
  guardar na licitação. O rascunho fica salvo no navegador.
- **Modelos do PDF da proposta:** Clássico, Moderno (faixa colorida, dados em colunas, tabela listrada), Timbrado
  (dados da empresa no cabeçalho e rodapé, letra serifada), Compacto (letra menor, cabe em menos páginas) e Simples
  (preto e branco com grade, para imprimir), cada um em 8 cores. A empresa tem o modelo/cor padrão (Configurações →
  Empresas) e cada proposta pode trocar na aba Proposta. "Pré-visualizar" mostra o PDF antes de salvar e permite
  trocar o modelo e a cor ali mesmo.
- **Proposta em PDF e assinatura digital:** a plataforma monta a proposta em Word (seus modelos) ou em PDF
  (com logo, itens, total por extenso, condições e declaração). Também dá para enviar um PDF pronto (por exemplo,
  o Word que você ajustou e converteu). Na hora de assinar, abre a página do PDF e você **clica onde o carimbo
  "Assinado digitalmente" deve ficar**. A assinatura usa o **certificado A1 da empresa** (padrão ICP-Brasil/PAdES,
  conferível em validar.iti.gov.br) e o arquivo aparece com o selo na plataforma.
  - **Funciona no plano grátis da Cloudflare:** montar o Word/PDF e preparar o PDF rodam no navegador; o servidor
    só assina o resumo (hash) do PDF com a chave guardada, o que leva cerca de 2 ms.
- **Resultado da disputa:** por item (ganho, perdido, cancelado), colocação, nosso lance, vencedor,
  valor vencedor e motivo da perda.
- **Comentários e histórico** em cada licitação e empenho, com menção (@) que gera notificação.

**Seção 2 — Pós-ganho**
- Ao mover uma licitação para **Ganhas**, o card aparece sozinho no quadro de **Empenhos e entregas**,
  já com os itens e o produto mais barato cotado.
- **Itens do empenho:** "Adicionar itens ganhos" lista só os itens ganhos da licitação e mostra o que já foi
  empenhado em outros empenhos (vários empenhos por licitação, comum em registro de preço).
- **Empenho de licitação de antes da plataforma:** em "Novo empenho", escolha "Licitação de antes da plataforma",
  preencha órgão, número, UASG, objeto e o empenho; a licitação é criada já como Ganha e os itens são preenchidos
  à mão.
- Etapas: Aguardando empenho → Empenho recebido → Material comprado → Aguardando entrega →
  Entrega realizada → Solicitar atestado → Concluído.
- Prazo de entrega calculado em dias corridos ou úteis; itens ganhos com lucro; dados de faturamento;
  arquivos e leitura do empenho pela IA.
- **Atas vigentes** com vigência, alerta de vencimento, prazo e produtos registrados.
- **Saldo das atas automático:** no empenho, escolha a ata e o item da ata; o saldo é descontado
  sozinho e o sistema não deixa empenhar acima do saldo. Alerta quando o saldo passa de 80% do registrado.

**Ficha da licitação**
- Duas colunas: à esquerda os **dados principais** (sessão ou reabertura, órgão, UASG, registro de preço,
  modalidade, portal, valor, responsável, objeto — editar abre numa janela) e a contagem dos itens; à direita o
  próximo passo e as abas Itens, Resultado, Orçamento, Proposta, Arquivos e IA.
- **Resultado por item:** ganho, acompanhando, perdido ou cancelado. Em "Ganhamos" (ou ao arrastar para Ganhas)
  abre "Quais itens ganhamos?": só os itens ganhos vão para o empenho, já com o valor final.
- **Próximo passo** da etapa com botões: "Vamos participar" / "Não vamos participar", "Ir para Orçamento",
  "Ficamos bem colocados", "Ganhamos" / "Perdemos" (pede o motivo).
- Em **Boa colocação**: acompanhar ou não, colocação, situação da disputa e **reabertura da sessão** (data e
  hora) — a reabertura entra no calendário e gera alerta.

**Financeiro** (permissão própria: Equipe e acessos → Financeiro)
- Vendido (empenhado), impostos, custo dos produtos, frete e despesas, **lucro líquido** e margem no período.
- Situação dos recebimentos: ganho aguardando empenho, **a faturar**, **a receber** e recebido no período.
- Por mês, por órgão e tabela de empenhos com lucro de cada um; exportação em CSV.
- No empenho (aba Faturamento): nota fiscal, data da nota, data do pagamento, valor recebido, frete e despesas.

**Documentação e relatórios**
- **Documentos de habilitação:** separados como na Lei 14.133/2021 (jurídica, fiscal/social/trabalhista,
  econômico-financeira, técnica e outros), por empresa, com validade, arquivo e alerta antes de vencer.
  **Baixar tudo (zip)** ou por seção, com uma pasta por habilitação e os vencidos marcados no nome.
- **Relatórios:** taxa de sucesso, resultados por mês, motivos de perda, concorrentes que mais ganham,
  desempenho por órgão, nicho e modalidade, empenhado e lucro no período; exportação em CSV.

## Aplicativo para Windows

Em **Configurações → Aplicativo** (ou no menu da conta → "Baixar app para Windows") cada pessoa baixa o
`Montzion-Instalador.exe`. Ao abrir, ele instala o Montzion na pasta do usuário (sem pedir administrador), cria
atalhos na área de trabalho e no menu Iniciar, registra em "Aplicativos instalados" (para desinstalar) e abre o
Montzion num **programa próprio**: uma janela do Windows com nome e ícone do Montzion e o motor WebView2 da Microsoft
dentro (o mesmo do Edge, que já vem no Windows 10 e 11), sem barra de endereço, sem abas e com os dados guardados em
`%LOCALAPPDATA%\Montzion\Dados`. Links para outros sites (PNCP, portais) abrem no navegador padrão; a janela do
Compras.gov.br do robô de lances também é uma janela própria. Abrir o atalho de novo só traz a janela para a frente.
Se o Windows não tiver o WebView2, o aplicativo avisa uma vez (com o link de download gratuito da Microsoft) e abre
no modo aplicativo do Edge/Chrome. Código em `desktop/janela_windows.go` (chamadas diretas ao Windows, sem
bibliotecas externas; o `WebView2Loader.dll` da Microsoft vai embutido, licença em `desktop/recursos`). Registro de
erros em `%LOCALAPPDATA%\Montzion\montzion.log`. O instalador ainda não tem
assinatura digital de código, então o Windows mostra "O Windows protegeu o computador" na primeira vez
(Mais informações → Executar assim mesmo).

Dentro do aplicativo, Configurações → Aplicativo não oferece baixar de novo: mostra a **versão instalada** e o botão
**Verificar atualização**, que compara com `public/downloads/versao.json` e, se houver versão nova, mostra as novidades
e o botão para baixar. Ao gerar um instalador novo, suba a versão em `desktop/comum.go` **e** em
`public/downloads/versao.json` (com as novidades); o teste `go test ./...` em `desktop/` falha se as duas forem diferentes.

Para gerar de novo depois de mudar algo em `desktop/` (precisa de Go 1.22+ e Python 3):

```bash
./desktop/build.sh
```

O arquivo sai em `public/downloads/Montzion-Instalador.exe` e é publicado junto com o site.

## Publicar na Cloudflare

Tudo pelo painel da Cloudflare, sem linha de comando:

1. **Ativar o R2 (arquivos):** no menu, *R2 Object Storage* → ativar o plano grátis (a Cloudflare pede um
   cartão, mas não cobra dentro do limite grátis). Não precisa criar o bucket: o deploy cria sozinho.
2. **Criar o Worker a partir do GitHub:** *Workers & Pages → Create → Import a repository* → escolha
   este repositório.
   - Nome do projeto: `montzionlic` (precisa ser igual ao `name` do `wrangler.jsonc`)
   - Build command: `npm run build`
   - Deploy command: `npm run deploy:ci`
   - Ramo (branch) de produção: o ramo principal do repositório
   No primeiro deploy o banco D1 `montzionlic-db` e o bucket `montzionlic-arquivos` são criados sozinhos,
   e as tabelas do banco são aplicadas.
3. **Plano do Worker:** o plano grátis atende. O trabalho pesado (montar propostas, preparar PDFs, ler o
   certificado) roda no navegador de quem usa.
4. **Ativar a assinatura digital:** no Worker, *Settings → Variables and Secrets → Add*, tipo **Secret**,
   nome `CHAVE_CERTIFICADO` e, como valor, um texto longo e aleatório (40+ letras e números misturados).
   Guarde esse valor só lá: se ele mudar, é preciso cadastrar o certificado de novo.
5. **Domínio montzion.com.br:**
   - Na Cloudflare: *Add a domain* → `montzion.com.br` → plano Free. Confira se os registros **MX** e **TXT**
     do Google (e-mail) foram importados.
   - No Registro.br: em *DNS → Alterar servidores DNS*, coloque os dois servidores que a Cloudflare mostrar.
     A troca leva de alguns minutos a algumas horas.
   - Quando o domínio aparecer como *Active* na Cloudflare: no Worker, *Settings → Domains & Routes → Add →
     Custom domain* → `montzion.com.br` (e, se quiser, `www.montzion.com.br`). Se a Cloudflare avisar que já
     existe um registro para o domínio (o site antigo), apague esse registro A e tente de novo.
6. **Logo após o primeiro deploy**, abra o site e crie o administrador na tela de primeiro acesso.

A partir daí, cada push no ramo de produção publica sozinho.

## Rodar no computador

```bash
npm install
npm run db:migrate:local
npm run dev
```

Para testar a assinatura no computador, crie um arquivo `.dev.vars` (não vai para o Git) com
`CHAVE_CERTIFICADO="um-texto-longo-e-aleatorio"`.

A IA só funciona conectada à conta Cloudflare. Para testar sem login, rode `SEM_IA=1 npm run dev`
(tudo funciona, menos o botão "Analisar com IA").

Abra http://localhost:5173.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Roda localmente com banco de teste |
| `npm run build` | Confere os tipos e gera a versão de produção |
| `npm run db:migrate:local` | Aplica as migrações no banco local |
| `npm run db:migrate:remote` | Aplica as migrações no banco da Cloudflare |
| `npm run deploy` | Build + migrações + publicação (pelo seu computador) |
| `ESTADO=/pasta npm run dev` | Roda com um banco local separado (para testar do zero) |
| `npm run cf-typegen` | Regenera os tipos depois de mudar o `wrangler.jsonc` |
