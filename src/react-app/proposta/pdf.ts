// Roda no navegador: gera a proposta comercial em PDF (layout da plataforma), pronta para assinar.
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { DadosMontados } from "../../shared/proposta";

type Dados = DadosMontados;

// As fontes padrão do PDF usam a codificação WinAnsi (português funciona).
// Caracteres fora dela são trocados para não quebrar o documento.
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function limparTexto(texto: string): string {
  return Array.from(texto ?? "")
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (ch === "\n") return ch;
      if (c === 9) return " ";
      if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WINANSI_EXTRA.has(ch)) return ch;
      if (ch === "→") return "->";
      if (ch === "≤") return "<=";
      if (ch === "≥") return ">=";
      return "?";
    })
    .join("");
}

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 48;
const MARGEM_INFERIOR = 92; // espaço para o selo de assinatura e o número da página
const AZUL = rgb(0.12, 0.23, 0.54);
const CINZA = rgb(0.38, 0.38, 0.42);
const TEXTO = rgb(0.1, 0.1, 0.12);
const LINHA = rgb(0.78, 0.8, 0.85);
const FUNDO_CABECALHO = rgb(0.91, 0.93, 0.98);

function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
  const linhas: string[] = [];
  for (const paragrafo of limparTexto(texto).split("\n")) {
    const palavras = paragrafo.split(/\s+/).filter(Boolean);
    let atual = "";
    for (const palavra of palavras) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) {
        atual = tentativa;
        continue;
      }
      if (atual) linhas.push(atual);
      // palavra maior que a linha: corta em pedaços
      let resto = palavra;
      while (fonte.widthOfTextAtSize(resto, tamanho) > largura) {
        let i = resto.length;
        while (i > 1 && fonte.widthOfTextAtSize(resto.slice(0, i), tamanho) > largura) i--;
        linhas.push(resto.slice(0, i));
        resto = resto.slice(i);
      }
      atual = resto;
    }
    linhas.push(atual);
  }
  return linhas;
}

interface Contexto {
  pdf: PDFDocument;
  pagina: PDFPage;
  y: number;
  normal: PDFFont;
  negrito: PDFFont;
}

function novaPagina(ctx: Contexto) {
  ctx.pagina = ctx.pdf.addPage([A4.largura, A4.altura]);
  ctx.y = A4.altura - MARGEM;
}

function garantirEspaco(ctx: Contexto, altura: number) {
  if (ctx.y - altura < MARGEM_INFERIOR) novaPagina(ctx);
}

function paragrafo(
  ctx: Contexto,
  texto: string,
  opcoes: { tamanho?: number; fonte?: PDFFont; cor?: ReturnType<typeof rgb>; alinhar?: "esquerda" | "centro" | "direita" | "justificar"; espaco?: number; rotulo?: string } = {},
) {
  const tamanho = opcoes.tamanho ?? 10;
  const fonte = opcoes.fonte ?? ctx.normal;
  const largura = A4.largura - MARGEM * 2;
  const alturaLinha = tamanho * 1.38;
  const rotulo = opcoes.rotulo ? limparTexto(opcoes.rotulo) : "";
  const recuo = rotulo ? ctx.negrito.widthOfTextAtSize(rotulo, tamanho) + 3 : 0;
  const linhas = quebrar(texto, fonte, tamanho, largura - recuo);
  linhas.forEach((linha, i) => {
    garantirEspaco(ctx, alturaLinha);
    const larguraTexto = fonte.widthOfTextAtSize(linha, tamanho);
    let x = MARGEM + (i === 0 ? recuo : recuo);
    if (opcoes.alinhar === "centro") x = (A4.largura - larguraTexto) / 2;
    if (opcoes.alinhar === "direita") x = A4.largura - MARGEM - larguraTexto;
    if (i === 0 && rotulo) ctx.pagina.drawText(rotulo, { x: MARGEM, y: ctx.y - tamanho, size: tamanho, font: ctx.negrito, color: TEXTO });
    const ultima = i === linhas.length - 1;
    if (opcoes.alinhar === "justificar" && !ultima && linha.includes(" ")) {
      // distribui o espaço entre as palavras
      const palavras = linha.split(" ");
      const larguraPalavras = palavras.reduce((s, p) => s + fonte.widthOfTextAtSize(p, tamanho), 0);
      const espaco = (largura - recuo - larguraPalavras) / (palavras.length - 1);
      let px = x;
      for (const p of palavras) {
        ctx.pagina.drawText(p, { x: px, y: ctx.y - tamanho, size: tamanho, font: fonte, color: opcoes.cor ?? TEXTO });
        px += fonte.widthOfTextAtSize(p, tamanho) + espaco;
      }
    } else {
      ctx.pagina.drawText(linha, { x, y: ctx.y - tamanho, size: tamanho, font: fonte, color: opcoes.cor ?? TEXTO });
    }
    ctx.y -= alturaLinha;
  });
  ctx.y -= opcoes.espaco ?? 4;
}

// Colunas da tabela de itens (somam a largura útil da página).
const COLUNAS = [
  { titulo: "Item", largura: 34, campo: "item" as const, direita: false },
  { titulo: "Descrição", largura: 179, campo: "descricao" as const, direita: false },
  { titulo: "Marca / modelo", largura: 78, campo: "marca" as const, direita: false },
  { titulo: "Unid.", largura: 34, campo: "unidade" as const, direita: false },
  { titulo: "Qtd.", largura: 40, campo: "quantidade" as const, direita: true },
  { titulo: "Valor unit.", largura: 67, campo: "valor_unitario" as const, direita: true },
  { titulo: "Valor total", largura: 67.28, campo: "valor_total" as const, direita: true },
];

function cabecalhoTabela(ctx: Contexto) {
  const altura = 18;
  garantirEspaco(ctx, altura + 20);
  let x = MARGEM;
  ctx.pagina.drawRectangle({ x: MARGEM, y: ctx.y - altura, width: A4.largura - MARGEM * 2, height: altura, color: FUNDO_CABECALHO });
  for (const col of COLUNAS) {
    ctx.pagina.drawText(col.titulo, { x: x + 4, y: ctx.y - 12.5, size: 8, font: ctx.negrito, color: TEXTO });
    x += col.largura;
  }
  ctx.y -= altura;
}

function tabelaItens(ctx: Contexto, itens: Dados["itens"], total: string) {
  cabecalhoTabela(ctx);
  const tamanho = 8.5;
  for (const item of itens) {
    const celulas = COLUNAS.map((col) => quebrar(String(item[col.campo] ?? ""), ctx.normal, tamanho, col.largura - 8));
    const altura = Math.max(...celulas.map((l) => l.length)) * (tamanho * 1.3) + 8;
    if (ctx.y - altura < MARGEM_INFERIOR) {
      novaPagina(ctx);
      cabecalhoTabela(ctx);
    }
    let x = MARGEM;
    celulas.forEach((linhas, i) => {
      const col = COLUNAS[i];
      linhas.forEach((linha, j) => {
        const w = ctx.normal.widthOfTextAtSize(linha, tamanho);
        ctx.pagina.drawText(linha, {
          x: col.direita ? x + col.largura - 4 - w : x + 4,
          y: ctx.y - 4 - tamanho - j * tamanho * 1.3,
          size: tamanho,
          font: ctx.normal,
          color: TEXTO,
        });
      });
      x += col.largura;
    });
    ctx.y -= altura;
    ctx.pagina.drawLine({ start: { x: MARGEM, y: ctx.y }, end: { x: A4.largura - MARGEM, y: ctx.y }, thickness: 0.5, color: LINHA });
  }
  // total
  garantirEspaco(ctx, 22);
  ctx.pagina.drawRectangle({ x: MARGEM, y: ctx.y - 20, width: A4.largura - MARGEM * 2, height: 20, color: FUNDO_CABECALHO });
  const rotulo = "VALOR GLOBAL DA PROPOSTA";
  const largTotal = COLUNAS[COLUNAS.length - 1].largura;
  ctx.pagina.drawText(rotulo, {
    x: A4.largura - MARGEM - largTotal - 8 - ctx.negrito.widthOfTextAtSize(rotulo, 8.5),
    y: ctx.y - 13.5,
    size: 8.5,
    font: ctx.negrito,
    color: TEXTO,
  });
  const t = limparTexto(total);
  ctx.pagina.drawText(t, { x: A4.largura - MARGEM - 4 - ctx.negrito.widthOfTextAtSize(t, 9), y: ctx.y - 13.5, size: 9, font: ctx.negrito, color: AZUL });
  ctx.y -= 30;
}

export interface ExtrasPdf {
  logo?: { bytes: Uint8Array; tipo: string } | null;
  declaracao: string;
}

export async function gerarPropostaPdf(d: Dados, extras: ExtrasPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(limparTexto(`Proposta comercial ${d.numero_licitacao} - ${d.orgao}`));
  pdf.setAuthor(limparTexto(d.empresa_nome || "Montzion"));
  pdf.setCreator("Montzion");
  pdf.setProducer("Montzion");
  const ctx: Contexto = {
    pdf,
    pagina: pdf.addPage([A4.largura, A4.altura]),
    y: A4.altura - MARGEM,
    normal: await pdf.embedFont(StandardFonts.Helvetica),
    negrito: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  // Cabeçalho da empresa (com logo, se houver)
  if (extras.logo) {
    try {
      const img = extras.logo.tipo === "image/png" ? await pdf.embedPng(extras.logo.bytes) : await pdf.embedJpg(extras.logo.bytes);
      const escala = Math.min(150 / img.width, 54 / img.height, 1);
      const w = img.width * escala;
      const h = img.height * escala;
      ctx.pagina.drawImage(img, { x: (A4.largura - w) / 2, y: ctx.y - h, width: w, height: h });
      ctx.y -= h + 8;
    } catch {
      // logo inválida: segue sem
    }
  }
  if (d.empresa_nome) paragrafo(ctx, d.empresa_nome, { tamanho: 15, fonte: ctx.negrito, cor: AZUL, alinhar: "centro", espaco: 1 });
  const linha1 = [d.empresa_cnpj && `CNPJ ${d.empresa_cnpj}`, d.empresa_ie && `IE ${d.empresa_ie}`].filter(Boolean).join("  ·  ");
  const linha2 = [d.empresa_endereco, d.empresa_telefone, d.empresa_email].filter(Boolean).join("  ·  ");
  if (linha1) paragrafo(ctx, linha1, { tamanho: 8.5, cor: CINZA, alinhar: "centro", espaco: 0 });
  if (linha2) paragrafo(ctx, linha2, { tamanho: 8.5, cor: CINZA, alinhar: "centro", espaco: 0 });
  ctx.y -= 10;
  ctx.pagina.drawLine({ start: { x: MARGEM, y: ctx.y }, end: { x: A4.largura - MARGEM, y: ctx.y }, thickness: 1, color: AZUL });
  ctx.y -= 18;

  paragrafo(ctx, "PROPOSTA COMERCIAL", { tamanho: 14, fonte: ctx.negrito, alinhar: "centro", espaco: 12 });

  paragrafo(ctx, `${d.orgao}${d.uasg ? `  (UASG ${d.uasg})` : ""}`, { rotulo: "Ao(À): " });
  const referencia = [
    `${d.modalidade || "Licitação"} nº ${d.numero_licitacao}`,
    d.data_sessao && `Sessão: ${d.data_sessao}${d.horario ? ` às ${d.horario}` : ""}`,
    d.portal,
  ]
    .filter(Boolean)
    .join("  ·  ");
  paragrafo(ctx, referencia, { rotulo: "Referente: " });
  if (d.objeto) paragrafo(ctx, d.objeto, { rotulo: "Objeto: " });
  ctx.y -= 8;

  tabelaItens(ctx, d.itens, d.valor_total);
  paragrafo(ctx, `${d.valor_total} (${d.valor_total_extenso}).`, { rotulo: "Valor global: ", espaco: 14 });

  paragrafo(ctx, "CONDIÇÕES", { tamanho: 11, fonte: ctx.negrito, cor: AZUL, espaco: 6 });
  paragrafo(ctx, `${d.validade_dias} dias (até ${d.validade_data}).`, { rotulo: "Validade da proposta: " });
  if (d.prazo_entrega) paragrafo(ctx, d.prazo_entrega, { rotulo: "Prazo de entrega: " });
  if (d.garantia) paragrafo(ctx, d.garantia, { rotulo: "Garantia: " });
  if (d.banco_nome) {
    const banco = [
      `${d.banco_nome}${d.banco_codigo ? ` (${d.banco_codigo})` : ""}`,
      d.agencia && `Agência ${d.agencia}`,
      d.conta && `Conta ${d.tipo_conta ? `${d.tipo_conta} ` : ""}${d.conta}`,
      d.pix && `PIX ${d.pix}`,
      d.titular && `titular ${d.titular}`,
    ]
      .filter(Boolean)
      .join(", ");
    paragrafo(ctx, `depósito bancário — ${banco}.`, { rotulo: "Pagamento: " });
  }
  if (d.observacoes) paragrafo(ctx, d.observacoes, { rotulo: "Observações: " });
  ctx.y -= 10;

  if (extras.declaracao) paragrafo(ctx, extras.declaracao, { tamanho: 9.5, alinhar: "justificar", espaco: 16 });

  // Local, data e assinatura (mantidos juntos na mesma página)
  garantirEspaco(ctx, 120);
  paragrafo(ctx, `${d.empresa_cidade ? `${d.empresa_cidade}, ` : ""}${d.data_extenso}.`, { alinhar: "direita", espaco: 42 });
  const meio = A4.largura / 2;
  ctx.pagina.drawLine({ start: { x: meio - 120, y: ctx.y }, end: { x: meio + 120, y: ctx.y }, thickness: 0.7, color: TEXTO });
  ctx.y -= 6;
  if (d.representante_nome) paragrafo(ctx, d.representante_nome, { fonte: ctx.negrito, alinhar: "centro", espaco: 0 });
  const cargo = [d.representante_cargo, d.representante_cpf && `CPF ${d.representante_cpf}`].filter(Boolean).join("  ·  ");
  if (cargo) paragrafo(ctx, cargo, { tamanho: 9, cor: CINZA, alinhar: "centro", espaco: 0 });
  if (d.empresa_nome) paragrafo(ctx, [d.empresa_nome, d.empresa_cnpj && `CNPJ ${d.empresa_cnpj}`].filter(Boolean).join("  ·  "), { tamanho: 9, cor: CINZA, alinhar: "centro", espaco: 0 });

  // Numeração das páginas
  const total = pdf.getPageCount();
  pdf.getPages().forEach((p, i) => {
    const texto = `Página ${i + 1} de ${total}`;
    p.drawText(texto, { x: MARGEM, y: 30, size: 7.5, font: ctx.normal, color: CINZA });
  });

  return pdf.save();
}
