import { Check, type LucideIcon } from "lucide-react";

export interface Passo {
  chave: string;
  titulo: string;
  descricao: string;
  icone: LucideIcon;
  completo?: boolean;
}

/** Navegação em etapas, no estilo de checkout. */
export function Etapas({
  passos,
  atual,
  aoEscolher,
}: {
  passos: Passo[];
  atual: string;
  aoEscolher: (chave: string) => void;
}) {
  return (
    <nav className="etapas" aria-label="Etapas da ficha">
      {passos.map((p, i) => {
        const Icone = p.icone;
        const ativo = p.chave === atual;
        return (
          <button
            key={p.chave}
            className={`etapa ${ativo ? "ativa" : ""} ${p.completo ? "completa" : ""}`}
            onClick={() => aoEscolher(p.chave)}
            aria-current={ativo ? "step" : undefined}
          >
            <span className="etapa-numero">
              {p.completo && !ativo ? <Check /> : <Icone />}
            </span>
            <span className="etapa-texto">
              <small>Etapa {i + 1}</small>
              <strong>{p.titulo}</strong>
              <span>{p.descricao}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
