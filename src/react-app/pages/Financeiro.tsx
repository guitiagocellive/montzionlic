import { BarChart3, Building2, CircleDollarSign, Download, FileClock, HandCoins, Landmark, Percent, Receipt, Truck, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { api, mensagemDeErro } from "../api";
import { BarraPeriodo, baixarCsv, nomeMes, usePeriodo } from "../components/Periodo";
import { avisar, Carregando } from "../components/Ui";
import { formatarData, formatarMoeda, formatarNumero } from "../formato";
import { link } from "../rota";

interface Empenho {
  id: number;
  numero_empenho: string | null;
  data_empenho: string | null;
  nota_fiscal: string | null;
  data_nota: string | null;
  data_pagamento: string | null;
  licitacao_numero: string | null;
  orgao: string | null;
  vendido: number;
  custo: number;
  impostos: number;
  frete: number;
  despesas: number;
  lucro: number;
  margem: number;
  situacao: "aguardando_empenho" | "a_faturar" | "a_receber" | "recebido";
}

interface Dados {
  de: string;
  ate: string;
  resumo: { empenhos: number; vendido: number; custo: number; impostos: number; frete: number; lucro: number };
  recebido: number;
  pendencias: Record<"aguardando_empenho" | "a_faturar" | "a_receber", { total: number; valor: number }>;
  porMes: { mes: string; vendido: number; lucro: number; impostos: number }[];
  porOrgao: { nome: string; empenhos: number; vendido: number; lucro: number }[];
  empenhos: Empenho[];
  pendentes: Empenho[];
}

const SITUACAO: Record<Empenho["situacao"], { nome: string; classe: string }> = {
  aguardando_empenho: { nome: "Aguardando empenho", classe: "" },
  a_faturar: { nome: "A faturar", classe: "amarelo" },
  a_receber: { nome: "A receber", classe: "acento" },
  recebido: { nome: "Recebido", classe: "verde" },
};

const pct = (n: number) => `${formatarNumero(n * 100)}%`;

export function Financeiro() {
  const p = usePeriodo("ano");
  const [dados, setDados] = useState<Dados | null>(null);

  useEffect(() => {
    setDados(null);
    api<Dados>(`/financeiro?de=${p.de}&ate=${p.ate}`).then(setDados, (err) => avisar(mensagemDeErro(err), "erro"));
  }, [p.de, p.ate]);

  const r = dados?.resumo;
  const margem = r && r.vendido > 0 ? r.lucro / r.vendido : 0;
  const maxMes = Math.max(1, ...(dados?.porMes ?? []).map((m) => m.vendido));
  const maxOrgao = Math.max(1, ...(dados?.porOrgao ?? []).map((o) => o.vendido));

  function exportar() {
    if (!dados) return;
    baixarCsv(`financeiro-${dados.de}-a-${dados.ate}.csv`, [
      ["Empenho", "Data", "Órgão", "Licitação", "Vendido", "Custo", "Impostos", "Frete/despesas", "Lucro", "Margem", "Nota fiscal", "Situação"],
      ...dados.empenhos.map((e) => [
        e.numero_empenho ?? "",
        e.data_empenho ? formatarData(e.data_empenho) : "",
        e.orgao ?? "",
        e.licitacao_numero ?? "",
        e.vendido.toFixed(2).replace(".", ","),
        e.custo.toFixed(2).replace(".", ","),
        e.impostos.toFixed(2).replace(".", ","),
        (e.frete + e.despesas).toFixed(2).replace(".", ","),
        e.lucro.toFixed(2).replace(".", ","),
        pct(e.margem),
        e.nota_fiscal ?? "",
        SITUACAO[e.situacao].nome,
      ]),
    ]);
  }

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Financeiro</span>
          <h1>Painel financeiro</h1>
          <p className="texto-suave">Quanto foi vendido, quanto foi de imposto e custo, e quanto sobrou de lucro.</p>
        </div>
        <button className="botao secundario" onClick={exportar} disabled={!dados?.empenhos.length}>
          <Download /> Exportar CSV
        </button>
      </div>

      <BarraPeriodo p={p} />

      {!dados || !r ? (
        <Carregando />
      ) : (
        <>
          <section className="kpis">
            <div className="kpi entrar" style={{ ["--i" as string]: 2 }}>
              <div className="kpi-topo">
                <span className="kpi-nome">Vendido (empenhado)</span>
                <CircleDollarSign size={16} />
              </div>
              <div className="kpi-valor">{formatarMoeda(r.vendido)}</div>
              <div className="kpi-det">{r.empenhos} empenho(s) no período</div>
            </div>
            <div className="kpi entrar" style={{ ["--i" as string]: 3 }}>
              <div className="kpi-topo">
                <span className="kpi-nome">Impostos</span>
                <Landmark size={16} />
              </div>
              <div className="kpi-valor">{formatarMoeda(r.impostos)}</div>
              <div className="kpi-det">{r.vendido > 0 ? pct(r.impostos / r.vendido) : "—"} do vendido</div>
            </div>
            <div className="kpi entrar" style={{ ["--i" as string]: 4 }}>
              <div className="kpi-topo">
                <span className="kpi-nome">Custo dos produtos</span>
                <Receipt size={16} />
              </div>
              <div className="kpi-valor">{formatarMoeda(r.custo)}</div>
              <div className="kpi-det">
                <Truck size={12} /> Frete e despesas: {formatarMoeda(r.frete)}
              </div>
            </div>
            <div className={`kpi entrar ${r.lucro >= 0 ? "bom" : ""}`} style={{ ["--i" as string]: 5 }}>
              <div className="kpi-topo">
                <span className="kpi-nome">Lucro líquido</span>
                <Percent size={16} />
              </div>
              <div className={`kpi-valor ${r.lucro < 0 ? "texto-vermelho" : ""}`}>{formatarMoeda(r.lucro)}</div>
              <div className="kpi-det">Margem de {pct(margem)}</div>
            </div>
          </section>

          <section className="cartao entrar" style={{ ["--i" as string]: 6 }}>
            <div className="cartao-titulo">
              <h2>
                <Wallet size={17} /> Situação dos recebimentos
              </h2>
              <span className="texto-fraco pequeno">Pendências de todos os empenhos · recebido no período</span>
            </div>
            <div className="faixa-recebimentos">
              {[
                { chave: "aguardando_empenho" as const, nome: "Ganho, aguardando empenho", icone: <FileClock size={16} /> },
                { chave: "a_faturar" as const, nome: "Empenhado, a faturar", icone: <Receipt size={16} /> },
                { chave: "a_receber" as const, nome: "Faturado, a receber", icone: <HandCoins size={16} /> },
              ].map((x) => (
                <div key={x.chave} className={`etapa-recebimento ${SITUACAO[x.chave].classe}`}>
                  <span className="pequeno">
                    {x.icone} {x.nome}
                  </span>
                  <strong>{formatarMoeda(dados.pendencias[x.chave].valor)}</strong>
                  <span className="texto-fraco pequeno">{dados.pendencias[x.chave].total} empenho(s)</span>
                </div>
              ))}
              <div className="etapa-recebimento verde">
                <span className="pequeno">
                  <Wallet size={16} /> Recebido no período
                </span>
                <strong>{formatarMoeda(dados.recebido)}</strong>
                <span className="texto-fraco pequeno">pela data de pagamento</span>
              </div>
            </div>
            {dados.pendentes.length > 0 && (
              <div className="tabela-relatorio" style={{ marginTop: 14 }}>
                <div className="linha-relatorio cabecalho fin-pendente">
                  <span>Empenho</span>
                  <span>Situação</span>
                  <span>Valor</span>
                  <span>Nota / data</span>
                </div>
                {dados.pendentes.slice(0, 10).map((e) => (
                  <a key={e.id} className="linha-relatorio fin-pendente link-linha" {...link(`/pos-ganho/${e.id}`)}>
                    <span className="nome-relatorio">
                      {e.numero_empenho ? `Empenho ${e.numero_empenho}` : `Licitação ${e.licitacao_numero ?? "—"}`}
                      <small className="texto-fraco">{e.orgao}</small>
                    </span>
                    <span>
                      <span className={`selo ${SITUACAO[e.situacao].classe}`}>{SITUACAO[e.situacao].nome}</span>
                    </span>
                    <strong>{formatarMoeda(e.vendido)}</strong>
                    <span className="texto-fraco pequeno">
                      {e.nota_fiscal ? `NF ${e.nota_fiscal} · ${formatarData(e.data_nota)}` : e.data_empenho ? `Empenhado em ${formatarData(e.data_empenho)}` : "—"}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </section>

          <div className="grade-relatorio">
            <section className="cartao entrar" style={{ ["--i" as string]: 7 }}>
              <div className="cartao-titulo">
                <h2>
                  <BarChart3 size={17} /> Por mês
                </h2>
                <span className="legenda-mini">
                  <i className="ponto acento" /> Vendido <i className="ponto verde" /> Lucro <i className="ponto amarelo" /> Impostos
                </span>
              </div>
              {dados.porMes.length === 0 ? (
                <p className="texto-fraco pequeno">Sem empenhos no período.</p>
              ) : (
                <div className="grafico-meses">
                  {dados.porMes.map((m, i) => (
                    <div key={m.mes} className="mes-coluna">
                      <div className="mes-barras">
                        <div className="barra destaque" style={{ height: `${(m.vendido / maxMes) * 100}%`, ["--i" as string]: i }} title={`Vendido ${formatarMoeda(m.vendido)}`} />
                        <div className="barra verde" style={{ height: `${(Math.max(0, m.lucro) / maxMes) * 100}%`, ["--i" as string]: i }} title={`Lucro ${formatarMoeda(m.lucro)}`} />
                        <div className="barra amarelo" style={{ height: `${(m.impostos / maxMes) * 100}%`, ["--i" as string]: i }} title={`Impostos ${formatarMoeda(m.impostos)}`} />
                      </div>
                      <span className="barra-rotulo">{nomeMes(m.mes)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="cartao entrar" style={{ ["--i" as string]: 8 }}>
              <div className="cartao-titulo">
                <h2>
                  <Building2 size={17} /> Por órgão
                </h2>
              </div>
              {dados.porOrgao.length === 0 ? (
                <p className="texto-fraco pequeno">Sem empenhos no período.</p>
              ) : (
                <div className="tabela-relatorio">
                  <div className="linha-relatorio cabecalho tres">
                    <span>Órgão</span>
                    <span>Vendido</span>
                    <span>Lucro</span>
                  </div>
                  {dados.porOrgao.map((o) => (
                    <div key={o.nome} className="linha-relatorio tres">
                      <span className="nome-relatorio">
                        {o.nome}
                        <span className="barra-progresso fina">
                          <span style={{ width: `${(o.vendido / maxOrgao) * 100}%` }} />
                        </span>
                      </span>
                      <span>{formatarMoeda(o.vendido)}</span>
                      <strong className={o.lucro < 0 ? "texto-vermelho" : "texto-verde"}>{formatarMoeda(o.lucro)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="cartao entrar" style={{ ["--i" as string]: 9 }}>
            <div className="cartao-titulo">
              <h2>
                <Receipt size={17} /> Empenhos do período
              </h2>
              <span className="texto-fraco pequeno">Lucro = vendido − impostos − custo − frete e despesas</span>
            </div>
            {dados.empenhos.length === 0 ? (
              <p className="texto-fraco pequeno">Nenhum empenho com data no período.</p>
            ) : (
              <div className="tabela-rolavel">
                <table className="tabela-fin">
                  <thead>
                    <tr>
                      <th>Empenho</th>
                      <th>Vendido</th>
                      <th>Impostos</th>
                      <th>Custo</th>
                      <th>Frete/desp.</th>
                      <th>Lucro</th>
                      <th>Margem</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.empenhos.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <a className="link-suave" {...link(`/pos-ganho/${e.id}`)}>
                            {e.numero_empenho || `Licitação ${e.licitacao_numero ?? "—"}`}
                          </a>
                          <small className="texto-fraco">
                            {e.orgao} · {formatarData(e.data_empenho)}
                          </small>
                        </td>
                        <td>{formatarMoeda(e.vendido)}</td>
                        <td>{formatarMoeda(e.impostos)}</td>
                        <td>{formatarMoeda(e.custo)}</td>
                        <td>{formatarMoeda(e.frete + e.despesas)}</td>
                        <td className={e.lucro < 0 ? "texto-vermelho" : "texto-verde"}>
                          <strong>{formatarMoeda(e.lucro)}</strong>
                        </td>
                        <td>{pct(e.margem)}</td>
                        <td>
                          <span className={`selo ${SITUACAO[e.situacao].classe}`}>{SITUACAO[e.situacao].nome}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
