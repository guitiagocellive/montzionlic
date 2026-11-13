// Roda no navegador: junta vários arquivos num .zip (com pastas) e baixa.

export interface ArquivoZip {
  /** Caminho dentro do zip, ex.: "1 - Habilitação jurídica/Contrato social.pdf" */
  caminho: string;
  url: string;
}

export const nomeDeArquivo = (texto: string) =>
  texto
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "arquivo";

/** Junta os arquivos num .zip (sem baixar). */
export async function montarZip(arquivos: ArquivoZip[], aoProgredir?: (feitos: number, total: number) => void): Promise<Blob> {
  const PizZip = (await import("pizzip")).default;
  const zip = new PizZip();
  const usados = new Set<string>();
  let feitos = 0;
  for (const a of arquivos) {
    const resposta = await fetch(a.url, { credentials: "same-origin" });
    if (!resposta.ok) throw new Error(`Não foi possível baixar "${a.caminho}".`);
    // nomes repetidos ganham (2), (3)...
    let caminho = a.caminho;
    for (let n = 2; usados.has(caminho.toLowerCase()); n++) caminho = a.caminho.replace(/(\.[^./]+)?$/, ` (${n})$1`);
    usados.add(caminho.toLowerCase());
    zip.file(caminho, await resposta.arrayBuffer(), { binary: true });
    aoProgredir?.(++feitos, arquivos.length);
  }
  // PDFs e imagens já vêm comprimidos: guardar sem recomprimir é mais rápido.
  return zip.generate({ type: "blob", compression: "STORE", mimeType: "application/zip" });
}

/** Salva um arquivo no computador (pasta de downloads). */
export function salvarNoComputador(blob: Blob, nome: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
}

export async function baixarZip(nomeZip: string, arquivos: ArquivoZip[], aoProgredir?: (feitos: number, total: number) => void) {
  salvarNoComputador(await montarZip(arquivos, aoProgredir), `${nomeDeArquivo(nomeZip)}.zip`);
}
