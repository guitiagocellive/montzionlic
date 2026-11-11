import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { Ambiente } from "./auth";
import { rotasArquivos } from "./rotas/arquivos";
import { rotasAssinaturas } from "./rotas/assinaturas";
import { rotasAtas } from "./rotas/atas";
import { gerarNotificacoes } from "./notificacoes";
import { rotasAtividades } from "./rotas/atividades";
import { rotasAuth } from "./rotas/auth";
import { rotasDocumentos } from "./rotas/documentos";
import { rotasPropostas } from "./rotas/propostas";
import { rotasRelatorios } from "./rotas/relatorios";
import { rotasCertificado } from "./rotas/certificado";
import { rotasEmpresas } from "./rotas/empresas";
import { rotasFinanceiro } from "./rotas/financeiro";
import { rotasConfiguracoes } from "./rotas/configuracoes";
import { rotasConta, rotasFotos } from "./rotas/conta";
import { rotasConvitePublico, rotasConvites } from "./rotas/convites";
import { rotasNotificacoes } from "./rotas/notificacoes";
import { rotasExecucoes } from "./rotas/execucoes";
import { rotasFornecedores } from "./rotas/fornecedores";
import { rotasLicitacoes } from "./rotas/licitacoes";
import { rotasPainel } from "./rotas/painel";
import { rotasPncp } from "./rotas/pncp";
import { rotasRobo } from "./rotas/robo";
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
app.route("/conta", rotasConta);
app.route("/fotos", rotasFotos);
app.route("/configuracoes", rotasConfiguracoes);
app.route("/convites/publico", rotasConvitePublico);
app.route("/convites", rotasConvites);
app.route("/usuarios", rotasUsuarios);
app.route("/licitacoes", rotasLicitacoes);
app.route("/execucoes", rotasExecucoes);
app.route("/atas", rotasAtas);
app.route("/fornecedores", rotasFornecedores);
app.route("/arquivos", rotasArquivos);
app.route("/atividades", rotasAtividades);
app.route("/documentos", rotasDocumentos);
app.route("/propostas", rotasPropostas);
app.route("/relatorios", rotasRelatorios);
app.route("/certificado", rotasCertificado);
app.route("/empresas", rotasEmpresas);
app.route("/financeiro", rotasFinanceiro);
app.route("/pncp", rotasPncp);
app.route("/assinaturas", rotasAssinaturas);
app.route("/robo", rotasRobo);
app.route("/", rotasPainel);
app.route("/", rotasNotificacoes);

app.notFound((c) => c.json({ erro: "Rota não encontrada." }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ erro: "Requisição bloqueada." }, err.status);
  }
  console.error(err);
  return c.json({ erro: "Erro interno. Tente novamente." }, 500);
});

export default {
  fetch: app.fetch,
  // Roda de hora em hora (wrangler.jsonc → triggers) para gerar os avisos do sino.
  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(gerarNotificacoes(env.DB));
  },
} satisfies ExportedHandler<Env>;
