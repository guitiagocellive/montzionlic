import { Hono } from "hono";
import { type Ambiente, exigirAdmin, exigirLogin } from "../auth";
import { buscar, comandoAtualizar, inserir } from "../banco";
import { type Esquema, idDaRota, lerCampos, lerJson, temErro } from "../validacao";

// Atas de registro de preço vigentes.
export const rotasAtas = new Hono<Ambiente>();
rotasAtas.use(exigirLogin);

const ESQUEMA_ATA: Esquema = {
  nome: "texto",
  licitacao_id: "id",
  numero_licitacao: "texto",
  numero_ata: "texto",
  orgao_gerenciador: "texto",
  data_inicio: "data",
  data_fim: "data",
  prazo_entrega: "inteiro",
  prazo_tipo: ["corridos", "uteis"],
  observacoes: "textoLongo",
};

const ESQUEMA_ITEM: Esquema = {
  item_numero: "texto",
  produto: "texto",
  unidade: "texto",
  quantidade: "numero",
  valor_unitario: "numero",
};

function comandosItens(
  db: D1Database,
  ataId: number,
  itens: unknown,
): D1PreparedStatement[] | { erro: string } {
  if (!Array.isArray(itens)) return [];
  const comandos = [db.prepare("DELETE FROM ata_itens WHERE ata_id = ?").bind(ataId)];
  for (const bruto of itens) {
    if (!bruto || typeof bruto !== "object") return { erro: "Item inválido." };
    const item = lerCampos(bruto as Record<string, unknown>, ESQUEMA_ITEM);
    if (temErro(item)) return item;
    const cols = ["ata_id", ...item.colunas];
    comandos.push(
      db
        .prepare(`INSERT INTO ata_itens (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
        .bind(ataId, ...item.valores),
    );
  }
  return comandos;
}

rotasAtas.get("/", async (c) => {
  const [atas, itens] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT a.*, l.numero AS licitacao_numero_vinculada, l.orgao AS licitacao_orgao
         FROM atas a LEFT JOIN licitacoes l ON l.id = a.licitacao_id
        ORDER BY a.data_fim IS NULL, a.data_fim`,
    ),
    c.env.DB.prepare("SELECT * FROM ata_itens ORDER BY id"),
  ]);
  const porAta = new Map<number, unknown[]>();
  for (const item of itens.results as { ata_id: number }[]) {
    porAta.set(item.ata_id, [...(porAta.get(item.ata_id) ?? []), item]);
  }
  return c.json({
    atas: (atas.results as { id: number }[]).map((a) => ({ ...a, itens: porAta.get(a.id) ?? [] })),
  });
});

rotasAtas.post("/", async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const campos = lerCampos(corpo, ESQUEMA_ATA);
  if (temErro(campos)) return c.json(campos, 400);
  const ata = await inserir<{ id: number }>(c.env.DB, "atas", campos);
  const itens = comandosItens(c.env.DB, ata.id, corpo.itens);
  if ("erro" in itens) {
    await c.env.DB.prepare("DELETE FROM atas WHERE id = ?").bind(ata.id).run();
    return c.json(itens, 400);
  }
  if (itens.length > 0) await c.env.DB.batch(itens);
  return c.json({ ata }, 201);
});

rotasAtas.patch("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Ata inválida." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  if (!(await buscar(c.env.DB, "atas", id))) return c.json({ erro: "Ata não encontrada." }, 404);
  const campos = lerCampos(corpo, ESQUEMA_ATA);
  if (temErro(campos)) return c.json(campos, 400);
  const itens = comandosItens(c.env.DB, id, corpo.itens);
  if ("erro" in itens) return c.json(itens, 400);
  const atualizar = comandoAtualizar(c.env.DB, "atas", id, campos);
  const comandos = [...(atualizar ? [atualizar] : []), ...itens];
  if (comandos.length === 0) return c.json({ erro: "Nada para alterar." }, 400);
  await c.env.DB.batch(comandos);
  return c.json({ ata: await buscar(c.env.DB, "atas", id) });
});

rotasAtas.delete("/:id", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Ata inválida." }, 400);
  await c.env.DB.prepare("DELETE FROM atas WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
