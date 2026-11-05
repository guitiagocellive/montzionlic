// Formatação no padrão brasileiro.

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export function formatarMoeda(valor: number | null | undefined): string {
  return valor == null || !Number.isFinite(valor) ? "—" : moeda.format(valor);
}

export function formatarNumero(valor: number | null | undefined): string {
  return valor == null || !Number.isFinite(valor) ? "—" : numero.format(valor);
}

/** AAAA-MM-DD → DD/MM/AAAA */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** AAAA-MM-DD → { dia: "06", mes: "nov" } */
export function diaMes(iso: string) {
  const [, m, d] = iso.split("-");
  return { dia: d, mes: MESES[Number(m) - 1] ?? "" };
}

/** AAAA-MM-DD → "12 nov" */
export function formatarDataCurta(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d)
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    .replace(".", "");
}

export function hojeIso(deslocamento = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Texto amigável para quantos dias faltam. */
export function textoPrazo(dias: number): string {
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Amanhã";
  if (dias === -1) return "Ontem";
  if (dias < 0) return `Há ${-dias} dias`;
  return `Em ${dias} dias`;
}

/** Converte valor de input em número (ou null). */
export function paraNumero(valor: string): number | null {
  if (valor.trim() === "") return null;
  const n = Number(valor.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
