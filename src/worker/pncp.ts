// Arquivos do PNCP: o navegador não consegue baixar direto de lá (o PNCP manda um cabeçalho de
// permissão duplicado), então o servidor busca e repassa.

export const URL_ARQUIVO_PNCP = /^https:\/\/pncp\.gov\.br\/pncp-api\/v1\/orgaos\/\d{14}\/compras\/\d{4}\/\d+\/arquivos\/\d+$/;

const TIPOS: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/** Nome original do arquivo (vem no Content-Disposition do PNCP). */
export function nomeDoArquivo(resposta: Response): string {
  const d = resposta.headers.get("content-disposition") ?? "";
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(d)?.[1];
  const simples = /filename="?([^";]+)"?/i.exec(d)?.[1];
  try {
    return (utf ? decodeURIComponent(utf) : simples ?? "").trim();
  } catch {
    return (simples ?? "").trim();
  }
}

export function extensaoDe(nome: string): string {
  return /\.([a-z0-9]{1,5})$/i.exec(nome)?.[1]?.toLowerCase() ?? "";
}

export function tipoPorExtensao(ext: string): string {
  return TIPOS[ext] ?? "application/octet-stream";
}

/** Descobre o tipo pelos primeiros bytes quando o nome não ajuda. */
export function extensaoPelosBytes(b: Uint8Array): string {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
  if (b[0] === 0x50 && b[1] === 0x4b) return "zip";
  if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72) return "rar";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50) return "png";
  return "";
}
