import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { Ambiente } from "./auth";
import { rotasArquivos } from "./rotas/arquivos";
import { rotasAtas } from "./rotas/atas";
import { rotasAuth } from "./rotas/auth";
import { rotasExecucoes } from "./rotas/execucoes";
import { rotasFornecedores } from "./rotas/fornecedores";
import { rotasLicitacoes } from "./rotas/licitacoes";
import { rotasPainel } from "./rotas/painel";
import { rotasUsuarios } from "./rotas/usuarios";

const app = new Hono<Ambiente>().basePath("/api");

app.use(secureHeaders());
// Bloqueia envios de formulário vindos de outros sites.
app.use(csrf());
app.use(async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

app.route("/auth", rotasAuth);
app.route("/usuarios", rotasUsuarios);
app.route("/licitacoes", rotasLicitacoes);
app.route("/execucoes", rotasExecucoes);
app.route("/atas", rotasAtas);
app.route("/fornecedores", rotasFornecedores);
app.route("/arquivos", rotasArquivos);
app.route("/", rotasPainel);

app.notFound((c) => c.json({ erro: "Rota não encontrada." }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ erro: "Requisição bloqueada." }, err.status);
  }
  console.error(err);
  return c.json({ erro: "Erro interno. Tente novamente." }, 500);
});

export default app;
