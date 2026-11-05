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

## Publicar na Cloudflare

1. **Criar o banco D1:** no painel da Cloudflare, vá em *Storage & Databases → D1 → Create*,
   com o nome `montzionlic-db`. Copie o **Database ID** e cole em `wrangler.jsonc`
   no campo `database_id`.
2. **Nome do Worker:** o campo `name` em `wrangler.jsonc` precisa ser igual ao nome do Worker
   criado no painel (hoje está `montzionlic`).
3. **Conectar o GitHub:** no Worker, vá em *Settings → Build → Connect* e escolha este repositório.
   - Build command: `npm run build`
   - Deploy command: `npm run deploy:ci` (aplica as migrações do banco e publica)
4. **Domínio:** no Worker, *Settings → Domains & Routes → Add → Custom domain*.
5. **Logo após o primeiro deploy**, abra o site e crie o administrador na tela de primeiro acesso.

A partir daí, cada push na branch de produção publica sozinho.

## Rodar no computador

```bash
npm install
npm run db:migrate:local
npm run dev
```

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
