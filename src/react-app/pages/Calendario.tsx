import { ChevronLeft, ChevronRight, FileSignature, Gavel, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, mensagemDeErro } from "../api";
import { avisar } from "../components/Ui";
import { hojeIso } from "../formato";
import { navegar } from "../rota";

type TipoEvento = "sessao" | "entrega" | "ata";

interface Evento {
  tipo: TipoEvento;
  data: string;
  titulo: string;
  /** Texto curto que cabe dentro do dia. */
  curto: string;
  detalhe: string;
  destino: string;
}

const NOMES_TIPO: Record<TipoEvento, string> = {
  sessao: "Sessão de licitação",
  entrega: "Prazo de entrega",
  ata: "Fim de ata",
};

const ICONES = { sessao: Gavel, entrega: Truck, ata: FileSignature };

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function Calendario() {
  const [mes, setMes] = useState(() => {
    const h = new Date();
    return new Date(h.getFullYear(), h.getMonth(), 1);
  });
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [selecionado, setSelecionado] = useState(hojeIso());
  const [tipos, setTipos] = useState<Set<TipoEvento>>(new Set(["sessao", "entrega", "ata"]));
  const hoje = hojeIso();

  // A grade começa no domingo da primeira semana e tem 6 semanas.
  const dias = useMemo(() => {
    const inicio = new Date(mes);
    inicio.setDate(1 - inicio.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(inicio);
      d.setDate(inicio.getDate() + i);
      return d;
    });
  }, [mes]);

  useEffect(() => {
    const de = iso(dias[0]);
    const ate = iso(dias[41]);
    api<{
      sessoes: { id: number; numero: string | null; orgao: string | null; modalidade: string | null; data: string; horario: string | null }[];
      entregas: { id: number; numero_empenho: string | null; data: string; orgao: string | null; numero: string | null }[];
      atas: { id: number; nome: string | null; numero_ata: string | null; orgao_gerenciador: string | null; data: string }[];
    }>(`/calendario?de=${de}&ate=${ate}`).then(
      (r) =>
        setEventos([
          ...r.sessoes.map((s) => ({
            tipo: "sessao" as const,
            data: s.data,
            titulo: `${s.horario ? `${s.horario} · ` : ""}Nº ${s.numero ?? "—"}`,
            curto: s.numero ?? s.orgao ?? "Sessão",
            detalhe: [s.orgao, s.modalidade].filter(Boolean).join(" · "),
            destino: `/licitacoes/${s.id}`,
          })),
          ...r.entregas.map((e) => ({
            tipo: "entrega" as const,
            data: e.data,
            titulo: e.numero_empenho ? `Empenho ${e.numero_empenho}` : `Entrega · Lic. ${e.numero ?? "—"}`,
            curto: `Entrega ${e.numero ?? ""}`.trim(),
            detalhe: e.orgao ?? "",
            destino: `/pos-ganho/${e.id}`,
          })),
          ...r.atas.map((a) => ({
            tipo: "ata" as const,
            data: a.data,
            titulo: a.nome || `Ata ${a.numero_ata ?? ""}`,
            curto: `Ata ${a.numero_ata ?? ""}`.trim(),
            detalhe: a.orgao_gerenciador ?? "",
            destino: "/atas",
          })),
        ]),
      (err) => avisar(mensagemDeErro(err), "erro"),
    );
  }, [dias]);

  const visiveis = eventos.filter((e) => tipos.has(e.tipo));
  const porDia = (d: string) => visiveis.filter((e) => e.data === d).sort((a, b) => a.titulo.localeCompare(b.titulo));
  const doDia = porDia(selecionado);

  function mudarMes(delta: number) {
    setMes((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  const titulo = mes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Visão geral</span>
          <h1>Calendário</h1>
          <p className="texto-suave">Sessões, prazos de entrega e vencimento de atas no mesmo lugar.</p>
        </div>
      </div>

      <div className="calendario-layout">
        <section className="cartao calendario entrar" style={{ ["--i" as string]: 1 }}>
          <div className="calendario-topo">
            <button className="botao-icone" onClick={() => mudarMes(-1)} aria-label="Mês anterior">
              <ChevronLeft />
            </button>
            <h2>{titulo.charAt(0).toUpperCase() + titulo.slice(1)}</h2>
            <button className="botao-icone" onClick={() => mudarMes(1)} aria-label="Próximo mês">
              <ChevronRight />
            </button>
            <button
              className="botao secundario pequeno"
              onClick={() => {
                const h = new Date();
                setMes(new Date(h.getFullYear(), h.getMonth(), 1));
                setSelecionado(hoje);
              }}
            >
              Hoje
            </button>
          </div>

          <div className="legenda-calendario">
            {(Object.keys(NOMES_TIPO) as TipoEvento[]).map((t) => (
              <button
                key={t}
                className={`legenda ${t} ${tipos.has(t) ? "" : "desligada"}`}
                onClick={() =>
                  setTipos((s) => {
                    const n = new Set(s);
                    if (n.has(t)) n.delete(t);
                    else n.add(t);
                    return n;
                  })
                }
              >
                <span className="ponto" /> {NOMES_TIPO[t]}
              </button>
            ))}
          </div>

          <div className="grade-calendario">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
              <div key={d} className="dia-semana">
                {d}
              </div>
            ))}
            {dias.map((d) => {
              const chave = iso(d);
              const lista = porDia(chave);
              const foraDoMes = d.getMonth() !== mes.getMonth();
              return (
                <button
                  key={chave}
                  className={`dia ${foraDoMes ? "fora" : ""} ${chave === hoje ? "hoje" : ""} ${chave === selecionado ? "selecionado" : ""}`}
                  onClick={() => setSelecionado(chave)}
                >
                  <span className="dia-numero">{d.getDate()}</span>
                  <span className="dia-eventos">
                    {lista.slice(0, 3).map((e, i) => (
                      <span key={i} className={`evento-chip ${e.tipo}`} title={e.titulo}>
                        {e.curto}
                      </span>
                    ))}
                    {lista.length > 3 && <span className="evento-mais">+{lista.length - 3}</span>}
                  </span>
                  {lista.length > 0 && (
                    <span className="dia-pontos">
                      {lista.slice(0, 4).map((e, i) => (
                        <span key={i} className={`ponto ${e.tipo}`} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="cartao agenda entrar" style={{ ["--i" as string]: 2 }}>
          <h2>
            {new Date(`${selecionado}T12:00:00`).toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h2>
          {doDia.length === 0 ? (
            <p className="texto-fraco">Nada marcado para este dia.</p>
          ) : (
            <div className="lista-agenda">
              {doDia.map((e, i) => {
                const Icone = ICONES[e.tipo];
                return (
                  <button key={i} className={`item-agenda ${e.tipo}`} onClick={() => navegar(e.destino)}>
                    <span className="icone-evento">
                      <Icone />
                    </span>
                    <span>
                      <small>{NOMES_TIPO[e.tipo]}</small>
                      <strong>{e.titulo}</strong>
                      {e.detalhe && <span className="texto-fraco pequeno">{e.detalhe}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
