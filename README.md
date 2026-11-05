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

**Seção 2 — Pós-ganho**
- Ao mover uma licitação para **Ganhas**, o card aparece sozinho no quadro de **Empenhos e entregas**,
  já com os itens e o produto mais barato cotado.
- Etapas: Aguardando empenho → Empenho recebido → Material comprado → Aguardando entrega →
  Entrega realizada → Solicitar atestado → Concluído.
- Prazo de entrega calculado em dias corridos ou úteis; itens ganhos com lucro; dados de faturamento;
  arquivos e leitura do empenho pela IA.
- **Atas vigentes** com vigência, alerta de vencimento, prazo e produtos registrados.

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
6. **Domínio:** no Worker, *Settings → Domains & Routes → Add → Custom domain*.
7. **Logo após o primeiro deploy**, abra o site e crie o administrador na tela de primeiro acesso.

A partir daí, cada push na branch de produção publica sozinho.

## Rodar no computador

```bash
npm install
npm run db:migrate:local
npm run dev
```

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
| `npm run cf-typegen` | Regenera os tipos depois de mudar o `wrangler.jsonc` |
