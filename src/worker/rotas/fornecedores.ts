import { Hono } from "hono";
import { type Ambiente, exigirAdmin, exigirLogin } from "../auth";
import { buscar, comandoAtualizar, inserir } from "../banco";
import { type Esquema, idDaRota, lerCampos, lerJson, temErro } from "../validacao";

export const rotasFornecedores = new Hono<Ambiente>();
rotasFornecedores.use(exigirLogin);

const ESQUEMA: Esquema = {
  nome: "texto",
  nicho: "texto",
  vendedor: "texto",
  telefone: "texto",
  email: "texto",
  site: "texto",
  catalogo: "texto",
  cnpj: "texto",
  cidade: "texto",
  uf: "texto",
  observacoes: "textoLongo",
};

rotasFornecedores.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT f.*, (SELECT COUNT(*) FROM cotacoes c WHERE c.fornecedor_id = f.id) AS total_cotacoes
       FROM fornecedores f ORDER BY f.nome COLLATE NOCASE`,
  ).all();
  return c.json({ fornecedores: results });
});

rotasFornecedores.post("/", async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const campos = lerCampos(corpo, ESQUEMA);
  if (temErro(campos)) return c.json(campos, 400);
  if (!campos.valores[campos.colunas.indexOf("nome")]) {
    return c.json({ erro: "Informe o nome do fornecedor." }, 400);
  }
  return c.json({ fornecedor: await inserir(c.env.DB, "fornecedores", campos) }, 201);
});

rotasFornecedores.patch("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Fornecedor inválido." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const campos = lerCampos(corpo, ESQUEMA);
  if (temErro(campos)) return c.json(campos, 400);
  const i = campos.colunas.indexOf("nome");
  if (i >= 0 && !campos.valores[i]) return c.json({ erro: "Informe o nome do fornecedor." }, 400);
  const comando = comandoAtualizar(c.env.DB, "fornecedores", id, campos);
  if (!comando) return c.json({ erro: "Nada para alterar." }, 400);
  await comando.run();
  return c.json({ fornecedor: await buscar(c.env.DB, "fornecedores", id) });
});

rotasFornecedores.delete("/:id", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Fornecedor inválido." }, 400);
  await c.env.DB.prepare("DELETE FROM fornecedores WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
