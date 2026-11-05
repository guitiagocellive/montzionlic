import { Hono } from "hono";
import { podeVer } from "../../shared/permissoes";
import { type Ambiente, exigirLogin, exigirModulo } from "../auth";
import { hojeBrasilia } from "../configuracoes";

// Relatórios de desempenho: participações, resultados, motivos de perda, concorrentes e empenhos.
export const rotasRelatorios = new Hono<Ambiente>();
rotasRelatorios.use(exigirLogin, exigirModulo("licitacoes"));

const DATA = /^\d{4}-\d{2}-\d{2}$/;

rotasRelatorios.get("/", async (c) => {
  const hoje = hojeBrasilia();
  const de = DATA.test(c.req.query("de") ?? "") ? c.req.query("de")! : `${hoje.slice(0, 4)}-01-01`;
  const ate = DATA.test(c.req.query("ate") ?? "") ? c.req.query("ate")! : hoje;
  if (de > ate) return c.json({ erro: "A data inicial é depois da final." }, 400);
  const db = c.env.DB;
  const p = c.get("usuario").permissoes;

  // Licitação "do período": sessão ou resultado dentro das datas.
  const doPeriodo = `((l.data_sessao BETWEEN ?1 AND ?2) OR (l.data_resultado BETWEEN ?1 AND ?2))`;

  const [resumo, porMes, porOrgao, porNicho, porModalidade, motivosLic, motivosItens, concorrentes, itens, empenhos, empenhoMes] =
    await db.batch([
      db.prepare(
        `SELECT COUNT(*) AS participadas,
                SUM(CASE WHEN l.etapa = 'ganha' THEN 1 ELSE 0 END) AS ganhas,
                SUM(CASE WHEN l.etapa = 'perdida' THEN 1 ELSE 0 END) AS perdidas,
                SUM(CASE WHEN l.etapa NOT IN ('ganha', 'perdida') THEN 1 ELSE 0 END) AS em_andamento,
                COALESCE(SUM(l.valor_estimado), 0) AS valor_estimado
           FROM licitacoes l WHERE ${doPeriodo}`,
      ).bind(de, ate),
      db.prepare(
        `SELECT strftime('%Y-%m', l.data_resultado) AS mes,
                SUM(CASE WHEN l.etapa = 'ganha' THEN 1 ELSE 0 END) AS ganhas,
                SUM(CASE WHEN l.etapa = 'perdida' THEN 1 ELSE 0 END) AS perdidas
           FROM licitacoes l WHERE l.data_resultado BETWEEN ?1 AND ?2 GROUP BY mes ORDER BY mes`,
      ).bind(de, ate),
      db.prepare(
        `SELECT COALESCE(l.orgao, 'Órgão não informado') AS nome, COUNT(*) AS participacoes,
                SUM(CASE WHEN l.etapa = 'ganha' THEN 1 ELSE 0 END) AS ganhas,
                SUM(CASE WHEN l.etapa = 'perdida' THEN 1 ELSE 0 END) AS perdidas
           FROM licitacoes l WHERE ${doPeriodo} GROUP BY nome ORDER BY participacoes DESC, ganhas DESC LIMIT 10`,
      ).bind(de, ate),
      db.prepare(
        `SELECT COALESCE(l.nicho, 'Sem nicho') AS nome, COUNT(*) AS participacoes,
                SUM(CASE WHEN l.etapa = 'ganha' THEN 1 ELSE 0 END) AS ganhas,
                SUM(CASE WHEN l.etapa = 'perdida' THEN 1 ELSE 0 END) AS perdidas
           FROM licitacoes l WHERE ${doPeriodo} GROUP BY nome ORDER BY participacoes DESC LIMIT 10`,
      ).bind(de, ate),
      db.prepare(
        `SELECT COALESCE(l.modalidade, 'Não informada') AS nome, COUNT(*) AS participacoes,
                SUM(CASE WHEN l.etapa = 'ganha' THEN 1 ELSE 0 END) AS ganhas,
                SUM(CASE WHEN l.etapa = 'perdida' THEN 1 ELSE 0 END) AS perdidas
           FROM licitacoes l WHERE ${doPeriodo} GROUP BY nome ORDER BY participacoes DESC`,
      ).bind(de, ate),
      db.prepare(
        `SELECT COALESCE(l.motivo_perda, 'Não informado') AS motivo, COUNT(*) AS total
           FROM licitacoes l WHERE l.etapa = 'perdida' AND ${doPeriodo} GROUP BY motivo ORDER BY total DESC`,
      ).bind(de, ate),
      db.prepare(
        `SELECT COALESCE(i.motivo_perda, 'Não informado') AS motivo, COUNT(*) AS total
           FROM licitacao_itens i JOIN licitacoes l ON l.id = i.licitacao_id
          WHERE i.resultado = 'perdido' AND ${doPeriodo} GROUP BY motivo ORDER BY total DESC`,
      ).bind(de, ate),
      db.prepare(
        `SELECT i.vencedor AS nome, COUNT(*) AS vitorias,
                AVG(CASE WHEN i.nosso_lance > 0 AND i.valor_vencedor > 0 THEN (i.nosso_lance - i.valor_vencedor) / i.nosso_lance END) AS diferenca_media
           FROM licitacao_itens i JOIN licitacoes l ON l.id = i.licitacao_id
          WHERE i.resultado = 'perdido' AND i.vencedor IS NOT NULL AND ${doPeriodo}
          GROUP BY LOWER(TRIM(i.vencedor)) ORDER BY vitorias DESC LIMIT 10`,
      ).bind(de, ate),
      db.prepare(
        `SELECT SUM(CASE WHEN i.resultado = 'ganho' THEN 1 ELSE 0 END) AS ganhos,
                SUM(CASE WHEN i.resultado = 'perdido' THEN 1 ELSE 0 END) AS perdidos,
                SUM(CASE WHEN i.resultado = 'cancelado' THEN 1 ELSE 0 END) AS cancelados,
                COALESCE(SUM(CASE WHEN i.resultado = 'ganho' THEN i.nosso_lance * i.quantidade END), 0) AS valor_ganho
           FROM licitacao_itens i JOIN licitacoes l ON l.id = i.licitacao_id WHERE ${doPeriodo}`,
      ).bind(de, ate),
      db.prepare(
        `SELECT COUNT(DISTINCT e.id) AS empenhos,
                COALESCE(SUM(ei.quantidade * ei.valor_unitario), 0) AS empenhado,
                COALESCE(SUM(ei.quantidade * (ei.valor_unitario * (1 - l.imposto_percentual / 100.0) - ei.custo_unitario)), 0) AS lucro
           FROM execucoes e JOIN licitacoes l ON l.id = e.licitacao_id
           LEFT JOIN execucao_itens ei ON ei.execucao_id = e.id
          WHERE e.data_empenho BETWEEN ?1 AND ?2`,
      ).bind(de, ate),
      db.prepare(
        `SELECT strftime('%Y-%m', e.data_empenho) AS mes, COALESCE(SUM(ei.quantidade * ei.valor_unitario), 0) AS empenhado
           FROM execucoes e LEFT JOIN execucao_itens ei ON ei.execucao_id = e.id
          WHERE e.data_empenho BETWEEN ?1 AND ?2 GROUP BY mes ORDER BY mes`,
      ).bind(de, ate),
    ]);

  const verFinanceiro = podeVer(p, "posganho");
  return c.json({
    de,
    ate,
    resumo: resumo.results[0],
    porMes: porMes.results,
    porOrgao: porOrgao.results,
    porNicho: porNicho.results,
    porModalidade: porModalidade.results,
    motivosLicitacao: motivosLic.results,
    motivosItens: motivosItens.results,
    concorrentes: concorrentes.results,
    itens: itens.results[0],
    financeiro: verFinanceiro ? { ...(empenhos.results[0] as object), porMes: empenhoMes.results } : null,
  });
});
