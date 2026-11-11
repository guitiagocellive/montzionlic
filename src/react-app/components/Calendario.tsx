import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Calendário da plataforma (no lugar do seletor de data do navegador): data única ou intervalo início–fim.
// Valores sempre em "aaaa-mm-dd" (texto vazio = sem data).

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

const doisDigitos = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
const deIso = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const hoje = () => iso(new Date());
const somarDias = (s: string, n: number) => {
  const d = deIso(s) ?? new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
/** "aaaa-mm-dd" → "dd/mm/aaaa". */
export const dataBr = (s: string) => {
  const d = deIso(s);
  return d ? `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}` : "";
};

type Modo = "unico" | "intervalo";

interface PropsCalendario {
  modo: Modo;
  de: string;
  ate: string;
  min?: string;
  max?: string;
  atalhos?: boolean;
  aoEscolher: (de: string, ate: string, terminou: boolean) => void;
}

/** O calendário em si (grade de dias com navegação de mês e ano). */
export function Calendario({ modo, de, ate, min, max, atalhos, aoEscolher }: PropsCalendario) {
  const base = deIso(de) ?? deIso(ate) ?? new Date();
  const [mes, setMes] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1));
  const [vista, setVista] = useState<"dias" | "meses">("dias");
  const [passando, setPassando] = useState("");
  const [direcao, setDirecao] = useState(0);
  const escolhendoFim = modo === "intervalo" && !!de && !ate;

  const mudarMes = (n: number) => {
    setDirecao(n);
    setMes((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  };

  const dias: Date[] = [];
  const inicio = new Date(mes.getFullYear(), mes.getMonth(), 1 - mes.getDay());
  for (let i = 0; i < 42; i++) dias.push(new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i));

  // Durante a escolha do fim, o intervalo acompanha o mouse.
  const fimVisivel = escolhendoFim && passando ? passando : ate;
  const [a, b] = de && fimVisivel && fimVisivel < de ? [fimVisivel, de] : [de, fimVisivel];

  function clicar(dia: string) {
    if (modo === "unico") return aoEscolher(dia, dia, true);
    if (!de || ate) return aoEscolher(dia, "", false);
    const [x, y] = dia < de ? [dia, de] : [de, dia];
    aoEscolher(x, y, true);
  }

  const atalho = (rotulo: string, x: string, y: string) => (
    <button type="button" className="cal-atalho" onClick={() => aoEscolher(x, y, true)}>
      {rotulo}
    </button>
  );

  return (
    <div className="calendario" onMouseLeave={() => setPassando("")}>
      <div className="cal-topo">
        <button type="button" className="cal-seta" onClick={() => (vista === "dias" ? mudarMes(-1) : setMes((m) => new Date(m.getFullYear() - 1, m.getMonth(), 1)))} aria-label={vista === "dias" ? "Mês anterior" : "Ano anterior"}>
          <ChevronLeft />
        </button>
        <button type="button" className="cal-titulo" onClick={() => setVista((v) => (v === "dias" ? "meses" : "dias"))} aria-label="Escolher mês e ano">
          {vista === "dias" ? `${MESES[mes.getMonth()]} ${mes.getFullYear()}` : mes.getFullYear()}
        </button>
        <button type="button" className="cal-seta" onClick={() => (vista === "dias" ? mudarMes(1) : setMes((m) => new Date(m.getFullYear() + 1, m.getMonth(), 1)))} aria-label={vista === "dias" ? "Próximo mês" : "Próximo ano"}>
          <ChevronRight />
        </button>
      </div>

      {vista === "meses" ? (
        <div className="cal-meses">
          {MESES.map((nome, i) => (
            <button
              type="button"
              key={nome}
              className={i === mes.getMonth() ? "ativo" : ""}
              onClick={() => {
                setMes(new Date(mes.getFullYear(), i, 1));
                setVista("dias");
              }}
            >
              {nome.slice(0, 3)}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="cal-semana">
            {SEMANA.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className={`cal-dias ${direcao > 0 ? "vai" : direcao < 0 ? "volta" : ""}`} key={`${mes.getFullYear()}-${mes.getMonth()}`}>
            {dias.map((d) => {
              const s = iso(d);
              const fora = d.getMonth() !== mes.getMonth();
              const bloqueado = (!!min && s < min) || (!!max && s > max);
              const ponta = s === a || s === b;
              const dentro = !!a && !!b && s > a && s < b;
              const classes = [
                "cal-dia",
                fora && "fora",
                s === hoje() && "hoje",
                ponta && "escolhido",
                dentro && "no-intervalo",
                modo === "intervalo" && a && b && a !== b && s === a && "inicio",
                modo === "intervalo" && a && b && a !== b && s === b && "fim",
              ].filter(Boolean);
              return (
                <button
                  type="button"
                  key={s}
                  className={classes.join(" ")}
                  disabled={bloqueado}
                  onClick={() => clicar(s)}
                  onMouseEnter={() => escolhendoFim && setPassando(s)}
                  aria-label={dataBr(s)}
                  aria-pressed={ponta}
                >
                  <span>{d.getDate()}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {modo === "intervalo" && (
        <p className="cal-dica">{escolhendoFim ? "Agora clique no dia do fim." : de && ate ? `${dataBr(de)} até ${dataBr(ate)}` : "Clique no dia do início."}</p>
      )}

      <div className="cal-rodape">
        {modo === "intervalo" && atalhos ? (
          <div className="cal-atalhos">
            {atalho("Hoje", hoje(), hoje())}
            {atalho("Próx. 7 dias", hoje(), somarDias(hoje(), 7))}
            {atalho("Próx. 30 dias", hoje(), somarDias(hoje(), 30))}
            {atalho("Últ. 30 dias", somarDias(hoje(), -30), hoje())}
          </div>
        ) : (
          <button type="button" className="cal-atalho" onClick={() => aoEscolher(hoje(), hoje(), true)}>
            Hoje
          </button>
        )}
        <button type="button" className="cal-limpar" onClick={() => aoEscolher("", "", true)}>
          Limpar
        </button>
      </div>
    </div>
  );
}

/** Caixa flutuante presa ao botão (fica por cima de janelas e se ajusta à tela). */
function Flutuante({ ancora, aberto, fechar, children }: { ancora: React.RefObject<HTMLElement | null>; aberto: boolean; fechar: () => void; children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; acima: boolean } | null>(null);

  const posicionar = useCallback(() => {
    const el = ancora.current;
    const cx = caixa.current;
    if (!el || !cx) return;
    const r = el.getBoundingClientRect();
    const w = cx.offsetWidth;
    const h = cx.offsetHeight;
    const acima = r.bottom + h + 12 > innerHeight && r.top - h - 12 > 0;
    const left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    setPos({ top: acima ? r.top - h - 8 : r.bottom + 8, left, acima });
  }, [ancora]);

  useLayoutEffect(() => {
    if (!aberto) return setPos(null);
    posicionar();
    // Ao abrir junto com a página, o campo ainda pode não estar ligado: tenta de novo no próximo quadro.
    const quadro = requestAnimationFrame(posicionar);
    return () => cancelAnimationFrame(quadro);
  }, [aberto, posicionar]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent | TouchEvent) => {
      const alvo = e.target as Node;
      if (caixa.current?.contains(alvo) || ancora.current?.contains(alvo)) return;
      fechar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // não fecha a janela (modal) de trás
      fechar();
      ancora.current?.querySelector("button")?.focus();
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("touchstart", fora);
    window.addEventListener("keydown", tecla, true);
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("touchstart", fora);
      window.removeEventListener("keydown", tecla, true);
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [aberto, fechar, posicionar, ancora]);

  if (!aberto) return null;
  return createPortal(
    <div
      ref={caixa}
      className={`cal-flutuante ${pos?.acima ? "acima" : ""}`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? "visible" : "hidden" }}
      role="dialog"
      aria-label="Calendário"
    >
      {children}
    </div>,
    document.body,
  );
}

interface PropsSeletorData {
  valor?: string;
  valorInicial?: string;
  aoMudar?: (valor: string) => void;
  id?: string;
  nome?: string; // para formulários (vai num campo escondido)
  rotulo?: string; // nome acessível do botão
  placeholder?: string;
  desabilitado?: boolean;
  min?: string;
  max?: string;
}

/** Campo de data única: abre o calendário ao clicar. Funciona controlado (valor) ou solto (valorInicial + nome). */
export function SeletorData({ valor, valorInicial, aoMudar, id, nome, rotulo, placeholder = "dd/mm/aaaa", desabilitado, min, max }: PropsSeletorData) {
  const [interno, setInterno] = useState(valorInicial ?? "");
  const atual = valor ?? interno;
  const [aberto, setAberto] = useState(false);
  const ancora = useRef<HTMLDivElement>(null);
  const fechar = useCallback(() => setAberto(false), []);

  function escolher(v: string) {
    if (valor === undefined) setInterno(v);
    aoMudar?.(v);
    setAberto(false);
  }

  return (
    <div className={`seletor-data ${aberto ? "aberto" : ""}`} ref={ancora}>
      <button type="button" id={id} className="botao-data" onClick={() => setAberto((v) => !v)} disabled={desabilitado} aria-label={rotulo ? `${rotulo}: ${dataBr(atual) || "sem data"}` : undefined} aria-haspopup="dialog" aria-expanded={aberto}>
        <CalendarDays aria-hidden="true" />
        <span className={atual ? "" : "vazio"}>{dataBr(atual) || placeholder}</span>
      </button>
      {atual && !desabilitado && (
        <button type="button" className="limpar-data" onClick={() => escolher("")} aria-label="Limpar data">
          <X />
        </button>
      )}
      {nome && <input type="hidden" name={nome} value={atual} />}
      <Flutuante ancora={ancora} aberto={aberto} fechar={fechar}>
        <Calendario modo="unico" de={atual} ate={atual} min={min} max={max} aoEscolher={(d) => escolher(d)} />
      </Flutuante>
    </div>
  );
}

interface PropsSeletorIntervalo {
  de: string;
  ate: string;
  aoMudar: (de: string, ate: string) => void;
  rotulo?: string;
  placeholder?: string;
  abrirAoMontar?: boolean;
  atalhos?: boolean;
}

/** Campo de período (início e fim) num calendário só: primeiro clique = início, segundo = fim. */
export function SeletorIntervalo({ de, ate, aoMudar, rotulo = "Período", placeholder = "Escolher período", abrirAoMontar, atalhos = true }: PropsSeletorIntervalo) {
  const [aberto, setAberto] = useState(!!abrirAoMontar);
  const [rascunho, setRascunho] = useState<[string, string] | null>(null);
  const ancora = useRef<HTMLDivElement>(null);
  const fechar = useCallback(() => {
    setAberto(false);
    setRascunho(null);
  }, []);
  const [a, b] = rascunho ?? [de, ate];
  const texto = de && ate ? (de === ate ? dataBr(de) : `${dataBr(de)} – ${dataBr(ate)}`) : de ? `A partir de ${dataBr(de)}` : ate ? `Até ${dataBr(ate)}` : "";

  return (
    <div className={`seletor-data intervalo ${aberto ? "aberto" : ""}`} ref={ancora}>
      <button type="button" className="botao-data" onClick={() => (aberto ? fechar() : setAberto(true))} aria-label={`${rotulo}: ${texto || "sem datas"}`} aria-haspopup="dialog" aria-expanded={aberto}>
        <CalendarDays aria-hidden="true" />
        <span className={texto ? "" : "vazio"}>{texto || placeholder}</span>
      </button>
      {(de || ate) && (
        <button type="button" className="limpar-data" onClick={() => aoMudar("", "")} aria-label="Limpar período">
          <X />
        </button>
      )}
      <Flutuante ancora={ancora} aberto={aberto} fechar={fechar}>
        <Calendario
          modo="intervalo"
          de={a}
          ate={b}
          atalhos={atalhos}
          aoEscolher={(x, y, terminou) => {
            if (!terminou) return setRascunho([x, y]);
            aoMudar(x, y);
            fechar();
          }}
        />
      </Flutuante>
    </div>
  );
}
