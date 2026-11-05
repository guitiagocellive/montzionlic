import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  ChartColumnBig,
  Clock,
  FileSignature,
  Gavel,
  Plus,
  Target,
  TrendingUp,
  Truck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { diasAte, ETAPAS_EXECUCAO, ETAPAS_LICITACAO, ETAPAS_LICITACAO_ATIVAS } from "../../shared/negocio";
import { podeEditar, podeVer } from "../../shared/permissoes";
import type { Alerta, Usuario } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { avisar } from "../components/Ui";
import { diaMes, formatarMoeda, textoPrazo } from "../formato";
import { link } from "../rota";

interface DadosPainel {
  hoje: string;
  licitacoesPorEtapa: { etapa: string; total: number }[];
  valorEmDisputa: number;
  proximasSessoes: { id: number; numero: string | null; orgao: string | null; modalidade: string | null; data_sessao: string; horario: string | null }[];
  execucoesPorEtapa: { etapa: string; total: number }[];
  entregasProximas: { id: number; data_limite: string }[];
  valores: { vendido: number; lucro: number };
  atas: { vigentes: number | null; vencendo: number | null };
}

export const ICONES_ALERTA = {
  sessao: Clock,
  sessao_sem_orcamento: TriangleAlert,
  entrega: Truck,
  entrega_atrasada: Truck,
  ata: FileSignature,
};

function saudacao(hora: number) {
  if (hora < 5 || hora >= 18) return "Boa noite";
  if (hora < 12) return "Bom dia";
  return "Boa tarde";
}

export function Painel({ usuario }: { usuario: Usuario }) {
  const [dados, setDados] = useState<DadosPainel | null>(null);
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const p = usuario.permissoes;

  useEffect(() => {
    api<DadosPainel>("/painel").then(setDados, (err) => avisar(mensagemDeErro(err), "erro"));
    api<{ alertas: Alerta[] }>("/alertas").then((r) => setAlertas(r.alertas), () => setAlertas([]));
  }, []);

  const conta = (lista: { etapa: string; total: number }[] | undefined, chave: string) =>
    lista?.find((x) => x.etapa === chave)?.total ?? 0;
  const ativas = ETAPAS_LICITACAO_ATIVAS.reduce((s, e) => s + conta(dados?.licitacoesPorEtapa, e), 0);
  const ganhas = conta(dados?.licitacoesPorEtapa, "ganha");
  const perdidas = conta(dados?.licitacoesPorEtapa, "perdida");
  const taxa = ganhas + perdidas > 0 ? Math.round((ganhas / (ganhas + perdidas)) * 100) : null;
  const atrasadas = (dados?.entregasProximas ?? []).filter((e) => diasAte(e.data_limite, dados!.hoje) < 0).length;
  const amanha = (dados?.proximasSessoes ?? []).filter((s) => diasAte(s.data_sessao, dados!.hoje) <= 1).length;
  const maxEtapa = Math.max(1, ...ETAPAS_LICITACAO.map((e) => conta(dados?.licitacoesPorEtapa, e.chave)));

  const hoje = new Date();
  const data = hoje.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  const kpis = [
    { nome: "Licitações em andamento", valor: dados ? ativas : "…", det: dados ? `${formatarMoeda(dados.valorEmDisputa)} estimados` : "", icone: Gavel, destino: "/licitacoes", ver: podeVer(p, "licitacoes") },
    { nome: "Sessões nos próximos 7 dias", valor: dados ? dados.proximasSessoes.length : "…", det: amanha ? `${amanha} hoje ou amanhã` : "Nenhuma para amanhã", icone: CalendarClock, destino: "/calendario", ver: podeVer(p, "licitacoes") },
    { nome: "Taxa de sucesso", valor: taxa == null ? "—" : `${taxa}%`, det: `${ganhas} ganhas · ${perdidas} perdidas`, icone: Target, destino: "/licitacoes", ver: podeVer(p, "licitacoes"), classe: taxa != null && taxa >= 30 ? "bom" : "" },
    { nome: "Entregas atrasadas", valor: dados ? atrasadas : "…", det: atrasadas ? "Precisam de atenção" : "Tudo em dia", icone: Truck, destino: "/pos-ganho", ver: podeVer(p, "posganho"), classe: atrasadas ? "risco" : "bom" },
  ].filter((k) => k.ver);

  return (
    <>
      <div className="cabecalho-painel entrar">
        <div>
          <span className="sobretitulo">{data.charAt(0).toUpperCase() + data.slice(1)}</span>
          <h1>
            {saudacao(hoje.getHours())}, {usuario.nome.split(" ")[0]}
          </h1>
        </div>
        {podeEditar(p, "licitacoes") && (
          <a className="botao" {...link("/licitacoes?nova=1")}>
            <Plus /> Nova licitação
          </a>
        )}
      </div>

      {kpis.length > 0 && (
        <section className="kpis">
          {kpis.map((k, i) => {
            const Icone = k.icone;
            return (
              <a key={k.nome} className={`kpi entrar ${k.classe ?? ""}`} style={{ ["--i" as string]: i + 1 }} {...link(k.destino)}>
                <div className="kpi-topo">
                  <span className="kpi-nome">{k.nome}</span>
                  <span className="icone-redondo">
                    <Icone />
                  </span>
                </div>
                <div className="kpi-valor">{k.valor}</div>
                <div className="kpi-det">
                  {k.classe === "bom" && <TrendingUp />}
                  {k.det}
                </div>
              </a>
            );
          })}
        </section>
      )}

      <section className="grade-painel">
        {podeVer(p, "licitacoes") && (
          <div className="cartao entrar" style={{ ["--i" as string]: 5 }}>
            <div className="cartao-titulo">
              <h2>
                <ChartColumnBig size={17} /> Licitações por etapa
              </h2>
              <a className="link-suave pequeno" {...link("/licitacoes")}>
                Abrir quadro <ArrowUpRight size={14} />
              </a>
            </div>
            <div className="barras">
              {ETAPAS_LICITACAO.map((e, i) => {
                const total = conta(dados?.licitacoesPorEtapa, e.chave);
                return (
                  <div key={e.chave} className="barra-coluna">
                    <div className="barra-trilho">
                      <span className="barra-valor">{total}</span>
                      <div
                        className={`barra ${total === maxEtapa && total > 0 ? "destaque" : ""}`}
                        style={{ height: `${(total / maxEtapa) * 78}%`, ["--i" as string]: i }}
                      />
                    </div>
                    <span className="barra-rotulo">{e.nome}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="cartao entrar" style={{ ["--i" as string]: 6 }}>
          <div className="cartao-titulo">
            <h2>Alertas</h2>
            {alertas && alertas.length > 0 && (
              <a className="link-suave pequeno" {...link("/alertas")}>
                Ver todos ({alertas.length}) <ArrowUpRight size={14} />
              </a>
            )}
          </div>
          {alertas === null ? (
            <p className="texto-fraco pequeno">Carregando…</p>
          ) : alertas.length === 0 ? (
            <p className="texto-fraco pequeno">Nenhum alerta. Tudo em dia.</p>
          ) : (
            <div className="lista-alertas">
              {alertas.slice(0, 4).map((a, i) => {
                const Icone = ICONES_ALERTA[a.tipo];
                return (
                  <a key={i} className="item-alerta" {...link(a.link)}>
                    <span className={`icone-redondo ${a.gravidade}`}>
                      <Icone />
                    </span>
                    <span>
                      <strong>{a.titulo}</strong>
                      <small>{a.detalhe}</small>
                    </span>
                    <ArrowRight />
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {podeVer(p, "licitacoes") && (
          <div className="cartao entrar" style={{ ["--i" as string]: 7 }}>
            <div className="cartao-titulo">
              <h2>Próximas sessões</h2>
              <a className="link-suave pequeno" {...link("/calendario")}>
                Calendário <ArrowUpRight size={14} />
              </a>
            </div>
            {!dados?.proximasSessoes.length ? (
              <p className="texto-fraco pequeno">Nenhuma sessão nos próximos 7 dias.</p>
            ) : (
              dados.proximasSessoes.slice(0, 5).map((s) => {
                const dias = diasAte(s.data_sessao, dados.hoje);
                const { dia, mes } = diaMes(s.data_sessao);
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
                      <span>{[s.orgao, s.horario].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className={`selo ${dias <= 1 ? "acento" : ""}`}>{textoPrazo(dias)}</span>
                  </a>
                );
              })
            )}
          </div>
        )}

        {(podeVer(p, "posganho") || podeVer(p, "atas")) && (
          <div className="cartao entrar" style={{ ["--i" as string]: 8 }}>
            <div className="cartao-titulo">
              <h2>Pós-ganho</h2>
              {podeVer(p, "posganho") && (
                <a className="link-suave pequeno" {...link("/pos-ganho")}>
                  Empenhos <ArrowUpRight size={14} />
                </a>
              )}
            </div>
            <div className="numeros-painel">
              {podeVer(p, "posganho") && (
                <>
                  <div>
                    <span>Vendido em empenhos</span>
                    <strong>{formatarMoeda(dados?.valores.vendido ?? 0)}</strong>
                  </div>
                  <div>
                    <span>Lucro previsto</span>
                    <strong className="texto-verde">{formatarMoeda(dados?.valores.lucro ?? 0)}</strong>
                  </div>
                </>
              )}
              {podeVer(p, "atas") && (
                <>
                  <div>
                    <span>Atas vigentes</span>
                    <strong>{dados?.atas.vigentes ?? 0}</strong>
                  </div>
                  <div>
                    <span>Vencem em 30 dias</span>
                    <strong className={(dados?.atas.vencendo ?? 0) > 0 ? "texto-amarelo" : ""}>{dados?.atas.vencendo ?? 0}</strong>
                  </div>
                </>
              )}
            </div>
            {podeVer(p, "posganho") && (
              <div className="mini-etapas">
                {ETAPAS_EXECUCAO.filter((e) => e.chave !== "concluido").map((e) => (
                  <div key={e.chave} className="mini-etapa" style={{ ["--cor-etapa" as string]: e.cor }}>
                    <span className="coluna-ponto" />
                    <span>{e.nome}</span>
                    <strong>{conta(dados?.execucoesPorEtapa, e.chave)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
