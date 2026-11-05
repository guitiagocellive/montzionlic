// Roda no navegador: prepara o PDF para a assinatura digital (PAdES).
//
// 1. Desenha o carimbo "Assinado digitalmente" onde a pessoa escolheu.
// 2. Reserva o espaço da assinatura e calcula o resumo (SHA-256) do PDF.
// 3. O servidor assina só esse resumo com o certificado da empresa (a chave nunca sai de lá).
// 4. A assinatura devolvida é encaixada no espaço reservado.

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFInvalidObject, PDFName, PDFNumber, PDFString, rgb, StandardFonts } from "pdf-lib";
import { api } from "../api";
import { limparTexto } from "../proposta/pdf";

export const SELO = { largura: 300, altura: 50 };

/** Posição do carimbo: página (começa em 0) e canto inferior esquerdo, em pontos do PDF. */
export interface PosicaoSelo {
  pagina: number;
  x: number;
  y: number;
}

export interface Signatario {
  titular: string;
  documento: string | null;
  /** Tamanho (base64) dos certificados, para reservar espaço suficiente. */
  tamanhoCertificados?: number;
}

export interface OpcoesAssinatura {
  motivo: string;
  local: string;
  contato?: string;
}

const ESPACO_BYTE_RANGE = "/**********";
const latin1 = new TextDecoder("latin1");

function formatarDocumento(doc: string | null) {
  if (!doc) return "";
  if (doc.length === 14) return `CNPJ ${doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}`;
  return `CPF ${doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}`;
}

const pdfTexto = (texto: string) => (/[^\x20-\x7e]/.test(texto) ? PDFHexString.fromText(texto) : PDFString.of(texto));

/** Posição padrão: canto inferior direito da última página. */
export function posicaoPadrao(larguraPagina: number, pagina: number): PosicaoSelo {
  return { pagina, x: larguraPagina - SELO.largura - 48, y: 22 };
}

/** Abre o PDF e devolve as páginas (tamanho em pontos). Lança erro se não der para assinar. */
export async function abrirParaAssinar(bytes: Uint8Array) {
  if (latin1.decode(bytes).includes("/ByteRange")) {
    throw new Error("Este PDF já tem uma assinatura digital. Assinar de novo invalidaria a assinatura existente.");
  }
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new Error("Não foi possível abrir este PDF para assinar (ele pode estar protegido por senha).");
  }
}

function desenharSelo(pdf: PDFDocument, posicao: PosicaoSelo, s: Signatario, quando: Date, fontes: { normal: import("pdf-lib").PDFFont; negrito: import("pdf-lib").PDFFont }) {
  const pagina = pdf.getPage(Math.min(Math.max(posicao.pagina, 0), pdf.getPageCount() - 1));
  const { width, height } = pagina.getSize();
  const { largura, altura } = SELO;
  const x = Math.min(Math.max(posicao.x, 0), Math.max(0, width - largura));
  const y = Math.min(Math.max(posicao.y, 0), Math.max(0, height - altura));
  const verde = rgb(0.05, 0.5, 0.33);

  pagina.drawRectangle({ x, y, width: largura, height: altura, borderColor: verde, borderWidth: 1, color: rgb(0.94, 0.99, 0.96), opacity: 0.95 });
  pagina.drawCircle({ x: x + 22, y: y + altura / 2, size: 13, color: verde });
  pagina.drawLine({ start: { x: x + 15, y: y + altura / 2 }, end: { x: x + 20, y: y + altura / 2 - 5 }, thickness: 2.2, color: rgb(1, 1, 1) });
  pagina.drawLine({ start: { x: x + 20, y: y + altura / 2 - 5 }, end: { x: x + 29, y: y + altura / 2 + 6 }, thickness: 2.2, color: rgb(1, 1, 1) });

  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(quando);
  const tx = x + 42;
  pagina.drawText("ASSINADO DIGITALMENTE", { x: tx, y: y + altura - 14, size: 8, font: fontes.negrito, color: verde });
  const titular = limparTexto(s.titular);
  pagina.drawText(titular.length > 52 ? `${titular.slice(0, 51)}…` : titular, { x: tx, y: y + altura - 25, size: 7.5, font: fontes.negrito, color: rgb(0.1, 0.1, 0.12) });
  pagina.drawText(limparTexto(`${formatarDocumento(s.documento)}${s.documento ? "  ·  " : ""}${data} (Brasília)`), {
    x: tx,
    y: y + altura - 35,
    size: 7,
    font: fontes.normal,
    color: rgb(0.3, 0.3, 0.35),
  });
  pagina.drawText("Certificado ICP-Brasil · confira em validar.iti.gov.br", { x: tx, y: y + 7, size: 6.5, font: fontes.normal, color: rgb(0.45, 0.45, 0.5) });
  return pagina;
}

/** Reserva o espaço da assinatura (dicionário /Sig, campo invisível e AcroForm). */
function reservarEspaco(pdf: PDFDocument, pagina: ReturnType<PDFDocument["getPage"]>, s: Signatario, o: OpcoesAssinatura, quando: Date, tamanhoHex: number) {
  const ctx = pdf.context;
  const byteRange = PDFArray.withContext(ctx);
  byteRange.push(PDFNumber.of(0));
  byteRange.push(PDFName.of(ESPACO_BYTE_RANGE.slice(1)));
  byteRange.push(PDFName.of(ESPACO_BYTE_RANGE.slice(1)));
  byteRange.push(PDFName.of(ESPACO_BYTE_RANGE.slice(1)));

  const assinatura = ctx.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "ETSI.CAdES.detached",
    ByteRange: byteRange,
    Contents: PDFHexString.of("0".repeat(tamanhoHex)),
    Reason: pdfTexto(limparTexto(o.motivo)),
    M: PDFString.fromDate(quando),
    ContactInfo: pdfTexto(limparTexto(o.contato ?? "")),
    Name: pdfTexto(limparTexto(`${s.titular}${s.documento ? `:${s.documento}` : ""}`)),
    Location: pdfTexto(limparTexto(o.local)),
    Prop_Build: { Filter: { Name: "Adobe.PPKLite" }, App: { Name: "Montzion" } },
  });
  // Fica fora de "object streams" para o espaço reservado ser encontrado no arquivo final.
  const bytesAssinatura = new Uint8Array(assinatura.sizeInBytes());
  assinatura.copyBytesInto(bytesAssinatura, 0);
  const refAssinatura = ctx.register(PDFInvalidObject.of(bytesAssinatura));

  const aparencia = ctx.formXObject([], { BBox: [0, 0, 0, 0], Resources: {} });
  const campo = ctx.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    Rect: [0, 0, 0, 0],
    V: refAssinatura,
    T: PDFString.of(`Assinatura${Date.now()}`),
    F: 4,
    P: pagina.ref,
    AP: { N: ctx.register(aparencia) },
  });
  const refCampo = ctx.register(campo);

  const anotacoes = pagina.node.lookupMaybe(PDFName.of("Annots"), PDFArray) ?? ctx.obj([]);
  anotacoes.push(refCampo);
  pagina.node.set(PDFName.of("Annots"), anotacoes);

  let formulario = pdf.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (!formulario) {
    formulario = ctx.obj({ Fields: [] });
    pdf.catalog.set(PDFName.of("AcroForm"), ctx.register(formulario));
  }
  const flags = formulario.lookupMaybe(PDFName.of("SigFlags"), PDFNumber);
  formulario.set(PDFName.of("SigFlags"), PDFNumber.of((flags?.asNumber() ?? 0) | 3));
  let campos = formulario.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (!campos) {
    campos = ctx.obj([]);
    formulario.set(PDFName.of("Fields"), campos);
  }
  campos.push(refCampo);
}

function concatenar(a: Uint8Array, b: Uint8Array) {
  const tudo = new Uint8Array(a.length + b.length);
  tudo.set(a);
  tudo.set(b, a.length);
  return tudo;
}

export interface PdfPreparado {
  pdf: Uint8Array;
  resumo: Uint8Array;
  inicio: number;
  fim: number;
}

/** Desenha o carimbo, reserva o espaço da assinatura e calcula o resumo a ser assinado. */
export async function prepararPdf(doc: PDFDocument, posicao: PosicaoSelo, s: Signatario, o: OpcoesAssinatura): Promise<PdfPreparado> {
  const quando = new Date();
  const fontes = { normal: await doc.embedFont(StandardFonts.Helvetica), negrito: await doc.embedFont(StandardFonts.HelveticaBold) };
  const pagina = desenharSelo(doc, posicao, s, quando, fontes);
  const tamanhoHex = Math.max(16000, Math.ceil((s.tamanhoCertificados ?? 6000) * 1.6) + 8000);
  reservarEspaco(doc, pagina, s, o, quando, tamanhoHex);
  const pdf = await doc.save({ useObjectStreams: false });

  const texto = latin1.decode(pdf);
  const marcador = `<${"0".repeat(tamanhoHex)}>`;
  const inicio = texto.lastIndexOf(marcador);
  if (inicio < 0) throw new Error("Não foi possível preparar o PDF para assinar.");
  const fim = inicio + marcador.length;

  const intervalo = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/.exec(texto);
  if (!intervalo) throw new Error("Não foi possível preparar o PDF para assinar.");
  const novo = `/ByteRange [0 ${inicio} ${fim} ${pdf.length - fim}]`;
  if (novo.length > intervalo[0].length) throw new Error("Não foi possível preparar o PDF para assinar.");
  const preenchido = novo.padEnd(intervalo[0].length, " ");
  for (let i = 0; i < preenchido.length; i++) pdf[intervalo.index + i] = preenchido.charCodeAt(i);

  const resumo = new Uint8Array(await crypto.subtle.digest("SHA-256", concatenar(pdf.subarray(0, inicio), pdf.subarray(fim))));
  return { pdf, resumo, inicio, fim };
}

/** Encaixa a assinatura (CMS) no espaço reservado. */
export function encaixarAssinatura(p: PdfPreparado, cms: Uint8Array): Uint8Array {
  const hex = Array.from(cms, (b) => b.toString(16).padStart(2, "0")).join("");
  const espaco = p.fim - p.inicio - 2;
  if (hex.length > espaco) throw new Error("A assinatura não coube no PDF.");
  const pdf = p.pdf.slice();
  const preenchido = hex.padEnd(espaco, "0");
  for (let i = 0; i < espaco; i++) pdf[p.inicio + 1 + i] = preenchido.charCodeAt(i);
  return pdf;
}

const paraBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const deBase64 = (texto: string) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

/**
 * Assina o PDF de ponta a ponta: prepara aqui, o servidor assina o resumo, encaixa a assinatura.
 * Devolve o PDF assinado e o "pedido" (para o arquivo ganhar o selo na plataforma).
 */
export async function assinarPdf(doc: PDFDocument, posicao: PosicaoSelo, s: Signatario, o: OpcoesAssinatura) {
  const preparado = await prepararPdf(doc, posicao, s, o);
  const r = await api<{ cms: string; pedido: string }>("/certificado/assinar", { corpo: { resumo: paraBase64(preparado.resumo) } });
  return { pdf: encaixarAssinatura(preparado, deBase64(r.cms)), pedido: r.pedido };
}
