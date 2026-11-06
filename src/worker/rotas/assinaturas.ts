import { Hono } from "hono";
import { podeEditar, podeVer } from "../../shared/permissoes";
import { type Ambiente, exigirLogin, exigirModulo } from "../auth";
import { comandoUsarPedidoAvulso, pedidoValido } from "../pedidosAssinatura";
import { idDaRota } from "../validacao";

// Página "Assinar documentos": PDFs assinados com o certificado da empresa fora das licitações.
// O PDF é preparado e assinado no navegador; aqui só guarda (com o pedido de assinatura de uso único).
export const rotasAssinaturas = new Hono<Ambiente>();
rotasAssinaturas.use(exigirLogin, exigirModulo("assinatura"));

const TAMANHO_MAXIMO = 50 * 1024 * 1024;

rotasAssinaturas.get("/", async (c) => {
  const usuario = c.get("usuario");
  const { results: avulsos } = await c.env.DB.prepare(
    `SELECT a.id, a.nome, a.tamanho, a.titular, a.assinado_em, u.nome AS assinado_por_nome
       FROM assinaturas_avulsas a LEFT JOIN usuarios u ON u.id = a.assinado_por
      ORDER BY a.assinado_em DESC LIMIT 200`,
  ).all();
  // Também mostra o que foi assinado dentro das licitações e dos empenhos (o que a pessoa pode ver).
  const filtros: string[] = [];
  if (podeVer(usuario.permissoes, "licitacoes")) filtros.push("ar.licitacao_id IS NOT NULL");
  if (podeVer(usuario.permissoes, "posganho")) filtros.push("ar.execucao_id IS NOT NULL");
  const { results: nasLicitacoes } = filtros.length
    ? await c.env.DB.prepare(
        `SELECT ar.id, ar.nome, ar.tamanho, ar.assinatura_titular AS titular, ar.assinado_em, ar.categoria,
                ar.licitacao_id, ar.execucao_id, u.nome AS assinado_por_nome,
                l.numero AS licitacao_numero, l.orgao AS licitacao_orgao, e.numero_empenho
           FROM arquivos ar
           LEFT JOIN usuarios u ON u.id = ar.assinado_por
           LEFT JOIN licitacoes l ON l.id = ar.licitacao_id
           LEFT JOIN execucoes e ON e.id = ar.execucao_id
          WHERE ar.assinado_em IS NOT NULL AND (${filtros.join(" OR ")})
          ORDER BY ar.assinado_em DESC LIMIT 50`,
      ).all()
    : { results: [] };
  return c.json({ avulsos, nas_licitacoes: nasLicitacoes });
});

rotasAssinaturas.post("/", async (c) => {
  const usuario = c.get("usuario");
  if (!podeEditar(usuario.permissoes, "assinatura")) return c.json({ erro: "Você não tem permissão para assinar documentos." }, 403);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ erro: "Envio inválido." }, 400);
  }
  const arquivo = form.get("arquivo");
  if (!arquivo || typeof arquivo === "string" || arquivo.size === 0) return c.json({ erro: "Envie o PDF assinado." }, 400);
  if (arquivo.size > TAMANHO_MAXIMO) return c.json({ erro: "O arquivo passa de 50 MB." }, 400);
  if (arquivo.type !== "application/pdf") return c.json({ erro: "Só PDFs podem ser assinados." }, 400);
  const pedido = String(form.get("pedido_assinatura") ?? "");
  const titular = await pedidoValido(c.env.DB, pedido, usuario.id);
  if (!titular) return c.json({ erro: "Assinatura expirada ou inválida. Assine de novo." }, 400);

  const nome = (String(form.get("nome") ?? "") || arquivo.name).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 200) || "documento.pdf";
  const chave = `assinados/${crypto.randomUUID()}.pdf`;
  await c.env.ARQUIVOS.put(chave, arquivo.stream(), { httpMetadata: { contentType: "application/pdf" } });
  const registro = await c.env.DB.prepare(
    `INSERT INTO assinaturas_avulsas (chave, nome, tamanho, titular, assinado_por, assinado_em)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id, nome, tamanho, titular, assinado_em`,
  )
    .bind(chave, /\.pdf$/i.test(nome) ? nome : `${nome}.pdf`, arquivo.size, titular, usuario.id, Date.now())
    .first<{ id: number }>();
  if (registro) await comandoUsarPedidoAvulso(c.env.DB, pedido, registro.id).run();
  return c.json({ documento: registro }, 201);
});

rotasAssinaturas.get("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Documento inválido." }, 400);
  const doc = await c.env.DB.prepare("SELECT chave, nome FROM assinaturas_avulsas WHERE id = ?").bind(id).first<{ chave: string; nome: string }>();
  if (!doc) return c.json({ erro: "Documento não encontrado." }, 404);
  const objeto = await c.env.ARQUIVOS.get(doc.chave);
  if (!objeto) return c.json({ erro: "Documento não encontrado no armazenamento." }, 404);
  const baixar = c.req.query("baixar") === "1";
  return new Response(objeto.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${baixar ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(doc.nome)}`,
      "Content-Length": String(objeto.size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
});

rotasAssinaturas.delete("/:id", async (c) => {
  if (!podeEditar(c.get("usuario").permissoes, "assinatura")) return c.json({ erro: "Sem permissão." }, 403);
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Documento inválido." }, 400);
  const doc = await c.env.DB.prepare("SELECT chave FROM assinaturas_avulsas WHERE id = ?").bind(id).first<{ chave: string }>();
  if (!doc) return c.json({ erro: "Documento não encontrado." }, 404);
  await c.env.DB.prepare("DELETE FROM assinaturas_avulsas WHERE id = ?").bind(id).run();
  await c.env.ARQUIVOS.delete(doc.chave);
  return c.json({ ok: true });
});
