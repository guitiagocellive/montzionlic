// Roda no navegador: monta um documento avulso (declaração, ofício…) em PDF com a identidade da empresa,
// usando os mesmos modelos visuais da proposta.
import { PDFDocument, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { ModeloPdf } from "../../shared/proposta";
import {
  A4,
  CINZA,
  type Contexto,
  type DadosCabecalho,
  embutirLogo,
  type ExtrasPdf,
  garantirEspaco,
  limparTexto,
  marcaDagua,
  MARGEM,
  montarTema,
  paragrafo,
  prepararCabecalho,
  quebrar,
  TEXTO,
} from "./pdf";

export interface DadosDocumento {
  empresa: {
    nome: string;
    cnpj: string;
    ie: string;
    endereco: string;
    cidade: string;
    telefone: string;
    email: string;
  };
  titulo: string;
  texto: string;
  /** Linhas "Ao(À)" e "Referente" (quando o documento é para uma licitação). */
  destinatario?: { orgao: string; referencia: string } | null;
  /** Local e data por extenso no fim. */
  localData?: { local: string; data: string } | null;
  /** Linha de assinatura do responsável. */
  assinatura?: { nome: string; cpf: string; cargo: string } | null;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function dataPorExtenso(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return iso;
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

/** Título do documento no estilo de cada modelo. */
function desenharTitulo(ctx: Contexto, titulo: string) {
  const { modelo, cor, fundo } = ctx.tema;
  const p = () => ctx.pagina;
  const largura = A4.largura - MARGEM * 2;
  if (modelo === "moderno") {
    // faixa clarinha com o título na cor
    const linhas = quebrar(titulo, ctx.negrito, 13, largura - 28);
    const altura = linhas.length * 17 + 14;
    garantirEspaco(ctx, altura + 20);
    p().drawRectangle({ x: MARGEM, y: ctx.y - altura, width: largura, height: altura, color: fundo });
    p().drawRectangle({ x: MARGEM, y: ctx.y - altura, width: 4, height: altura, color: cor });
    linhas.forEach((l, i) => p().drawText(l, { x: MARGEM + 16, y: ctx.y - 20 - i * 17, size: 13, font: ctx.negrito, color: cor }));
    ctx.y -= altura + 20;
  } else if (modelo === "simples") {
    // caixa preta, como formulário
    const linhas = quebrar(titulo, ctx.negrito, 12.5, largura - 20);
    const altura = linhas.length * 16 + 12;
    garantirEspaco(ctx, altura + 20);
    p().drawRectangle({ x: MARGEM, y: ctx.y - altura, width: largura, height: altura, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    linhas.forEach((l) => {
      const w = ctx.negrito.widthOfTextAtSize(l, 12.5);
      p().drawText(l, { x: (A4.largura - w) / 2, y: ctx.y - 19, size: 12.5, font: ctx.negrito, color: rgb(0, 0, 0) });
      ctx.y -= 16;
    });
    ctx.y -= 32;
  } else if (modelo === "compacto") {
    // à esquerda, com linha na cor por baixo
    paragrafo(ctx, titulo, { tamanho: 12, fonte: ctx.negrito, cor, espaco: 2 });
    p().drawLine({ start: { x: MARGEM, y: ctx.y }, end: { x: A4.largura - MARGEM, y: ctx.y }, thickness: 1.2, color: cor });
    ctx.y -= 16;
  } else {
    // clássico e timbrado: centralizado na cor, com um traço curto embaixo
    paragrafo(ctx, titulo, { tamanho: 13, fonte: ctx.negrito, cor, alinhar: "centro", espaco: 4 });
    const meio = A4.largura / 2;
    p().drawLine({ start: { x: meio - 40, y: ctx.y }, end: { x: meio + 40, y: ctx.y }, thickness: 1.6, color: cor });
    ctx.y -= 20;
  }
}

export async function gerarDocumentoPdf(d: DadosDocumento, extras: ExtrasPdf): Promise<Uint8Array> {
  const modelo: ModeloPdf = extras.modelo ?? "classico";
  const tema = montarTema(modelo, extras.cor ?? "#1f3b8a");
  const pdf = await PDFDocument.create();
  pdf.setTitle(limparTexto(d.titulo || "Documento"));
  pdf.setAuthor(limparTexto(d.empresa.nome || "Montzion"));
  pdf.setCreator("Montzion");
  pdf.setProducer("Montzion");
  const serifa = modelo === "timbrado";
  const normal = await pdf.embedFont(serifa ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(serifa ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const logo = await embutirLogo(pdf, extras.logo);

  const e = d.empresa;
  const cab: DadosCabecalho = {
    empresa_nome: e.nome,
    empresa_cnpj: e.cnpj,
    empresa_ie: e.ie,
    empresa_endereco: e.endereco,
    empresa_cidade: e.cidade,
    empresa_telefone: e.telefone,
    empresa_email: e.email,
    numero_proposta: "",
  };
  const cabecalho = prepararCabecalho(modelo, cab, logo, { normal, negrito }, tema, null);
  const decorar = (p: PDFPage) => {
    if (logo && extras.marcaDagua) marcaDagua(p, logo);
    cabecalho.desenhar(p);
  };
  const ctx: Contexto = { pdf, pagina: pdf.addPage([A4.largura, A4.altura]), y: cabecalho.topo, normal, negrito, tema, topo: cabecalho.topo, decorar };
  decorar(ctx.pagina);

  const tamanho = modelo === "compacto" ? 10 : 10.8;

  // Para quem é (opcional)
  if (d.destinatario?.orgao) {
    ctx.y -= 10;
    paragrafo(ctx, d.destinatario.orgao, { rotulo: "Ao(À): ", tamanho: 10, espaco: 1 });
    if (d.destinatario.referencia) paragrafo(ctx, d.destinatario.referencia, { rotulo: "Referente: ", tamanho: 10, espaco: 1 });
  }

  // Título: cada modelo tem o seu jeito (e usa a cor escolhida)
  ctx.y -= 22;
  desenharTitulo(ctx, (d.titulo || "Declaração").toUpperCase());

  // Texto: cada parágrafo justificado; linha em branco vira espaço
  for (const p of d.texto.replace(/\r/g, "").split("\n")) {
    if (!p.trim()) {
      ctx.y -= tamanho * 0.9;
      continue;
    }
    paragrafo(ctx, p.trim(), { tamanho, alinhar: "justificar", espaco: tamanho * 0.55 });
  }

  // Local e data
  if (d.localData) {
    garantirEspaco(ctx, 40);
    ctx.y -= 22;
    const local = d.localData.local.trim();
    paragrafo(ctx, `${local ? `${local}, ` : ""}${dataPorExtenso(d.localData.data)}.`, { tamanho, alinhar: "centro", espaco: 0 });
  }

  // Assinatura do responsável (mantida junta na mesma página)
  if (d.assinatura) {
    garantirEspaco(ctx, 120);
    ctx.y -= 52;
    const meio = A4.largura / 2;
    ctx.pagina.drawLine({ start: { x: meio - 130, y: ctx.y }, end: { x: meio + 130, y: ctx.y }, thickness: 0.7, color: TEXTO });
    ctx.y -= 6;
    const a = d.assinatura;
    if (a.nome) paragrafo(ctx, a.nome, { tamanho: 10, fonte: negrito, alinhar: "centro", espaco: 0 });
    if (a.cpf) paragrafo(ctx, `CPF: ${a.cpf}`, { tamanho: 9, cor: CINZA, alinhar: "centro", espaco: 0 });
    if (a.cargo) paragrafo(ctx, a.cargo, { tamanho: 9, cor: CINZA, alinhar: "centro", espaco: 0 });
    if (e.nome) paragrafo(ctx, [e.nome, e.cnpj && `CNPJ ${e.cnpj}`].filter(Boolean).join("  ·  "), { tamanho: 9, cor: CINZA, alinhar: "centro", espaco: 0 });
  }

  const total = pdf.getPageCount();
  if (total > 1) {
    pdf.getPages().forEach((p, i) => p.drawText(`Página ${i + 1} de ${total}`, { x: MARGEM, y: 30, size: 7.5, font: normal, color: CINZA }));
  }
  return pdf.save();
}
