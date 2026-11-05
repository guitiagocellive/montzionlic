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
  /** Onde o conteúdo começa em cada página (abaixo do cabeçalho). */
  topo: number;
  /** Desenha cabeçalho e marca d'água numa página nova. */
  decorar: (p: PDFPage) => void;
}

function novaPagina(ctx: Contexto) {
  ctx.pagina = ctx.pdf.addPage([A4.largura, A4.altura]);
  ctx.decorar(ctx.pagina);
  ctx.y = ctx.topo;
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
  { titulo: "Item", largura: 32, campo: "item" as const, direita: false },
  { titulo: "Descrição do objeto", largura: 185, campo: "descricao" as const, direita: false },
  { titulo: "Un", largura: 34, campo: "unidade" as const, direita: false },
  { titulo: "Qtd", largura: 42, campo: "quantidade" as const, direita: true },
  { titulo: "Marca", largura: 70, campo: "marca" as const, direita: false },
  { titulo: "Valor unitário", largura: 68, campo: "valor_unitario" as const, direita: true },
  { titulo: "Valor final", largura: 68.28, campo: "valor_total" as const, direita: true },
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
  // total (com o valor por extenso)
  const linhas = quebrar(total, ctx.negrito, 9, A4.largura - MARGEM * 2 - 16);
  const altura = linhas.length * 12.5 + 9;
  garantirEspaco(ctx, altura + 4);
  ctx.pagina.drawRectangle({ x: MARGEM, y: ctx.y - altura, width: A4.largura - MARGEM * 2, height: altura, color: FUNDO_CABECALHO });
  linhas.forEach((linha, i) => {
    const w = ctx.negrito.widthOfTextAtSize(linha, 9);
    ctx.pagina.drawText(linha, { x: (A4.largura - w) / 2, y: ctx.y - 14 - i * 12.5, size: 9, font: ctx.negrito, color: TEXTO });
  });
  ctx.y -= altura + 14;
}

export interface ExtrasPdf {
  logo?: { bytes: Uint8Array; tipo: string } | null;
  /** Logo clarinho no fundo de cada página. */
  marcaDagua?: boolean;
}

function titulo(ctx: Contexto, texto: string) {
  garantirEspaco(ctx, 40);
  ctx.y -= 4;
  paragrafo(ctx, texto, { tamanho: 10, fonte: ctx.negrito, cor: AZUL, espaco: 2 });
  ctx.pagina.drawLine({ start: { x: MARGEM, y: ctx.y + 1 }, end: { x: A4.largura - MARGEM, y: ctx.y + 1 }, thickness: 0.6, color: LINHA });
  ctx.y -= 6;
}

function linhaDado(ctx: Contexto, rotulo: string, valor: string) {
  if (!valor) return;
  paragrafo(ctx, valor, { rotulo: `${rotulo}: `, tamanho: 9.5, espaco: 1 });
}

export async function gerarPropostaPdf(d: Dados, extras: ExtrasPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(limparTexto(`Proposta comercial ${d.numero_licitacao} - ${d.orgao}`));
  pdf.setAuthor(limparTexto(d.empresa_nome || "Montzion"));
  pdf.setCreator("Montzion");
  pdf.setProducer("Montzion");
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logo: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
  if (extras.logo) {
    try {
      logo = extras.logo.tipo === "image/png" ? await pdf.embedPng(extras.logo.bytes) : await pdf.embedJpg(extras.logo.bytes);
    } catch {
      logo = null; // logo inválida: segue sem
    }
  }
  const escalaLogo = logo ? Math.min(150 / logo.width, 50 / logo.height, 1) : 0;
  const alturaLogo = logo ? logo.height * escalaLogo : 0;
  const tituloPagina = "PROPOSTA COMERCIAL";
  const topo = A4.altura - MARGEM + 8 - (logo ? alturaLogo + 8 : 0) - 30;

  const decorar = (p: PDFPage) => {
    // Marca d'água: o logo grande e bem claro no meio da página
    if (logo && extras.marcaDagua) {
      const escala = Math.min(440 / logo.width, 300 / logo.height);
      const w = logo.width * escala;
      const h = logo.height * escala;
      p.drawImage(logo, { x: (A4.largura - w) / 2, y: (A4.altura - h) / 2 - 40, width: w, height: h, opacity: 0.07 });
    }
    // Cabeçalho: logo e "PROPOSTA COMERCIAL"
    let y = A4.altura - MARGEM + 8;
    if (logo) {
      const w = logo.width * escalaLogo;
      p.drawImage(logo, { x: (A4.largura - w) / 2, y: y - alturaLogo, width: w, height: alturaLogo });
      y -= alturaLogo + 8;
    }
    const wt = negrito.widthOfTextAtSize(tituloPagina, 12);
    p.drawText(tituloPagina, { x: (A4.largura - wt) / 2, y: y - 13, size: 12, font: negrito, color: TEXTO });
  };

  const ctx: Contexto = { pdf, pagina: pdf.addPage([A4.largura, A4.altura]), y: topo, normal, negrito, topo, decorar };
  decorar(ctx.pagina);
  ctx.y -= 6;

  // Identificação
  if (d.contratacao) paragrafo(ctx, `Contratação: ${d.contratacao}`, { tamanho: 12, fonte: negrito, espaco: 0 });
  if (d.numero_proposta) paragrafo(ctx, `Nº: ${d.numero_proposta}`, { tamanho: 12, fonte: negrito, espaco: 0 });
  ctx.y -= 6;
  paragrafo(ctx, `${d.orgao}${d.uasg ? `  (UASG ${d.uasg})` : ""}`, { rotulo: "Ao(À): ", tamanho: 9.5, espaco: 1 });
  const referencia = [
    `${d.modalidade || "Licitação"} nº ${d.numero_licitacao}`,
    d.data_sessao && `Sessão: ${d.data_sessao}${d.horario ? ` às ${d.horario}` : ""}`,
    d.portal,
  ]
    .filter(Boolean)
    .join("  ·  ");
  paragrafo(ctx, referencia, { rotulo: "Referente: ", tamanho: 9.5, espaco: 1 });
  if (d.objeto) paragrafo(ctx, d.objeto, { rotulo: "Objeto: ", tamanho: 9.5, espaco: 1 });

  // Empresa, banco e representante
  titulo(ctx, "Dados da empresa");
  linhaDado(ctx, "Razão Social", d.empresa_nome);
  linhaDado(ctx, "CNPJ", d.empresa_cnpj);
  linhaDado(ctx, "Inscrição Estadual", d.empresa_ie);
  linhaDado(ctx, "Endereço", d.empresa_endereco);
  linhaDado(ctx, "Cidade/Estado", d.empresa_cidade);
  linhaDado(ctx, "Telefone", d.empresa_telefone);
  linhaDado(ctx, "E-mail", d.empresa_email);
  if (d.banco_nome) {
    titulo(ctx, "Dados bancários para fins de pagamento");
    linhaDado(ctx, "Banco", `${d.banco_nome}${d.banco_codigo ? ` (${d.banco_codigo})` : ""}`);
    linhaDado(ctx, "Agência", d.agencia);
    linhaDado(ctx, d.tipo_conta ? `Conta ${d.tipo_conta}` : "Conta", d.conta);
    linhaDado(ctx, "PIX", d.pix);
    linhaDado(ctx, "Titular", d.titular);
  }
  if (d.representante_nome) {
    titulo(ctx, "Dados do representante legal");
    linhaDado(ctx, "Nome", d.representante_nome);
    linhaDado(ctx, "CPF", d.representante_cpf);
    linhaDado(ctx, "RG", d.representante_rg);
    linhaDado(ctx, "Cargo", d.representante_cargo);
  }
  ctx.y -= 10;

  // Itens
  tabelaItens(ctx, d.itens, `Valor Global da Proposta: ${d.valor_total} (${d.valor_total_extenso}).`);

  // Prazos e condições
  if (d.prazo_entrega) paragrafo(ctx, d.prazo_entrega, { rotulo: "Prazo de entrega: ", tamanho: 9.5, espaco: 2 });
  paragrafo(ctx, `${d.validade_dias} (${d.validade_extenso}) dias, contados da data de sua apresentação (até ${d.validade_data}).`, {
    rotulo: "Prazo de validade da proposta: ",
    tamanho: 9.5,
    espaco: 2,
  });
  if (d.garantia) paragrafo(ctx, d.garantia, { rotulo: "Garantia: ", tamanho: 9.5, espaco: 2 });
  if (d.observacoes) paragrafo(ctx, d.observacoes, { rotulo: "Observações: ", tamanho: 9.5, espaco: 2 });
  if (d.condicoes.length) {
    ctx.y -= 4;
    for (const c of d.condicoes) paragrafo(ctx, c.texto, { rotulo: "•  ", tamanho: 9.5, alinhar: "justificar", espaco: 3 });
  }
  ctx.y -= 8;

  // Declarações
  for (const dec of d.declaracoes) {
    garantirEspaco(ctx, 50);
    if (dec.titulo) paragrafo(ctx, dec.titulo.toUpperCase(), { tamanho: 9.5, fonte: negrito, espaco: 3 });
    paragrafo(ctx, dec.texto, { tamanho: 9, alinhar: "justificar", espaco: 10 });
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
