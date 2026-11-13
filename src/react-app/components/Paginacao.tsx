import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

/** Números das páginas com reticências: 1 … 4 5 [6] 7 8 … 40 */
export function numerosPaginas(atual: number, total: number): (number | "…")[] {
  const set = new Set([1, total, atual - 2, atual - 1, atual, atual + 1, atual + 2].filter((n) => n >= 1 && n <= total));
  const lista = [...set].sort((a, b) => a - b);
  const saida: (number | "…")[] = [];
  lista.forEach((n, i) => {
    if (i > 0 && n - lista[i - 1] > 1) saida.push("…");
    saida.push(n);
  });
  return saida;
}

/**
 * Paginação única da plataforma: primeira, anterior, os números perto da atual, próxima e última.
 * Use em todas as listas paginadas (busca, acompanhamento, mercado, empresas...).
 */
export function Paginacao({
  pagina,
  total,
  aoIr,
  ocupado = false,
  rotulo = "Páginas",
}: {
  pagina: number;
  total: number;
  aoIr: (n: number) => void;
  ocupado?: boolean;
  rotulo?: string;
}) {
  if (total <= 1) return null;
  return (
    <nav className="paginacao" aria-label={rotulo}>
      <button className="pag-seta so-icone" onClick={() => aoIr(1)} disabled={pagina <= 1 || ocupado} aria-label="Primeira página" title="Primeira página">
        <ChevronsLeft />
      </button>
      <button className="pag-seta" onClick={() => aoIr(pagina - 1)} disabled={pagina <= 1 || ocupado} aria-label="Página anterior">
        <ChevronLeft /> <span>Anterior</span>
      </button>
      <div className="pag-numeros">
        {numerosPaginas(pagina, total).map((n, i) =>
          n === "…" ? (
            <span key={`r${i}`} className="pag-reticencias">
              …
            </span>
          ) : (
            <button key={n} className={n === pagina ? "ativa" : ""} onClick={() => aoIr(n)} disabled={ocupado && n !== pagina} aria-label={`Página ${n}`} aria-current={n === pagina ? "page" : undefined}>
              {n}
            </button>
          ),
        )}
      </div>
      <button className="pag-seta" onClick={() => aoIr(pagina + 1)} disabled={pagina >= total || ocupado} aria-label="Próxima página">
        <span>Próxima</span> <ChevronRight />
      </button>
      <button className="pag-seta so-icone" onClick={() => aoIr(total)} disabled={pagina >= total || ocupado} aria-label="Última página" title="Última página">
        <ChevronsRight />
      </button>
    </nav>
  );
}
