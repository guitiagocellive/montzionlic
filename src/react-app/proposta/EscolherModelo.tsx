import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { CORES_PDF, MODELOS_PDF } from "../../shared/proposta";

/** Miniatura desenhada com CSS de como fica a página de cada modelo. */
function Miniatura({ modelo }: { modelo: string }) {
  return (
    <span className={`mini-pagina mini-${modelo}`} aria-hidden="true">
      <span className="mini-topo">
        <span className="mini-logo" />
        <span className="mini-titulo" />
      </span>
      <span className="mini-dados">
        <span />
        <span />
        <span />
      </span>
      <span className="mini-tabela">
        <span className="mini-cab" />
        <span />
        <span />
        <span />
      </span>
      <span className="mini-texto">
        <span />
        <span />
      </span>
      <span className="mini-rodape" />
    </span>
  );
}

/** Escolha do modelo visual e da cor do PDF da proposta. */
export function EscolherModeloPdf({
  modelo,
  cor,
  aoMudar,
}: {
  modelo: string;
  cor: string;
  aoMudar: (novo: { modelo?: string; cor?: string }) => void;
}) {
  const semCor = modelo === "simples";
  return (
    <div className="escolher-modelo-pdf" style={{ "--cor-modelo": semCor ? "#111111" : cor } as CSSProperties}>
      <div className="modelos-pdf" role="radiogroup" aria-label="Modelo do PDF">
        {MODELOS_PDF.map((m) => (
          <button
            key={m.chave}
            type="button"
            role="radio"
            aria-checked={modelo === m.chave}
            className={`modelo-pdf ${modelo === m.chave ? "ativo" : ""}`}
            onClick={() => aoMudar({ modelo: m.chave })}
            title={m.descricao}
          >
            <Miniatura modelo={m.chave} />
            <strong>{m.nome}</strong>
            <small>{m.descricao}</small>
          </button>
        ))}
      </div>
      <div className="cores-pdf">
        <span className="texto-fraco pequeno">Cor</span>
        {CORES_PDF.map((c) => (
          <button
            key={c.cor}
            type="button"
            className={`cor-pdf ${cor === c.cor ? "ativa" : ""}`}
            style={{ background: c.cor }}
            onClick={() => aoMudar({ cor: c.cor })}
            aria-label={`Cor ${c.nome}`}
            title={c.nome}
            disabled={semCor}
          >
            {cor === c.cor && <Check size={13} />}
          </button>
        ))}
        {semCor && <span className="texto-fraco pequeno">O modelo Simples é sempre preto e branco.</span>}
      </div>
    </div>
  );
}
