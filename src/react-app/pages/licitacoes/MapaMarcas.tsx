import { useEffect, useMemo, useRef, useState } from "react";
import type { Linha } from "../../../shared/mercado";
import { formatarMoeda, formatarNumero } from "../../formato";

// Mapa do Brasil da Inteligência de mercado.
// - Volume (padrão, como no Siga): degradê de uma cor só, do estado que menos comprou ao que mais comprou.
// - Marca líder: cada estado com a marca que mais venceu lá. Só 3 cores de marca (mais "outras"):
//   num mapa todas as cores ficam lado a lado e, com mais de 3, algumas se confundem para quem tem daltonismo.
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

/** Cor do degradê para t entre 0 e 1 (baixo → meio → alto), com as cores do tema. */
function corDegrade(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return x <= 0.5
    ? `color-mix(in oklab, var(--mapa-meio) ${Math.round(x * 200)}%, var(--mapa-baixo))`
    : `color-mix(in oklab, var(--mapa-alto) ${Math.round((x - 0.5) * 200)}%, var(--mapa-meio))`;
}

export function MapaMarcas({ estados, ativo, aoEscolher }: { estados: Linha[]; ativo: string; aoEscolher: (uf: string) => void }) {
  const [mapa, setMapa] = useState<Mapa | null>(null);
  const [erro, setErro] = useState(false);
  const [dica, setDica] = useState<{ uf: string; x: number; y: number } | null>(null);
  const [modo, setModo] = useState<"volume" | "lider">("volume");
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    carregarMapa().then(setMapa, () => setErro(true));
  }, []);

  const porUf = useMemo(() => new Map(estados.map((e) => [e.chave, e])), [estados]);
  const maximo = useMemo(() => Math.max(1, ...estados.map((e) => e.compras)), [estados]);

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
    const outras = ordem.slice(3).reduce((s, [, x]) => s + x.estados, 0);
    return {
      corDaMarca: new Map(ordem.slice(0, 3).map(([nome], i) => [nome, CORES[i]])),
      legenda: [
        ...ordem.slice(0, 3).map(([nome, x], i) => ({ nome, cor: CORES[i], estados: x.estados })),
        ...(outras ? [{ nome: "Outras marcas", cor: "var(--mapa-outras)", estados: outras }] : []),
      ],
    };
  }, [estados]);

  if (erro) return null;
  if (!mapa) return <div className="mapa-marcas carregando-mapa" aria-hidden="true" />;

  const corDe = (uf: string) => {
    const e = porUf.get(uf);
    if (!e) return "var(--mapa-vazio)";
    // Raiz quadrada: o estado campeão não apaga a diferença entre os outros.
    if (modo === "volume") return corDegrade(Math.sqrt(e.compras / maximo));
    const lider = e.destaques[0]?.nome;
    return lider ? (corDaMarca.get(lider) ?? "var(--mapa-outras)") : "var(--mapa-vazio)";
  };
  const info = dica ? porUf.get(dica.uf) : null;
  const realce = dica?.uf ?? "";

  return (
    <div className="mapa-marcas">
      <div className="mapa-cabecalho">
        <span className="texto-fraco pequeno">{modo === "volume" ? "Licitações por estado" : "Marca que mais venceu em cada estado"}</span>
        <div className="segmentado pequeno" role="group" aria-label="O que o mapa mostra">
          <button type="button" className={modo === "volume" ? "ativo" : ""} onClick={() => setModo("volume")}>
            Volume
          </button>
          <button type="button" className={modo === "lider" ? "ativo" : ""} onClick={() => setModo("lider")}>
            Marca líder
          </button>
        </div>
      </div>

      <div className="mapa-desenho" ref={caixa} onMouseLeave={() => setDica(null)}>
        <svg viewBox={mapa.viewBox} role="img" aria-label="Mapa do Brasil por estado">
          <defs>
            <filter id="sombra-mapa" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.28" />
            </filter>
          </defs>
          <g filter="url(#sombra-mapa)">
            {Object.entries(mapa.estados).map(([uf, e]) => (
              <path
                key={uf}
                data-uf={uf}
                d={e.d}
                fill={corDe(uf)}
                className={`estado-mapa ${porUf.has(uf) ? "com-dados" : ""}`}
                onMouseMove={(ev) => {
                  const r = caixa.current?.getBoundingClientRect();
                  if (r) setDica({ uf, x: ev.clientX - r.left, y: ev.clientY - r.top });
                }}
                onClick={() => porUf.has(uf) && aoEscolher(uf)}
              >
                <title>{e.nome}</title>
              </path>
            ))}
          </g>
          {/* Contorno por cima: estado escolhido e o que está sob o mouse. */}
          {ativo && mapa.estados[ativo] && <path d={mapa.estados[ativo].d} className="contorno-mapa ativo" />}
          {realce && realce !== ativo && mapa.estados[realce] && <path d={mapa.estados[realce].d} className="contorno-mapa" />}
        </svg>
        {dica && (
          <div className={`dica-mapa ${dica.x > (caixa.current?.clientWidth ?? 0) * 0.6 ? "esquerda" : ""}`} style={{ left: dica.x, top: dica.y }} role="tooltip">
            <strong>
              {mapa.estados[dica.uf]?.nome} <span className="texto-fraco">{dica.uf}</span>
            </strong>
            {info ? (
              <>
                <span className="texto-fraco">
                  {formatarNumero(info.compras)} licitações · {formatarMoeda(info.valor)}
                </span>
                {info.destaques.map((d, i) => (
                  <span key={d.nome} className="linha-dica">
                    <span className="posicao-dica">{i + 1}</span>
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
        {modo === "volume" ? (
          <div className="degrade-mapa">
            <span className="texto-fraco">Menos</span>
            <i aria-hidden="true" />
            <span className="texto-fraco">Mais ({formatarNumero(maximo)} licitações)</span>
          </div>
        ) : (
          <div className="marcas-mapa">
            {legenda.map((l) => (
              <span key={l.nome} className="item-legenda">
                <i style={{ background: l.cor }} />
                {l.nome}
                <span className="texto-fraco">{l.estados}</span>
              </span>
            ))}
          </div>
        )}
        <span className="creditos-mapa texto-fraco">Passe o mouse para ver as marcas de cada estado e clique para filtrar · Mapa: {mapa.fonte}</span>
      </div>
    </div>
  );
}
