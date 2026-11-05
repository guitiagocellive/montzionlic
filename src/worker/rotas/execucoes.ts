import { Hono } from "hono";
import { ETAPAS_EXECUCAO, somarPrazo, type TipoPrazo } from "../../shared/negocio";
import { type Ambiente, exigirAdmin, exigirLogin } from "../auth";
import { buscar, comandoAtualizar, comExtras, inserir } from "../banco";
import { type Esquema, idDaRota, lerCampos, lerJson, temErro } from "../validacao";

// Seção 2: pós-ganho. Cada card é um empenho de uma licitação ganha.
export const rotasExecucoes = new Hono<Ambiente>();
rotasExecucoes.use(exigirLogin);

const ESQUEMA_EXECUCAO: Esquema = {
  etapa: ETAPAS_EXECUCAO.map((e) => e.chave),
  posicao: "numero",
  numero_empenho: "texto",
  data_empenho: "data",
  prazo_dias: "inteiro",
  prazo_tipo: ["corridos", "uteis"],
  registro_preco: "bool",
  fat_razao_social: "texto",
  fat_cnpj: "texto",
  fat_endereco: "texto",
  fat_email: "texto",
  fat_telefone: "texto",
  observacoes: "textoLongo",
};

const ESQUEMA_ITEM: Esquema = {
  item_id: "id",
  item_numero: "texto",
  produto: "texto",
  quantidade: "numero",
  valor_unitario: "numero",
  custo_unitario: "numero",
};

interface Execucao {
  id: number;
  licitacao_id: number;
  etapa: string;
  data_empenho: string | null;
  prazo_dias: number | null;
  prazo_tipo: TipoPrazo;
}

function calcularLimite(e: Pick<Execucao, "data_empenho" | "prazo_dias" | "prazo_tipo">) {
  if (!e.data_empenho || e.prazo_dias == null) return null;
  return somarPrazo(e.data_empenho, e.prazo_dias, e.prazo_tipo);
}

rotasExecucoes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.etapa, e.posicao, e.numero_empenho, e.data_empenho, e.data_limite,
            e.prazo_dias, e.prazo_tipo, e.registro_preco, e.licitacao_id,
            l.numero AS licitacao_numero, l.orgao, l.uasg, l.modalidade, l.nicho,
            (SELECT COUNT(*) FROM execucao_itens i WHERE i.execucao_id = e.id) AS total_itens,
            (SELECT COALESCE(SUM(i.quantidade * i.valor_unitario), 0) FROM execucao_itens i WHERE i.execucao_id = e.id) AS valor_total
       FROM execucoes e JOIN licitacoes l ON l.id = e.licitacao_id
      ORDER BY e.posicao`,
  ).all();
  return c.json({ execucoes: results });
});

// Novo empenho para uma licitação (ex.: vários empenhos de um registro de preço).
rotasExecucoes.post("/", async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const licitacaoId = idDaRota(String(corpo.licitacao_id ?? ""));
  if (!licitacaoId) return c.json({ erro: "Escolha a licitação." }, 400);
  const lic = await buscar<{ registro_preco: number }>(c.env.DB, "licitacoes", licitacaoId);
  if (!lic) return c.json({ erro: "Licitação não encontrada." }, 404);

  const campos = lerCampos(corpo, ESQUEMA_EXECUCAO);
  if (temErro(campos)) return c.json(campos, 400);
  const etapa = (corpo.etapa as string) || "aguardando_empenho";
  const max = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(posicao), 0) AS p FROM execucoes WHERE etapa = ?",
  )
    .bind(etapa)
    .first<{ p: number }>();

  const herdado = "registro_preco" in corpo ? {} : { registro_preco: lic.registro_preco };
  const execucao = await inserir<Execucao>(
    c.env.DB,
    "execucoes",
    comExtras(campos, {
      ...herdado,
      licitacao_id: licitacaoId,
      etapa,
      posicao: (max?.p ?? 0) + 1,
    }),
  );
  return c.json({ execucao }, 201);
});

rotasExecucoes.get("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Empenho inválido." }, 400);
  const execucao = await buscar<Execucao>(c.env.DB, "execucoes", id);
  if (!execucao) return c.json({ erro: "Empenho não encontrado." }, 404);

  const [licitacao, itens, itensLicitacao, cotacoes, arquivos] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, numero, uasg, orgao, objeto, modalidade, nicho, portal, registro_preco,
              imposto_percentual, lucro_percentual
         FROM licitacoes WHERE id = ?`,
    ).bind(execucao.licitacao_id),
    c.env.DB.prepare("SELECT * FROM execucao_itens WHERE execucao_id = ? ORDER BY id").bind(id),
    c.env.DB.prepare(
      "SELECT id, numero, descricao, quantidade, unidade FROM licitacao_itens WHERE licitacao_id = ? ORDER BY CAST(numero AS INTEGER), numero, id",
    ).bind(execucao.licitacao_id),
    c.env.DB.prepare(
      "SELECT id, item_id, produto, marca, custo_unitario, frete FROM cotacoes WHERE licitacao_id = ?",
    ).bind(execucao.licitacao_id),
    c.env.DB.prepare(
      `SELECT a.id, a.nome, a.tipo_mime, a.tamanho, a.categoria, a.criado_em, a.execucao_id,
              u.nome AS enviado_por_nome,
              (SELECT COUNT(*) FROM analises_ia x WHERE x.arquivo_id = a.id) AS analisado
         FROM arquivos a LEFT JOIN usuarios u ON u.id = a.enviado_por
        WHERE a.execucao_id = ? OR a.licitacao_id = ?
        ORDER BY a.execucao_id IS NULL, a.criado_em DESC`,
    ).bind(id, execucao.licitacao_id),
  ]);

  return c.json({
    execucao,
    licitacao: licitacao.results[0],
    itens: itens.results,
    itensLicitacao: itensLicitacao.results,
    cotacoes: cotacoes.results,
    arquivos: arquivos.results,
  });
});

rotasExecucoes.patch("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Empenho inválido." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const atual = await buscar<Execucao>(c.env.DB, "execucoes", id);
  if (!atual) return c.json({ erro: "Empenho não encontrado." }, 404);

  const campos = lerCampos(corpo, ESQUEMA_EXECUCAO);
  if (temErro(campos)) return c.json(campos, 400);

  // Recalcula a data limite de entrega com os valores novos.
  const valor = (col: string) => {
    const i = campos.colunas.indexOf(col);
    return i >= 0 ? campos.valores[i] : (atual as unknown as Record<string, unknown>)[col];
  };
  const extras: Record<string, unknown> = {
    data_limite: calcularLimite({
      data_empenho: valor("data_empenho") as string | null,
      prazo_dias: valor("prazo_dias") as number | null,
      prazo_tipo: (valor("prazo_tipo") as TipoPrazo) ?? "corridos",
    }),
  };
  if (corpo.etapa && corpo.etapa !== atual.etapa && corpo.posicao === undefined) {
    const max = await c.env.DB.prepare(
      "SELECT COALESCE(MAX(posicao), 0) AS p FROM execucoes WHERE etapa = ?",
    )
      .bind(corpo.etapa)
      .first<{ p: number }>();
    extras.posicao = (max?.p ?? 0) + 1;
  }

  const comandos: D1PreparedStatement[] = [];
  const atualizar = comandoAtualizar(c.env.DB, "execucoes", id, comExtras(campos, extras));
  if (atualizar) comandos.push(atualizar);

  // Itens ganhos: a lista enviada substitui a anterior.
  if (Array.isArray(corpo.itens)) {
    comandos.push(c.env.DB.prepare("DELETE FROM execucao_itens WHERE execucao_id = ?").bind(id));
    for (const bruto of corpo.itens as Record<string, unknown>[]) {
      if (!bruto || typeof bruto !== "object") return c.json({ erro: "Item inválido." }, 400);
      const item = lerCampos(bruto, ESQUEMA_ITEM);
      if (temErro(item)) return c.json(item, 400);
      const cols = ["execucao_id", ...item.colunas];
      comandos.push(
        c.env.DB.prepare(
          `INSERT INTO execucao_itens (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        ).bind(id, ...item.valores),
      );
    }
  }

  if (comandos.length === 0) return c.json({ erro: "Nada para alterar." }, 400);
  await c.env.DB.batch(comandos);
  return c.json({ execucao: await buscar(c.env.DB, "execucoes", id) });
});

rotasExecucoes.delete("/:id", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Empenho inválido." }, 400);
  const { results } = await c.env.DB.prepare("SELECT chave FROM arquivos WHERE execucao_id = ?")
    .bind(id)
    .all<{ chave: string }>();
  if (results.length > 0) await c.env.ARQUIVOS.delete(results.map((r) => r.chave));
  await c.env.DB.prepare("DELETE FROM execucoes WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
