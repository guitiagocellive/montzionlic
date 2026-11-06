import { Hono } from "hono";
import { type Ambiente, exigirAdmin, exigirLogin } from "../auth";
import { buscar, comandoAtualizar, inserir } from "../banco";
import { type Esquema, idDaRota, lerCampos, lerJson, temErro, texto } from "../validacao";
import { marcarUnicaPadrao } from "./propostas";
import { CORES_PDF, MODELOS_PDF } from "../../shared/proposta";

// Empresas que participam das licitações (cada proposta escolhe uma). Todos leem; só admin altera.
export const rotasEmpresas = new Hono<Ambiente>();
rotasEmpresas.use(exigirLogin);

const ESQUEMA_EMPRESA: Esquema = {
  nome: "texto",
  cnpj: "texto",
  ie: "texto",
  endereco: "texto",
  cidade: "texto",
  telefone: "texto",
  email: "texto",
  representante_nome: "texto",
  representante_cpf: "texto",
  representante_rg: "texto",
  representante_cargo: "texto",
  marca_dagua: "bool",
  modelo_pdf: MODELOS_PDF.map((m) => m.chave),
  cor_pdf: CORES_PDF.map((c) => c.cor),
  padrao: "bool",
};

const COLUNAS = `id, nome, cnpj, ie, endereco, cidade, telefone, email, representante_nome, representante_cpf,
  representante_rg, representante_cargo, marca_dagua, modelo_pdf, cor_pdf, padrao, (logo_chave IS NOT NULL) AS tem_logo`;

rotasEmpresas.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${COLUNAS} FROM empresas ORDER BY padrao DESC, nome COLLATE NOCASE`).all();
  return c.json({ empresas: results });
});

rotasEmpresas.post("/", exigirAdmin, async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  if (!texto(corpo.nome)) return c.json({ erro: "Informe a razão social." }, 400);
  const campos = lerCampos(corpo, ESQUEMA_EMPRESA);
  if (temErro(campos)) return c.json(campos, 400);
  const empresa = await inserir<{ id: number }>(c.env.DB, "empresas", campos);
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM empresas").first<{ n: number }>();
  await marcarUnicaPadrao(c.env.DB, "empresas", empresa.id, total?.n === 1 ? true : corpo.padrao);
  return c.json({ empresa: await c.env.DB.prepare(`SELECT ${COLUNAS} FROM empresas WHERE id = ?`).bind(empresa.id).first() }, 201);
});

rotasEmpresas.patch("/:id", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Empresa inválida." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  if (corpo.nome !== undefined && !texto(corpo.nome)) return c.json({ erro: "Informe a razão social." }, 400);
  const campos = lerCampos(corpo, ESQUEMA_EMPRESA);
  if (temErro(campos)) return c.json(campos, 400);
  const comando = comandoAtualizar(c.env.DB, "empresas", id, campos, false);
  if (comando) await comando.run();
  await marcarUnicaPadrao(c.env.DB, "empresas", id, corpo.padrao);
  return c.json({ empresa: await c.env.DB.prepare(`SELECT ${COLUNAS} FROM empresas WHERE id = ?`).bind(id).first() });
});

rotasEmpresas.delete("/:id", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Empresa inválida." }, 400);
  const empresa = await buscar<{ logo_chave: string | null }>(c.env.DB, "empresas", id);
  if (!empresa) return c.json({ erro: "Empresa não encontrada." }, 404);
  if (empresa.logo_chave) await c.env.ARQUIVOS.delete(empresa.logo_chave);
  await c.env.DB.prepare("DELETE FROM empresas WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ---------- Logo de cada empresa ----------

const TIPOS_LOGO = new Set(["image/png", "image/jpeg"]);

rotasEmpresas.get("/:id/logo", async (c) => {
  const id = idDaRota(c.req.param("id"));
  const empresa = id ? await buscar<{ logo_chave: string | null }>(c.env.DB, "empresas", id) : null;
  if (!empresa?.logo_chave) return c.json({ erro: "Sem logo." }, 404);
  const objeto = await c.env.ARQUIVOS.get(empresa.logo_chave);
  if (!objeto) return c.json({ erro: "Sem logo." }, 404);
  return new Response(objeto.body, {
    headers: { "Content-Type": objeto.httpMetadata?.contentType ?? "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300" },
  });
});

rotasEmpresas.post("/:id/logo", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  const empresa = id ? await buscar<{ logo_chave: string | null }>(c.env.DB, "empresas", id) : null;
  if (!id || !empresa) return c.json({ erro: "Empresa não encontrada." }, 404);
  const form = await c.req.formData().catch(() => null);
  const logo = form?.get("logo");
  if (!logo || typeof logo === "string") return c.json({ erro: "Escolha a imagem do logo." }, 400);
  if (!TIPOS_LOGO.has(logo.type)) return c.json({ erro: "Use uma imagem PNG ou JPG." }, 400);
  if (logo.size > 1.5 * 1024 * 1024) return c.json({ erro: "O logo passa de 1,5 MB." }, 400);
  const chave = `empresas/${id}/logo-${crypto.randomUUID()}`;
  await c.env.ARQUIVOS.put(chave, logo.stream(), { httpMetadata: { contentType: logo.type } });
  await c.env.DB.prepare("UPDATE empresas SET logo_chave = ? WHERE id = ?").bind(chave, id).run();
  if (empresa.logo_chave) await c.env.ARQUIVOS.delete(empresa.logo_chave);
  return c.json({ ok: true });
});

rotasEmpresas.delete("/:id/logo", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  const empresa = id ? await buscar<{ logo_chave: string | null }>(c.env.DB, "empresas", id) : null;
  if (!id || !empresa) return c.json({ erro: "Empresa não encontrada." }, 404);
  if (empresa.logo_chave) await c.env.ARQUIVOS.delete(empresa.logo_chave);
  await c.env.DB.prepare("UPDATE empresas SET logo_chave = NULL WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
