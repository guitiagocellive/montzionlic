import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Menu do botão direito no desenho da plataforma (vidro, ícones, atalhos de teclado), no lugar do menu do navegador.

export interface ItemMenu {
  rotulo?: string;
  icone?: ReactNode;
  /** Texto pequeno à direita (ex.: "Hoje", um atalho). */
  dica?: string;
  aoClicar?: () => void;
  perigo?: boolean;
  desativado?: boolean;
  /** Explica por que está desativado (aparece ao passar o mouse). */
  motivo?: string;
  submenu?: ItemMenu[];
  /** Linha separadora (ignora o resto). */
  separador?: boolean;
  /** Título de seção (texto pequeno, não clicável). */
  titulo?: string;
}

function Lista({ itens, aoFechar, x, y, raiz }: { itens: ItemMenu[]; aoFechar: () => void; x: number; y: number; raiz?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [aberto, setAberto] = useState<number | null>(null);
  const [foco, setFoco] = useState(-1);
  const clicaveis = itens.map((it, i) => (!it.separador && !it.titulo && !it.desativado ? i : -1)).filter((i) => i >= 0);

  // Não deixa sair da tela: abre para cima/esquerda quando falta espaço.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = x + r.width > window.innerWidth - 8 ? Math.max(8, raiz ? x - r.width : x - r.width * 2 - 4) : x;
    const ny = y + r.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - r.height - 8) : y;
    setPos({ x: nx, y: ny });
  }, [x, y, raiz]);

  useEffect(() => {
    if (!raiz) return;
    ref.current?.focus();
  }, [raiz]);

  function teclar(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const atual = clicaveis.indexOf(foco);
      const prox = e.key === "ArrowDown" ? clicaveis[(atual + 1) % clicaveis.length] : clicaveis[(atual - 1 + clicaveis.length) % clicaveis.length];
      setFoco(prox ?? -1);
      setAberto(null);
    } else if ((e.key === "Enter" || e.key === " " || e.key === "ArrowRight") && foco >= 0) {
      e.preventDefault();
      e.stopPropagation();
      const it = itens[foco];
      if (it.submenu) setAberto(foco);
      else if (e.key !== "ArrowRight") escolher(it);
    }
  }

  function escolher(it: ItemMenu) {
    if (it.desativado || it.submenu) return;
    aoFechar();
    it.aoClicar?.();
  }

  return (
    <div
      ref={ref}
      className="menu-contexto"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={teclar}
      onContextMenu={(e) => e.preventDefault()}
    >
      {itens.map((it, i) =>
        it.separador ? (
          <div key={i} className="menu-contexto-separador" role="separator" />
        ) : it.titulo ? (
          <div key={i} className="menu-contexto-titulo">
            {it.titulo}
          </div>
        ) : (
          <div key={i} className="menu-contexto-linha" onMouseEnter={() => (setFoco(i), setAberto(it.submenu ? i : null))}>
            <button
              type="button"
              role="menuitem"
              className={`menu-contexto-item ${it.perigo ? "perigo" : ""} ${foco === i ? "foco" : ""}`}
              disabled={it.desativado}
              title={it.desativado ? it.motivo : undefined}
              aria-haspopup={it.submenu ? "menu" : undefined}
              aria-expanded={it.submenu ? aberto === i : undefined}
              onClick={() => (it.submenu ? setAberto(i) : escolher(it))}
            >
              <span className="menu-contexto-icone">{it.icone}</span>
              <span className="menu-contexto-rotulo">{it.rotulo}</span>
              {it.dica && <span className="menu-contexto-dica">{it.dica}</span>}
              {it.submenu && <ChevronRight size={14} className="menu-contexto-seta" />}
            </button>
            {it.submenu && aberto === i && <SubLista itens={it.submenu} aoFechar={aoFechar} pai={ref} indice={i} />}
          </div>
        ),
      )}
    </div>
  );
}

function SubLista({ itens, aoFechar, pai, indice }: { itens: ItemMenu[]; aoFechar: () => void; pai: React.RefObject<HTMLDivElement | null>; indice: number }) {
  const linha = pai.current?.children[indice] as HTMLElement | undefined;
  const r = linha?.getBoundingClientRect();
  const caixa = pai.current?.getBoundingClientRect();
  if (!r || !caixa) return null;
  // Fora do menu pai: o desfoque (backdrop-filter) dele prenderia a posição "fixed" do submenu.
  return createPortal(<Lista itens={itens} aoFechar={aoFechar} x={caixa.right + 4} y={r.top - 6} />, document.body);
}

/** Abre na posição do clique (x, y da tela). Fecha com Esc, clique fora, rolagem ou ao escolher. */
export function MenuContexto({ x, y, itens, aoFechar }: { x: number; y: number; itens: ItemMenu[]; aoFechar: () => void }) {
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;
  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".menu-contexto")) fechar.current();
    };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && fechar.current();
    const sair = () => fechar.current();
    window.addEventListener("mousedown", fora, true);
    window.addEventListener("keydown", tecla);
    window.addEventListener("resize", sair);
    window.addEventListener("blur", sair);
    window.addEventListener("scroll", sair, true);
    return () => {
      window.removeEventListener("mousedown", fora, true);
      window.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", sair);
      window.removeEventListener("blur", sair);
      window.removeEventListener("scroll", sair, true);
    };
  }, []);
  return createPortal(<Lista itens={itens} aoFechar={aoFechar} x={x} y={y} raiz />, document.body);
}
