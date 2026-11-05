import { Hono } from "hono";
import { ETAPAS_LICITACAO } from "../../shared/negocio";
import { podeEditar, podeVer } from "../../shared/permissoes";
import { type Ambiente, exigirAdmin, exigirLogin, exigirModulo } from "../auth";
import { lerConfiguracoes } from "../configuracoes";
import { notificar } from "../notificacoes";
import { buscar, comandoAtualizar, comExtras, inserir } from "../banco";
import { calcularPreco } from "../../shared/negocio";
import { type Esquema, idDaRota, lerCampos, lerJson, temErro } from "../validacao";

export const rotasLicitacoes = new Hono<Ambiente>();
rotasLicitacoes.use(exigirLogin);
rotasLicitacoes.use(exigirModulo((c) => (c.req.path.includes("/cotacoes") ? "orcamento" : "licitacoes")));

const CHAVES_ETAPA = ETAPAS_LICITACAO.map((e) => e.chave);

const ESQUEMA_LICITACAO: Esquema = {
  etapa: CHAVES_ETAPA,
  posicao: "numero",
  uasg: "texto",
  numero: "texto",
  orgao: "texto",
  objeto: "textoLongo",
  modalidade: "texto",
  nicho: "texto",
  data_sessao: "data",
  horario: "hora",
  portal: "texto",
  registro_preco: "bool",
  fase: "texto",
  valor_estimado: "numero",
  link: "texto",
  observacoes: "textoLongo",
  lucro_percentual: "numero",
  imposto_percentual: "numero",
  responsavel_id: "id",
};

const ESQUEMA_ITEM: Esquema = {
  numero: "texto",
  descricao: "textoLongo",
  quantidade: "numero",
  unidade: "texto",
  valor_referencia: "numero",
  participar: "bool",
};

const ESQUEMA_COTACAO: Esquema = {
  item_id: "id",
  produto: "texto",
  marca: "texto",
  fornecedor_id: "id",
  fornecedor_nome: "texto",
  custo_unitario: "numero",
  frete: "numero",
  observacoes: "textoLongo",
};

interface Licitacao {
  id: number;
  etapa: string;
  registro_preco: number;
  imposto_percentual: number;
  lucro_percentual: number;
}

/**
 * Quando uma licitação vai para "Ganhas", cria automaticamente o card no
 * quadro de pós-ganho (se ainda não existir), já com os itens cotados.
 */
async function aoGanhar(db: D1Database, licitacaoId: number): Promise<number | null> {
  const existente = await db
    .prepare("SELECT id FROM execucoes WHERE licitacao_id = ? LIMIT 1")
    .bind(licitacaoId)
    .first<{ id: number }>();
  if (existente) return null;

  const lic = await buscar<Licitacao>(db, "licitacoes", licitacaoId);
  if (!lic) return null;

  const max = await db
    .prepare("SELECT COALESCE(MAX(posicao), 0) AS p FROM execucoes WHERE etapa = 'aguardando_empenho'")
    .first<{ p: number }>();

  const execucao = await db
    .prepare(
      `INSERT INTO execucoes (licitacao_id, etapa, posicao, registro_preco)
       VALUES (?, 'aguardando_empenho', ?, ?) RETURNING id`,
    )
    .bind(licitacaoId, (max?.p ?? 0) + 1, lic.registro_preco)
    .first<{ id: number }>();

  // Para cada item em que participamos, usa a cotação mais barata como sugestão.
  const { results: itens } = await db
    .prepare(
      `SELECT i.id, i.numero, i.quantidade,
              c.produto, c.marca, c.custo_unitario, c.frete
         FROM licitacao_itens i
         LEFT JOIN cotacoes c ON c.id = (
           SELECT c2.id FROM cotacoes c2 WHERE c2.item_id = i.id
            ORDER BY (COALESCE(c2.custo_unitario, 0) + COALESCE(c2.frete, 0) / MAX(COALESCE(i.quantidade, 1), 1))
            LIMIT 1)
        WHERE i.licitacao_id = ? AND i.participar = 1
        ORDER BY i.id`,
    )
    .bind(licitacaoId)
    .all<{
      id: number;
      numero: string | null;
      quantidade: number | null;
      produto: string | null;
      marca: string | null;
      custo_unitario: number | null;
      frete: number | null;
    }>();

  if (itens.length > 0) {
    await db.batch(
      itens.map((i) => {
        const calculo = calcularPreco({
          custoUnitario: i.custo_unitario ?? 0,
          frete: i.frete ?? 0,
          quantidade: i.quantidade ?? 1,
          impostoPercentual: lic.imposto_percentual,
          lucroPercentual: lic.lucro_percentual,
        });
        const produto = [i.produto, i.marca].filter(Boolean).join(" — ") || null;
        return db
          .prepare(
            `INSERT INTO execucao_itens (execucao_id, item_id, item_numero, produto, quantidade, custo_unitario)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            execucao!.id,
            i.id,
            i.numero,
            produto,
            i.quantidade,
            i.custo_unitario == null ? null : calculo.custoUnitarioComFrete,
          );
      }),
    );
  }
  return execucao!.id;
}

// Lista para o quadro Kanban (dados resumidos de cada card).
rotasLicitacoes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.etapa, l.posicao, l.uasg, l.numero, l.orgao, l.objeto, l.modalidade,
            l.nicho, l.data_sessao, l.horario, l.portal, l.registro_preco, l.fase,
            l.valor_estimado, l.responsavel_id, u.nome AS responsavel_nome, u.cor AS responsavel_cor,
            CASE WHEN u.foto_chave IS NOT NULL THEN '/api/fotos/' || u.id || '?v=' || substr(u.foto_chave, -8) END AS responsavel_foto,
            l.atualizado_em,
            (SELECT COUNT(*) FROM licitacao_itens i WHERE i.licitacao_id = l.id AND i.participar = 1) AS total_itens,
            (SELECT COUNT(*) FROM arquivos a WHERE a.licitacao_id = l.id) AS total_arquivos,
            (SELECT COUNT(*) FROM cotacoes ct WHERE ct.licitacao_id = l.id) AS total_cotacoes
       FROM licitacoes l
       LEFT JOIN usuarios u ON u.id = l.responsavel_id
      ORDER BY l.posicao`,
  ).all();
  return c.json({ licitacoes: results });
});

rotasLicitacoes.post("/", async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const campos = lerCampos(corpo, ESQUEMA_LICITACAO);
  if (temErro(campos)) return c.json(campos, 400);

  const etapa = (corpo.etapa as string) || "estudar";
  const max = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(posicao), 0) AS p FROM licitacoes WHERE etapa = ?",
  )
    .bind(etapa)
    .first<{ p: number }>();
  const config = await lerConfiguracoes(c.env.DB);

  const licitacao = await inserir<Licitacao>(
    c.env.DB,
    "licitacoes",
    comExtras(campos, {
      etapa,
      posicao: (max?.p ?? 0) + 1,
      criado_por: c.get("usuario").id,
      ...("lucro_percentual" in corpo ? {} : { lucro_percentual: config.margem_padrao }),
      ...("imposto_percentual" in corpo ? {} : { imposto_percentual: config.imposto_padrao }),
    }),
  );
  if (etapa === "ganha") await aoGanhar(c.env.DB, licitacao.id);
  return c.json({ licitacao }, 201);
});

// Ficha completa: dados, itens, cotações, arquivos e cards de pós-ganho.
rotasLicitacoes.get("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Licitação inválida." }, 400);

  const [licitacao, itens, cotacoes, arquivos, execucoes] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM licitacoes WHERE id = ?").bind(id),
    c.env.DB.prepare(
      "SELECT * FROM licitacao_itens WHERE licitacao_id = ? ORDER BY CAST(numero AS INTEGER), numero, id",
    ).bind(id),
    c.env.DB.prepare(
      `SELECT ct.*, f.nome AS fornecedor_cadastrado
         FROM cotacoes ct LEFT JOIN fornecedores f ON f.id = ct.fornecedor_id
        WHERE ct.licitacao_id = ? ORDER BY ct.id`,
    ).bind(id),
    c.env.DB.prepare(
      `SELECT a.id, a.nome, a.tipo_mime, a.tamanho, a.categoria, a.criado_em, u.nome AS enviado_por_nome,
              (SELECT COUNT(*) FROM analises_ia x WHERE x.arquivo_id = a.id) AS analisado
         FROM arquivos a LEFT JOIN usuarios u ON u.id = a.enviado_por
        WHERE a.licitacao_id = ? ORDER BY a.criado_em DESC`,
    ).bind(id),
    c.env.DB.prepare(
      "SELECT id, etapa, numero_empenho FROM execucoes WHERE licitacao_id = ? ORDER BY id",
    ).bind(id),
  ]);

  if (!licitacao.results[0]) return c.json({ erro: "Licitação não encontrada." }, 404);
  const veOrcamento = podeVer(c.get("usuario").permissoes, "orcamento");
  return c.json({
    licitacao: licitacao.results[0],
    itens: itens.results,
    cotacoes: veOrcamento ? cotacoes.results : [],
    arquivos: arquivos.results,
    execucoes: execucoes.results,
  });
});

rotasLicitacoes.patch("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Licitação inválida." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);

  const atual = await buscar<Licitacao & { responsavel_id: number | null; numero: string | null; orgao: string | null }>(
    c.env.DB,
    "licitacoes",
    id,
  );
  if (!atual) return c.json({ erro: "Licitação não encontrada." }, 404);
  const usuario = c.get("usuario");
  if (("lucro_percentual" in corpo || "imposto_percentual" in corpo) && !podeEditar(usuario.permissoes, "orcamento")) {
    return c.json({ erro: "Você não pode alterar margens e impostos." }, 403);
  }

  const campos = lerCampos(corpo, ESQUEMA_LICITACAO);
  if (temErro(campos)) return c.json(campos, 400);

  // Mudou de etapa sem informar posição: vai para o fim da nova coluna.
  let extras: Record<string, unknown> = {};
  if (corpo.etapa && corpo.etapa !== atual.etapa && corpo.posicao === undefined) {
    const max = await c.env.DB.prepare(
      "SELECT COALESCE(MAX(posicao), 0) AS p FROM licitacoes WHERE etapa = ?",
    )
      .bind(corpo.etapa)
      .first<{ p: number }>();
    extras = { posicao: (max?.p ?? 0) + 1 };
  }

  const comando = comandoAtualizar(c.env.DB, "licitacoes", id, comExtras(campos, extras));
  if (!comando) return c.json({ erro: "Nada para alterar." }, 400);
  await comando.run();

  let execucaoCriada: number | null = null;
  const nome = `Licitação ${atual.numero ?? ""}`.trim() + (atual.orgao ? ` · ${atual.orgao}` : "");
  if (corpo.etapa === "ganha" && atual.etapa !== "ganha") {
    execucaoCriada = await aoGanhar(c.env.DB, id);
    await notificar(
      c.env.DB,
      { modulo: "posganho", exceto: usuario.id },
      {
        tipo: "ganha",
        titulo: "Licitação ganha! 🎉",
        mensagem: `${nome} foi para o Pós-ganho.`,
        link: execucaoCriada ? `/pos-ganho/${execucaoCriada}` : `/licitacoes/${id}`,
        chave: `ganha:${id}`,
      },
    );
  }
  const novoResponsavel = corpo.responsavel_id == null || corpo.responsavel_id === "" ? null : Number(corpo.responsavel_id);
  if ("responsavel_id" in corpo && novoResponsavel && novoResponsavel !== atual.responsavel_id && novoResponsavel !== usuario.id) {
    await notificar(
      c.env.DB,
      { usuarioIds: [novoResponsavel] },
      {
        tipo: "responsavel",
        titulo: "Você é o responsável por uma licitação",
        mensagem: `${usuario.nome} atribuiu a ${nome} a você.`,
        link: `/licitacoes/${id}`,
        chave: `responsavel:${id}:${Date.now()}`,
      },
    );
  }

  const licitacao = await buscar(c.env.DB, "licitacoes", id);
  return c.json({ licitacao, execucaoCriada });
});

rotasLicitacoes.delete("/:id", exigirAdmin, async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Licitação inválida." }, 400);

  // Apaga os arquivos do R2 antes de apagar os registros.
  const { results } = await c.env.DB.prepare(
    `SELECT chave FROM arquivos WHERE licitacao_id = ?
     UNION SELECT a.chave FROM arquivos a JOIN execucoes e ON e.id = a.execucao_id WHERE e.licitacao_id = ?`,
  )
    .bind(id, id)
    .all<{ chave: string }>();
  if (results.length > 0) await c.env.ARQUIVOS.delete(results.map((r) => r.chave));

  await c.env.DB.prepare("DELETE FROM licitacoes WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ---------------- Itens ----------------

rotasLicitacoes.post("/:id/itens", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Licitação inválida." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);

  // Aceita um item ou uma lista em "itens" (importação pela IA).
  const lista = Array.isArray(corpo.itens) ? (corpo.itens as Record<string, unknown>[]) : [corpo];
  if (lista.length === 0 || lista.length > 500) return c.json({ erro: "Lista de itens inválida." }, 400);

  const existe = await buscar(c.env.DB, "licitacoes", id);
  if (!existe) return c.json({ erro: "Licitação não encontrada." }, 404);

  const comandos: D1PreparedStatement[] = [];
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== "object") return c.json({ erro: "Item inválido." }, 400);
    const campos = lerCampos(bruto, ESQUEMA_ITEM);
    if (temErro(campos)) return c.json(campos, 400);
    const cols = ["licitacao_id", ...campos.colunas];
    comandos.push(
      c.env.DB.prepare(
        `INSERT INTO licitacao_itens (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) RETURNING *`,
      ).bind(id, ...campos.valores),
    );
  }
  const resultados = await c.env.DB.batch(comandos);
  return c.json({ itens: resultados.map((r) => r.results[0]) }, 201);
});

rotasLicitacoes.patch("/itens/:itemId", async (c) => {
  const id = idDaRota(c.req.param("itemId"));
  if (!id) return c.json({ erro: "Item inválido." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const campos = lerCampos(corpo, ESQUEMA_ITEM);
  if (temErro(campos)) return c.json(campos, 400);
  const comando = comandoAtualizar(c.env.DB, "licitacao_itens", id, campos, false);
  if (!comando) return c.json({ erro: "Nada para alterar." }, 400);
  await comando.run();
  return c.json({ item: await buscar(c.env.DB, "licitacao_itens", id) });
});

rotasLicitacoes.delete("/itens/:itemId", async (c) => {
  const id = idDaRota(c.req.param("itemId"));
  if (!id) return c.json({ erro: "Item inválido." }, 400);
  await c.env.DB.prepare("DELETE FROM licitacao_itens WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// ---------------- Cotações (produtos orçados) ----------------

async function itemPertence(db: D1Database, itemId: unknown, licitacaoId: number) {
  if (itemId == null || itemId === "") return true;
  const item = await db
    .prepare("SELECT 1 FROM licitacao_itens WHERE id = ? AND licitacao_id = ?")
    .bind(itemId, licitacaoId)
    .first();
  return !!item;
}

rotasLicitacoes.post("/:id/cotacoes", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Licitação inválida." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const campos = lerCampos(corpo, ESQUEMA_COTACAO);
  if (temErro(campos)) return c.json(campos, 400);
  if (!(await itemPertence(c.env.DB, corpo.item_id, id))) {
    return c.json({ erro: "Item não pertence a esta licitação." }, 400);
  }
  const cotacao = await inserir(c.env.DB, "cotacoes", comExtras(campos, { licitacao_id: id }));
  return c.json({ cotacao }, 201);
});

rotasLicitacoes.patch("/cotacoes/:cotacaoId", async (c) => {
  const id = idDaRota(c.req.param("cotacaoId"));
  if (!id) return c.json({ erro: "Cotação inválida." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const atual = await buscar<{ licitacao_id: number }>(c.env.DB, "cotacoes", id);
  if (!atual) return c.json({ erro: "Cotação não encontrada." }, 404);
  const campos = lerCampos(corpo, ESQUEMA_COTACAO);
  if (temErro(campos)) return c.json(campos, 400);
  if (!(await itemPertence(c.env.DB, corpo.item_id, atual.licitacao_id))) {
    return c.json({ erro: "Item não pertence a esta licitação." }, 400);
  }
  const comando = comandoAtualizar(c.env.DB, "cotacoes", id, campos, false);
  if (!comando) return c.json({ erro: "Nada para alterar." }, 400);
  await comando.run();
  return c.json({ cotacao: await buscar(c.env.DB, "cotacoes", id) });
});

rotasLicitacoes.delete("/cotacoes/:cotacaoId", async (c) => {
  const id = idDaRota(c.req.param("cotacaoId"));
  if (!id) return c.json({ erro: "Cotação inválida." }, 400);
  await c.env.DB.prepare("DELETE FROM cotacoes WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
