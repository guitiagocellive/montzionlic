import { BarChart3, Building2, Download, Swords, Target, TrendingUp, Trophy, XCircle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api, mensagemDeErro } from "../api";
import { SeletorIntervalo } from "../components/Calendario";
import { avisar, Carregando } from "../components/Ui";
import { formatarMoeda, formatarNumero } from "../formato";
import { baixarCsv, nomeMes, periodo, taxa } from "../components/Periodo";

interface Grupo {
  nome: string;
  participacoes: number;
  ganhas: number;
  perdidas: number;
}

interface Dados {
  de: string;
  ate: string;
  resumo: { participadas: number; ganhas: number | null; perdidas: number | null; em_andamento: number | null; valor_estimado: number };
  porMes: { mes: string; ganhas: number; perdidas: number }[];
  porOrgao: Grupo[];
  porNicho: Grupo[];
  porModalidade: Grupo[];
  motivosLicitacao: { motivo: string; total: number }[];
  motivosItens: { motivo: string; total: number }[];
  concorrentes: { nome: string; vitorias: number; diferenca_media: number | null }[];
  itens: { ganhos: number | null; perdidos: number | null; cancelados: number | null; valor_ganho: number };
  financeiro: { empenhos: number; empenhado: number; lucro: number; porMes: { mes: string; empenhado: number }[] } | null;
}

function TabelaGrupo({ titulo, icone, grupos, arquivo }: { titulo: string; icone: ReactNode; grupos: Grupo[]; arquivo: string }) {
  const max = Math.max(1, ...grupos.map((g) => g.participacoes));
  return (
    <section className="cartao">
      <div className="cartao-titulo">
        <h2>
          {icone} {titulo}
        </h2>
        {grupos.length > 0 && (
          <button
            className="botao link"
            onClick={() => baixarCsv(arquivo, [["Nome", "Disputas", "Ganhas", "Perdidas", "Taxa"], ...grupos.map((g) => [g.nome, g.participacoes, g.ganhas, g.perdidas, taxa(g.ganhas, g.perdidas)])])}
          >
            <Download size={14} /> CSV
          </button>
        )}
      </div>
      {grupos.length === 0 ? (
        <p className="texto-fraco pequeno">Sem dados no período.</p>
      ) : (
        <div className="tabela-relatorio">
          <div className="linha-relatorio cabecalho">
            <span>Nome</span>
            <span>Disputas</span>
            <span>Ganhas</span>
            <span>Perdidas</span>
            <span>Taxa</span>
          </div>
          {grupos.map((g) => (
            <div key={g.nome} className="linha-relatorio">
              <span className="nome-relatorio">
                {g.nome}
                <span className="barra-progresso fina">
                  <span style={{ width: `${(g.participacoes / max) * 100}%` }} />
                </span>
              </span>
              <span>{g.participacoes}</span>
              <span className="texto-verde">{g.ganhas}</span>
              <span className="texto-vermelho">{g.perdidas}</span>
              <strong>{taxa(g.ganhas, g.perdidas)}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function Relatorios() {
  const [tipo, setTipo] = useState("ano");
  const [[de, ate], setDatas] = useState(() => periodo("ano"));
  const [dados, setDados] = useState<Dados | null>(null);

  useEffect(() => {
    setDados(null);
    api<Dados>(`/relatorios?de=${de}&ate=${ate}`).then(setDados, (err) => avisar(mensagemDeErro(err), "erro"));
  }, [de, ate]);

  function escolher(t: string) {
    setTipo(t);
    if (t !== "personalizado") setDatas(periodo(t));
  }

  const ganhas = dados?.resumo.ganhas ?? 0;
  const perdidas = dados?.resumo.perdidas ?? 0;
  const motivos = (() => {
    const mapa = new Map<string, number>();
    for (const m of [...(dados?.motivosLicitacao ?? []), ...(dados?.motivosItens ?? [])]) mapa.set(m.motivo, (mapa.get(m.motivo) ?? 0) + m.total);
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const maxMotivo = Math.max(1, ...motivos.map((m) => m[1]));
  const meses = (() => {
    const todos = new Set([...(dados?.porMes ?? []).map((m) => m.mes), ...(dados?.financeiro?.porMes ?? []).map((m) => m.mes)]);
    return [...todos].filter(Boolean).sort();
  })();
  const maxResultado = Math.max(1, ...(dados?.porMes ?? []).map((m) => Math.max(m.ganhas, m.perdidas)));
  const maxEmpenho = Math.max(1, ...(dados?.financeiro?.porMes ?? []).map((m) => m.empenhado));

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Visão geral</span>
          <h1>Relatórios</h1>
          <p className="texto-suave">Desempenho nas disputas, motivos de perda, concorrentes e empenhos.</p>
        </div>
      </div>

      <div className="barra-periodo entrar" style={{ ["--i" as string]: 1 }}>
        <div className="segmentado grande">
          {[
            ["mes", "Este mês"],
            ["trimestre", "3 meses"],
            ["ano", "Este ano"],
            ["12meses", "12 meses"],
            ["personalizado", "Personalizado"],
          ].map(([v, r]) => (
            <button key={v} className={tipo === v ? "ativo" : ""} onClick={() => escolher(v)}>
              {r}
            </button>
          ))}
        </div>
        {tipo === "personalizado" && (
          <div className="linha-acoes">
            <div className="campo campo-periodo">
              <span>Período (início e fim)</span>
              <SeletorIntervalo de={de} ate={ate} aoMudar={(x, y) => setDatas([x, y])} rotulo="Período" />
            </div>
          </div>
        )}
      </div>

      {!dados ? (
        <Carregando />
      ) : (
        <>
          <section className="kpis">
            <div className="kpi entrar" style={{ ["--i" as string]: 2 }}>
              <div className="kpi-topo">
                <span className="kpi-nome">Licitações no período</span>
                <span className="icone-redondo"><BarChart3 /></span>
              </div>
              <div className="kpi-valor">{dados.resumo.participadas}</div>
              <div className="kpi-det">{dados.resumo.em_andamento ?? 0} em andamento · {formatarMoeda(dados.resumo.valor_estimado)} estimados</div>
            </div>
            <div className="kpi entrar" style={{ ["--i" as string]: 3 }}>
              <div className="kpi-topo">
                <span className="kpi-nome">Taxa de sucesso</span>
                <span className="icone-redondo"><Target /></span>
              </div>
              <div className="kpi-valor">{taxa(ganhas, perdidas)}</div>
              <div className="kpi-det">{ganhas} ganhas · {perdidas} perdidas</div>
            </div>
            <div className="kpi entrar" style={{ ["--i" as string]: 4 }}>
              <div className="kpi-topo">
                <span className="kpi-nome">Itens disputados</span>
                <span className="icone-redondo"><Trophy /></span>
              </div>
              <div className="kpi-valor">{(dados.itens.ganhos ?? 0) + (dados.itens.perdidos ?? 0)}</div>
              <div className="kpi-det">{dados.itens.ganhos ?? 0} ganhos · {formatarMoeda(dados.itens.valor_ganho)}</div>
            </div>
            {dados.financeiro && (
              <div className="kpi entrar bom" style={{ ["--i" as string]: 5 }}>
                <div className="kpi-topo">
                  <span className="kpi-nome">Empenhado no período</span>
                  <span className="icone-redondo"><TrendingUp /></span>
                </div>
                <div className="kpi-valor">{formatarMoeda(dados.financeiro.empenhado)}</div>
                <div className="kpi-det">{dados.financeiro.empenhos} empenho(s) · lucro {formatarMoeda(dados.financeiro.lucro)}</div>
              </div>
            )}
          </section>

          <div className="grade-relatorio">
            <section className="cartao entrar" style={{ ["--i" as string]: 6 }}>
              <div className="cartao-titulo">
                <h2>
                  <BarChart3 size={17} /> Resultados por mês
                </h2>
                <span className="legenda-mini">
                  <i className="ponto verde" /> Ganhas <i className="ponto vermelho" /> Perdidas
                  {dados.financeiro && (
                    <>
                      <i className="ponto acento" /> Empenhado
                    </>
                  )}
                </span>
              </div>
              {meses.length === 0 ? (
                <p className="texto-fraco pequeno">Sem resultados no período.</p>
              ) : (
                <div className="grafico-meses">
                  {meses.map((m, i) => {
                    const r = dados.porMes.find((x) => x.mes === m);
                    const e = dados.financeiro?.porMes.find((x) => x.mes === m);
                    return (
                      <div key={m} className="mes-coluna">
                        <div className="mes-barras">
                          <div className="barra verde" style={{ height: `${((r?.ganhas ?? 0) / maxResultado) * 100}%`, ["--i" as string]: i }} title={`${r?.ganhas ?? 0} ganhas`} />
                          <div className="barra vermelho" style={{ height: `${((r?.perdidas ?? 0) / maxResultado) * 100}%`, ["--i" as string]: i }} title={`${r?.perdidas ?? 0} perdidas`} />
                          {dados.financeiro && (
                            <div className="barra destaque" style={{ height: `${((e?.empenhado ?? 0) / maxEmpenho) * 100}%`, ["--i" as string]: i }} title={formatarMoeda(e?.empenhado ?? 0)} />
                          )}
                        </div>
                        <span className="barra-rotulo">{nomeMes(m)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="cartao entrar" style={{ ["--i" as string]: 7 }}>
              <div className="cartao-titulo">
                <h2>
                  <XCircle size={17} /> Por que perdemos
                </h2>
              </div>
              {motivos.length === 0 ? (
                <p className="texto-fraco pequeno">Registre o resultado das disputas para ver os motivos.</p>
              ) : (
                motivos.map(([motivo, total]) => (
                  <div key={motivo} className="linha-motivo">
                    <span>{motivo}</span>
                    <div className="barra-progresso">
                      <span style={{ width: `${(total / maxMotivo) * 100}%`, background: "var(--vermelho)" }} />
                    </div>
                    <strong>{total}</strong>
                  </div>
                ))
              )}
            </section>
          </div>

          <section className="cartao entrar" style={{ ["--i" as string]: 8 }}>
            <div className="cartao-titulo">
              <h2>
                <Swords size={17} /> Concorrentes que mais ganharam de nós
              </h2>
            </div>
            {dados.concorrentes.length === 0 ? (
              <p className="texto-fraco pequeno">Registre a empresa vencedora nos itens perdidos (aba Resultado da licitação).</p>
            ) : (
              <div className="tabela-relatorio">
                <div className="linha-relatorio cabecalho tres">
                  <span>Empresa</span>
                  <span>Itens ganhos</span>
                  <span>Preço abaixo do nosso (média)</span>
                </div>
                {dados.concorrentes.map((c) => (
                  <div key={c.nome} className="linha-relatorio tres">
                    <span>{c.nome}</span>
                    <strong>{c.vitorias}</strong>
                    <span>{c.diferenca_media == null ? "—" : `${formatarNumero(c.diferenca_media * 100)}%`}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grade-relatorio">
            <TabelaGrupo titulo="Por órgão" icone={<Building2 size={17} />} grupos={dados.porOrgao} arquivo={`relatorio-orgaos-${de}-a-${ate}.csv`} />
            <TabelaGrupo titulo="Por nicho" icone={<Target size={17} />} grupos={dados.porNicho} arquivo={`relatorio-nichos-${de}-a-${ate}.csv`} />
          </div>
          <TabelaGrupo titulo="Por modalidade" icone={<BarChart3 size={17} />} grupos={dados.porModalidade} arquivo={`relatorio-modalidades-${de}-a-${ate}.csv`} />
        </>
      )}
    </>
  );
}
