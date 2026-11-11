// Inteligência de mercado: soma quem vendeu, quais marcas e para quais estados, a partir da
// "pesquisa de preços" dos dados abertos do Compras.gov.br (um registro por item vencido).

/** Um registro da pesquisa de preços (só os campos usados). */
export interface RegistroPreco {
  idCompra: number | string;
  idItemCompra?: number | string;
  dataCompra?: string | null;
  dataResultado?: string | null;
  niFornecedor?: string | null;
  nomeFornecedor?: string | null;
  marca?: string | null;
  quantidade?: number | null;
  precoUnitario?: number | null;
  estado?: string | null;
  municipio?: string | null;
  nomeOrgao?: string | null;
  descricaoItem?: string | null;
  nomePdm?: string | null;
}

export const semAcentoMaiusculo = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();

// Palavras que aparecem no campo "marca" mas não são marca.
const NAO_E_MARCA = new Set(
  (
    "MARCA MARCAS MODELO MOD MODELOS REF REFERENCIA TIPO LINHA SERIE VERSAO COR CORES " +
    "DE DA DO DAS DOS E EM COM SEM PARA P POR A O AS OS NO NA " +
    "UN UND UNID UNIDADE CX CAIXA PCT PACOTE KIT JOGO PECA PC FARDO ROLO " +
    "NACIONAL IMPORTADO IMPORTADA BRASIL BRASILEIRA BRASILEIRO NOVO NOVA ORIGINAL " +
    "BRANCO BRANCA PRETO PRETA AZUL VERMELHO VERDE AMARELO CINZA PRATA " +
    "SPLIT JANELA INVERTER PISO TETO HI WALL CASSETE PORTATIL QUENTE FRIO BTU BTUS BTUH " +
    "GRANDE PEQUENO MEDIO MINI MAXI PLUS PRO SUPER ULTRA PREMIUM STANDARD BASIC " +
    "LTDA ME EPP EIRELI SA COMERCIO INDUSTRIA DISTRIBUIDORA " +
    "NAO INFORMADA INFORMADO CONFORME EDITAL TERMO TR DIVERSAS DIVERSOS VARIAS VARIOS " +
    "PROPOSTA ANEXA ANEXO CONF ITEM ITENS LOTE OFERTADO OFERTADA DESCRITIVO ESPECIFICACAO " +
    "CONDICIONADOR CONDICIONADORES CONDICIONADO ECO INV AUTOMATICO AUTOMATICA ELETRICO ELETRICA DIGITAL " +
    "SMART TOUCH WIFI REMOTO CONTROLE MEDIA FINA GROSSA COLOR COLORIDA COLORIDO ECONOMIC ECONOMICA ECONOMICO " +
    "TINTA PONTA CORPO TRANSPARENTE ESFERA LISO LISA SIMPLES DUPLO DUPLA TRIPLO TOTAL MATERIAL PRODUTO " +
    "AMARELA LARANJA ROSA ROXO ROXA MARROM BEGE DOURADO VERMELHA PRETOS AZUIS BRANCOS HIWALL ACORDO"
  ).split(" "),
);

// Marcas próprias/genéricas viram um grupo só.
const GENERICAS = new Set(["PROPRIA", "PROPRIO", "GENERICA", "GENERICO", "SM", "S/M", "SEM MARCA"]);

// Marcas de duas palavras que costumam vir separadas por espaço ou hífen.
const COMPOSTAS: [RegExp, string][] = [
  [/^FABER\s*CASTELL/, "FABER-CASTELL"],
  [/^BLACK\s*(\+|&|E|AND)?\s*DECKER/, "BLACK+DECKER"],
  [/^JOHNSON\s*(&|E|AND)?\s*JOHNSON/, "JOHNSON & JOHNSON"],
  [/^PROCTER/, "PROCTER & GAMBLE"],
  [/^BRASTEMP/, "BRASTEMP"],
  [/^SPRINGER\s*MIDEA/, "MIDEA"],
  [/^CARRIER\s*MIDEA/, "MIDEA"],
  [/^MIDEA\s*CARRIER/, "MIDEA"],
  [/^HP\s*INC/, "HP"],
  [/^DELL\s*(TECHNOLOGIES|COMPUTADORES)?/, "DELL"],
  [/^3M/, "3M"],
];

const MARCAS_CURTAS = new Set(["LG", "HP", "HQ", "TCL", "AOC", "BIC", "CCE", "JBL", "SEW", "WEG", "GE", "3M", "BD", "MSA", "APC", "SMS"]);

/**
 * Tira do texto livre do fornecedor ("ELGIN/ELGIN", "AUFIT CLIMARIO", "FONTAINE JANELA 10K")
 * o nome da marca ("ELGIN", "AUFIT", "FONTAINE"). Palavras do nome do produto também são ignoradas.
 * Devolve "" quando não dá para identificar.
 */
export function normalizarMarca(texto: string | null | undefined, palavrasDoProduto: Set<string> = new Set()): string {
  if (!texto) return "";
  const t = semAcentoMaiusculo(texto).replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (GENERICAS.has(t) || /^(MARCA\s+)?(PROPRIA|GENERICA|GENERICO)\b/.test(t)) return "Marca própria/genérica";
  for (const [teste, nome] of COMPOSTAS) if (teste.test(t)) return nome;
  const palavras = t.split(/[\s/\\,;|()[\]{}:+*"'´`.]+|(?<!\w)-|-(?!\w)/).flatMap((p) => p.split(/-(?=[A-Z]{3,})/));
  for (const bruta of palavras) {
    const p = bruta.replace(/^[-_.]+|[-_.]+$/g, "");
    if (!p) continue;
    if (MARCAS_CURTAS.has(p)) return p;
    if (p.length < 3) continue;
    if (NAO_E_MARCA.has(p) || palavrasDoProduto.has(p) || /^(INVERT|ESPECIFIC|CONFORM|REFRIGER|DESCRI)/.test(p)) continue;
    // Palavra do produto cortada pelo fornecedor ("MICROCOMPUTA" de "MICROCOMPUTADOR").
    if (p.length >= 6 && [...palavrasDoProduto].some((w) => w.startsWith(p))) continue;
    const digitos = (p.match(/\d/g) ?? []).length;
    if (digitos >= 2 || (digitos === 1 && p.length <= 5)) continue; // código de modelo (HJQ24000, PDFE48C, 12K...)
    if (!/[A-Z]/.test(p)) continue;
    return p;
  }
  return "";
}

/** Palavras do nome do produto (para não confundir "CANETA" com marca). */
export function palavrasDe(...textos: (string | null | undefined)[]): Set<string> {
  const s = new Set<string>();
  for (const t of textos) for (const p of semAcentoMaiusculo(t ?? "").split(/[^A-Z0-9]+/)) if (p.length >= 3) s.add(p);
  return s;
}

/**
 * Código do modelo no texto do fornecedor ("LIV-LCS24FI-02I/LIV-..." → "LCS24FI-02I", "HJFI24C2WC/HJFE24C2C" → "HJFI24C2WC").
 * Precisa ter letras e pelo menos 2 números; capacidade, tensão e ano (12000BTU, 220V, 2026) não contam.
 */
export function extrairModelo(texto: string | null | undefined, marca = ""): string {
  if (!texto) return "";
  const t = semAcentoMaiusculo(texto);
  for (const bruta of t.split(/[\s/\\,;|()[\]{}:+*"'´`]+/)) {
    const p = bruta.replace(/^[-_.]+|[-_.]+$/g, "");
    const digitos = (p.match(/\d/g) ?? []).length;
    const letras = (p.match(/[A-Z]/g) ?? []).length;
    if (p.length < 5 || digitos < 2 || letras < 2) continue;
    const junto = p.replace(/[-_.]/g, "");
    if (/^\d+(K|BTUS?|BTUH|V|W|KW|MM|CM|ML|L|G|KG|GB|TB|MHZ|GHZ|HZ|POL)$/.test(junto)) continue;
    if (/^(CX|PCT|C)?\d+(UN|UND|UNID|UNIDADES|PC|PCS|FL|FLS|RESMAS?)$/.test(junto)) continue; // quantidade, não modelo
    // "LIV-LCS24FI-02I": tira o prefixo quando ele é a própria marca.
    if (marca && p.startsWith(`${marca}-`) && p.length - marca.length - 1 >= 5) return p.slice(marca.length + 1);
    return p;
  }
  return "";
}

export interface Linha {
  chave: string;
  nome: string;
  /** Soma de preço unitário × quantidade. */
  valor: number;
  quantidade: number;
  /** Licitações diferentes (compras). */
  compras: number;
  /** Preço unitário mediano. */
  precoMediano: number | null;
  /** Até 3 destaques (marcas de uma empresa, estados de uma marca...), por número de vitórias. */
  destaques: { nome: string; valor: number; compras: number }[];
  /** CNPJ (só nas empresas). */
  cnpj?: string;
}

export interface Resumo {
  registros: number;
  /** Registros com preço fora da realidade (mais de 50× o preço típico do produto), deixados de fora. */
  descartados: number;
  compras: number;
  valor: number;
  quantidade: number;
  marcas: Linha[];
  empresas: Linha[];
  estados: Linha[];
  /** Valor homologado e licitações por mês ("2026-03"), pela data do resultado. */
  porMes: { mes: string; valor: number; compras: number }[];
  /** Modelos (código informado pelo fornecedor); destaques = marca. */
  modelos: Linha[];
  /** Registros sem marca identificável. */
  semMarca: number;
}

interface Acumulado {
  nome: string;
  valor: number;
  quantidade: number;
  compras: Set<string>;
  precos: number[];
  sub: Map<string, { valor: number; compras: Set<string> }>;
  cnpj?: string;
}

function mediana(v: number[]): number | null {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

function nomeEmpresa(n: string) {
  return n.replace(/\s+/g, " ").trim();
}

/** Tira registros repetidos (o mesmo item, fornecedor, preço e quantidade). */
export function semRepetidos(registros: RegistroPreco[]): RegistroPreco[] {
  const vistos = new Set<string>();
  return registros.filter((r) => {
    const k = `${r.idItemCompra ?? r.idCompra}|${r.niFornecedor ?? ""}|${r.precoUnitario ?? ""}|${r.quantidade ?? ""}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/** Soma tudo. `uf` filtra um estado (marcas e empresas que venderam para ele). */
export function resumir(registros: RegistroPreco[], uf = ""): Resumo {
  // Preço típico de cada produto (para deixar de fora preços digitados errado).
  const precosPorProduto = new Map<string, number[]>();
  for (const r of registros) {
    const preco = Number(r.precoUnitario);
    if (preco > 0) {
      const k = r.nomePdm ?? "";
      const lista = precosPorProduto.get(k);
      if (lista) lista.push(preco);
      else precosPorProduto.set(k, [preco]);
    }
  }
  const tipico = new Map([...precosPorProduto.entries()].map(([k, v]) => [k, mediana(v) ?? 0]));
  let descartados = 0;

  const marcas = new Map<string, Acumulado>();
  const empresas = new Map<string, Acumulado>();
  const estados = new Map<string, Acumulado>();
  const modelos = new Map<string, Acumulado>();
  const meses = new Map<string, { valor: number; compras: Set<string> }>();
  const compras = new Set<string>();
  const cacheProduto = new Map<string, Set<string>>();
  let valorTotal = 0;
  let qtdTotal = 0;
  let semMarca = 0;
  let total = 0;

  const somar = (mapa: Map<string, Acumulado>, chave: string, nome: string, valor: number, qtd: number, preco: number | null, compra: string, sub: string, cnpj?: string) => {
    let a = mapa.get(chave);
    if (!a) mapa.set(chave, (a = { nome, valor: 0, quantidade: 0, compras: new Set(), precos: [], sub: new Map(), cnpj }));
    a.valor += valor;
    a.quantidade += qtd;
    a.compras.add(compra);
    if (preco != null && preco > 0) a.precos.push(preco);
    if (sub) {
      let x = a.sub.get(sub);
      if (!x) a.sub.set(sub, (x = { valor: 0, compras: new Set() }));
      x.valor += valor;
      x.compras.add(compra);
    }
  };

  for (const r of registros) {
    const estado = (r.estado ?? "").trim().toUpperCase();
    if (uf && estado !== uf) continue;
    const t = tipico.get(r.nomePdm ?? "") ?? 0;
    if (t > 0 && Number(r.precoUnitario) > 50 * t) {
      descartados++;
      continue;
    }
    total++;
    const qtd = Number(r.quantidade) || 0;
    const preco = r.precoUnitario == null ? null : Number(r.precoUnitario);
    const valor = (preco ?? 0) * qtd;
    const compra = String(r.idCompra);
    compras.add(compra);
    valorTotal += valor;
    qtdTotal += qtd;

    // Palavras do produto e da descrição padronizada do item (o catálogo não traz marca).
    const produto = `${r.nomePdm ?? ""}|${r.descricaoItem ?? ""}`;
    let palavras = cacheProduto.get(produto);
    if (!palavras) cacheProduto.set(produto, (palavras = palavrasDe(r.nomePdm, r.descricaoItem)));
    const marca = normalizarMarca(r.marca, palavras);
    const empresa = nomeEmpresa(r.nomeFornecedor ?? "") || "Fornecedor não informado";
    const cnpj = (r.niFornecedor ?? "").replace(/\D/g, "");

    if (marca) somar(marcas, marca, marca, valor, qtd, preco, compra, estado);
    else semMarca++;
    // Filiais da mesma empresa (mesma raiz do CNPJ) contam juntas.
    somar(empresas, cnpj.length === 14 ? cnpj.slice(0, 8) : cnpj || empresa, empresa, valor, qtd, preco, compra, marca, cnpj || undefined);
    if (estado) somar(estados, estado, estado, valor, qtd, preco, compra, marca);
    const mes = (r.dataResultado || r.dataCompra || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(mes)) {
      let m = meses.get(mes);
      if (!m) meses.set(mes, (m = { valor: 0, compras: new Set() }));
      m.valor += valor;
      m.compras.add(compra);
    }
    const modelo = extrairModelo(r.marca, marca);
    if (modelo) somar(modelos, modelo.replace(/[-_.]/g, ""), modelo, valor, qtd, preco, compra, marca);
  }

  const lista = (mapa: Map<string, Acumulado>): Linha[] =>
    [...mapa.entries()]
      .map(([chave, a]) => ({
        chave,
        nome: a.nome,
        valor: a.valor,
        quantidade: a.quantidade,
        compras: a.compras.size,
        precoMediano: mediana(a.precos),
        destaques: [...a.sub.entries()]
          .map(([nome, x]) => ({ nome, valor: x.valor, compras: x.compras.size }))
          .sort((x, y) => y.compras - x.compras || y.valor - x.valor)
          .slice(0, 3),
        ...(a.cnpj ? { cnpj: a.cnpj } : {}),
      }))
      .sort((a, b) => b.valor - a.valor || b.compras - a.compras);

  return {
    registros: total,
    descartados,
    compras: compras.size,
    valor: valorTotal,
    quantidade: qtdTotal,
    marcas: lista(marcas),
    empresas: lista(empresas),
    estados: lista(estados),
    modelos: lista(modelos),
    porMes: [...meses.entries()].map(([mes, m]) => ({ mes, valor: m.valor, compras: m.compras.size })).sort((a, b) => a.mes.localeCompare(b.mes)),
    semMarca,
  };
}

/** Busca no catálogo: produtos (PDM) cujo nome tem todas as palavras digitadas. */
export function buscarNoCatalogo(
  pdms: [number, string, number, number][],
  texto: string,
  limite = 40,
): [number, string, number, number][] {
  const palavras = semAcentoMaiusculo(texto)
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 2);
  if (!palavras.length) return [];
  const frase = palavras.join(" ");
  const achados = pdms.filter((p) => {
    const nome = semAcentoMaiusculo(p[1]).replace(/-/g, " ");
    return palavras.every((w) => nome.split(/[^A-Z0-9]+/).some((x) => x.startsWith(w)));
  });
  const nota = (p: [number, string, number, number]) => {
    const nome = semAcentoMaiusculo(p[1]).replace(/-/g, " ");
    // "AR CONDICIONADO - DIFUSOR" é peça/acessório: vem depois do produto em si.
    const acessorio = /\s-\s|\//.test(p[1]) ? 3 : 0;
    return (p[3] ? 0 : 4) + acessorio + (nome.includes(frase) ? 0 : 2) + (nome.startsWith(palavras[0]) ? 0 : 1);
  };
  return achados.sort((a, b) => nota(a) - nota(b) || a[1].length - b[1].length).slice(0, limite);
}
