function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

interface Props {
  nome: string;
  cor?: string | null;
  foto?: string | null;
  grande?: boolean;
  pequeno?: boolean;
}

/** Foto da pessoa, ou as iniciais na cor dela. */
export function Avatar({ nome, cor, foto, grande = false, pequeno = false }: Props) {
  return (
    <span
      className={`avatar ${grande ? "grande" : ""} ${pequeno ? "pequeno" : ""}`}
      style={cor ? { ["--cor-avatar" as string]: cor } : undefined}
      aria-hidden="true"
    >
      {foto ? <img src={foto} alt="" /> : iniciais(nome)}
    </span>
  );
}
