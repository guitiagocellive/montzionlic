export const NOME_SISTEMA = "Montzion";

export function Marca() {
  return (
    <div className="marca">
      <span className="marca-icone" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M5 18V7l7 6 7-6v11"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>
        {NOME_SISTEMA}
        <small>Licitações</small>
      </span>
    </div>
  );
}
