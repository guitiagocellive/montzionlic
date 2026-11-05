import { Sparkle } from "lucide-react";

export const NOME_SISTEMA = "Montzion";

export function Marca() {
  return (
    <div className="marca">
      <span className="marca-icone" aria-hidden="true">
        <Sparkle strokeWidth={2.2} />
      </span>
      <span>
        {NOME_SISTEMA}
        <small>Gestão de licitações</small>
      </span>
    </div>
  );
}
