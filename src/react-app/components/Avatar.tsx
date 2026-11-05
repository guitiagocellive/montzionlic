function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

export function Avatar({
  nome,
  grande = false,
  pequeno = false,
}: {
  nome: string;
  grande?: boolean;
  pequeno?: boolean;
}) {
  return (
    <span className={`avatar ${grande ? "grande" : ""} ${pequeno ? "pequeno" : ""}`} aria-hidden="true">
      {iniciais(nome)}
    </span>
  );
}
