import { Hono } from "hono";
import { type Ambiente, CAMPOS_USUARIO, exigirLogin, type LinhaUsuario, paraUsuario } from "../auth";
import { idDaRota, lerJson, texto } from "../validacao";

// Perfil da própria pessoa: nome, cargo, cor, tema e foto.
export const rotasConta = new Hono<Ambiente>();
rotasConta.use(exigirLogin);

const TEMAS = ["claro", "escuro", "sistema"];
const COR = /^#[0-9a-f]{6}$/i;
const TIPOS_FOTO = new Set(["image/png", "image/jpeg", "image/webp"]);

async function usuarioAtual(db: D1Database, id: number) {
  const linha = await db.prepare(`SELECT ${CAMPOS_USUARIO} FROM usuarios WHERE id = ?`).bind(id).first<LinhaUsuario>();
  return paraUsuario(linha!);
}

rotasConta.patch("/perfil", async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const sets: string[] = [];
  const valores: unknown[] = [];

  if (corpo.nome !== undefined) {
    const nome = texto(corpo.nome);
    if (!nome || nome.length > 120) return c.json({ erro: "Informe seu nome." }, 400);
    sets.push("nome = ?");
    valores.push(nome);
  }
  if (corpo.cargo !== undefined) {
    const cargo = texto(corpo.cargo);
    if (cargo.length > 80) return c.json({ erro: "Cargo longo demais." }, 400);
    sets.push("cargo = ?");
    valores.push(cargo || null);
  }
  if (corpo.cor !== undefined) {
    if (typeof corpo.cor !== "string" || !COR.test(corpo.cor)) return c.json({ erro: "Cor inválida." }, 400);
    sets.push("cor = ?");
    valores.push(corpo.cor.toLowerCase());
  }
  if (corpo.tema !== undefined) {
    if (!TEMAS.includes(corpo.tema as string)) return c.json({ erro: "Tema inválido." }, 400);
    sets.push("tema = ?");
    valores.push(corpo.tema);
  }
  if (sets.length === 0) return c.json({ erro: "Nada para alterar." }, 400);

  const id = c.get("usuario").id;
  await c.env.DB.prepare(`UPDATE usuarios SET ${sets.join(", ")}, atualizado_em = datetime('now') WHERE id = ?`)
    .bind(...valores, id)
    .run();
  return c.json({ usuario: await usuarioAtual(c.env.DB, id) });
});

// Foto de perfil (PNG, JPG ou WEBP até 3 MB).
rotasConta.post("/foto", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ erro: "Envio inválido." }, 400);
  }
  const foto = form.get("foto");
  if (!foto || typeof foto === "string") return c.json({ erro: "Escolha uma imagem." }, 400);
  if (!TIPOS_FOTO.has(foto.type)) return c.json({ erro: "Use uma imagem PNG, JPG ou WEBP." }, 400);
  if (foto.size > 3 * 1024 * 1024) return c.json({ erro: "A imagem passa de 3 MB." }, 400);

  const usuario = c.get("usuario");
  const anterior = await c.env.DB.prepare("SELECT foto_chave FROM usuarios WHERE id = ?")
    .bind(usuario.id)
    .first<{ foto_chave: string | null }>();
  const chave = `fotos/${usuario.id}-${crypto.randomUUID()}`;
  await c.env.ARQUIVOS.put(chave, foto.stream(), { httpMetadata: { contentType: foto.type } });
  await c.env.DB.prepare("UPDATE usuarios SET foto_chave = ? WHERE id = ?").bind(chave, usuario.id).run();
  if (anterior?.foto_chave) await c.env.ARQUIVOS.delete(anterior.foto_chave);
  return c.json({ usuario: await usuarioAtual(c.env.DB, usuario.id) });
});

rotasConta.delete("/foto", async (c) => {
  const usuario = c.get("usuario");
  const anterior = await c.env.DB.prepare("SELECT foto_chave FROM usuarios WHERE id = ?")
    .bind(usuario.id)
    .first<{ foto_chave: string | null }>();
  if (anterior?.foto_chave) await c.env.ARQUIVOS.delete(anterior.foto_chave);
  await c.env.DB.prepare("UPDATE usuarios SET foto_chave = NULL WHERE id = ?").bind(usuario.id).run();
  return c.json({ usuario: await usuarioAtual(c.env.DB, usuario.id) });
});

// Fotos de qualquer pessoa do time (para avatares).
export const rotasFotos = new Hono<Ambiente>();
rotasFotos.use(exigirLogin);
rotasFotos.get("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Usuário inválido." }, 400);
  const linha = await c.env.DB.prepare("SELECT foto_chave FROM usuarios WHERE id = ?")
    .bind(id)
    .first<{ foto_chave: string | null }>();
  if (!linha?.foto_chave) return c.json({ erro: "Sem foto." }, 404);
  const objeto = await c.env.ARQUIVOS.get(linha.foto_chave);
  if (!objeto) return c.json({ erro: "Sem foto." }, 404);
  const tipo = objeto.httpMetadata?.contentType ?? "image/jpeg";
  return new Response(objeto.body, {
    headers: {
      "Content-Type": TIPOS_FOTO.has(tipo) ? tipo : "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
});
