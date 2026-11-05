import {
  CalendarClock,
  ChartColumnBig,
  FileSignature,
  Gavel,
  PieChart,
  Target,
  TrendingUp,
  Truck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { diasAte, ETAPAS_EXECUCAO, ETAPAS_LICITACAO, ETAPAS_LICITACAO_ATIVAS } from "../../shared/negocio";
import type { Usuario } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { avisar } from "../components/Ui";
import { formatarDataCurta, formatarMoeda, textoPrazo } from "../formato";
import { link } from "../rota";

interface DadosPainel {
  hoje: string;
  licitacoesPorEtapa: { etapa: string; total: number }[];
  valorEmDisputa: number;
  proximasSessoes: { id: number; numero: string | null; orgao: string | null; modalidade: string | null; data_sessao: string; horario: string | null; portal: string | null }[];
  execucoesPorEtapa: { etapa: string; total: number }[];
  entregasProximas: { id: number; numero_empenho: string | null; data_limite: string; orgao: string | null; licitacao_numero: string | null }[];
  valores: { vendido: number; lucro: number };
  atas: { vigentes: number | null; vencendo: number | null };
  licitacoesPorNicho: { nicho: string; total: number }[];
}

function saudacao(hora: number) {
  if (hora < 5) return "Boa noite";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function useAgora() {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return agora;
}

export function Painel({ usuario }: { usuario: Usuario }) {
  const agora = useAgora();
  const [dados, setDados] = useState<DadosPainel | null>(null);

  useEffect(() => {
    api<DadosPainel>("/painel").then(setDados, (err) => avisar(mensagemDeErro(err), "erro"));
  }, []);

  const contagem = (lista: { etapa: string; total: number }[] | undefined, chave: string) =>
    lista?.find((x) => x.etapa === chave)?.total ?? 0;

  const ativas = ETAPAS_LICITACAO_ATIVAS.reduce((s, e) => s + contagem(dados?.licitacoesPorEtapa, e), 0);
  const ganhas = contagem(dados?.licitacoesPorEtapa, "ganha");
  const perdidas = contagem(dados?.licitacoesPorEtapa, "perdida");
  const taxa = ganhas + perdidas > 0 ? Math.round((ganhas / (ganhas + perdidas)) * 100) : null;
  const atrasadas = (dados?.entregasProximas ?? []).filter((e) => diasAte(e.data_limite, dados!.hoje) < 0).length;
  const maxEtapa = Math.max(1, ...ETAPAS_LICITACAO.map((e) => contagem(dados?.licitacoesPorEtapa, e.chave)));
  const maxNicho = Math.max(1, ...(dados?.licitacoesPorNicho ?? []).map((n) => n.total));

  const indicadores = [
    { nome: "Licitações em andamento", valor: dados ? String(ativas) : "…", detalhe: dados ? `${formatarMoeda(dados.valorEmDisputa)} estimados` : "", icone: Gavel },
    { nome: "Sessões nos próximos 7 dias", valor: dados ? String(dados.proximasSessoes.length) : "…", detalhe: "Fique de olho nos horários", icone: CalendarClock },
    { nome: "Taxa de sucesso", valor: taxa == null ? "—" : `${taxa}%`, detalhe: `${ganhas} ganhas · ${perdidas} perdidas`, icone: Target },
    { nome: "Entregas atrasadas", valor: dados ? String(atrasadas) : "…", detalhe: atrasadas ? "Precisam de atenção" : "Tudo em dia", icone: Truck, alerta: atrasadas > 0 },
  ];

  return (
    <div className="grade-painel">
      <section className="cartao boas-vindas entrar" style={{ margin: 0 }}>
        <div className="boas-vindas-texto">
          <span className="rotulo">
            <span className="ponto-vivo" /> Sistema online
          </span>
          <h1>
            {saudacao(agora.getHours())}, <span className="texto-gradiente">{usuario.nome.split(" ")[0]}</span>
          </h1>
          <p className="texto-suave">Este é o resumo das suas licitações, empenhos e atas.</p>
        </div>
        <div className="relogio">
          <strong>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>
          <span>{maiuscula(agora.toLocaleDateString("pt-BR", { weekday: "long" }))}</span>
        </div>
        <svg className="onda" viewBox="0 0 1200 90" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="grad-onda" x1="0" x2="1">
              <stop offset="0" stopColor="#8b5cf6" stopOpacity="0" />
              <stop offset="0.5" stopColor="#d946ef" />
              <stop offset="1" stopColor="#ec4899" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id="grad-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#d946ef" stopOpacity="0.22" />
              <stop offset="1" stopColor="#d946ef" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0 70 C120 70 160 30 260 38 S420 80 520 58 S700 12 800 30 S980 76 1080 46 S1160 30 1200 34 V90 H0Z" fill="url(#grad-area)" />
          <path className="linha-onda" d="M0 70 C120 70 160 30 260 38 S420 80 520 58 S700 12 800 30 S980 76 1080 46 S1160 30 1200 34" fill="none" stroke="url(#grad-onda)" strokeWidth="2.5" />
        </svg>
      </section>

      {indicadores.map(({ nome, valor, detalhe, icone: Icone, alerta }, i) => (
        <section key={nome} className={`cartao indicador entrar ${alerta ? "alerta-ind" : ""}`} style={{ margin: 0, ["--i" as string]: i + 1 }}>
          <div className="indicador-topo">
            <span className="icone-brilho">
              <Icone aria-hidden="true" />
            </span>
          </div>
          <div>
            <div className="indicador-valor">{valor}</div>
            <div className="indicador-nome">{nome}</div>
            {detalhe && <div className="texto-fraco pequeno">{detalhe}</div>}
          </div>
        </section>
      ))}

      <section className="cartao funil entrar" style={{ margin: 0, ["--i" as string]: 5 }}>
        <div className="cartao-titulo">
          <h2>
            <ChartColumnBig size={18} color="#f0abfc" aria-hidden="true" /> Licitações por etapa
          </h2>
          <a className="link-suave pequeno" {...link("/licitacoes")}>
            Abrir quadro →
          </a>
        </div>
        <div className="barras com-rotulos">
          {ETAPAS_LICITACAO.map((e, i) => {
            const total = contagem(dados?.licitacoesPorEtapa, e.chave);
            return (
              <div key={e.chave} className="barra-coluna">
                <span className="barra-valor">{total}</span>
                <div
                  className={`barra ${total === maxEtapa && total > 0 ? "destaque" : ""}`}
                  style={{ ["--h" as string]: `${Math.max(4, (total / maxEtapa) * 100)}%`, ["--i" as string]: i }}
                />
                <span className="barra-rotulo">{e.nome}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="cartao lista-painel entrar" style={{ margin: 0, ["--i" as string]: 6 }}>
        <div className="cartao-titulo">
          <h2>
            <CalendarClock size={18} color="#f0abfc" aria-hidden="true" /> Próximas sessões
          </h2>
          <a className="link-suave pequeno" {...link("/calendario")}>
            Calendário →
          </a>
        </div>
        {!dados?.proximasSessoes.length ? (
          <p className="texto-fraco pequeno">Nenhuma sessão nos próximos 7 dias.</p>
        ) : (
          dados.proximasSessoes.map((s) => {
            const dias = diasAte(s.data_sessao, dados.hoje);
            return (
              <a key={s.id} className="linha-painel" {...link(`/licitacoes/${s.id}`)}>
                <span className="data-bloco">
                  <strong>{formatarDataCurta(s.data_sessao).split(" ")[0]}</strong>
                  <small>{formatarDataCurta(s.data_sessao).split(" ")[1]}</small>
                </span>
                <span className="linha-painel-texto">
                  <strong>Nº {s.numero ?? "—"}</strong>
                  <span className="texto-fraco pequeno">{[s.orgao, s.horario].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={`selo ${dias <= 1 ? "amarelo" : "cinza"}`}>{textoPrazo(dias)}</span>
              </a>
            );
          })
        )}
      </section>

      <section className="cartao lista-painel entrar" style={{ margin: 0, ["--i" as string]: 7 }}>
        <div className="cartao-titulo">
          <h2>
            <Truck size={18} color="#f0abfc" aria-hidden="true" /> Entregas próximas
          </h2>
          <a className="link-suave pequeno" {...link("/pos-ganho")}>
            Empenhos →
          </a>
        </div>
        {!dados?.entregasProximas.length ? (
          <p className="texto-fraco pequeno">Nenhuma entrega vencendo nos próximos 7 dias.</p>
        ) : (
          dados.entregasProximas.map((e) => {
            const dias = diasAte(e.data_limite, dados.hoje);
            return (
              <a key={e.id} className="linha-painel" {...link(`/pos-ganho/${e.id}`)}>
                <span className="data-bloco">
                  <strong>{formatarDataCurta(e.data_limite).split(" ")[0]}</strong>
                  <small>{formatarDataCurta(e.data_limite).split(" ")[1]}</small>
                </span>
                <span className="linha-painel-texto">
                  <strong>{e.numero_empenho ? `Empenho ${e.numero_empenho}` : `Licitação ${e.licitacao_numero ?? "—"}`}</strong>
                  <span className="texto-fraco pequeno">{e.orgao}</span>
                </span>
                <span className={`selo ${dias < 0 ? "vermelho" : dias <= 2 ? "amarelo" : "cinza"}`}>
                  {dias < 0 ? "Atrasada" : textoPrazo(dias)}
                </span>
              </a>
            );
          })
        )}
      </section>

      <section className="cartao entrar posganho-resumo" style={{ margin: 0, ["--i" as string]: 8 }}>
        <div className="cartao-titulo">
          <h2>
            <TrendingUp size={18} color="#f0abfc" aria-hidden="true" /> Pós-ganho
          </h2>
        </div>
        <div className="numeros-painel">
          <div>
            <span>Vendido (empenhos)</span>
            <strong className="texto-gradiente">{formatarMoeda(dados?.valores.vendido ?? 0)}</strong>
          </div>
          <div>
            <span>Lucro previsto</span>
            <strong className="texto-verde">{formatarMoeda(dados?.valores.lucro ?? 0)}</strong>
          </div>
          <div>
            <span>
              <FileSignature size={14} aria-hidden="true" /> Atas vigentes
            </span>
            <strong>{dados?.atas.vigentes ?? 0}</strong>
          </div>
          <div>
            <span>Atas vencendo em 30 dias</span>
            <strong className={(dados?.atas.vencendo ?? 0) > 0 ? "texto-amarelo" : ""}>{dados?.atas.vencendo ?? 0}</strong>
          </div>
        </div>
        <div className="mini-etapas">
          {ETAPAS_EXECUCAO.map((e) => (
            <div key={e.chave} className="mini-etapa" style={{ ["--cor-etapa" as string]: e.cor }}>
              <span className="coluna-ponto" />
              <span>{e.nome}</span>
              <strong>{contagem(dados?.execucoesPorEtapa, e.chave)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="cartao entrar nichos" style={{ margin: 0, ["--i" as string]: 9 }}>
        <div className="cartao-titulo">
          <h2>
            <PieChart size={18} color="#f0abfc" aria-hidden="true" /> Licitações por nicho
          </h2>
        </div>
        {!dados?.licitacoesPorNicho.length ? (
          <p className="texto-fraco pequeno">Cadastre licitações para ver os nichos.</p>
        ) : (
          dados.licitacoesPorNicho.map((n) => (
            <div key={n.nicho} className="linha-nicho">
              <span>{n.nicho}</span>
              <div className="barra-progresso">
                <span style={{ width: `${(n.total / maxNicho) * 100}%` }} />
              </div>
              <strong>{n.total}</strong>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
