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
- **Empresa e margens** (admin): margem de lucro e impostos padrão das licitações novas.
- **Alertas** (admin): com quantos dias de antecedência avisar sessões, entregas e atas.
- **Propostas** (admin): modelos do Word, contas bancárias, logo e declaração da proposta em PDF.
- **Certificado digital** (admin): cadastro do certificado A1 (.pfx/.p12 + senha), validade e troca.
  A senha não fica guardada; a chave fica criptografada com o segredo `CHAVE_CERTIFICADO` do Worker.
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

- **Proposta comercial:** gera a proposta em Word a partir dos **seus modelos** (.docx) — escolha o modelo,
  o banco para pagamento e a validade; órgão, itens, preços, total por extenso e dados da empresa entram
  sozinhos. Campos no Word entre chaves, ex.: `{orgao}`; tabela de itens com `{#itens}` … `{/itens}`.
  Modelo de exemplo em `public/modelos/modelo-proposta.docx`.
- **Proposta em PDF e assinatura digital:** a própria plataforma monta a proposta em PDF (com logo, itens, total
  por extenso, condições e declaração) e, se quiser, já sai **assinada com o certificado A1 da empresa**
  (padrão ICP-Brasil/PAdES, conferível em validar.iti.gov.br). O PDF ganha um carimbo "Assinado digitalmente" e,
  na plataforma, o arquivo aparece com o selo. PDFs já enviados também podem ser assinados na aba Arquivos.
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

1. **Criar o banco D1:** no painel da Cloudflare, vá em *Storage & Databases → D1 → Create*,
   com o nome `montzionlic-db`. Copie o **Database ID** e cole em `wrangler.jsonc`
   no campo `database_id`.
2. **Nome do Worker:** o campo `name` em `wrangler.jsonc` precisa ser igual ao nome do Worker
   criado no painel (hoje está `montzionlic`).
3. **Criar o armazenamento de arquivos (R2):** no painel, vá em *R2 Object Storage → Create bucket*,
   com o nome `montzionlic-arquivos`. (O R2 tem plano grátis, mas a Cloudflare pede um cartão para ativar.)
4. **IA:** não precisa criar nada — a IA (Workers AI) já vem com a conta.
5. **Conectar o GitHub:** no Worker, vá em *Settings → Build → Connect* e escolha este repositório.
   - Build command: `npm run build`
   - Deploy command: `npm run deploy:ci` (aplica as migrações do banco e publica)
6. **Ativar a assinatura digital:** no Worker, vá em *Settings → Variables and Secrets → Add*,
   escolha o tipo **Secret**, nome `CHAVE_CERTIFICADO` e, como valor, um texto longo e aleatório
   (por exemplo, gere com `openssl rand -base64 32`). Guarde esse valor só lá: se ele mudar, é preciso
   cadastrar o certificado de novo. Depois, cadastre o certificado em *Configurações → Certificado digital*.
7. **Plano do Worker:** recomendo o **Workers Paid** (US$ 5/mês). O plano grátis limita cada requisição a
   10 ms de processamento, e gerar Word/PDF ou assinar leva de 50 a 100 ms — no grátis essas ações podem falhar.
8. **Domínio:** no Worker, *Settings → Domains & Routes → Add → Custom domain*.
9. **Logo após o primeiro deploy**, abra o site e crie o administrador na tela de primeiro acesso.

A partir daí, cada push na branch de produção publica sozinho.

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
