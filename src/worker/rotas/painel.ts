import { Hono } from "hono";
import {
  ETAPAS_ANTES_DA_ENTREGA,
  ETAPAS_LICITACAO_ATIVAS,
} from "../../shared/negocio";
import { podeVer } from "../../shared/permissoes";
import { type Ambiente, exigirLogin } from "../auth";
import { hojeBrasilia } from "../configuracoes";

export const rotasPainel = new Hono<Ambiente>();
rotasPainel.use(exigirLogin);


const lista = (valores: string[]) => valores.map((v) => `'${v}'`).join(", ");

// Números do dashboard.
rotasPainel.get("/painel", async (c) => {
  const hoje = hojeBrasilia();
  const em7 = hojeBrasilia(7);
  const em30 = hojeBrasilia(30);
  const db = c.env.DB;

  const [porEtapa, emDisputa, proximasSessoes, porExecucao, entregas, valores, atas, porNicho] =
    await db.batch([
      db.prepare("SELECT etapa, COUNT(*) AS total FROM licitacoes GROUP BY etapa"),
      db.prepare(
        `SELECT COALESCE(SUM(valor_estimado), 0) AS valor FROM licitacoes WHERE etapa IN (${lista(ETAPAS_LICITACAO_ATIVAS)})`,
      ),
      db
        .prepare(
          `SELECT id, numero, orgao, modalidade, data_sessao, horario, portal, etapa
             FROM licitacoes
            WHERE data_sessao BETWEEN ? AND ? AND etapa IN (${lista(ETAPAS_LICITACAO_ATIVAS)})
            ORDER BY data_sessao, horario LIMIT 8`,
        )
        .bind(hoje, em7),
      db.prepare("SELECT etapa, COUNT(*) AS total FROM execucoes GROUP BY etapa"),
      db
        .prepare(
          `SELECT e.id, e.numero_empenho, e.data_limite, e.etapa, l.orgao, l.numero AS licitacao_numero
             FROM execucoes e JOIN licitacoes l ON l.id = e.licitacao_id
            WHERE e.data_limite IS NOT NULL AND e.data_limite <= ?
              AND e.etapa IN (${lista(ETAPAS_ANTES_DA_ENTREGA)})
            ORDER BY e.data_limite LIMIT 8`,
        )
        .bind(em7),
      db.prepare(
        `SELECT COALESCE(SUM(i.quantidade * i.valor_unitario), 0) AS vendido,
                COALESCE(SUM(i.quantidade * (i.valor_unitario * (1 - l.imposto_percentual / 100.0) - i.custo_unitario)), 0) AS lucro
           FROM execucao_itens i
           JOIN execucoes e ON e.id = i.execucao_id
           JOIN licitacoes l ON l.id = e.licitacao_id
          WHERE i.valor_unitario IS NOT NULL AND i.custo_unitario IS NOT NULL`,
      ),
      db
        .prepare(
          `SELECT
             SUM(CASE WHEN data_fim >= ? THEN 1 ELSE 0 END) AS vigentes,
             SUM(CASE WHEN data_fim >= ? AND data_fim <= ? THEN 1 ELSE 0 END) AS vencendo
           FROM atas`,
        )
        .bind(hoje, hoje, em30),
      db.prepare(
        `SELECT COALESCE(nicho, 'Sem nicho') AS nicho, COUNT(*) AS total
           FROM licitacoes GROUP BY COALESCE(nicho, 'Sem nicho') ORDER BY total DESC LIMIT 6`,
      ),
    ]);

  // Cada bloco só aparece para quem tem acesso ao módulo correspondente.
  const p = c.get("usuario").permissoes;
  const lic = podeVer(p, "licitacoes");
  const pos = podeVer(p, "posganho");
  return c.json({
    hoje,
    licitacoesPorEtapa: lic ? porEtapa.results : [],
    valorEmDisputa: lic ? (emDisputa.results[0] as { valor: number }).valor : 0,
    proximasSessoes: lic ? proximasSessoes.results : [],
    execucoesPorEtapa: pos ? porExecucao.results : [],
    entregasProximas: pos ? entregas.results : [],
    valores: pos ? valores.results[0] : { vendido: 0, lucro: 0 },
    atas: podeVer(p, "atas") ? atas.results[0] : { vigentes: 0, vencendo: 0 },
    licitacoesPorNicho: lic ? porNicho.results : [],
  });
});

// Painel da área de Licitações.
rotasPainel.get("/painel/licitacoes", async (c) => {
  if (!podeVer(c.get("usuario").permissoes, "licitacoes")) return c.json({ erro: "Sem acesso." }, 403);
  const hoje = hojeBrasilia();
  const em14 = hojeBrasilia(14);
  const ano = hoje.slice(0, 4);
  const db = c.env.DB;
  const ativas = lista(ETAPAS_LICITACAO_ATIVAS);
  const [porEtapa, sessoes, semOrcamento, resultadoAno, recentes, porResponsavel, acompanhando] = await db.batch([
    db.prepare("SELECT etapa, COUNT(*) AS total, COALESCE(SUM(valor_estimado), 0) AS valor FROM licitacoes GROUP BY etapa"),
    db
      .prepare(
        `SELECT id, numero, orgao, modalidade, etapa, portal,
                CASE WHEN data_reabertura >= ?1 THEN data_reabertura ELSE data_sessao END AS data,
                CASE WHEN data_reabertura >= ?1 THEN hora_reabertura ELSE horario END AS horario,
                (data_reabertura >= ?1) AS reabertura
           FROM licitacoes
          WHERE etapa IN (${ativas})
            AND ((data_sessao BETWEEN ?1 AND ?2) OR (data_reabertura BETWEEN ?1 AND ?2))
          ORDER BY data, horario LIMIT 10`,
      )
      .bind(hoje, em14),
    db
      .prepare(
        `SELECT l.id, l.numero, l.orgao, l.data_sessao FROM licitacoes l
          WHERE l.etapa IN (${ativas}) AND l.data_sessao >= ?
            AND NOT EXISTS (SELECT 1 FROM cotacoes c WHERE c.licitacao_id = l.id)
          ORDER BY l.data_sessao LIMIT 6`,
      )
      .bind(hoje),
    db
      .prepare(
        `SELECT SUM(CASE WHEN etapa = 'ganha' THEN 1 ELSE 0 END) AS ganhas,
                SUM(CASE WHEN etapa = 'perdida' THEN 1 ELSE 0 END) AS perdidas
           FROM licitacoes WHERE substr(COALESCE(data_resultado, data_sessao, ''), 1, 4) = ?`,
      )
      .bind(ano),
    db.prepare(
      `SELECT id, numero, orgao, etapa, data_resultado, motivo_perda FROM licitacoes
        WHERE etapa IN ('ganha', 'perdida') ORDER BY COALESCE(data_resultado, atualizado_em) DESC LIMIT 6`,
    ),
    db.prepare(
      `SELECT u.id, COALESCE(u.nome, 'Sem responsável') AS nome, u.cor, COUNT(*) AS total
         FROM licitacoes l LEFT JOIN usuarios u ON u.id = l.responsavel_id
        WHERE l.etapa IN (${ativas}) GROUP BY u.id ORDER BY total DESC`,
    ),
    db.prepare(
      `SELECT id, numero, orgao, colocacao, situacao_disputa, data_reabertura, hora_reabertura, acompanhar
         FROM licitacoes WHERE etapa = 'boa_colocacao' ORDER BY acompanhar DESC, data_reabertura IS NULL, data_reabertura LIMIT 12`,
    ),
  ]);
  return c.json({
    hoje,
    porEtapa: porEtapa.results,
    sessoes: sessoes.results,
    semOrcamento: semOrcamento.results,
    resultadoAno: resultadoAno.results[0],
    recentes: recentes.results,
    porResponsavel: porResponsavel.results,
    boaColocacao: acompanhando.results,
  });
});

// Painel da área de Pós-ganho.
rotasPainel.get("/painel/posganho", async (c) => {
  const p = c.get("usuario").permissoes;
  if (!podeVer(p, "posganho")) return c.json({ erro: "Sem acesso." }, 403);
  const hoje = hojeBrasilia();
  const em7 = hojeBrasilia(7);
  const em30 = hojeBrasilia(30);
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const db = c.env.DB;
  const [porEtapa, entregas, aFaturar, mes, atasVencendo, saldoBaixo] = await db.batch([
    db.prepare(
      `SELECT e.etapa, COUNT(DISTINCT e.id) AS total, COALESCE(SUM(ei.quantidade * ei.valor_unitario), 0) AS valor
         FROM execucoes e LEFT JOIN execucao_itens ei ON ei.execucao_id = e.id GROUP BY e.etapa`,
    ),
    db
      .prepare(
        `SELECT e.id, e.numero_empenho, e.data_limite, e.etapa, l.orgao, l.numero AS licitacao_numero
           FROM execucoes e JOIN licitacoes l ON l.id = e.licitacao_id
          WHERE e.data_limite IS NOT NULL AND e.data_limite <= ? AND e.etapa IN (${lista(ETAPAS_ANTES_DA_ENTREGA)})
          ORDER BY e.data_limite LIMIT 10`,
      )
      .bind(em7),
    db.prepare(
      `SELECT COUNT(DISTINCT e.id) AS total, COALESCE(SUM(ei.quantidade * ei.valor_unitario), 0) AS valor
         FROM execucoes e LEFT JOIN execucao_itens ei ON ei.execucao_id = e.id
        WHERE e.data_empenho IS NOT NULL AND e.data_nota IS NULL
          AND e.etapa IN ('entrega_realizada', 'solicitar_atestado', 'concluido')`,
    ),
    db
      .prepare(
        `SELECT COUNT(DISTINCT e.id) AS empenhos, COALESCE(SUM(ei.quantidade * ei.valor_unitario), 0) AS valor
           FROM execucoes e LEFT JOIN execucao_itens ei ON ei.execucao_id = e.id WHERE e.data_empenho >= ?`,
      )
      .bind(inicioMes),
    db
      .prepare("SELECT id, nome, numero_ata, orgao_gerenciador, data_fim FROM atas WHERE data_fim BETWEEN ? AND ? ORDER BY data_fim LIMIT 6")
      .bind(hoje, em30),
    db
      .prepare(
        `SELECT a.id, a.nome, a.numero_ata, ai.item_numero, ai.produto, ai.quantidade,
                COALESCE((SELECT SUM(ei.quantidade) FROM execucao_itens ei WHERE ei.ata_item_id = ai.id), 0) AS empenhado
           FROM ata_itens ai JOIN atas a ON a.id = ai.ata_id
          WHERE (a.data_fim IS NULL OR a.data_fim >= ?) AND ai.quantidade > 0
            AND COALESCE((SELECT SUM(ei.quantidade) FROM execucao_itens ei WHERE ei.ata_item_id = ai.id), 0) >= ai.quantidade * 0.8
          LIMIT 8`,
      )
      .bind(hoje),
  ]);
  return c.json({
    hoje,
    porEtapa: porEtapa.results,
    entregas: entregas.results,
    aFaturar: podeVer(p, "financeiro") ? aFaturar.results[0] : null,
    mes: mes.results[0],
    atasVencendo: podeVer(p, "atas") ? atasVencendo.results : [],
    saldoBaixo: podeVer(p, "atas") ? saldoBaixo.results : [],
  });
});

// Eventos do calendário entre duas datas.
rotasPainel.get("/calendario", async (c) => {
  const de = c.req.query("de") ?? "";
  const ate = c.req.query("ate") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return c.json({ erro: "Período inválido." }, 400);
  }
  const db = c.env.DB;
  const [sessoes, entregas, atas] = await db.batch([
    db
      .prepare(
        `SELECT id, numero, orgao, modalidade, data_sessao AS data, horario, etapa
           FROM licitacoes WHERE data_sessao BETWEEN ?1 AND ?2
         UNION ALL
         SELECT id, numero, orgao, 'Reabertura' || COALESCE(' · ' || modalidade, ''), data_reabertura, hora_reabertura, etapa
           FROM licitacoes WHERE data_reabertura BETWEEN ?1 AND ?2 AND acompanhar = 1 AND etapa = 'boa_colocacao'`,
      )
      .bind(de, ate),
    db
      .prepare(
        `SELECT e.id, e.numero_empenho, e.data_limite AS data, e.etapa, l.orgao, l.numero
           FROM execucoes e JOIN licitacoes l ON l.id = e.licitacao_id
          WHERE e.data_limite BETWEEN ? AND ?`,
      )
      .bind(de, ate),
    db
      .prepare(
        `SELECT id, nome, numero_ata, orgao_gerenciador, data_fim AS data
           FROM atas WHERE data_fim BETWEEN ? AND ?`,
      )
      .bind(de, ate),
  ]);
  const p = c.get("usuario").permissoes;
  return c.json({
    sessoes: podeVer(p, "licitacoes") ? sessoes.results : [],
    entregas: podeVer(p, "posganho") ? entregas.results : [],
    atas: podeVer(p, "atas") ? atas.results : [],
  });
});

// Lista simples do time (para escolher responsável).
rotasPainel.get("/equipe", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, nome FROM usuarios WHERE ativo = 1 ORDER BY nome COLLATE NOCASE",
  ).all();
  return c.json({ equipe: results });
});
