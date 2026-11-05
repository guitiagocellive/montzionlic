import { Hono } from "hono";
import { type Ambiente, exigirLogin, exigirModulo } from "../auth";
import { hojeBrasilia } from "../configuracoes";

// Financeiro: vendido, custo, impostos, frete, lucro, a faturar e a receber.
export const rotasFinanceiro = new Hono<Ambiente>();
rotasFinanceiro.use(exigirLogin, exigirModulo("financeiro"));

const DATA = /^\d{4}-\d{2}-\d{2}$/;

interface Linha {
  id: number;
  numero_empenho: string | null;
  data_empenho: string | null;
  etapa: string;
  nota_fiscal: string | null;
  data_nota: string | null;
  data_pagamento: string | null;
  valor_recebido: number | null;
  frete: number;
  despesas: number;
  licitacao_id: number;
  licitacao_numero: string | null;
  orgao: string | null;
  imposto_percentual: number;
  vendido: number;
  custo: number;
}

const arred = (n: number) => Math.round(n * 100) / 100;

function calcular(l: Linha) {
  const impostos = (l.vendido * (l.imposto_percentual ?? 0)) / 100;
  const lucro = l.vendido - impostos - l.custo - l.frete - l.despesas;
  const situacao = !l.data_empenho ? "aguardando_empenho" : !l.data_nota ? "a_faturar" : !l.data_pagamento ? "a_receber" : "recebido";
  return {
    ...l,
    impostos: arred(impostos),
    lucro: arred(lucro),
    margem: l.vendido > 0 ? lucro / l.vendido : 0,
    situacao,
  };
}

rotasFinanceiro.get("/", async (c) => {
  const hoje = hojeBrasilia();
  const de = DATA.test(c.req.query("de") ?? "") ? c.req.query("de")! : `${hoje.slice(0, 4)}-01-01`;
  const ate = DATA.test(c.req.query("ate") ?? "") ? c.req.query("ate")! : hoje;
  if (de > ate) return c.json({ erro: "A data inicial é depois da final." }, 400);

  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.numero_empenho, e.data_empenho, e.etapa, e.nota_fiscal, e.data_nota, e.data_pagamento, e.valor_recebido,
            COALESCE(e.frete, 0) AS frete, COALESCE(e.outras_despesas, 0) AS despesas,
            l.id AS licitacao_id, l.numero AS licitacao_numero, l.orgao, l.imposto_percentual,
            COALESCE(SUM(ei.quantidade * ei.valor_unitario), 0) AS vendido,
            COALESCE(SUM(ei.quantidade * ei.custo_unitario), 0) AS custo
       FROM execucoes e JOIN licitacoes l ON l.id = e.licitacao_id
       LEFT JOIN execucao_itens ei ON ei.execucao_id = e.id
      GROUP BY e.id
      ORDER BY e.data_empenho IS NULL, e.data_empenho DESC, e.id DESC`,
  ).all<Linha>();
  const todos = results.map(calcular);
  const doPeriodo = todos.filter((x) => x.data_empenho && x.data_empenho >= de && x.data_empenho <= ate);

  const soma = (lista: typeof todos, campo: "vendido" | "custo" | "impostos" | "frete" | "despesas" | "lucro") =>
    arred(lista.reduce((s, x) => s + (x[campo] ?? 0), 0));
  const resumo = {
    empenhos: doPeriodo.length,
    vendido: soma(doPeriodo, "vendido"),
    custo: soma(doPeriodo, "custo"),
    impostos: soma(doPeriodo, "impostos"),
    frete: arred(soma(doPeriodo, "frete") + soma(doPeriodo, "despesas")),
    lucro: soma(doPeriodo, "lucro"),
  };

  // Pendências (de todos os empenhos, não só do período)
  const grupo = (s: string) => todos.filter((x) => x.situacao === s);
  const pendencias = {
    aguardando_empenho: { total: grupo("aguardando_empenho").length, valor: soma(grupo("aguardando_empenho"), "vendido") },
    a_faturar: { total: grupo("a_faturar").length, valor: soma(grupo("a_faturar"), "vendido") },
    a_receber: { total: grupo("a_receber").length, valor: soma(grupo("a_receber"), "vendido") },
  };
  const recebidosPeriodo = todos.filter((x) => x.data_pagamento && x.data_pagamento >= de && x.data_pagamento <= ate);
  const recebido = arred(recebidosPeriodo.reduce((s, x) => s + (x.valor_recebido ?? x.vendido), 0));

  // Por mês e por órgão
  const porMesMapa = new Map<string, { mes: string; vendido: number; lucro: number; impostos: number }>();
  for (const x of doPeriodo) {
    const mes = x.data_empenho!.slice(0, 7);
    const m = porMesMapa.get(mes) ?? { mes, vendido: 0, lucro: 0, impostos: 0 };
    m.vendido += x.vendido;
    m.lucro += x.lucro;
    m.impostos += x.impostos;
    porMesMapa.set(mes, m);
  }
  const porOrgaoMapa = new Map<string, { nome: string; empenhos: number; vendido: number; lucro: number }>();
  for (const x of doPeriodo) {
    const nome = x.orgao || "Órgão não informado";
    const o = porOrgaoMapa.get(nome) ?? { nome, empenhos: 0, vendido: 0, lucro: 0 };
    o.empenhos += 1;
    o.vendido += x.vendido;
    o.lucro += x.lucro;
    porOrgaoMapa.set(nome, o);
  }

  return c.json({
    de,
    ate,
    resumo,
    recebido,
    pendencias,
    porMes: [...porMesMapa.values()].sort((a, b) => a.mes.localeCompare(b.mes)),
    porOrgao: [...porOrgaoMapa.values()].sort((a, b) => b.vendido - a.vendido).slice(0, 10),
    empenhos: doPeriodo,
    pendentes: todos.filter((x) => x.situacao === "a_faturar" || x.situacao === "a_receber").slice(0, 50),
  });
});
