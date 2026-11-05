import { Hono } from "hono";
import { type Ambiente, exigirAdmin, exigirLogin } from "../auth";
import { buscar, comandoAtualizar, inserir } from "../banco";
import { CAMPOS_ITEM, CAMPOS_MODELO } from "../../shared/proposta";
import { type Esquema, idDaRota, lerCampos, lerJson, temErro, texto } from "../validacao";

// Contas bancárias e modelos de proposta (Configurações). Todos leem; só admin altera.
export const rotasPropostas = new Hono<Ambiente>();
rotasPropostas.use(exigirLogin);

const ESQUEMA_CONTA: Esquema = {
  apelido: "texto",
  banco: "texto",
  codigo_banco: "texto",
  agencia: "texto",
  conta: "texto",
  tipo: "texto",
  pix: "texto",
  titular: "texto",
  padrao: "bool",
};

rotasPropostas.get("/campos", (c) => c.json({ campos: CAMPOS_MODELO, camposItem: CAMPOS_ITEM }));

rotasPropostas.get("/contas", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM contas_bancarias ORDER BY padrao DESC, apelido COLLATE NOCASE").all();
  return c.json({ contas: results });
});

async function marcarUnicaPadrao(db: D1Database, tabela: string, id: number, padrao: unknown) {
  if (padrao === true || padrao === 1) {
    await db.prepare(`UPDATE ${tabela} SET padrao = CASE WHEN id = ? THEN 1 ELSE 0 END`).bind(id).run();
  }
}

rotasPropostas.post("/contas", exigirAdmin, async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const campos = lerCampos(corpo, ESQUEMA_CONTA);
  if (temErro(campos)) return c.json(campos, 400);
  if (!texto(corpo.apelido) || !texto(corpo.banco)) return c.json({ erro: "Informe o apelido e o banco." }, 400);
  const conta = await inserir<{ id: number }>(c.env.DB, "contas_bancarias", campos);
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM contas_bancarias").first<{ n: number }>();
  await marcarUnicaPadrao(c.env.DB, "contas_bancarias", conta.id, total?.n === 1 ? true : corpo.padrao);
  return c.json({ conta }, 201);
});

rotasPropostas.patch("/contas/:id", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Conta inválida." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const campos = lerCampos(corpo, ESQUEMA_CONTA);
  if (temErro(campos)) return c.json(campos, 400);
  const comando = comandoAtualizar(c.env.DB, "contas_bancarias", id, campos, false);
  if (comando) await comando.run();
  await marcarUnicaPadrao(c.env.DB, "contas_bancarias", id, corpo.padrao);
  return c.json({ conta: await buscar(c.env.DB, "contas_bancarias", id) });
});

rotasPropostas.delete("/contas/:id", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Conta inválida." }, 400);
  await c.env.DB.prepare("DELETE FROM contas_bancarias WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ---------- Modelos (.docx) ----------

rotasPropostas.get("/modelos", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, nome, arquivo_nome, tamanho, padrao, criado_em FROM modelos_proposta ORDER BY padrao DESC, nome COLLATE NOCASE",
  ).all();
  return c.json({ modelos: results });
});

rotasPropostas.post("/modelos", exigirAdmin, async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ erro: "Envio inválido." }, 400);
  const arquivo = form.get("arquivo");
  if (!arquivo || typeof arquivo === "string") return c.json({ erro: "Escolha o arquivo do modelo (.docx)." }, 400);
  if (!/\.docx$/i.test(arquivo.name)) return c.json({ erro: "O modelo precisa ser um arquivo do Word (.docx)." }, 400);
  if (arquivo.size > 10 * 1024 * 1024) return c.json({ erro: "O modelo passa de 10 MB." }, 400);
  const dados = await arquivo.arrayBuffer();
  // O conteúdo (campos entre chaves) é conferido no navegador; aqui só se confere que é um .docx (zip).
  const inicio = new Uint8Array(dados, 0, Math.min(4, dados.byteLength));
  if (inicio[0] !== 0x50 || inicio[1] !== 0x4b || inicio[2] !== 0x03 || inicio[3] !== 0x04) {
    return c.json({ erro: "O arquivo não parece ser um documento do Word (.docx)." }, 400);
  }

  const nome = texto(form.get("nome")).slice(0, 120) || arquivo.name.replace(/\.docx$/i, "");
  const chave = `modelos/${crypto.randomUUID()}.docx`;
  await c.env.ARQUIVOS.put(chave, dados, {
    httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  });
  const modelo = await c.env.DB.prepare(
    "INSERT INTO modelos_proposta (nome, chave, arquivo_nome, tamanho, enviado_por) VALUES (?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(nome, chave, arquivo.name.slice(0, 200), arquivo.size, c.get("usuario").id)
    .first<{ id: number }>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM modelos_proposta").first<{ n: number }>();
  if (total?.n === 1) await marcarUnicaPadrao(c.env.DB, "modelos_proposta", modelo!.id, true);
  return c.json({ modelo }, 201);
});

rotasPropostas.patch("/modelos/:id", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Modelo inválido." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  if (corpo.nome !== undefined) {
    const nome = texto(corpo.nome).slice(0, 120);
    if (!nome) return c.json({ erro: "Informe o nome." }, 400);
    await c.env.DB.prepare("UPDATE modelos_proposta SET nome = ? WHERE id = ?").bind(nome, id).run();
  }
  await marcarUnicaPadrao(c.env.DB, "modelos_proposta", id, corpo.padrao);
  return c.json({ ok: true });
});

rotasPropostas.get("/modelos/:id/arquivo", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Modelo inválido." }, 400);
  const modelo = await buscar<{ chave: string; arquivo_nome: string }>(c.env.DB, "modelos_proposta", id);
  if (!modelo) return c.json({ erro: "Modelo não encontrado." }, 404);
  const objeto = await c.env.ARQUIVOS.get(modelo.chave);
  if (!objeto) return c.json({ erro: "Arquivo do modelo não encontrado." }, 404);
  return new Response(objeto.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(modelo.arquivo_nome)}`,
    },
  });
});

rotasPropostas.delete("/modelos/:id", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Modelo inválido." }, 400);
  const modelo = await buscar<{ chave: string }>(c.env.DB, "modelos_proposta", id);
  if (!modelo) return c.json({ erro: "Modelo não encontrado." }, 404);
  await c.env.ARQUIVOS.delete(modelo.chave);
  await c.env.DB.prepare("DELETE FROM modelos_proposta WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
