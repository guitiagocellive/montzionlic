import { Hono } from "hono";
import {
  ETAPAS_ANTES_DA_ENTREGA,
  ETAPAS_LICITACAO_ATIVAS,
} from "../../shared/negocio";
import { type Ambiente, exigirLogin } from "../auth";

export const rotasPainel = new Hono<Ambiente>();
rotasPainel.use(exigirLogin);

/** Data de hoje no horário de Brasília (AAAA-MM-DD). */
export function hojeBrasilia(deslocamentoDias = 0): string {
  const agora = new Date(Date.now() - 3 * 60 * 60 * 1000 + deslocamentoDias * 86_400_000);
  return agora.toISOString().slice(0, 10);
}

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

  return c.json({
    hoje,
    licitacoesPorEtapa: porEtapa.results,
    valorEmDisputa: (emDisputa.results[0] as { valor: number }).valor,
    proximasSessoes: proximasSessoes.results,
    execucoesPorEtapa: porExecucao.results,
    entregasProximas: entregas.results,
    valores: valores.results[0],
    atas: atas.results[0],
    licitacoesPorNicho: porNicho.results,
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
           FROM licitacoes WHERE data_sessao BETWEEN ? AND ?`,
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
  return c.json({ sessoes: sessoes.results, entregas: entregas.results, atas: atas.results });
});

// Lista simples do time (para escolher responsável).
rotasPainel.get("/equipe", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, nome FROM usuarios WHERE ativo = 1 ORDER BY nome COLLATE NOCASE",
  ).all();
  return c.json({ equipe: results });
});
