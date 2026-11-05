export const NOME_SISTEMA = "Montzion Licitações";

export function Marca() {
  return (
    <div className="marca">
      <img src="/favicon.svg" alt="" width={28} height={28} />
      <span>{NOME_SISTEMA}</span>
    </div>
  );
}
