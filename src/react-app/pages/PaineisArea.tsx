import { ArrowUpRight, CalendarClock, ChartColumnBig, Eye, EyeOff, PackageMinus, Receipt, RotateCcw, Target, TriangleAlert, Trophy, Truck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { diasAte, ETAPAS_EXECUCAO, ETAPAS_LICITACAO } from "../../shared/negocio";
import { api, mensagemDeErro } from "../api";
import { Avatar } from "../components/Avatar";
import { taxa } from "../components/Periodo";
import { avisar, Carregando } from "../components/Ui";
import { diaMes, formatarData, formatarMoeda, textoPrazo } from "../formato";
import { link } from "../rota";

// ---------------- Painel de Licitações ----------------

interface DadosLicitacoes {
  hoje: string;
  porEtapa: { etapa: string; total: number; valor: number }[];
  sessoes: { id: number; numero: string | null; orgao: string | null; modalidade: string | null; etapa: string; data: string; horario: string | null; reabertura: number }[];
  semOrcamento: { id: number; numero: string | null; orgao: string | null; data_sessao: string }[];
  resultadoAno: { ganhas: number | null; perdidas: number | null };
  recentes: { id: number; numero: string | null; orgao: string | null; etapa: string; data_resultado: string | null; motivo_perda: string | null }[];
  porResponsavel: { id: number | null; nome: string; cor: string | null; foto: string | null; total: number }[];
  boaColocacao: { id: number; numero: string | null; orgao: string | null; colocacao: number | null; situacao_disputa: string | null; data_reabertura: string | null; hora_reabertura: string | null; acompanhar: number }[];
}

function Barras({ etapas, dados, destino }: { etapas: { chave: string; nome: string }[]; dados: { etapa: string; total: number }[]; destino: string }) {
  const conta = (k: string) => dados.find((x) => x.etapa === k)?.total ?? 0;
  const max = Math.max(1, ...etapas.map((e) => conta(e.chave)));
  return (
    <div className="barras">
      {etapas.map((e, i) => {
        const total = conta(e.chave);
        return (
          <a key={e.chave} className="barra-coluna" {...link(destino)}>
            <div className="barra-trilho">
              <span className="barra-valor">{total}</span>
              <div className={`barra ${total === max && total > 0 ? "destaque" : ""}`} style={{ height: `${(total / max) * 78}%`, ["--i" as string]: i }} />
            </div>
            <span className="barra-rotulo">{e.nome}</span>
          </a>
        );
      })}
    </div>
  );
}

export function PainelLicitacoes() {
  const [d, setD] = useState<DadosLicitacoes | null>(null);
  useEffect(() => {
    api<DadosLicitacoes>("/painel/licitacoes").then(setD, (err) => avisar(mensagemDeErro(err), "erro"));
  }, []);
  if (!d) return <Carregando />;

  const ativas = d.porEtapa.filter((e) => ["estudar", "fazer", "orcamento", "boa_colocacao"].includes(e.etapa));
  const emAndamento = ativas.reduce((s, e) => s + e.total, 0);
  const emDisputa = ativas.reduce((s, e) => s + e.valor, 0);
  const ganhas = d.resultadoAno.ganhas ?? 0;
  const perdidas = d.resultadoAno.perdidas ?? 0;
  const maxResp = Math.max(1, ...d.porResponsavel.map((r) => r.total));

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Painel de licitações</h1>
          <p className="texto-suave">O que está em andamento, as próximas sessões e como estamos nas disputas.</p>
        </div>
        <a className="botao secundario" {...link("/licitacoes")}>
          Abrir quadro <ArrowUpRight />
        </a>
      </div>

      <section className="kpis">
        <a className="kpi entrar" style={{ ["--i" as string]: 1 }} {...link("/licitacoes")}>
          <div className="kpi-topo">
            <span className="kpi-nome">Em andamento</span>
            <Target size={16} />
          </div>
          <div className="kpi-valor">{emAndamento}</div>
          <div className="kpi-det">{formatarMoeda(emDisputa)} estimados em disputa</div>
        </a>
        <div className="kpi entrar" style={{ ["--i" as string]: 2 }}>
          <div className="kpi-topo">
            <span className="kpi-nome">Sessões em 14 dias</span>
            <CalendarClock size={16} />
          </div>
          <div className="kpi-valor">{d.sessoes.length}</div>
          <div className="kpi-det">{d.sessoes.filter((s) => s.reabertura).length} reabertura(s)</div>
        </div>
        <div className={`kpi entrar ${d.semOrcamento.length ? "atencao" : ""}`} style={{ ["--i" as string]: 3 }}>
          <div className="kpi-topo">
            <span className="kpi-nome">Sem orçamento</span>
            <TriangleAlert size={16} />
          </div>
          <div className="kpi-valor">{d.semOrcamento.length}</div>
          <div className="kpi-det">com sessão marcada e nenhum produto cotado</div>
        </div>
        <div className="kpi entrar bom" style={{ ["--i" as string]: 4 }}>
          <div className="kpi-topo">
            <span className="kpi-nome">Taxa de sucesso no ano</span>
            <Trophy size={16} />
          </div>
          <div className="kpi-valor">{taxa(ganhas, perdidas)}</div>
          <div className="kpi-det">
            {ganhas} ganhas · {perdidas} perdidas
          </div>
        </div>
      </section>

      <section className="grade-painel">
        <div className="cartao entrar" style={{ ["--i" as string]: 5 }}>
          <div className="cartao-titulo">
            <h2>
              <ChartColumnBig size={17} /> Funil por etapa
            </h2>
          </div>
          <Barras etapas={ETAPAS_LICITACAO} dados={d.porEtapa} destino="/licitacoes" />
        </div>

        <div className="cartao entrar" style={{ ["--i" as string]: 6 }}>
          <div className="cartao-titulo">
            <h2>Próximas sessões</h2>
            <a className="link-suave pequeno" {...link("/calendario")}>
              Calendário <ArrowUpRight size={14} />
            </a>
          </div>
          {d.sessoes.length === 0 ? (
            <p className="texto-fraco pequeno">Nenhuma sessão nos próximos 14 dias.</p>
          ) : (
            d.sessoes.slice(0, 6).map((s) => {
              const dias = diasAte(s.data, d.hoje);
              const { dia, mes } = diaMes(s.data);
              return (
                <a key={s.id} className="linha-painel" {...link(`/licitacoes/${s.id}`)}>
                  <span className="data-bloco">
                    <strong>{dia}</strong>
                    <small>{mes}</small>
                  </span>
                  <span className="linha-painel-texto">
                    <strong>
                      {s.modalidade ?? "Licitação"} {s.numero ?? ""}
                    </strong>
                    <span>{[s.reabertura ? "Reabertura" : null, s.orgao, s.horario].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={`selo ${s.reabertura ? "amarelo" : dias <= 1 ? "acento" : ""}`}>{textoPrazo(dias)}</span>
                </a>
              );
            })
          )}
        </div>

        <div className="cartao entrar" style={{ ["--i" as string]: 7 }}>
          <div className="cartao-titulo">
            <h2>
              <Trophy size={17} /> Boa colocação
            </h2>
          </div>
          {d.boaColocacao.length === 0 ? (
            <p className="texto-fraco pequeno">Nenhuma licitação em boa colocação.</p>
          ) : (
            d.boaColocacao.slice(0, 6).map((l) => (
              <a key={l.id} className={`linha-painel ${l.acompanhar ? "" : "apagada"}`} {...link(`/licitacoes/${l.id}`)}>
                <span className="data-bloco">
                  <strong>{l.colocacao ? `${l.colocacao}º` : "—"}</strong>
                  <small>lugar</small>
                </span>
                <span className="linha-painel-texto">
                  <strong>
                    {l.numero ?? "Sem número"} · {l.orgao ?? ""}
                  </strong>
                  <span>
                    {[l.situacao_disputa, l.data_reabertura && `Reabre ${formatarData(l.data_reabertura)}${l.hora_reabertura ? ` às ${l.hora_reabertura}` : ""}`]
                      .filter(Boolean)
                      .join(" · ") || "Sem situação registrada"}
                  </span>
                </span>
                {l.acompanhar ? <Eye size={16} className="texto-verde" /> : <EyeOff size={16} className="texto-fraco" />}
              </a>
            ))
          )}
        </div>

        <div className="cartao entrar" style={{ ["--i" as string]: 8 }}>
          <div className="cartao-titulo">
            <h2>
              <RotateCcw size={17} /> Resultados recentes
            </h2>
            <a className="link-suave pequeno" {...link("/relatorios")}>
              Relatórios <ArrowUpRight size={14} />
            </a>
          </div>
          {d.recentes.length === 0 ? (
            <p className="texto-fraco pequeno">Nenhum resultado ainda.</p>
          ) : (
            d.recentes.map((l) => (
              <a key={l.id} className="linha-painel" {...link(`/licitacoes/${l.id}`)}>
                <span className="linha-painel-texto">
                  <strong>
                    {l.numero ?? "Sem número"} · {l.orgao ?? ""}
                  </strong>
                  <span>{[l.data_resultado && formatarData(l.data_resultado), l.etapa === "perdida" ? l.motivo_perda : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={`selo ${l.etapa === "ganha" ? "verde" : "vermelho"}`}>{l.etapa === "ganha" ? "Ganha" : "Perdida"}</span>
              </a>
            ))
          )}
        </div>

        <div className="cartao entrar" style={{ ["--i" as string]: 9 }}>
          <div className="cartao-titulo">
            <h2>
              <Users size={17} /> Em andamento por responsável
            </h2>
          </div>
          {d.porResponsavel.length === 0 ? (
            <p className="texto-fraco pequeno">Nenhuma licitação em andamento.</p>
          ) : (
            d.porResponsavel.map((r) => (
              <div key={r.id ?? 0} className="linha-motivo">
                <span className="responsavel-resumo">
                  {r.id ? <Avatar nome={r.nome} cor={r.cor} foto={r.foto} pequeno /> : null}
                  {r.nome}
                </span>
                <div className="barra-progresso">
                  <span style={{ width: `${(r.total / maxResp) * 100}%`, background: r.cor ?? "var(--acento)" }} />
                </div>
                <strong>{r.total}</strong>
              </div>
            ))
          )}
        </div>

        {d.semOrcamento.length > 0 && (
          <div className="cartao entrar" style={{ ["--i" as string]: 10 }}>
            <div className="cartao-titulo">
              <h2>
                <TriangleAlert size={17} /> Faltando orçamento
              </h2>
            </div>
            {d.semOrcamento.map((l) => (
              <a key={l.id} className="linha-painel" {...link(`/licitacoes/${l.id}?aba=orcamento`)}>
                <span className="linha-painel-texto">
                  <strong>
                    {l.numero ?? "Sem número"} · {l.orgao ?? ""}
                  </strong>
                  <span>Sessão em {formatarData(l.data_sessao)}</span>
                </span>
                <span className="selo amarelo">{textoPrazo(diasAte(l.data_sessao, d.hoje))}</span>
              </a>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// ---------------- Painel de Pós-ganho ----------------

interface DadosPosGanho {
  hoje: string;
  porEtapa: { etapa: string; total: number; valor: number }[];
  entregas: { id: number; numero_empenho: string | null; data_limite: string; etapa: string; orgao: string | null; licitacao_numero: string | null }[];
  aFaturar: { total: number; valor: number } | null;
  mes: { empenhos: number; valor: number };
  atasVencendo: { id: number; nome: string | null; numero_ata: string | null; orgao_gerenciador: string | null; data_fim: string }[];
  saldoBaixo: { id: number; nome: string | null; numero_ata: string | null; item_numero: string | null; produto: string | null; quantidade: number; empenhado: number }[];
}

export function PainelPosGanho() {
  const [d, setD] = useState<DadosPosGanho | null>(null);
  useEffect(() => {
    api<DadosPosGanho>("/painel/posganho").then(setD, (err) => avisar(mensagemDeErro(err), "erro"));
  }, []);
  if (!d) return <Carregando />;

  const abertos = d.porEtapa.filter((e) => e.etapa !== "concluido");
  const emAberto = abertos.reduce((s, e) => s + e.total, 0);
  const atrasadas = d.entregas.filter((e) => diasAte(e.data_limite, d.hoje) < 0).length;

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Pós-ganho</span>
          <h1>Painel de pós-ganho</h1>
          <p className="texto-suave">Empenhos em andamento, entregas, faturamento e atas.</p>
        </div>
        <a className="botao secundario" {...link("/pos-ganho")}>
          Abrir quadro <ArrowUpRight />
        </a>
      </div>

      <section className="kpis">
        <a className="kpi entrar" style={{ ["--i" as string]: 1 }} {...link("/pos-ganho")}>
          <div className="kpi-topo">
            <span className="kpi-nome">Empenhos em aberto</span>
            <PackageMinus size={16} />
          </div>
          <div className="kpi-valor">{emAberto}</div>
          <div className="kpi-det">{formatarMoeda(abertos.reduce((s, e) => s + e.valor, 0))} em andamento</div>
        </a>
        <div className={`kpi entrar ${atrasadas ? "atencao" : ""}`} style={{ ["--i" as string]: 2 }}>
          <div className="kpi-topo">
            <span className="kpi-nome">Entregas na semana</span>
            <Truck size={16} />
          </div>
          <div className="kpi-valor">{d.entregas.length}</div>
          <div className="kpi-det">{atrasadas ? `${atrasadas} atrasada(s)` : "nenhuma atrasada"}</div>
        </div>
        {d.aFaturar && (
          <a className={`kpi entrar ${d.aFaturar.total ? "atencao" : ""}`} style={{ ["--i" as string]: 3 }} {...link("/financeiro")}>
            <div className="kpi-topo">
              <span className="kpi-nome">Entregue, a faturar</span>
              <Receipt size={16} />
            </div>
            <div className="kpi-valor">{formatarMoeda(d.aFaturar.valor)}</div>
            <div className="kpi-det">{d.aFaturar.total} empenho(s) sem nota fiscal</div>
          </a>
        )}
        <div className="kpi entrar bom" style={{ ["--i" as string]: 4 }}>
          <div className="kpi-topo">
            <span className="kpi-nome">Empenhado no mês</span>
            <Trophy size={16} />
          </div>
          <div className="kpi-valor">{formatarMoeda(d.mes.valor)}</div>
          <div className="kpi-det">{d.mes.empenhos} empenho(s)</div>
        </div>
      </section>

      <section className="grade-painel">
        <div className="cartao entrar" style={{ ["--i" as string]: 5 }}>
          <div className="cartao-titulo">
            <h2>
              <ChartColumnBig size={17} /> Empenhos por etapa
            </h2>
          </div>
          <Barras etapas={ETAPAS_EXECUCAO} dados={d.porEtapa} destino="/pos-ganho" />
        </div>

        <div className="cartao entrar" style={{ ["--i" as string]: 6 }}>
          <div className="cartao-titulo">
            <h2>
              <Truck size={17} /> Entregas vencendo ou atrasadas
            </h2>
          </div>
          {d.entregas.length === 0 ? (
            <p className="texto-fraco pequeno">Nenhuma entrega vencendo nos próximos 7 dias.</p>
          ) : (
            d.entregas.map((e) => {
              const dias = diasAte(e.data_limite, d.hoje);
              const { dia, mes } = diaMes(e.data_limite);
              return (
                <a key={e.id} className="linha-painel" {...link(`/pos-ganho/${e.id}`)}>
                  <span className="data-bloco">
                    <strong>{dia}</strong>
                    <small>{mes}</small>
                  </span>
                  <span className="linha-painel-texto">
                    <strong>{e.numero_empenho ? `Empenho ${e.numero_empenho}` : `Licitação ${e.licitacao_numero ?? "—"}`}</strong>
                    <span>{e.orgao}</span>
                  </span>
                  <span className={`selo ${dias < 0 ? "vermelho" : dias <= 2 ? "amarelo" : ""}`}>{dias < 0 ? `Atrasada ${-dias}d` : textoPrazo(dias)}</span>
                </a>
              );
            })
          )}
        </div>

        <div className="cartao entrar" style={{ ["--i" as string]: 7 }}>
          <div className="cartao-titulo">
            <h2>Atas</h2>
            <a className="link-suave pequeno" {...link("/atas")}>
              Atas vigentes <ArrowUpRight size={14} />
            </a>
          </div>
          {d.atasVencendo.length === 0 && d.saldoBaixo.length === 0 ? (
            <p className="texto-fraco pequeno">Nenhuma ata vencendo em 30 dias e nenhum saldo baixo.</p>
          ) : (
            <>
              {d.atasVencendo.map((a) => (
                <a key={`v${a.id}`} className="linha-painel" {...link("/atas")}>
                  <span className="linha-painel-texto">
                    <strong>{a.nome || `Ata ${a.numero_ata ?? ""}`}</strong>
                    <span>{a.orgao_gerenciador}</span>
                  </span>
                  <span className="selo amarelo">Vence {formatarData(a.data_fim)}</span>
                </a>
              ))}
              {d.saldoBaixo.map((s, i) => (
                <a key={`s${i}`} className="linha-painel" {...link("/atas")}>
                  <span className="linha-painel-texto">
                    <strong>
                      Item {s.item_numero ?? ""} · {s.produto ?? ""}
                    </strong>
                    <span>{s.nome || `Ata ${s.numero_ata ?? ""}`}</span>
                  </span>
                  <span className={`selo ${s.empenhado >= s.quantidade ? "vermelho" : "amarelo"}`}>
                    Saldo {Math.max(0, s.quantidade - s.empenhado)}
                  </span>
                </a>
              ))}
            </>
          )}
        </div>
      </section>
    </>
  );
}
