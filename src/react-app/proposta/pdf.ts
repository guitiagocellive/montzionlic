// Roda no navegador: gera a proposta comercial em PDF, pronta para assinar.
// Há vários modelos visuais (clássico, moderno, timbrado, compacto e simples) e a cor é escolhida pela empresa.
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { DadosMontados, ModeloPdf } from "../../shared/proposta";

type Dados = DadosMontados;
type Cor = ReturnType<typeof rgb>;

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

export const A4 = { largura: 595.28, altura: 841.89 };
export const MARGEM = 48;
export const LARGURA = A4.largura - MARGEM * 2;
const MARGEM_INFERIOR = 92; // espaço para o selo de assinatura e o número da página
export const CINZA = rgb(0.38, 0.38, 0.42);
export const TEXTO = rgb(0.1, 0.1, 0.12);
const LINHA = rgb(0.78, 0.8, 0.85);
const BRANCO = rgb(1, 1, 1);
const PRETO = rgb(0, 0, 0);
const CINZA_CLARO = rgb(0.9, 0.9, 0.9);

function corDoHex(hex: string): Cor {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? ["", "1f", "3b", "8a"];
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/** Mistura a cor com branco (t = 0 cor pura, 1 branco). */
function clarear(c: Cor, t: number): Cor {
  return rgb(c.red + (1 - c.red) * t, c.green + (1 - c.green) * t, c.blue + (1 - c.blue) * t);
}

export interface Tema {
  modelo: ModeloPdf;
  cor: Cor;
  fundo: Cor; // fundo suave (cabeçalho da tabela, total)
  listra: Cor; // linhas alternadas da tabela
  texto: number; // tamanho base do texto
  tabela: number; // tamanho do texto da tabela
}

export function montarTema(modelo: ModeloPdf, hex: string): Tema {
  const simples = modelo === "simples";
  const cor = simples ? PRETO : corDoHex(hex);
  return {
    modelo,
    cor,
    fundo: simples ? CINZA_CLARO : clarear(cor, modelo === "classico" || modelo === "compacto" ? 0.8 : 0.88),
    listra: clarear(cor, 0.95),
    texto: modelo === "compacto" ? 8.8 : 9.5,
    tabela: modelo === "compacto" ? 7.8 : 8.5,
  };
}

export function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
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

export interface Contexto {
  pdf: PDFDocument;
  pagina: PDFPage;
  y: number;
  normal: PDFFont;
  negrito: PDFFont;
  tema: Tema;
  /** Onde o conteúdo começa em cada página (abaixo do cabeçalho). */
  topo: number;
  /** Desenha cabeçalho, rodapé e marca d'água numa página nova. */
  decorar: (p: PDFPage) => void;
}

export function novaPagina(ctx: Contexto) {
  ctx.pagina = ctx.pdf.addPage([A4.largura, A4.altura]);
  ctx.decorar(ctx.pagina);
  ctx.y = ctx.topo;
}

export function garantirEspaco(ctx: Contexto, altura: number) {
  if (ctx.y - altura < MARGEM_INFERIOR) novaPagina(ctx);
}

interface OpcoesParagrafo {
  tamanho?: number;
  fonte?: PDFFont;
  cor?: Cor;
  alinhar?: "esquerda" | "centro" | "direita" | "justificar";
  espaco?: number;
  rotulo?: string;
  x?: number;
  largura?: number;
}

export function paragrafo(ctx: Contexto, texto: string, opcoes: OpcoesParagrafo = {}) {
  // Justificado: cada linha do texto original é um parágrafo (a última linha de cada um não estica).
  if (opcoes.alinhar === "justificar" && texto.includes("\n")) {
    const partes = texto.split("\n");
    partes.forEach((parte, i) => {
      const ultima = i === partes.length - 1;
      paragrafo(ctx, parte, { ...opcoes, espaco: ultima ? opcoes.espaco : 0, rotulo: i === 0 ? opcoes.rotulo : undefined });
    });
    return;
  }
  const tamanho = opcoes.tamanho ?? ctx.tema.texto;
  const fonte = opcoes.fonte ?? ctx.normal;
  const x0 = opcoes.x ?? MARGEM;
  const largura = opcoes.largura ?? LARGURA;
  const alturaLinha = tamanho * 1.38;
  const rotulo = opcoes.rotulo ? limparTexto(opcoes.rotulo) : "";
  const recuo = rotulo ? ctx.negrito.widthOfTextAtSize(rotulo, tamanho) + 3 : 0;
  const linhas = quebrar(texto, fonte, tamanho, largura - recuo);
  linhas.forEach((linha, i) => {
    garantirEspaco(ctx, alturaLinha);
    const larguraTexto = fonte.widthOfTextAtSize(linha, tamanho);
    let x = x0 + recuo;
    if (opcoes.alinhar === "centro") x = x0 + (largura - larguraTexto) / 2;
    if (opcoes.alinhar === "direita") x = x0 + largura - larguraTexto;
    if (i === 0 && rotulo) ctx.pagina.drawText(rotulo, { x: x0, y: ctx.y - tamanho, size: tamanho, font: ctx.negrito, color: TEXTO });
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

// ---------------- Títulos de seção (cada modelo tem o seu) ----------------

function titulo(ctx: Contexto, texto: string, x = MARGEM, largura = LARGURA) {
  const { modelo, cor } = ctx.tema;
  const p = ctx.pagina;
  if (x === MARGEM) garantirEspaco(ctx, 40);
  ctx.y -= 4;
  const t = limparTexto(texto);
  if (modelo === "moderno") {
    p.drawRectangle({ x, y: ctx.y - 11, width: 3, height: 12, color: cor });
    p.drawText(t.toUpperCase(), { x: x + 8, y: ctx.y - 9.5, size: 9, font: ctx.negrito, color: cor });
    ctx.y -= 20;
  } else if (modelo === "simples") {
    p.drawRectangle({ x, y: ctx.y - 15, width: largura, height: 15, color: CINZA_CLARO });
    p.drawText(t.toUpperCase(), { x: x + 6, y: ctx.y - 11, size: 8.5, font: ctx.negrito, color: PRETO });
    ctx.y -= 22;
  } else if (modelo === "timbrado") {
    p.drawText(t.toUpperCase(), { x, y: ctx.y - 10, size: 10, font: ctx.negrito, color: cor });
    p.drawLine({ start: { x, y: ctx.y - 14 }, end: { x: x + largura, y: ctx.y - 14 }, thickness: 0.8, color: cor });
    ctx.y -= 22;
  } else if (modelo === "compacto") {
    p.drawText(t.toUpperCase(), { x, y: ctx.y - 8.5, size: 8.2, font: ctx.negrito, color: cor });
    p.drawLine({ start: { x, y: ctx.y - 12 }, end: { x: x + largura, y: ctx.y - 12 }, thickness: 0.9, color: cor });
    ctx.y -= 18;
  } else {
    p.drawText(t, { x, y: ctx.y - 10, size: 10, font: ctx.negrito, color: cor });
    p.drawLine({ start: { x, y: ctx.y - 14 }, end: { x: x + largura, y: ctx.y - 14 }, thickness: 1, color: cor });
    ctx.y -= 22;
  }
}

// ---------------- Dados da empresa, banco e representante ----------------

interface Bloco {
  titulo: string;
  linhas: [string, string][];
}

function blocosDados(d: Dados): Bloco[] {
  const blocos: Bloco[] = [
    {
      titulo: "Dados da empresa",
      linhas: [
        ["Razão Social", d.empresa_nome],
        ["CNPJ", d.empresa_cnpj],
        ["Inscrição Estadual", d.empresa_ie],
        ["Endereço", d.empresa_endereco],
        ["Cidade/Estado", d.empresa_cidade],
        ["Telefone", d.empresa_telefone],
        ["E-mail", d.empresa_email],
      ],
    },
  ];
  if (d.banco_nome)
    blocos.push({
      titulo: "Dados bancários para pagamento",
      linhas: [
        ["Banco", `${d.banco_nome}${d.banco_codigo ? ` (${d.banco_codigo})` : ""}`],
        ["Agência", d.agencia],
        [d.tipo_conta ? `Conta ${d.tipo_conta}` : "Conta", d.conta],
        ["PIX", d.pix],
        ["Titular", d.titular],
      ],
    });
  if (d.representante_nome)
    blocos.push({
      titulo: "Representante legal",
      linhas: [
        ["Nome", d.representante_nome],
        ["CPF", d.representante_cpf],
        ["RG", d.representante_rg],
        ["Cargo", d.representante_cargo],
      ],
    });
  return blocos.map((b) => ({ ...b, linhas: b.linhas.filter(([, v]) => v) }));
}

function desenharBloco(ctx: Contexto, b: Bloco, x = MARGEM, largura = LARGURA) {
  titulo(ctx, b.titulo, x, largura);
  for (const [rotulo, valor] of b.linhas) paragrafo(ctx, valor, { rotulo: `${rotulo}: `, espaco: 1, x, largura });
}

/** Altura aproximada de um bloco numa coluna (para não quebrar a página no meio). */
function alturaBloco(ctx: Contexto, b: Bloco, largura: number) {
  const t = ctx.tema.texto;
  return 26 + b.linhas.reduce((s, [r, v]) => s + quebrar(`${r}: ${v}`, ctx.normal, t, largura - 4).length * t * 1.38 + 1, 0);
}

function dadosEmColunas(ctx: Contexto, colunas: Bloco[][]) {
  const gap = 18;
  const n = colunas.length;
  const largura = (LARGURA - gap * (n - 1)) / n;
  const alturas = colunas.map((c) => c.reduce((s, b) => s + alturaBloco(ctx, b, largura), 0));
  garantirEspaco(ctx, Math.max(...alturas) + 6);
  const inicio = ctx.y;
  let menor = inicio;
  colunas.forEach((col, i) => {
    ctx.y = inicio;
    const x = MARGEM + i * (largura + gap);
    for (const b of col) desenharBloco(ctx, b, x, largura);
    menor = Math.min(menor, ctx.y);
  });
  ctx.y = menor;
}

function dadosEmpresa(ctx: Contexto, d: Dados) {
  const blocos = blocosDados(d);
  const { modelo } = ctx.tema;
  if (modelo === "compacto" && blocos.length > 1) dadosEmColunas(ctx, blocos.map((b) => [b]));
  else if (modelo === "moderno" && blocos.length > 1) dadosEmColunas(ctx, [[blocos[0]], blocos.slice(1)]);
  else for (const b of blocos) desenharBloco(ctx, b);
}

// ---------------- Tabela de itens ----------------

// Colunas da tabela de itens (somam a largura útil da página).
const COLUNAS = [
  { titulo: "Item", largura: 32, campo: "item" as const, direita: false },
  { titulo: "Descrição do objeto", largura: 185, campo: "descricao" as const, direita: false },
  { titulo: "Un", largura: 34, campo: "unidade" as const, direita: false },
  { titulo: "Qtd", largura: 42, campo: "quantidade" as const, direita: true },
  { titulo: "Marca", largura: 70, campo: "marca" as const, direita: false },
  { titulo: "Valor unitário", largura: 68, campo: "valor_unitario" as const, direita: true },
  { titulo: "Valor final", largura: 68.28, campo: "valor_total" as const, direita: true },
];

/** Linhas verticais da grade (modelo simples). */
function grade(ctx: Contexto, topo: number, base: number) {
  let x = MARGEM;
  for (let i = 0; i <= COLUNAS.length; i++) {
    ctx.pagina.drawLine({ start: { x, y: topo }, end: { x, y: base }, thickness: 0.6, color: PRETO });
    x += COLUNAS[i]?.largura ?? 0;
  }
}

function cabecalhoTabela(ctx: Contexto) {
  const { modelo, cor, fundo } = ctx.tema;
  const altura = modelo === "compacto" ? 16 : 18;
  const tamanho = modelo === "compacto" ? 7.4 : 8;
  garantirEspaco(ctx, altura + 20);
  const p = ctx.pagina;
  const topo = ctx.y;
  if (modelo === "moderno") p.drawRectangle({ x: MARGEM, y: topo - altura, width: LARGURA, height: altura, color: cor });
  else if (modelo === "timbrado") {
    p.drawLine({ start: { x: MARGEM, y: topo }, end: { x: MARGEM + LARGURA, y: topo }, thickness: 1.1, color: cor });
    p.drawLine({ start: { x: MARGEM, y: topo - altura }, end: { x: MARGEM + LARGURA, y: topo - altura }, thickness: 0.6, color: cor });
  } else p.drawRectangle({ x: MARGEM, y: topo - altura, width: LARGURA, height: altura, color: fundo });
  if (modelo === "simples") {
    p.drawRectangle({ x: MARGEM, y: topo - altura, width: LARGURA, height: altura, borderColor: PRETO, borderWidth: 0.6 });
    grade(ctx, topo, topo - altura);
  }
  const corTexto = modelo === "moderno" ? BRANCO : modelo === "timbrado" ? cor : TEXTO;
  let x = MARGEM;
  for (const col of COLUNAS) {
    const w = ctx.negrito.widthOfTextAtSize(col.titulo, tamanho);
    p.drawText(col.titulo, { x: col.direita ? x + col.largura - 4 - w : x + 4, y: topo - altura / 2 - tamanho / 2 + 1.5, size: tamanho, font: ctx.negrito, color: corTexto });
    x += col.largura;
  }
  ctx.y -= altura;
}

function tabelaItens(ctx: Contexto, itens: Dados["itens"], total: string) {
  const { modelo, cor, fundo, listra } = ctx.tema;
  cabecalhoTabela(ctx);
  const tamanho = ctx.tema.tabela;
  const listrar = modelo === "moderno" || modelo === "compacto";
  itens.forEach((item, n) => {
    const celulas = COLUNAS.map((col) => quebrar(String(item[col.campo] ?? ""), ctx.normal, tamanho, col.largura - 8));
    const altura = Math.max(...celulas.map((l) => l.length)) * (tamanho * 1.3) + 8;
    if (ctx.y - altura < MARGEM_INFERIOR) {
      novaPagina(ctx);
      cabecalhoTabela(ctx);
    }
    if (listrar && n % 2 === 1) ctx.pagina.drawRectangle({ x: MARGEM, y: ctx.y - altura, width: LARGURA, height: altura, color: listra });
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
    if (modelo === "simples") grade(ctx, ctx.y, ctx.y - altura);
    ctx.y -= altura;
    ctx.pagina.drawLine({
      start: { x: MARGEM, y: ctx.y },
      end: { x: A4.largura - MARGEM, y: ctx.y },
      thickness: modelo === "simples" ? 0.6 : 0.5,
      color: modelo === "simples" ? PRETO : LINHA,
    });
  });
  // total (com o valor por extenso)
  const linhas = quebrar(total, ctx.negrito, 9, LARGURA - 16);
  const altura = linhas.length * 12.5 + 9;
  garantirEspaco(ctx, altura + 4);
  const p = ctx.pagina;
  let corTexto = TEXTO;
  if (modelo === "moderno") {
    p.drawRectangle({ x: MARGEM, y: ctx.y - altura, width: LARGURA, height: altura, color: cor });
    corTexto = BRANCO;
  } else if (modelo === "simples") {
    p.drawRectangle({ x: MARGEM, y: ctx.y - altura, width: LARGURA, height: altura, borderColor: PRETO, borderWidth: 0.8 });
  } else if (modelo === "timbrado") {
    p.drawLine({ start: { x: MARGEM, y: ctx.y - altura }, end: { x: MARGEM + LARGURA, y: ctx.y - altura }, thickness: 1.1, color: cor });
    corTexto = cor;
  } else {
    p.drawRectangle({ x: MARGEM, y: ctx.y - altura, width: LARGURA, height: altura, color: fundo });
  }
  linhas.forEach((linha, i) => {
    const w = ctx.negrito.widthOfTextAtSize(linha, 9);
    p.drawText(linha, { x: (A4.largura - w) / 2, y: ctx.y - 14 - i * 12.5, size: 9, font: ctx.negrito, color: corTexto });
  });
  ctx.y -= altura + 14;
}

// ---------------- Cabeçalho e rodapé de cada página ----------------

export interface ExtrasPdf {
  logo?: { bytes: Uint8Array; tipo: string } | null;
  /** Logo clarinho no fundo de cada página. */
  marcaDagua?: boolean;
  modelo?: ModeloPdf;
  /** Cor principal do modelo (#rrggbb). */
  cor?: string;
}

const TITULO_PAGINA = "PROPOSTA COMERCIAL";

function caber(logo: PDFImage | null, maxL: number, maxA: number) {
  if (!logo) return { w: 0, h: 0 };
  const e = Math.min(maxL / logo.width, maxA / logo.height, 1);
  return { w: logo.width * e, h: logo.height * e };
}

/** Desenha o cabeçalho (e rodapé) do modelo e devolve a altura onde o conteúdo começa. */
/** Dados da empresa usados no cabeçalho/rodapé (proposta ou documento avulso). */
export type DadosCabecalho = Pick<
  Dados,
  "empresa_nome" | "empresa_cnpj" | "empresa_ie" | "empresa_endereco" | "empresa_cidade" | "empresa_telefone" | "empresa_email" | "numero_proposta"
>;

/** titulo = null: sem título no cabeçalho (documentos avulsos, onde o título vai no corpo). */
export function prepararCabecalho(
  modelo: ModeloPdf,
  d: DadosCabecalho,
  logo: PDFImage | null,
  fontes: { normal: PDFFont; negrito: PDFFont },
  tema: Tema,
  titulo: string | null = TITULO_PAGINA,
): { topo: number; desenhar: (p: PDFPage) => void } {
  const { normal, negrito } = fontes;
  const topoPagina = A4.altura - MARGEM + 8;
  const textoDireita = (p: PDFPage, texto: string, y: number, tamanho: number, fonte: PDFFont, cor: Cor) => {
    const t = limparTexto(texto);
    p.drawText(t, { x: A4.largura - MARGEM - fonte.widthOfTextAtSize(t, tamanho), y, size: tamanho, font: fonte, color: cor });
  };
  const centro = (p: PDFPage, texto: string, y: number, tamanho: number, fonte: PDFFont, cor: Cor) => {
    const t = limparTexto(texto);
    p.drawText(t, { x: (A4.largura - fonte.widthOfTextAtSize(t, tamanho)) / 2, y, size: tamanho, font: fonte, color: cor });
  };

  if (modelo === "moderno") {
    const l = caber(logo, 150, 46);
    const altura = Math.max(l.h, 34);
    const base = topoPagina - 12 - altura;
    return {
      topo: base - 22,
      desenhar: (p) => {
        p.drawRectangle({ x: 0, y: A4.altura - 12, width: A4.largura, height: 12, color: tema.cor });
        if (logo) p.drawImage(logo, { x: MARGEM, y: topoPagina - 12 - l.h, width: l.w, height: l.h });
        if (titulo) {
          textoDireita(p, titulo, topoPagina - 28, 15, negrito, tema.cor);
          textoDireita(p, [d.empresa_nome, d.empresa_cnpj && `CNPJ ${d.empresa_cnpj}`].filter(Boolean).join("  ·  "), topoPagina - 42, 8, normal, CINZA);
        } else {
          textoDireita(p, d.empresa_nome, topoPagina - 28, 12, negrito, tema.cor);
          textoDireita(p, [d.empresa_cnpj && `CNPJ ${d.empresa_cnpj}`, d.empresa_cidade].filter(Boolean).join("  ·  "), topoPagina - 41, 8, normal, CINZA);
        }
        p.drawLine({ start: { x: MARGEM, y: base - 8 }, end: { x: A4.largura - MARGEM, y: base - 8 }, thickness: 1.2, color: tema.cor });
      },
    };
  }

  if (modelo === "timbrado") {
    const l = caber(logo, 140, 56);
    const linhas = [
      [d.empresa_cnpj && `CNPJ ${d.empresa_cnpj}`, d.empresa_ie && `IE ${d.empresa_ie}`].filter(Boolean).join("  ·  "),
      d.empresa_endereco,
      d.empresa_cidade,
      [d.empresa_telefone, d.empresa_email].filter(Boolean).join("  ·  "),
    ].filter(Boolean) as string[];
    const alturaTexto = 14 + linhas.length * 11;
    const base = topoPagina - Math.max(l.h, alturaTexto) - 6;
    const rodape = [d.empresa_endereco, d.empresa_cidade, d.empresa_telefone, d.empresa_email].filter(Boolean).join("  ·  ");
    return {
      topo: base - 18,
      desenhar: (p) => {
        if (logo) p.drawImage(logo, { x: MARGEM, y: topoPagina - l.h, width: l.w, height: l.h });
        textoDireita(p, d.empresa_nome, topoPagina - 11, 11, negrito, tema.cor);
        linhas.forEach((t, i) => textoDireita(p, t, topoPagina - 25 - i * 11, 8, normal, CINZA));
        p.drawLine({ start: { x: MARGEM, y: base }, end: { x: A4.largura - MARGEM, y: base }, thickness: 1.6, color: tema.cor });
        p.drawLine({ start: { x: MARGEM, y: base - 3 }, end: { x: A4.largura - MARGEM, y: base - 3 }, thickness: 0.5, color: tema.cor });
        if (rodape) {
          p.drawLine({ start: { x: MARGEM, y: 60 }, end: { x: A4.largura - MARGEM, y: 60 }, thickness: 0.5, color: tema.cor });
          const linhasRodape = quebrar(rodape, normal, 7.5, LARGURA);
          linhasRodape.slice(0, 2).forEach((t, i) => centro(p, t, 50 - i * 9, 7.5, normal, CINZA));
        }
      },
    };
  }

  if (modelo === "compacto") {
    const l = caber(logo, 110, 36);
    const altura = Math.max(l.h, 26);
    const base = topoPagina - altura;
    return {
      topo: base - 16,
      desenhar: (p) => {
        if (logo) p.drawImage(logo, { x: MARGEM, y: topoPagina - l.h, width: l.w, height: l.h });
        if (titulo) {
          textoDireita(p, titulo, topoPagina - 13, 12, negrito, tema.cor);
          if (d.numero_proposta) textoDireita(p, `Nº ${d.numero_proposta}`, topoPagina - 25, 8, normal, CINZA);
        } else {
          textoDireita(p, d.empresa_nome, topoPagina - 12, 10, negrito, tema.cor);
          if (d.empresa_cnpj) textoDireita(p, `CNPJ ${d.empresa_cnpj}`, topoPagina - 23, 7.5, normal, CINZA);
        }
        p.drawLine({ start: { x: MARGEM, y: base - 6 }, end: { x: A4.largura - MARGEM, y: base - 6 }, thickness: 1.2, color: tema.cor });
      },
    };
  }

  if (modelo === "simples") {
    const l = caber(logo, 130, 42);
    const caixa = topoPagina - (logo ? l.h + 8 : 0);
    return {
      topo: titulo ? caixa - 22 - 14 : caixa - 14,
      desenhar: (p) => {
        if (logo) p.drawImage(logo, { x: (A4.largura - l.w) / 2, y: topoPagina - l.h, width: l.w, height: l.h });
        if (titulo) {
          p.drawRectangle({ x: MARGEM, y: caixa - 22, width: LARGURA, height: 22, borderColor: PRETO, borderWidth: 1 });
          centro(p, titulo, caixa - 15, 12, negrito, PRETO);
        } else p.drawLine({ start: { x: MARGEM, y: caixa - 4 }, end: { x: A4.largura - MARGEM, y: caixa - 4 }, thickness: 0.8, color: PRETO });
      },
    };
  }

  // clássico
  const l = caber(logo, 150, 50);
  return {
    topo: topoPagina - (logo ? l.h + 8 : 0) - (titulo ? 30 : 8),
    desenhar: (p) => {
      let y = topoPagina;
      if (logo) {
        p.drawImage(logo, { x: (A4.largura - l.w) / 2, y: y - l.h, width: l.w, height: l.h });
        y -= l.h + 8;
      }
      if (titulo) {
        centro(p, titulo, y - 13, 12, negrito, tema.cor);
        p.drawLine({ start: { x: A4.largura / 2 - 40, y: y - 19 }, end: { x: A4.largura / 2 + 40, y: y - 19 }, thickness: 1.6, color: tema.cor });
      }
    },
  };
}

/** Marca d'água: o logo grande e bem claro no meio da página. */
export function marcaDagua(p: PDFPage, logo: PDFImage) {
  const escala = Math.min(440 / logo.width, 300 / logo.height);
  const w = logo.width * escala;
  const h = logo.height * escala;
  p.drawImage(logo, { x: (A4.largura - w) / 2, y: (A4.altura - h) / 2 - 40, width: w, height: h, opacity: 0.07 });
}

/** Embute o logo (PNG ou JPG); se falhar, segue sem. */
export async function embutirLogo(pdf: PDFDocument, logo: ExtrasPdf["logo"]): Promise<PDFImage | null> {
  if (!logo) return null;
  try {
    return logo.tipo === "image/png" ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
  } catch {
    return null;
  }
}

// ---------------- Proposta ----------------

export async function gerarPropostaPdf(d: Dados, extras: ExtrasPdf): Promise<Uint8Array> {
  const modelo: ModeloPdf = extras.modelo ?? "classico";
  const tema = montarTema(modelo, extras.cor ?? "#1f3b8a");
  const pdf = await PDFDocument.create();
  pdf.setTitle(limparTexto(`Proposta comercial ${d.numero_licitacao} - ${d.orgao}`));
  pdf.setAuthor(limparTexto(d.empresa_nome || "Montzion"));
  pdf.setCreator("Montzion");
  pdf.setProducer("Montzion");
  const serifa = modelo === "timbrado";
  const normal = await pdf.embedFont(serifa ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(serifa ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);

  let logo: PDFImage | null = null;
  if (extras.logo) {
    try {
      logo = extras.logo.tipo === "image/png" ? await pdf.embedPng(extras.logo.bytes) : await pdf.embedJpg(extras.logo.bytes);
    } catch {
      logo = null; // logo inválida: segue sem
    }
  }

  const cabecalho = prepararCabecalho(modelo, d, logo, { normal, negrito }, tema);
  const decorar = (p: PDFPage) => {
    if (logo && extras.marcaDagua) marcaDagua(p, logo);
    cabecalho.desenhar(p);
  };

  const ctx: Contexto = { pdf, pagina: pdf.addPage([A4.largura, A4.altura]), y: cabecalho.topo, normal, negrito, tema, topo: cabecalho.topo, decorar };
  decorar(ctx.pagina);
  ctx.y -= 6;

  // No timbrado o título fica no corpo (o cabeçalho é o da empresa).
  if (modelo === "timbrado") paragrafo(ctx, TITULO_PAGINA, { tamanho: 13, fonte: negrito, cor: tema.cor, alinhar: "centro", espaco: 8 });

  // Identificação
  const grande = modelo === "compacto" ? 10.5 : 12;
  if (d.contratacao) paragrafo(ctx, `Contratação: ${d.contratacao}`, { tamanho: grande, fonte: negrito, espaco: 0 });
  if (d.numero_proposta && modelo !== "compacto") paragrafo(ctx, `Nº: ${d.numero_proposta}`, { tamanho: grande, fonte: negrito, espaco: 0 });
  ctx.y -= 6;
  paragrafo(ctx, `${d.orgao}${d.uasg ? `  (UASG ${d.uasg})` : ""}`, { rotulo: "Ao(À): ", espaco: 1 });
  const referencia = [
    `${d.modalidade || "Licitação"} nº ${d.numero_licitacao}`,
    d.data_sessao && `Sessão: ${d.data_sessao}${d.horario ? ` às ${d.horario}` : ""}`,
    d.portal,
  ]
    .filter(Boolean)
    .join("  ·  ");
  paragrafo(ctx, referencia, { rotulo: "Referente: ", espaco: 1 });
  if (d.objeto) paragrafo(ctx, d.objeto, { rotulo: "Objeto: ", espaco: 1 });

  // Empresa, banco e representante
  dadosEmpresa(ctx, d);
  ctx.y -= modelo === "compacto" ? 6 : 10;

  // Itens
  tabelaItens(ctx, d.itens, `Valor Global da Proposta: ${d.valor_total} (${d.valor_total_extenso}).`);

  // Prazos e condições
  if (d.prazo_entrega) paragrafo(ctx, d.prazo_entrega, { rotulo: "Prazo de entrega: ", espaco: 2 });
  paragrafo(ctx, `${d.validade_dias} (${d.validade_extenso}) dias, contados da data de sua apresentação (até ${d.validade_data}).`, {
    rotulo: "Prazo de validade da proposta: ",
    espaco: 2,
  });
  if (d.garantia) paragrafo(ctx, d.garantia, { rotulo: "Garantia: ", espaco: 2 });
  if (d.observacoes) paragrafo(ctx, d.observacoes, { rotulo: "Observações: ", espaco: 2 });
  if (d.condicoes.length) {
    ctx.y -= 4;
    for (const c of d.condicoes) paragrafo(ctx, c.texto, { rotulo: "•  ", alinhar: "justificar", espaco: 3 });
  }
  ctx.y -= 8;

  // Declarações
  const tamanhoDeclaracao = modelo === "compacto" ? 8.4 : 9;
  for (const dec of d.declaracoes) {
    garantirEspaco(ctx, 50);
    if (dec.titulo) paragrafo(ctx, dec.titulo.toUpperCase(), { fonte: negrito, cor: modelo === "simples" || modelo === "classico" ? TEXTO : tema.cor, espaco: 3 });
    paragrafo(ctx, dec.texto, { tamanho: tamanhoDeclaracao, alinhar: "justificar", espaco: modelo === "compacto" ? 7 : 10 });
  }

  // Local, data e assinatura (mantidos juntos na mesma página)
  garantirEspaco(ctx, 130);
  ctx.y -= 6;
  paragrafo(ctx, `${d.empresa_cidade ? `${d.empresa_cidade}, ` : ""}${d.data_extenso}.`, { fonte: negrito, alinhar: "centro", espaco: 44 });
  const meio = A4.largura / 2;
  ctx.pagina.drawLine({ start: { x: meio - 130, y: ctx.y }, end: { x: meio + 130, y: ctx.y }, thickness: 0.7, color: TEXTO });
  ctx.y -= 6;
  if (d.representante_nome) paragrafo(ctx, `Nome: ${d.representante_nome}`, { fonte: negrito, alinhar: "centro", espaco: 0 });
  const documentos = [d.representante_cpf && `CPF: ${d.representante_cpf}`, d.representante_rg && `RG: ${d.representante_rg}`].filter(Boolean).join(" / ");
  if (documentos) paragrafo(ctx, documentos, { tamanho: 9, cor: CINZA, alinhar: "centro", espaco: 0 });
  if (d.representante_cargo) paragrafo(ctx, d.representante_cargo, { tamanho: 9, cor: CINZA, alinhar: "centro", espaco: 0 });
  if (d.empresa_nome) paragrafo(ctx, [d.empresa_nome, d.empresa_cnpj && `CNPJ ${d.empresa_cnpj}`].filter(Boolean).join("  ·  "), { tamanho: 9, cor: CINZA, alinhar: "centro", espaco: 0 });

  // Numeração das páginas
  const total = pdf.getPageCount();
  pdf.getPages().forEach((p, i) => {
    const texto = `Página ${i + 1} de ${total}`;
    p.drawText(texto, { x: MARGEM, y: 30, size: 7.5, font: normal, color: CINZA });
  });

  return pdf.save();
}
