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

- **Menu horizontal (balão no topo):** escolhe a área — Visão geral, Licitações, Pós-ganho, Documentação.
- **Menu lateral (cápsula):** as funções da área escolhida. No celular, vira uma cápsula fixa embaixo.
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
- Etapas: Aguardando empenho → Empenho recebido → Material comprado → Aguardando entrega →
  Entrega realizada → Solicitar atestado → Concluído.
- Prazo de entrega calculado em dias corridos ou úteis; itens ganhos com lucro; dados de faturamento;
  arquivos e leitura do empenho pela IA.
- **Atas vigentes** com vigência, alerta de vencimento, prazo e produtos registrados.
- **Saldo das atas automático:** no empenho, escolha a ata e o item da ata; o saldo é descontado
  sozinho e o sistema não deixa empenhar acima do saldo. Alerta quando o saldo passa de 80% do registrado.

**Documentação e relatórios**
- **Documentos da empresa:** certidões, contrato social, balanço, atestados — com validade, arquivo e
  alerta antes de vencer (antecedência em Configurações → Alertas).
- **Relatórios:** taxa de sucesso, resultados por mês, motivos de perda, concorrentes que mais ganham,
  desempenho por órgão, nicho e modalidade, empenhado e lucro no período; exportação em CSV.

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
