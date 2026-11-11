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
- **Proteção contra força bruta:** 5 senhas erradas seguidas bloqueiam o e-mail por 15 minutos.
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
- **Buscar licitações (PNCP):** Licitações → Buscar licitações. Pesquisa os editais do Portal Nacional de
  Contratações Públicas por palavra-chave, nº da licitação, **data da sessão** (hoje, amanhã, próximos 3/7/15/30 dias
  ou datas escolhidas), estado, modalidade e situação. Em "Mais filtros": **município** (lista do IBGE em
  `public/dados/municipios.json`, até 10 por busca), **UASG**, **órgão** (nome ou CNPJ), **registro de preço**, esfera
  e faixa de **valor estimado**. Na área principal também: **registro de preço** (só SRP / sem SRP) e **plataforma**
  da disputa (Compras.gov.br, Licitações-e, Portal de Compras Públicas, BNC, BLL, Licitanet…). Ordena por publicação,
  sessão mais próxima ou relevância.
  - **Clicar no card** abre a janela da licitação em etapas: **Dados** (sessão, valor de referência, registro de preço,
    modalidade, plataforma, UASG, objeto e mais informações), **Itens** e **Arquivos** (o arquivo ocupa a janela, com
    o edital já aberto). No card, "Ver itens" e "Ver arquivos" abrem direto na etapa. "Anterior/Próxima" (ou as setas
    do teclado) passam de uma licitação para outra mantendo a etapa.
  - **Adicionar ao quadro** primeiro pergunta de quais itens a empresa vai participar (procurar, selecionar todos,
    desmarcar todos) e só esses itens entram na licitação.
  - Cada resultado mostra sessão (com aviso de "hoje"/"amanhã"), UASG, valor estimado, SRP, modo de disputa e os links
    para o **PNCP** e para o **portal da disputa** (Compras.gov.br, BLL, BNC, Licitações-e, Portal de Compras
    Públicas…), direto na licitação quando o PNCP informa.
  - Prévia do PDF dentro da plataforma também no celular; .zip mostra o que tem dentro. A prévia dos arquivos na ficha
    da licitação usa o mesmo leitor.
  - O card é criado em "Para estudar" com os dados, os itens escolhidos e **todos os arquivos** anexados.
  - Filtros que o PNCP não faz (data da sessão, plataforma, UASG, CNPJ, nº, vários municípios) são aplicados aqui depois de
    baixar até 3.000 resultados por consulta; a tela avisa quando é preciso afinar a busca.
  - A pesquisa sai do navegador; só o download dos arquivos passa pelo servidor (`/api/pncp/arquivo`).
- **Robô de lances** (aba "Robô de lances" na licitação): valor mínimo por item (sugerido pelo orçamento com um
  lucro mínimo, com aviso quando fica abaixo do custo + impostos), quanto baixar a cada lance (R$ ou %) e lance
  fechado. Por padrão o robô espera os **30 segundos finais** do cronômetro e só então dá o menor lance que coloca a
  empresa em 1º; se não der sem passar do mínimo, dá o mínimo (melhor colocação possível). A opção "Não aguardar os
  segundos finais para enviar o lance" faz ele cobrir assim que perde o 1º lugar. A regra fica em
  `src/shared/robo.ts` e nunca envia abaixo do mínimo. O **simulador** testa tudo numa disputa de mentira (aberto com
  prorrogação de 2 min, hora fixa, aberto e fechado) e compara as estratégias. A ligação com o Compras.gov.br (pelo
  aplicativo do Windows) é a próxima fase.
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
atalhos na área de trabalho e no menu Iniciar, registra em "Aplicativos instalados" (para desinstalar) e abre
`https://montzion.com.br` numa janela própria (modo aplicativo do Edge ou Chrome). O instalador ainda não tem
assinatura digital de código, então o Windows mostra "O Windows protegeu o computador" na primeira vez
(Mais informações → Executar assim mesmo).

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
