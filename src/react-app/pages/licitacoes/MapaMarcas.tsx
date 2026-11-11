import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Linha } from "../../../shared/mercado";
import { formatarMoeda, formatarNumero } from "../../formato";

// Mapa do Brasil: cada estado pintado com a marca que mais venceu licitações lá.
// Só 3 cores de marca (mais "outras marcas" em cinza): num mapa todas as cores ficam lado a lado
// e, com mais de 3, algumas ficam iguais para quem tem daltonismo.
// Contorno dos estados: svg-maps (Victor Cazanave), licença CC BY 4.0.

type Mapa = { viewBox: string; fonte: string; estados: Record<string, { nome: string; d: string }> };

let mapaCache: Promise<Mapa> | null = null;
function carregarMapa() {
  mapaCache ??= fetch("/dados/mapa-brasil.json").then((r) => {
    if (!r.ok) throw new Error("mapa");
    return r.json() as Promise<Mapa>;
  });
  mapaCache.catch(() => (mapaCache = null));
  return mapaCache;
}

const CORES = ["var(--mapa-1)", "var(--mapa-2)", "var(--mapa-3)"];
const ESCALA = ["var(--mapa-v1)", "var(--mapa-v2)", "var(--mapa-v3)", "var(--mapa-v4)", "var(--mapa-v5)"];

export function MapaMarcas({ estados, ativo, aoEscolher }: { estados: Linha[]; ativo: string; aoEscolher: (uf: string) => void }) {
  const [mapa, setMapa] = useState<Mapa | null>(null);
  const [erro, setErro] = useState(false);
  const [dica, setDica] = useState<{ uf: string; x: number; y: number } | null>(null);
  const [rotulos, setRotulos] = useState<Record<string, { x: number; y: number }>>({});
  const [modo, setModo] = useState<"lider" | "volume">("lider");
  const caixa = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    carregarMapa().then(setMapa, () => setErro(true));
  }, []);

  const porUf = useMemo(() => new Map(estados.map((e) => [e.chave, e])), [estados]);

  // As 3 marcas que lideram em mais estados ganham cor; as outras ficam como "outras marcas".
  const { corDaMarca, legenda } = useMemo(() => {
    const lideres = new Map<string, { estados: number; vitorias: number }>();
    for (const e of estados) {
      const l = e.destaques[0];
      if (!l) continue;
      const x = lideres.get(l.nome) ?? { estados: 0, vitorias: 0 };
      x.estados++;
      x.vitorias += l.compras;
      lideres.set(l.nome, x);
    }
    const ordem = [...lideres.entries()].sort((a, b) => b[1].estados - a[1].estados || b[1].vitorias - a[1].vitorias);
    const corDaMarca = new Map(ordem.slice(0, 3).map(([nome], i) => [nome, CORES[i]]));
    const outras = ordem.slice(3).reduce((s, [, x]) => s + x.estados, 0);
    return {
      corDaMarca,
      legenda: [
        ...ordem.slice(0, 3).map(([nome, x], i) => ({ nome, cor: CORES[i], estados: x.estados })),
        ...(outras ? [{ nome: "Outras marcas", cor: "var(--mapa-outras)", estados: outras }] : []),
      ],
    };
  }, [estados]);

  // Volume: 5 faixas de nº de licitações (do menor ao maior estado).
  const faixas = useMemo(() => {
    const v = estados.map((e) => e.compras).sort((a, b) => a - b);
    if (!v.length) return [];
    const limites = [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
    return [...new Set([...limites, v[v.length - 1]])];
  }, [estados]);
  const faixaDe = (n: number) => {
    const i = faixas.findIndex((l) => n <= l);
    const pos = i < 0 ? faixas.length - 1 : i;
    // Espalha as faixas existentes pela escala inteira (com poucos estados ainda vai do claro ao escuro).
    return ESCALA[faixas.length <= 1 ? ESCALA.length - 1 : Math.round((pos / (faixas.length - 1)) * (ESCALA.length - 1))];
  };

  // Sigla no meio de cada estado (só onde cabe).
  useLayoutEffect(() => {
    if (!mapa || !svg.current) return;
    const r: Record<string, { x: number; y: number }> = {};
    svg.current.querySelectorAll<SVGPathElement>("path[data-uf]").forEach((p) => {
      const b = p.getBBox();
      if (b.width >= 22 && b.height >= 16) r[p.dataset.uf!] = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    // Ajustes onde o centro do retângulo cai fora do estado.
    const desloca: Record<string, [number, number]> = { PE: [18, 0], PA: [0, 10], GO: [-6, 6], MG: [6, 0], RS: [8, 0], SC: [4, 0], AM: [0, 6] };
    for (const [uf, [dx, dy]] of Object.entries(desloca)) if (r[uf]) r[uf] = { x: r[uf].x + dx, y: r[uf].y + dy };
    setRotulos(r);
  }, [mapa]);

  if (erro) return null;
  if (!mapa) return <div className="mapa-marcas carregando-mapa" aria-hidden="true" />;

  const corDe = (uf: string) => {
    const e = porUf.get(uf);
    if (e && modo === "volume") return faixaDe(e.compras);
    const lider = e?.destaques[0]?.nome;
    if (!e || !lider) return "var(--mapa-vazio)";
    return corDaMarca.get(lider) ?? "var(--mapa-outras)";
  };
  const info = dica ? porUf.get(dica.uf) : null;

  return (
    <div className="mapa-marcas">
      <div className="mapa-desenho" ref={caixa} onMouseLeave={() => setDica(null)}>
        <svg ref={svg} viewBox={mapa.viewBox} role="img" aria-label="Mapa do Brasil com a marca que mais vence em cada estado">
          {Object.entries(mapa.estados).map(([uf, e]) => (
            <path
              key={uf}
              data-uf={uf}
              d={e.d}
              fill={corDe(uf)}
              className={`estado-mapa ${ativo === uf ? "ativo" : ""} ${porUf.has(uf) ? "com-dados" : ""}`}
              onMouseMove={(ev) => {
                const r = caixa.current?.getBoundingClientRect();
                if (r) setDica({ uf, x: ev.clientX - r.left, y: ev.clientY - r.top });
              }}
              onClick={() => porUf.has(uf) && aoEscolher(uf)}
            >
              <title>{e.nome}</title>
            </path>
          ))}
          {Object.entries(rotulos).map(([uf, p]) => (
            <text key={uf} x={p.x} y={p.y} className="sigla-mapa" textAnchor="middle" dominantBaseline="central">
              {uf}
            </text>
          ))}
        </svg>
        {dica && (
          <div className="dica-mapa" style={{ left: dica.x, top: dica.y }} role="tooltip">
            <strong>{mapa.estados[dica.uf]?.nome}</strong>
            {info ? (
              <>
                <span className="texto-fraco">
                  {formatarNumero(info.compras)} licitações · {formatarMoeda(info.valor)}
                </span>
                {info.destaques.map((d, i) => (
                  <span key={d.nome} className="linha-dica">
                    <i style={{ background: i === 0 ? corDe(dica.uf) : "transparent" }} />
                    {d.nome} <b>{formatarNumero(d.compras)} vitórias</b>
                  </span>
                ))}
              </>
            ) : (
              <span className="texto-fraco">Sem compras no período</span>
            )}
          </div>
        )}
      </div>
      <div className="legenda-mapa">
        <div className="segmentado pequeno" role="group" aria-label="O que o mapa mostra">
          <button type="button" className={modo === "lider" ? "ativo" : ""} onClick={() => setModo("lider")}>
            Marca líder
          </button>
          <button type="button" className={modo === "volume" ? "ativo" : ""} onClick={() => setModo("volume")}>
            Volume de compras
          </button>
        </div>
        {modo === "volume" ? (
          <>
            <span className="texto-fraco pequeno">Licitações por estado</span>
            {faixas.map((limite, i) => (
              <span key={limite} className="item-legenda">
                <i style={{ background: faixaDe(limite) }} />
                <span className="nome-legenda">
                  {i === 0 ? `até ${formatarNumero(limite)}` : `${formatarNumero(faixas[i - 1] + 1)} a ${formatarNumero(limite)}`}
                </span>
              </span>
            ))}
          </>
        ) : (
          <span className="texto-fraco pequeno">Marca que mais venceu em cada estado</span>
        )}
        {modo === "lider" && legenda.map((l) => (
          <span key={l.nome} className="item-legenda">
            <i style={{ background: l.cor }} />
            <span className="nome-legenda">{l.nome}</span>
            <span className="texto-fraco">
              {l.estados} {l.estados === 1 ? "estado" : "estados"}
            </span>
          </span>
        ))}
        <span className="item-legenda">
          <i style={{ background: "var(--mapa-vazio)" }} />
          <span className="nome-legenda sem-compras">Sem compras</span>
        </span>
        <span className="texto-fraco pequeno dica-clique">Passe o mouse para ver as 3 marcas mais vencedoras do estado; clique para filtrar.</span>
        <span className="creditos-mapa texto-fraco">Mapa: {mapa.fonte}</span>
      </div>
    </div>
  );
}
