import { Hono } from "hono";
import { CATEGORIAS_DOCUMENTO } from "../../shared/negocio";
import { type Ambiente, exigirLogin, exigirModulo } from "../auth";
import { buscar } from "../banco";
import { idDaRota, texto } from "../validacao";

// Cofre de documentos da empresa (certidões, contrato social, atestados...).
export const rotasDocumentos = new Hono<Ambiente>();
rotasDocumentos.use(exigirLogin, exigirModulo("documentacao"));

const TAMANHO_MAXIMO = 30 * 1024 * 1024;
const VISUALIZAVEIS = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const DATA = /^\d{4}-\d{2}-\d{2}$/;

interface LinhaDocumento {
  id: number;
  arquivo_chave: string | null;
  arquivo_nome: string | null;
  arquivo_tipo: string | null;
}

rotasDocumentos.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.empresa_id, d.nome, d.categoria, d.emissao, d.validade, d.observacoes, d.arquivo_nome, d.arquivo_tipo,
            d.arquivo_tamanho, d.atualizado_em, u.nome AS atualizado_por_nome
       FROM documentos d LEFT JOIN usuarios u ON u.id = d.atualizado_por
      ORDER BY d.validade IS NULL, d.validade, d.nome COLLATE NOCASE`,
  ).all();
  return c.json({ documentos: results });
});

/** Lê os campos do formulário (multipart). Devolve erro em texto se algo estiver inválido. */
function lerFormulario(form: FormData) {
  const nome = texto(form.get("nome"));
  const categoria = String(form.get("categoria") ?? "Outro");
  const emissao = String(form.get("emissao") ?? "");
  const validade = String(form.get("validade") ?? "");
  const observacoes = texto(form.get("observacoes")).slice(0, 2000) || null;
  const empresaBruta = String(form.get("empresa_id") ?? "");
  const empresaId = empresaBruta ? Number(empresaBruta) : null;
  if (empresaId !== null && (!Number.isInteger(empresaId) || empresaId <= 0)) return { erro: "Empresa inválida." };
  if (!nome) return { erro: "Informe o nome do documento." };
  if (!CATEGORIAS_DOCUMENTO.includes(categoria)) return { erro: "Categoria inválida." };
  if (emissao && !DATA.test(emissao)) return { erro: "Data de emissão inválida." };
  if (validade && !DATA.test(validade)) return { erro: "Data de validade inválida." };
  return { nome: nome.slice(0, 200), categoria, emissao: emissao || null, validade: validade || null, observacoes, empresaId };
}

async function guardarArquivo(env: Env, form: FormData) {
  const arquivo = form.get("arquivo");
  if (!arquivo || typeof arquivo === "string" || arquivo.size === 0) return null;
  if (arquivo.size > TAMANHO_MAXIMO) throw new Error("O arquivo passa de 30 MB.");
  const tipo = arquivo.type || "application/octet-stream";
  const chave = `documentos/${crypto.randomUUID()}`;
  await env.ARQUIVOS.put(chave, arquivo.stream(), { httpMetadata: { contentType: tipo } });
  return { chave, nome: arquivo.name.slice(0, 250), tipo, tamanho: arquivo.size };
}

rotasDocumentos.post("/", async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ erro: "Envio inválido." }, 400);
  const dados = lerFormulario(form);
  if ("erro" in dados) return c.json(dados, 400);
  let arquivo;
  try {
    arquivo = await guardarArquivo(c.env, form);
  } catch (err) {
    return c.json({ erro: (err as Error).message }, 400);
  }
  const documento = await c.env.DB.prepare(
    `INSERT INTO documentos (empresa_id, nome, categoria, emissao, validade, observacoes, arquivo_chave, arquivo_nome, arquivo_tipo, arquivo_tamanho, atualizado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(dados.empresaId, dados.nome, dados.categoria, dados.emissao, dados.validade, dados.observacoes, arquivo?.chave ?? null, arquivo?.nome ?? null, arquivo?.tipo ?? null, arquivo?.tamanho ?? null, c.get("usuario").id)
    .first();
  return c.json({ documento }, 201);
});

// Atualiza os dados e, se vier um arquivo novo, substitui o anterior (ex.: certidão renovada).
rotasDocumentos.post("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Documento inválido." }, 400);
  const atual = await buscar<LinhaDocumento>(c.env.DB, "documentos", id);
  if (!atual) return c.json({ erro: "Documento não encontrado." }, 404);
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ erro: "Envio inválido." }, 400);
  const dados = lerFormulario(form);
  if ("erro" in dados) return c.json(dados, 400);
  let arquivo;
  try {
    arquivo = await guardarArquivo(c.env, form);
  } catch (err) {
    return c.json({ erro: (err as Error).message }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE documentos SET empresa_id = ?, nome = ?, categoria = ?, emissao = ?, validade = ?, observacoes = ?,
            arquivo_chave = COALESCE(?, arquivo_chave), arquivo_nome = COALESCE(?, arquivo_nome),
            arquivo_tipo = COALESCE(?, arquivo_tipo), arquivo_tamanho = COALESCE(?, arquivo_tamanho),
            atualizado_por = ?, atualizado_em = datetime('now')
      WHERE id = ?`,
  )
    .bind(dados.empresaId, dados.nome, dados.categoria, dados.emissao, dados.validade, dados.observacoes, arquivo?.chave ?? null, arquivo?.nome ?? null, arquivo?.tipo ?? null, arquivo?.tamanho ?? null, c.get("usuario").id, id)
    .run();
  if (arquivo && atual.arquivo_chave) await c.env.ARQUIVOS.delete(atual.arquivo_chave);
  return c.json({ ok: true });
});

rotasDocumentos.get("/:id/arquivo", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Documento inválido." }, 400);
  const doc = await buscar<LinhaDocumento>(c.env.DB, "documentos", id);
  if (!doc?.arquivo_chave) return c.json({ erro: "Sem arquivo." }, 404);
  const objeto = await c.env.ARQUIVOS.get(doc.arquivo_chave);
  if (!objeto) return c.json({ erro: "Arquivo não encontrado." }, 404);
  const tipo = doc.arquivo_tipo ?? "application/octet-stream";
  const inline = VISUALIZAVEIS.has(tipo) && c.req.query("baixar") !== "1";
  return new Response(objeto.body, {
    headers: {
      "Content-Type": inline ? tipo : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.arquivo_nome ?? "documento")}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
});

rotasDocumentos.delete("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Documento inválido." }, 400);
  const doc = await buscar<LinhaDocumento>(c.env.DB, "documentos", id);
  if (!doc) return c.json({ erro: "Documento não encontrado." }, 404);
  if (doc.arquivo_chave) await c.env.ARQUIVOS.delete(doc.arquivo_chave);
  await c.env.DB.prepare("DELETE FROM documentos WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
