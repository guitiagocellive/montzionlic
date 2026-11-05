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

export async function baixarZip(nomeZip: string, arquivos: ArquivoZip[], aoProgredir?: (feitos: number, total: number) => void) {
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
  const blob = zip.generate({ type: "blob", compression: "STORE", mimeType: "application/zip" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${nomeDeArquivo(nomeZip)}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
}
