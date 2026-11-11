// Análise de empresas: soma as vitórias de um fornecedor a partir dos resultados publicados no PNCP
// (todas as plataformas de compra) e da descrição dos itens.
import type { Linha } from "./mercado";
import { semAcentoMaiusculo } from "./mercado";

/** Resultado de um item no PNCP (só os campos usados). */
export interface ResultadoItem {
  idCompraItem: string;
  idCompra?: string | number | null;
  idContratacaoPNCP?: string | null;
  unidadeOrgaoCodigoUnidade?: string | null;
  unidadeOrgaoUfSigla?: string | null;
  orgaoEntidadeCnpj?: string | null;
  quantidadeHomologada?: number | null;
  valorUnitarioHomologado?: number | null;
  valorTotalHomologado?: number | null;
  ordemClassificacaoSrp?: number | null;
  situacaoCompraItemResultadoNome?: string | null;
  dataCancelamentoPncp?: string | null;
  dataResultadoPncp?: string | null;
  aplicacaoBeneficioMeepp?: boolean | null;
  porteFornecedorNome?: string | null;
}

/** Item do PNCP (descrição). */
export interface ItemPncp {
  idCompraItem: string;
  descricaoResumida?: string | null;
  materialOuServicoNome?: string | null;
  unidadeMedida?: string | null;
  criterioJulgamentoNome?: string | null;
  situacaoCompraItemNome?: string | null;
}

export interface ItemVencido {
  id: string;
  descricao: string;
  produto: string;
  data: string;
  uf: string;
  unidade: string;
  orgaoCnpj: string;
  modalidade: string;
  ata: boolean;
  quantidade: number;
  precoUnitario: number;
  valor: number;
  linkPncp: string | null;
  cancelado: boolean;
}

export interface ResumoEmpresa {
  itens: number;
  cancelados: number;
  licitacoes: number;
  orgaos: number;
  valor: number;
  valorAtas: number;
  porModalidade: { nome: string; itens: number; valor: number }[];
  porMes: { mes: string; valor: number; compras: number }[];
  estados: Linha[];
  orgaosLista: Linha[];
  produtos: Linha[];
  lista: ItemVencido[];
  meEpp: number;
}

/** Modalidade pelo código da compra (UASG(6) + modalidade(2) + número + ano). */
export function modalidadeDe(idCompra: string | number | null | undefined) {
  const m = String(idCompra ?? "").slice(6, 8);
  return m === "05" ? "Pregão eletrônico" : m === "06" ? "Dispensa eletrônica" : m === "03" ? "Concorrência" : m === "08" ? "Cotação eletrônica" : "Outras";
}

/** Link do edital no PNCP ("00394452000103-1-000709/2026" → pncp.gov.br/app/editais/00394452000103/2026/709). */
export function linkPncp(id: string | null | undefined) {
  const m = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec(id ?? "");
  return m ? `https://pncp.gov.br/app/editais/${m[1]}/${m[3]}/${Number(m[2])}` : null;
}

const PALAVRAS_FRACAS = new Set(["TIPO", "MATERIAL", "MODELO", "APLICACAO", "CARACTERISTICAS", "CARACTERISTICA", "COR", "CAPACIDADE", "DE", "DA", "DO", "E", "COM", "PARA"]);

/** Nome curto do produto pela descrição ("Equipamento Odontológico tipo: fotopolimerizador, ..." → "EQUIPAMENTO ODONTOLOGICO"). */
export function produtoDe(descricao: string) {
  const inicio = descricao.split(/[:,;.\n(]| - /)[0] ?? "";
  const palavras = semAcentoMaiusculo(inicio)
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (palavras.length && PALAVRAS_FRACAS.has(palavras[palavras.length - 1])) palavras.pop();
  return palavras.slice(0, 4).join(" ") || "SEM DESCRIÇÃO";
}

interface Acum {
  nome: string;
  valor: number;
  quantidade: number;
  compras: Set<string>;
  precos: number[];
  sub: Map<string, { valor: number; compras: Set<string> }>;
}

function mediana(v: number[]) {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

export function resumirEmpresa(resultados: ResultadoItem[], itens: ItemPncp[], uf = ""): ResumoEmpresa {
  const descricoes = new Map(itens.map((i) => [i.idCompraItem, i]));
  const vistos = new Set<string>();
  const lista: ItemVencido[] = [];
  const licitacoes = new Set<string>();
  const orgaos = new Set<string>();
  const modalidades = new Map<string, { itens: number; valor: number }>();
  const meses = new Map<string, { valor: number; compras: Set<string> }>();
  const estados = new Map<string, Acum>();
  const orgaosMapa = new Map<string, Acum>();
  const produtos = new Map<string, Acum>();
  let valor = 0;
  let valorAtas = 0;
  let cancelados = 0;
  let meEpp = 0;

  const somar = (mapa: Map<string, Acum>, chave: string, nome: string, v: number, qtd: number, preco: number, compra: string, sub: string) => {
    let a = mapa.get(chave);
    if (!a) mapa.set(chave, (a = { nome, valor: 0, quantidade: 0, compras: new Set(), precos: [], sub: new Map() }));
    a.valor += v;
    a.quantidade += qtd;
    a.compras.add(compra);
    if (preco > 0) a.precos.push(preco);
    if (sub) {
      let x = a.sub.get(sub);
      if (!x) a.sub.set(sub, (x = { valor: 0, compras: new Set() }));
      x.valor += v;
      x.compras.add(compra);
    }
  };

  for (const r of resultados) {
    const chave = `${r.idCompraItem}|${r.valorTotalHomologado}|${r.quantidadeHomologada}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const estado = (r.unidadeOrgaoUfSigla ?? "").toUpperCase();
    if (uf && estado !== uf) continue;
    const item = descricoes.get(r.idCompraItem);
    const descricao = (item?.descricaoResumida ?? "").replace(/\s+/g, " ").trim();
    const produto = produtoDe(descricao);
    const cancelado = (r.situacaoCompraItemResultadoNome ?? "").toLowerCase().includes("cancel") || !!r.dataCancelamentoPncp;
    const qtd = Number(r.quantidadeHomologada) || 0;
    const preco = Number(r.valorUnitarioHomologado) || 0;
    const v = Number(r.valorTotalHomologado) || preco * qtd;
    const compra = String(r.idCompra ?? r.idContratacaoPNCP ?? r.idCompraItem);
    const modalidade = modalidadeDe(r.idCompra);
    const unidade = String(r.unidadeOrgaoCodigoUnidade ?? "");
    const ata = r.ordemClassificacaoSrp != null;
    lista.push({
      id: r.idCompraItem,
      descricao: descricao || "Item sem descrição",
      produto,
      data: (r.dataResultadoPncp ?? "").slice(0, 10),
      uf: estado,
      unidade,
      orgaoCnpj: r.orgaoEntidadeCnpj ?? "",
      modalidade,
      ata,
      quantidade: qtd,
      precoUnitario: preco,
      valor: v,
      linkPncp: linkPncp(r.idContratacaoPNCP),
      cancelado,
    });
    if (cancelado) {
      cancelados++;
      continue;
    }
    if (r.aplicacaoBeneficioMeepp) meEpp++;
    valor += v;
    if (ata) valorAtas += v;
    licitacoes.add(compra);
    if (unidade) orgaos.add(unidade);
    const m = modalidades.get(modalidade) ?? { itens: 0, valor: 0 };
    m.itens++;
    m.valor += v;
    modalidades.set(modalidade, m);
    const mes = (r.dataResultadoPncp ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(mes)) {
      let x = meses.get(mes);
      if (!x) meses.set(mes, (x = { valor: 0, compras: new Set() }));
      x.valor += v;
      x.compras.add(compra);
    }
    if (estado) somar(estados, estado, estado, v, qtd, preco, compra, produto);
    if (unidade) somar(orgaosMapa, unidade, unidade, v, qtd, preco, compra, produto);
    somar(produtos, produto, produto, v, qtd, preco, compra, estado);
  }

  const linhas = (mapa: Map<string, Acum>): Linha[] =>
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
      }))
      .sort((a, b) => b.valor - a.valor);

  return {
    itens: lista.length - cancelados,
    cancelados,
    licitacoes: licitacoes.size,
    orgaos: orgaos.size,
    valor,
    valorAtas,
    porModalidade: [...modalidades.entries()].map(([nome, x]) => ({ nome, ...x })).sort((a, b) => b.valor - a.valor),
    porMes: [...meses.entries()].map(([mes, x]) => ({ mes, valor: x.valor, compras: x.compras.size })).sort((a, b) => a.mes.localeCompare(b.mes)),
    estados: linhas(estados),
    orgaosLista: linhas(orgaosMapa),
    produtos: linhas(produtos),
    lista: lista.sort((a, b) => b.data.localeCompare(a.data)),
    meEpp,
  };
}

/** Confere os dígitos do CNPJ. */
export function cnpjValido(cnpj: string) {
  const c = cnpj.replace(/\D/g, "");
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const digito = (base: string) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const n of base) {
      soma += Number(n) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = digito(c.slice(0, 12));
  const d2 = digito(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}
