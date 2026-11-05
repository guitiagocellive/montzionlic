import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { Ambiente } from "./auth";
import { rotasAuth } from "./rotas/auth";
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

app.notFound((c) => c.json({ erro: "Rota não encontrada." }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ erro: "Requisição bloqueada." }, err.status);
  }
  console.error(err);
  return c.json({ erro: "Erro interno. Tente novamente." }, 500);
});

export default app;
