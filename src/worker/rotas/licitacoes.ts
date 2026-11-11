import { Hono } from "hono";
import { CATEGORIAS_ARQUIVO, ETAPAS_LICITACAO } from "../../shared/negocio";
import { podeEditar, podeVer } from "../../shared/permissoes";
import { type Ambiente, exigirAdmin, exigirLogin, exigirModulo } from "../auth";
import { notificar } from "../notificacoes";
import { comandoEvento, registrarEvento } from "../atividades";
import { hojeBrasilia, lerConfiguracoes } from "../configuracoes";
import { type EmpresaProposta, ehCorPdf, ehModeloPdf, montarDados } from "../../shared/proposta";
import { comandoUsarPedido, pedidoValido } from "../pedidosAssinatura";
import { nomeEtapa } from "../../shared/negocio";
import { buscar, comandoAtualizar, comExtras, inserir } from "../banco";
import { calcularPreco } from "../../shared/negocio";
import { type Esquema, idDaRota, lerCampos, lerJson, temErro, texto } from "../validacao";
import { extensaoDe, extensaoPelosBytes, nomeDoArquivo, tipoPorExtensao, URL_ARQUIVO_PNCP } from "../pncp";

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
  pncp_id: "texto",
  acompanhar: "bool",
  colocacao: "inteiro",
  situacao_disputa: "texto",
  data_reabertura: "data",
  hora_reabertura: "hora",
  portal: "texto",
  registro_preco: "bool",
  fase: "texto",
  valor_estimado: "numero",
  link: "texto",
  observacoes: "textoLongo",
  lucro_percentual: "numero",
  imposto_percentual: "numero",
  responsavel_id: "id",
  data_resultado: "data",
  motivo_perda: "texto",
  observacao_resultado: "textoLongo",
};

const ESQUEMA_ITEM: Esquema = {
  numero: "texto",
  descricao: "textoLongo",
  quantidade: "numero",
  unidade: "texto",
  valor_referencia: "numero",
  participar: "bool",
  resultado: ["ganho", "perdido", "cancelado", "acompanhando"],
  colocacao: "inteiro",
  nosso_lance: "numero",
  vencedor: "texto",
  valor_vencedor: "numero",
  motivo_perda: "texto",
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
  descricao: "textoLongo",
  escolhida: "bool",
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

  // Só os itens ganhos vão para o empenho (se nenhum foi marcado, vão todos em que participamos).
  // O custo vem da cotação mais barata; o valor de venda é o lance final (ou o preço sugerido).
  const temGanhos = await db
    .prepare("SELECT 1 FROM licitacao_itens WHERE licitacao_id = ? AND resultado = 'ganho' LIMIT 1")
    .bind(licitacaoId)
    .first();
  const { results: itens } = await db
    .prepare(
      `SELECT i.id, i.numero, i.quantidade, i.nosso_lance, i.descricao,
              c.produto, c.marca, c.custo_unitario, c.frete
         FROM licitacao_itens i
         LEFT JOIN cotacoes c ON c.id = (
           SELECT c2.id FROM cotacoes c2 WHERE c2.item_id = i.id
            ORDER BY c2.escolhida DESC, (COALESCE(c2.custo_unitario, 0) + COALESCE(c2.frete, 0) / MAX(COALESCE(i.quantidade, 1), 1))
            LIMIT 1)
        WHERE i.licitacao_id = ? AND ${temGanhos ? "i.resultado = 'ganho'" : "i.participar = 1"}
        ORDER BY i.id`,
    )
    .bind(licitacaoId)
    .all<{
      id: number;
      numero: string | null;
      quantidade: number | null;
      nosso_lance: number | null;
      descricao: string | null;
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
        const produto = [i.produto, i.marca].filter(Boolean).join(" — ") || i.descricao?.slice(0, 200) || null;
        const venda = i.nosso_lance ?? (i.custo_unitario == null ? null : Math.round(calculo.precoVenda * 100) / 100);
        return db
          .prepare(
            `INSERT INTO execucao_itens (execucao_id, item_id, item_numero, produto, quantidade, valor_unitario, custo_unitario)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            execucao!.id,
            i.id,
            i.numero,
            produto,
            i.quantidade,
            venda,
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
            (SELECT COUNT(*) FROM licitacao_itens i WHERE i.licitacao_id = l.id AND i.resultado = 'ganho') AS itens_ganhos,
            (SELECT COUNT(*) FROM licitacao_itens i WHERE i.licitacao_id = l.id AND i.resultado = 'perdido') AS itens_perdidos,
            (SELECT COUNT(*) FROM licitacao_itens i WHERE i.licitacao_id = l.id AND i.resultado = 'acompanhando') AS itens_acompanhando,
            l.acompanhar, l.colocacao, l.data_reabertura, l.hora_reabertura, l.pncp_id,
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

  // Já importada do PNCP? Não duplica.
  if (typeof corpo.pncp_id === "string" && corpo.pncp_id) {
    const ja = await c.env.DB.prepare("SELECT id FROM licitacoes WHERE pncp_id = ?").bind(corpo.pncp_id).first<{ id: number }>();
    if (ja) return c.json({ erro: "Esta licitação já está no quadro.", id: ja.id }, 409);
  }

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
  await registrarEvento(c.env.DB, { licitacao_id: licitacao.id }, c.get("usuario").id, "criou a licitação");
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
      `SELECT a.id, a.licitacao_id, a.nome, a.tipo_mime, a.tamanho, a.categoria, a.criado_em, u.nome AS enviado_por_nome,
              (SELECT COUNT(*) FROM analises_ia x WHERE x.arquivo_id = a.id) AS analisado,
              a.assinado_em, a.assinatura_titular, ua.nome AS assinado_por_nome
         FROM arquivos a LEFT JOIN usuarios u ON u.id = a.enviado_por LEFT JOIN usuarios ua ON ua.id = a.assinado_por
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

  const atual = await buscar<
    Licitacao & {
      responsavel_id: number | null;
      numero: string | null;
      orgao: string | null;
      data_sessao: string | null;
      data_resultado: string | null;
    }
  >(
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

  // Ganhou ou perdeu: guarda a data do resultado, se ainda não houver.
  const virouResultado = (corpo.etapa === "ganha" || corpo.etapa === "perdida") && corpo.etapa !== atual.etapa;
  if (virouResultado && !atual.data_resultado && !("data_resultado" in corpo)) extras.data_resultado = hojeBrasilia();

  const comando = comandoAtualizar(c.env.DB, "licitacoes", id, comExtras(campos, extras));
  if (!comando) return c.json({ erro: "Nada para alterar." }, 400);
  const eventos: string[] = [];
  if (corpo.etapa && corpo.etapa !== atual.etapa) {
    eventos.push(`moveu de "${nomeEtapa(ETAPAS_LICITACAO, atual.etapa)}" para "${nomeEtapa(ETAPAS_LICITACAO, corpo.etapa as string)}"`);
  }
  if ("data_sessao" in corpo && corpo.data_sessao !== atual.data_sessao) {
    eventos.push(corpo.data_sessao ? `marcou a sessão para ${String(corpo.data_sessao).split("-").reverse().join("/")}` : "removeu a data da sessão");
  }
  if ("motivo_perda" in corpo || "observacao_resultado" in corpo) eventos.push("registrou o resultado da disputa");
  if (("lucro_percentual" in corpo && corpo.lucro_percentual !== atual.lucro_percentual) || ("imposto_percentual" in corpo && corpo.imposto_percentual !== atual.imposto_percentual)) {
    eventos.push(`ajustou margem/impostos para ${corpo.lucro_percentual ?? atual.lucro_percentual}% / ${corpo.imposto_percentual ?? atual.imposto_percentual}%`);
  }
  const outros = Object.keys(corpo).filter(
    (k) => !["etapa", "posicao", "data_sessao", "motivo_perda", "observacao_resultado", "data_resultado", "lucro_percentual", "imposto_percentual", "responsavel_id"].includes(k),
  );
  if (outros.length > 0) eventos.push("atualizou os dados da licitação");
  await c.env.DB.batch([comando, ...eventos.map((t) => comandoEvento(c.env.DB, { licitacao_id: id }, usuario.id, t))]);

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
  if ("responsavel_id" in corpo && novoResponsavel !== atual.responsavel_id) {
    const pessoa = novoResponsavel
      ? await c.env.DB.prepare("SELECT nome FROM usuarios WHERE id = ?").bind(novoResponsavel).first<{ nome: string }>()
      : null;
    await registrarEvento(c.env.DB, { licitacao_id: id }, usuario.id, pessoa ? `definiu ${pessoa.nome} como responsável` : "removeu o responsável");
  }
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
  comandos.push(
    comandoEvento(c.env.DB, { licitacao_id: id }, c.get("usuario").id, lista.length === 1 ? "adicionou um item" : `adicionou ${lista.length} itens`),
  );
  const resultados = await c.env.DB.batch(comandos);
  return c.json({ itens: resultados.slice(0, lista.length).map((r) => r.results[0]) }, 201);
});

rotasLicitacoes.patch("/itens/:itemId", async (c) => {
  const id = idDaRota(c.req.param("itemId"));
  if (!id) return c.json({ erro: "Item inválido." }, 400);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const campos = lerCampos(corpo, ESQUEMA_ITEM);
  if (temErro(campos)) return c.json(campos, 400);
  const antes = await buscar<{ resultado: string | null }>(c.env.DB, "licitacao_itens", id);
  if (!antes) return c.json({ erro: "Item não encontrado." }, 404);
  const comando = comandoAtualizar(c.env.DB, "licitacao_itens", id, campos, false);
  if (!comando) return c.json({ erro: "Nada para alterar." }, 400);
  await comando.run();
  const item = await buscar<{ licitacao_id: number; numero: string | null }>(c.env.DB, "licitacao_itens", id);
  if (item && corpo.resultado !== undefined && (corpo.resultado || null) !== antes.resultado) {
    const nomes: Record<string, string> = { ganho: "ganho", perdido: "perdido", cancelado: "cancelado" };
    await registrarEvento(
      c.env.DB,
      { licitacao_id: item.licitacao_id },
      c.get("usuario").id,
      corpo.resultado ? `marcou o item ${item.numero ?? ""} como ${nomes[corpo.resultado as string]}` : `limpou o resultado do item ${item.numero ?? ""}`,
    );
  }
  return c.json({ item });
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

/** Só uma cotação por item vai para a proposta: desmarca as outras do mesmo item. */
async function soUmaEscolhida(db: D1Database, cotacao: { id: number; item_id: number | null }) {
  if (cotacao.item_id == null) return;
  await db.prepare("UPDATE cotacoes SET escolhida = 0 WHERE item_id = ? AND id <> ?").bind(cotacao.item_id, cotacao.id).run();
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
  if (corpo.escolhida === true) await soUmaEscolhida(c.env.DB, cotacao as { id: number; item_id: number | null });
  await registrarEvento(c.env.DB, { licitacao_id: id }, c.get("usuario").id, `cotou "${corpo.produto ?? "produto"}"`);
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
  const cotacao = await buscar<{ id: number; item_id: number | null }>(c.env.DB, "cotacoes", id);
  if (corpo.escolhida === true && cotacao) await soUmaEscolhida(c.env.DB, cotacao);
  return c.json({ cotacao });
});

rotasLicitacoes.delete("/cotacoes/:cotacaoId", async (c) => {
  const id = idDaRota(c.req.param("cotacaoId"));
  if (!id) return c.json({ erro: "Cotação inválida." }, 400);
  await c.env.DB.prepare("DELETE FROM cotacoes WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// Anexa o edital de uma licitação importada do PNCP (o navegador não consegue baixar direto do PNCP).
rotasLicitacoes.post("/:id/edital-pncp", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Licitação inválida." }, 400);
  const usuario = c.get("usuario");
  if (!podeEditar(usuario.permissoes, "licitacoes")) return c.json({ erro: "Sem permissão." }, 403);
  if (!(await buscar(c.env.DB, "licitacoes", id))) return c.json({ erro: "Licitação não encontrada." }, 404);
  const corpo = await lerJson(c);
  const url = typeof corpo?.url === "string" ? corpo.url : "";
  if (!URL_ARQUIVO_PNCP.test(url)) return c.json({ erro: "Endereço de arquivo do PNCP inválido." }, 400);
  const categoria = CATEGORIAS_ARQUIVO.includes(corpo?.categoria as string) ? (corpo?.categoria as string) : "Edital";
  let resposta: Response | null = null;
  for (let tentativa = 0; tentativa < 2 && !resposta; tentativa++) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      if (r.ok) resposta = r;
    } catch {
      /* tenta de novo */
    }
  }
  if (!resposta) return c.json({ erro: "O PNCP não entregou o arquivo." }, 502);
  const limite = 45 * 1024 * 1024;
  if (Number(resposta.headers.get("content-length") ?? 0) > limite) return c.json({ erro: "Arquivo grande demais para anexar." }, 400);
  const dados = await resposta.arrayBuffer();
  if (dados.byteLength === 0 || dados.byteLength > limite) return c.json({ erro: "Arquivo do PNCP inválido." }, 400);
  const original = nomeDoArquivo(resposta);
  const extensao = extensaoDe(original) || extensaoPelosBytes(new Uint8Array(dados, 0, Math.min(4, dados.byteLength))) || "bin";
  const tipo = tipoPorExtensao(extensao);
  const titulo = (typeof corpo?.titulo === "string" ? corpo.titulo.trim() : "") || original.replace(/\.[a-z0-9]{1,5}$/i, "") || categoria;
  const nome = `${titulo.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 150)}.${extensao}`;
  const chave = `licitacoes/${id}/${crypto.randomUUID()}-pncp.${extensao}`;
  await c.env.ARQUIVOS.put(chave, dados, { httpMetadata: { contentType: tipo } });
  const arquivo = await c.env.DB.prepare(
    `INSERT INTO arquivos (licitacao_id, chave, nome, tipo_mime, tamanho, categoria, enviado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, nome`,
  )
    .bind(id, chave, nome, tipo, dados.byteLength, categoria, usuario.id)
    .first<{ id: number; nome: string }>();
  await registrarEvento(c.env.DB, { licitacao_id: id }, usuario.id, `anexou do PNCP: "${nome}"`);
  return c.json({ arquivo }, 201);
});

// ---------------- Proposta comercial ----------------

// Gera a proposta (Word a partir de um modelo, ou PDF — opcionalmente assinado com o certificado A1)
// e guarda nos arquivos da licitação.
rotasLicitacoes.post("/:id/proposta", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Licitação inválida." }, 400);
  const usuario = c.get("usuario");
  if (!podeVer(usuario.permissoes, "orcamento")) return c.json({ erro: "Você não tem acesso a preços." }, 403);
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);

  const lic = await buscar<{
    numero: string | null;
    uasg: string | null;
    orgao: string | null;
    objeto: string | null;
    modalidade: string | null;
    data_sessao: string | null;
    horario: string | null;
    portal: string | null;
  }>(c.env.DB, "licitacoes", id);
  if (!lic) return c.json({ erro: "Licitação não encontrada." }, 404);

  const modeloId = idDaRota(String(corpo.modelo_id ?? ""));
  const modelo = modeloId ? await buscar<{ id: number; nome: string }>(c.env.DB, "modelos_proposta", modeloId) : null;
  if (modeloId && !modelo) return c.json({ erro: "Modelo não encontrado." }, 404);
  const contaId = idDaRota(String(corpo.conta_id ?? ""));
  const conta = contaId ? await buscar<NonNullable<Parameters<typeof montarDados>[0]["conta"]>>(c.env.DB, "contas_bancarias", contaId) : null;
  if (contaId && !conta) return c.json({ erro: "Conta bancária não encontrada." }, 404);

  const validade = Number(corpo.validade_dias ?? 60);
  if (!Number.isInteger(validade) || validade < 1 || validade > 365) return c.json({ erro: "Validade entre 1 e 365 dias." }, 400);

  const pedidos = Array.isArray(corpo.itens) ? (corpo.itens as Record<string, unknown>[]) : [];
  if (pedidos.length === 0) return c.json({ erro: "Escolha ao menos um item." }, 400);
  if (pedidos.length > 300) return c.json({ erro: "Itens demais." }, 400);
  const { results: itensBanco } = await c.env.DB.prepare(
    "SELECT id, numero, descricao, unidade, quantidade FROM licitacao_itens WHERE licitacao_id = ?",
  )
    .bind(id)
    .all<{ id: number; numero: string | null; descricao: string | null; unidade: string | null; quantidade: number | null }>();
  const porId = new Map(itensBanco.map((i) => [i.id, i]));
  const itens = [];
  for (const p of pedidos) {
    const item = porId.get(Number(p.item_id));
    if (!item) return c.json({ erro: "Item não pertence a esta licitação." }, 400);
    const valor = Number(p.valor_unitario);
    if (!Number.isFinite(valor) || valor < 0) return c.json({ erro: `Valor inválido no item ${item.numero ?? ""}.` }, 400);
    itens.push({
      numero: item.numero,
      descricao: typeof p.descricao === "string" && p.descricao.trim() ? p.descricao.trim().slice(0, 4000) : item.descricao,
      marca: typeof p.marca === "string" ? p.marca.trim().slice(0, 200) : "",
      unidade: item.unidade,
      quantidade: item.quantidade ?? 0,
      valorUnitario: Math.round(valor * 100) / 100,
    });
  }

  // Empresa que participa (ou a padrão)
  const empresaId = idDaRota(String(corpo.empresa_id ?? ""));
  const empresa = await c.env.DB.prepare(
    `SELECT id, nome, cnpj, ie, endereco, cidade, telefone, email, representante_nome, representante_cpf, representante_rg,
            representante_cargo, marca_dagua, modelo_pdf, cor_pdf, (logo_chave IS NOT NULL) AS tem_logo
       FROM empresas ${empresaId ? "WHERE id = ?" : "ORDER BY padrao DESC, id"} LIMIT 1`,
  )
    .bind(...(empresaId ? [empresaId] : []))
    .first<EmpresaProposta & { marca_dagua: number; tem_logo: number; modelo_pdf: string; cor_pdf: string }>();
  if (!empresa) return c.json({ erro: "Cadastre a empresa em Configurações → Empresas." }, 400);

  // Declarações e condições escolhidas (na ordem da biblioteca) + as extras desta licitação
  const idsDeclaracoes = Array.isArray(corpo.declaracoes) ? corpo.declaracoes.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100) : [];
  const escolhidas = idsDeclaracoes.length
    ? (
        await c.env.DB.prepare(
          `SELECT tipo, titulo, texto FROM declaracoes WHERE id IN (${idsDeclaracoes.map(() => "?").join(",")}) ORDER BY ordem, id`,
        )
          .bind(...idsDeclaracoes)
          .all<{ tipo: string; titulo: string; texto: string }>()
      ).results
    : [];
  const extras = (Array.isArray(corpo.extras) ? corpo.extras : [])
    .slice(0, 30)
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({ titulo: texto(x.titulo).slice(0, 200), texto: (typeof x.texto === "string" ? x.texto.trim() : "").slice(0, 6000) }))
    .filter((x) => x.texto);

  const data = typeof corpo.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(corpo.data) ? corpo.data : hojeBrasilia();
  const textoCurto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const dados = montarDados({
    empresa,
    hoje: data,
    contratacao: textoCurto(corpo.contratacao, 80),
    numeroProposta: textoCurto(corpo.numero, 40),
    condicoes: escolhidas.filter((d) => d.tipo === "condicao").map((d) => d.texto),
    declaracoes: [...escolhidas.filter((d) => d.tipo === "declaracao").map((d) => ({ titulo: d.titulo, texto: d.texto })), ...extras],
    licitacao: lic,
    conta,
    validadeDias: validade,
    prazoEntrega: textoCurto(corpo.prazo_entrega, 300),
    garantia: textoCurto(corpo.garantia, 300),
    observacoes: textoCurto(corpo.observacoes, 4000),
    itens,
  });
  const nome = `Proposta ${lic.numero ?? ""} ${lic.orgao ?? ""}`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 110);
  // O Word/PDF é montado no navegador com estes dados e depois enviado em /proposta/arquivo.
  return c.json({
    dados,
    nome,
    modelo: modelo ? { id: modelo.id, nome: modelo.nome } : null,
    pdf: {
      tem_logo: !!empresa.tem_logo,
      marca_dagua: !!empresa.marca_dagua,
      empresa_id: empresa.id,
      // Modelo e cor: o escolhido nesta proposta ou o padrão da empresa.
      modelo: ehModeloPdf(corpo.modelo_pdf) ? corpo.modelo_pdf : ehModeloPdf(empresa.modelo_pdf) ? empresa.modelo_pdf : "classico",
      cor: ehCorPdf(corpo.cor_pdf) ? corpo.cor_pdf : ehCorPdf(empresa.cor_pdf) ? empresa.cor_pdf : "#1f3b8a",
    },
  });
});

// Rascunho da proposta desta licitação (o que foi preenchido na aba Proposta).
rotasLicitacoes.get("/:id/proposta/rascunho", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Licitação inválida." }, 400);
  if (!podeVer(c.get("usuario").permissoes, "orcamento")) return c.json({ erro: "Você não tem acesso a preços." }, 403);
  const linha = await c.env.DB.prepare("SELECT dados, atualizado_em FROM propostas_licitacao WHERE licitacao_id = ?")
    .bind(id)
    .first<{ dados: string; atualizado_em: string }>();
  const ano = hojeBrasilia().slice(0, 4);
  const feitas = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM propostas_licitacao WHERE substr(atualizado_em, 1, 4) = ? AND licitacao_id <> ?",
  )
    .bind(ano, id)
    .first<{ n: number }>();
  let rascunho: unknown = null;
  try {
    rascunho = linha ? JSON.parse(linha.dados) : null;
  } catch {
    rascunho = null;
  }
  return c.json({
    rascunho,
    atualizado_em: linha?.atualizado_em ?? null,
    sugestao_numero: `${String((feitas?.n ?? 0) + 1).padStart(3, "0")}/${ano}`,
  });
});

rotasLicitacoes.put("/:id/proposta/rascunho", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Licitação inválida." }, 400);
  const usuario = c.get("usuario");
  if (!podeVer(usuario.permissoes, "orcamento")) return c.json({ erro: "Você não tem acesso a preços." }, 403);
  const corpo = await lerJson(c);
  if (!corpo || typeof corpo.rascunho !== "object" || corpo.rascunho === null) return c.json({ erro: "Requisição inválida." }, 400);
  const dados = JSON.stringify(corpo.rascunho);
  if (dados.length > 200_000) return c.json({ erro: "Rascunho grande demais." }, 400);
  if (!(await buscar(c.env.DB, "licitacoes", id))) return c.json({ erro: "Licitação não encontrada." }, 404);
  await c.env.DB.prepare(
    `INSERT INTO propostas_licitacao (licitacao_id, dados, atualizado_por) VALUES (?, ?, ?)
     ON CONFLICT(licitacao_id) DO UPDATE SET dados = excluded.dados, atualizado_por = excluded.atualizado_por, atualizado_em = datetime('now')`,
  )
    .bind(id, dados, usuario.id)
    .run();
  return c.json({ ok: true });
});

// Guarda a proposta (Word ou PDF, assinado ou não) montada no navegador.
rotasLicitacoes.post("/:id/proposta/arquivo", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Licitação inválida." }, 400);
  const usuario = c.get("usuario");
  if (!podeVer(usuario.permissoes, "orcamento")) return c.json({ erro: "Você não tem acesso a preços." }, 403);
  if (!(await buscar(c.env.DB, "licitacoes", id))) return c.json({ erro: "Licitação não encontrada." }, 404);
  const form = await c.req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!form || !arquivo || typeof arquivo === "string") return c.json({ erro: "Envio inválido." }, 400);
  if (arquivo.size === 0 || arquivo.size > 20 * 1024 * 1024) return c.json({ erro: "Arquivo inválido." }, 400);
  const pdf = arquivo.type === "application/pdf";
  const tipo = pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const modeloNome = String(form.get("modelo") ?? "").slice(0, 120);

  const pedidoId = String(form.get("pedido_assinatura") ?? "");
  let titular: string | null = null;
  if (pedidoId) {
    if (!pdf) return c.json({ erro: "Só PDFs podem ser assinados." }, 400);
    titular = await pedidoValido(c.env.DB, pedidoId, usuario.id);
    if (!titular) return c.json({ erro: "Assinatura expirada ou inválida. Assine de novo." }, 400);
  }

  const base = String(form.get("nome") ?? "Proposta").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 110) || "Proposta";
  const nome = `${base}${titular ? " (assinada)" : ""}.${pdf ? "pdf" : "docx"}`;
  const chave = `licitacoes/${id}/${crypto.randomUUID()}-proposta.${pdf ? "pdf" : "docx"}`;
  await c.env.ARQUIVOS.put(chave, arquivo.stream(), { httpMetadata: { contentType: tipo } });
  const registro = await c.env.DB.prepare(
    `INSERT INTO arquivos (licitacao_id, chave, nome, tipo_mime, tamanho, categoria, enviado_por, assinado_em, assinado_por, assinatura_titular)
     VALUES (?, ?, ?, ?, ?, 'Proposta', ?, ?, ?, ?) RETURNING id, nome, assinado_em, assinatura_titular`,
  )
    .bind(id, chave, nome, tipo, arquivo.size, usuario.id, titular ? Date.now() : null, titular ? usuario.id : null, titular)
    .first<{ id: number; nome: string; assinado_em: number | null; assinatura_titular: string | null }>();
  if (titular && registro) await comandoUsarPedido(c.env.DB, pedidoId, registro.id).run();
  const descricao = !pdf
    ? `gerou a proposta comercial${modeloNome ? ` (modelo "${modeloNome}")` : ""}`
    : titular
      ? `gerou e assinou digitalmente a proposta comercial em PDF (certificado de ${titular})`
      : "gerou a proposta comercial em PDF";
  await registrarEvento(c.env.DB, { licitacao_id: id }, usuario.id, descricao);
  return c.json({ arquivo: registro }, 201);
});
