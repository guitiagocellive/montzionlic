// Cadastro de proposta no Compras.gov.br: o que é comum à janela de cadastro, à busca por número/UASG e ao
// cadastro com um clique do quadro. Tudo vai pelo aplicativo, com a sessão do gov.br da pessoa.

import { buscarLicitacoes, FILTROS_PADRAO, type ResultadoPncp } from "../../pncp";
import { mensagemDeErro } from "../../api";
import { pedir } from "./ItemCompras";

export const FE = "/comprasnet-fase-externa";

export type Bruto = Record<string, unknown>;
export const obj = (v: unknown): Bruto => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : {});
export const txt = (v: unknown) => (v == null ? "" : String(v).trim());
export const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const valorDe = (v: unknown): number | null => num(v) ?? num(obj(v).valorInformado) ?? num(obj(v).valorCalculado);
export const lista = (d: unknown): unknown[] => {
  if (Array.isArray(d)) return d;
  const o = obj(d);
  for (const k of ["content", "itens", "lista", "resultado", "registros"]) if (Array.isArray(o[k])) return o[k] as unknown[];
  return (Object.values(o).find((v) => Array.isArray(v)) as unknown[]) ?? [];
};

export const paraNumero = (s: string) => {
  const t = s.trim().replace(/\s/g, "").replace(/^R\$/, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
};
export const textoNumero = (n: number | null | undefined) => (n == null ? "" : String(Math.round(n * 10000) / 10000).replace(".", ","));
/** Valor em reais para o campo: 2 casas (4 quando o valor tem mais precisão). */
export const textoValor = (n: number | null | undefined) => {
  if (n == null) return "";
  const quatro = Math.abs(Math.round(n * 100) - n * 100) > 1e-6;
  return n.toFixed(quatro ? 4 : 2).replace(".", ",");
};

export interface PropostaDoItem {
  valor: number | null;
  quantidade: number | null;
  marca: string;
  modelo: string;
  pais: string;
  margem: string;
}

/** Valor de referência do item (o máximo que o órgão aceita pagar), como a tela oficial mostra. */
export type Referencia = { tipo: "valor"; valor: number } | { tipo: "sigiloso"; valor: null } | { tipo: "nao-informado"; valor: null };

export function textoReferencia(r: Referencia) {
  return r.tipo === "valor" ? null : r.tipo === "sigiloso" ? "Sigiloso" : "Não informado";
}

export interface ItemProposta {
  numero: number;
  descricao: string;
  quantidade: number | null;
  unidade: string;
  desconto: boolean;
  material: boolean;
  exclusivoMeEpp: boolean;
  srp: boolean;
  margem: boolean;
  anexoObrigatorio: boolean;
  /** Cabeçalho de grupo (número negativo no Compras.gov.br): a proposta vai em cada item dele. */
  grupo: boolean;
  /** Item de dentro de um grupo: o número do grupo (ex.: -1). */
  grupoDe: number | null;
  /** No cabeçalho do grupo: o nome dele ("Grupo 1"). */
  nomeGrupo: string;
  /** Mesmo número de referencia.valor (null quando sigiloso ou não informado). */
  valorEstimado: number | null;
  referencia: Referencia;
  /** Disputa pelo valor total do item (o valor da proposta é o total, não o unitário). */
  porValorTotal: boolean;
  proposta: PropostaDoItem | null;
}

export function lerItem(b: unknown, srp: boolean): ItemProposta | null {
  const x = obj(b);
  const n = num(x.numero);
  if (n == null) return null;
  const p = obj(x.propostaItem);
  const tem = Object.keys(p).length > 0;
  const criterio = txt(x.criterioJulgamento);
  const desconto = x.isPorMaiorDesconto === true || criterio === "2";
  const valores = obj(p.valores);
  const trat = txt(x.tipoTratamentoDiferenciadoMeEpp);
  // Igual à tela oficial: sigiloso até homologar; sem valor = "Não informado".
  const cabecaGrupo = x.isGrupo === true && x.isSubItem !== true;
  // O grupo mostra o valor estimado TOTAL (como a tela oficial: "Valor estimado (total)").
  const porValorTotal = cabecaGrupo || x.disputaPorValorUnitario === false;
  const ref = valorDe(porValorTotal ? x.valorEstimadoTotal : (x.valorEstimadoUnitario ?? x.valorEstimado ?? x.valorUnitarioEstimado));
  const referencia: Referencia =
    x.possuiOrcamentoSigiloso === true && x.homologado !== true
      ? { tipo: "sigiloso", valor: null }
      : ref != null && ref > 0
        ? { tipo: "valor", valor: ref }
        : { tipo: "nao-informado", valor: null };
  return {
    numero: n,
    descricao: txt(x.descricao ?? x.descricaoDetalhada) || `Item ${n}`,
    quantidade: num(x.quantidadeSolicitada ?? obj(x.detalhamento).quantidadeSolicitada ?? x.quantidade ?? x.quantidadeTotal ?? x.quantidadeItem),
    unidade: txt(x.unidadeFornecimento ?? x.unidadeMedida ?? x.unidade),
    desconto,
    material: txt(x.tipoItemCatalogo) !== "S",
    exclusivoMeEpp: trat === "1" || x.participacaoExclusivaMeEppOuEquiparadas === true,
    srp,
    margem: x.utilizaMargemPreferencia === true,
    anexoObrigatorio: x.isObrigatorioEnvioAnexo === true,
    grupo: x.isGrupo === true && x.isSubItem !== true,
    grupoDe: null,
    nomeGrupo: x.isGrupo === true ? txt(x.descricao) || `Grupo ${Math.abs(n)}` : "",
    valorEstimado: referencia.valor,
    referencia,
    porValorTotal,
    proposta: tem
      ? {
          valor: valorDe(valores.valorPropostaInicial) ?? valorDe(valores.valorPropostaInicialOuLances),
          quantidade: num(p.quantidadeOfertada),
          marca: txt(p.marcaFabricante),
          modelo: txt(p.modeloVersao),
          pais: txt(p.codigoPaisOrigemItem) || "BRA",
          margem: txt(p.declaracoesMargemPreferencia) || "0",
        }
      : null,
  };
}

export function chaveDaCompra(uasg: string, modalidade: string, numero: string, ano: string) {
  const u = uasg.replace(/\D/g, ""),
    n = numero.replace(/\D/g, ""),
    a = ano.replace(/\D/g, "");
  if (!u || !n || a.length !== 4 || u.length > 6 || n.length > 5) return "";
  return u.padStart(6, "0") + modalidade + n.padStart(5, "0") + a;
}

/** A chave da compra (17 dígitos) num link do Compras.gov.br (o PNCP guarda esse link). */
export function chaveDoLink(link: string | null | undefined): string {
  const m = (link ?? "").match(/[?&]compra=(\d{17})\b/);
  return m ? m[1] : "";
}

// ---------------- Compra aberta ----------------

export interface CompraCarregada {
  compra: Bruto;
  participacao: Bruto;
  itens: ItemProposta[];
  declaracoes: string[];
  /** O Compras.gov.br só mostra os itens depois de aceitar as declarações. */
  itensBloqueados: boolean;
  cnpj: string;
}

export async function carregarCompra(chave: string): Promise<CompraCarregada> {
  // Como a tela oficial: a participação traz os dados da compra e diz se a empresa já aceitou as declarações.
  // Antes de aceitar, o Compras.gov.br recusa a lista de itens ("Usuário não é vinculado a nenhuma empresa
  // participante da compra"): isso não é erro, é o passo das declarações.
  let erroParticipacao: unknown = null;
  const p = obj((await pedir({ caminho: `${FE}/v1/compras/${chave}/participacao` }).catch((e) => ((erroParticipacao = e), { dados: {} }))).dados);
  const daCompra = obj(
    (await pedir({ caminho: `${FE}/v1/compras/${chave}` })
      .catch(() => pedir({ caminho: `${FE}/v1/compras/${chave}`, captcha: true }))
      .catch(() => ({ dados: {} }))).dados,
  );
  const c: Bruto = { ...obj(p.compra), ...daCompra };
  if (!Object.keys(c).length && erroParticipacao) throw erroParticipacao;
  const todos: unknown[] = [];
  let itensBloqueados = false;
  try {
    for (let pagina = 0; pagina < 10; pagina++) {
      const r = await pedir({ caminho: `${FE}/v1/compras/${chave}/itens`, captcha: true, query: `situacoes=1,2,3,4,5,6,7,8,9,13,14&pagina=${pagina}&tamanhoPagina=50` });
      const l = lista(r.dados);
      todos.push(...l);
      const paginas = Number(r.cabecalhos?.["pages-count"] ?? 0);
      if (l.length < 50 || (paginas && pagina + 1 >= paginas)) break;
    }
  } catch (e) {
    if (p.isFornecedorParticipante === true || !/vinculad|participante/i.test(mensagemDeErro(e))) throw e;
    itensBloqueados = true;
  }
  const srp = c.comCaracteristicaSRP === true;
  // Textos das declarações: os que vêm na compra ou os do fundamento legal dela.
  let textos = Object.values(obj(c.textosDeclaracoes)).flatMap((v) => (Array.isArray(v) ? v.map(txt) : [txt(v)])).filter(Boolean);
  if (!textos.length && c.fundamentoLegal) {
    const d = await pedir({ caminho: `${FE}/v1/declaracoes`, query: `fundamentoLegal=${encodeURIComponent(txt(c.fundamentoLegal))}` }).catch(() => null);
    textos = Object.values(obj(d?.dados)).flatMap((v) => (Array.isArray(v) ? v.map(txt) : [txt(v)])).filter(Boolean);
  }
  const cnpj = txt(obj(p.participante).identificacao).replace(/\D/g, "");
  // Grupos: o Compras.gov.br lista o grupo (número negativo) e os itens dele vêm em "itens-grupo".
  const itens: ItemProposta[] = [];
  for (const b of todos) {
    const it = lerItem(b, srp);
    if (!it) continue;
    itens.push(it);
    if (it.grupo) itens.push(...(await itensDoGrupo(chave, it.numero, srp)));
  }
  return { compra: c, participacao: p, itens, declaracoes: textos, itensBloqueados, cnpj };
}

/** Itens de dentro do grupo (a proposta do grupo é a soma das propostas deles). */
export async function itensDoGrupo(chave: string, grupo: number, srp: boolean): Promise<ItemProposta[]> {
  const brutos: unknown[] = [];
  for (let pagina = 0; pagina < 10; pagina++) {
    const query = `tamanhoPagina=100&pagina=${pagina}&size=100&page=${pagina}`;
    const caminho = `${FE}/v1/compras/${chave}/itens/${grupo}/itens-grupo`;
    let r = await pedir({ caminho, query }).catch(() => null);
    if (!r || !lista(r.dados).length) r = await pedir({ caminho, query, captcha: true }).catch(() => null);
    const l = r ? lista(r.dados) : [];
    brutos.push(...l);
    const paginas = Number(r?.cabecalhos?.["pages-count"] ?? 0);
    if (l.length < 100 || !paginas || pagina + 1 >= paginas) break;
  }
  return brutos
    .map((b) => lerItem(b, srp))
    .filter((x): x is ItemProposta => !!x && x.numero !== grupo)
    .map((x) => ({ ...x, grupo: false, grupoDe: grupo }));
}

export function prazoEncerrado(compra: Bruto) {
  const fim = Date.parse(txt(compra.dataHoraFimPropostas));
  return compra.prazoCadastroPropostaEncerrado === true || (Number.isFinite(fim) && fim < Date.now());
}

// ---------------- Proposta de um item ----------------

export interface DadosProposta {
  valor: number;
  quantidade: number;
  marca: string;
  modelo: string;
}

export function problemaDaProposta(it: ItemProposta, d: Partial<DadosProposta>): string {
  if (it.grupo) return "Grupo: cadastre os itens dele";
  if (d.valor == null || !(d.valor > 0)) return it.desconto ? "Informe o desconto" : "Informe o valor unitário";
  if (it.desconto && d.valor > 100) return "Desconto acima de 100%";
  if (d.quantidade == null || !(d.quantidade > 0)) return "Informe a quantidade";
  if (it.material && (!d.marca?.trim() || !d.modelo?.trim())) return "Informe marca e modelo";
  return "";
}

/** Cadastra (ou altera, se já existe) a proposta do item no Compras.gov.br. */
export async function enviarProposta(chave: string, it: ItemProposta, d: DadosProposta) {
  const p = it.proposta;
  const corpo = {
    quantidadeOfertada: d.quantidade,
    propostaTrabalhoMre: 0,
    valor: d.valor,
    marcaFabricante: it.material ? d.marca.trim() : null,
    modeloVersao: it.material ? d.modelo.trim() : null,
    codigoPaisOrigemItem: it.margem ? p?.pais || "BRA" : null,
    declaracoesMargemPreferencia: it.margem ? p?.margem || "0" : null,
    declaracaoConteudoNacional: false,
    modificado: true,
  };
  await pedir({ metodo: p ? "PUT" : "POST", caminho: `${FE}/v1/compras/${chave}/itens/${it.numero}/participacao`, corpo });
}

// ---------------- Valor a cadastrar ----------------

export interface Sugestao {
  valor: number | null;
  marca: string;
  modelo: string;
  origem: string;
  /** Motivo para não cadastrar sem olhar (vazio = viável). */
  aviso: string;
}

/**
 * Valor da proposta no cadastro: SEMPRE o valor de referência do órgão (o lance mínimo só vale na disputa).
 * Orçamento sigiloso ou não informado: calcula pelo orçamento (preço de venda com o lucro e os impostos da licitação)
 * ou usa o valor digitado na aba Proposta.
 * @param venda preço de venda unitário pelo orçamento; @param custo custo unitário com impostos (lucro zero)
 */
export function valorSugerido(
  it: ItemProposta,
  o: { venda: number | null; custo: number | null; valorDigitado: number | null; marca: string; modelo: string },
): Sugestao {
  const q = it.quantidade ?? 1;
  const vezes = (v: number | null) => (v == null ? null : Math.round((it.porValorTotal ? v * q : v) * 100) / 100);
  const venda = vezes(o.venda);
  const custo = vezes(o.custo);
  const base = { marca: o.marca, modelo: o.modelo };
  if (it.desconto) return { ...base, valor: null, origem: "", aviso: "Item por maior desconto: informe o desconto" };
  if (it.referencia.tipo === "valor") {
    const ref = it.referencia.valor;
    const aviso = custo != null && custo > ref + 1e-9 ? `Seu custo com impostos (${dinheiro(custo)}) passa da referência` : "";
    return { ...base, valor: ref, origem: "Valor de referência", aviso };
  }
  const rotulo = textoReferencia(it.referencia)!;
  if (o.valorDigitado != null) return { ...base, valor: o.valorDigitado, origem: `${rotulo} · valor da aba Proposta`, aviso: "" };
  if (venda != null) return { ...base, valor: venda, origem: `${rotulo} · calculado pelo orçamento`, aviso: "" };
  return { ...base, valor: null, origem: rotulo, aviso: `${rotulo}: sem orçamento para calcular, informe o valor` };
}

const dinheiro = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ---------------- Declaração de equidade de gênero (níveis oficiais) ----------------

export interface NivelEquidade {
  valor: string;
  rotulo: string;
}

let niveisCache: Promise<{ niveis: NivelEquidade[]; nenhum: string } | null> | null = null;

/** Níveis da declaração de equidade de gênero, da lista oficial do Compras.gov.br (null se não der para ler). */
export function niveisEquidade() {
  niveisCache ??= pedir({ caminho: `${FE}/v1/enums` })
    .then((r) => {
      const e = lista(r.dados).map(obj).find((x) => txt(x.name) === "NivelDeclaracaoEquidadeGeneroEnum");
      if (!e) return null;
      const valores = lista(e.values).map(obj);
      const nenhum = valores.find((v) => txt(v.enumName) === "NENHUM");
      return {
        nenhum: txt(nenhum?.value),
        niveis: valores.filter((v) => v !== nenhum).map((v) => ({ valor: txt(v.value), rotulo: txt(v.label) || txt(v.enumName) })),
      };
    })
    .catch(() => {
      niveisCache = null;
      return null;
    });
  return niveisCache;
}

// ---------------- Achar a compra pelo número e pela UASG ----------------

export interface CompraEncontrada {
  chave: string;
  titulo: string;
  orgao: string;
  objeto: string;
  encerramento: string | null;
  situacao: string;
  fonte: "pncp" | "compras";
}

const MODALIDADE_DA_CHAVE: Record<string, string> = { "05": "Pregão eletrônico", "06": "Dispensa eletrônica", "03": "Concorrência eletrônica", "08": "Cotação eletrônica" };
/** Modalidade do PNCP → código da modalidade na chave do Compras.gov.br. */
const MODALIDADE_PNCP_CHAVE: Record<string, string> = { "6": "05", "7": "05", "8": "06", "4": "03", "5": "03" };

export const tituloDaChave = (chave: string) =>
  `${MODALIDADE_DA_CHAVE[chave.slice(6, 8)] ?? "Compra"} Nº ${chave.slice(8, 13).replace(/^0+(?=\d)/, "")}/${chave.slice(13)}`;

function daBusca(r: ResultadoPncp): CompraEncontrada | null {
  let chave = chaveDoLink(r.linkPortal);
  if (!chave && r.portal === "Compras.gov.br" && MODALIDADE_PNCP_CHAVE[r.modalidadeId]) {
    chave = chaveDaCompra(r.uasg, MODALIDADE_PNCP_CHAVE[r.modalidadeId], r.numero, r.ano);
  }
  if (!chave) return null;
  return {
    chave,
    titulo: tituloDaChave(chave),
    orgao: [r.uasg && `UASG ${r.uasg}`, r.unidade || r.orgao].filter(Boolean).join(" - "),
    objeto: r.objeto,
    encerramento: r.encerramento,
    situacao: r.situacao,
    fonte: "pncp",
  };
}

/** "90012/2025" → { numero: "90012", ano: "2025" } */
export function separarNumero(texto: string) {
  const [n, a] = texto.split("/").map((x) => x.replace(/\D/g, ""));
  return { numero: (n ?? "").replace(/^0+(?=\d)/, ""), ano: a && a.length === 4 ? a : a && a.length === 2 ? `20${a}` : "" };
}

/**
 * Procura as compras do Compras.gov.br com esse número nessa UASG: primeiro no PNCP (que traz a chave da
 * compra), depois direto no Compras.gov.br testando as modalidades (para compras que ainda não estão no PNCP).
 */
export async function buscarCompras(numeroTexto: string, uasgTexto: string, comCompras = true): Promise<CompraEncontrada[]> {
  const { numero, ano } = separarNumero(numeroTexto);
  const uasg = uasgTexto.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!numero || !uasg) return [];
  const achadas = new Map<string, CompraEncontrada>();
  try {
    const r = await buscarLicitacoes({ ...FILTROS_PADRAO, modalidades: [], situacao: "todas", numero: ano ? `${numero}/${ano}` : numero, uasg }, 1, 20);
    for (const x of r.itens) {
      const c = daBusca(x);
      if (c && !achadas.has(c.chave)) achadas.set(c.chave, c);
    }
  } catch {
    /* PNCP fora do ar: segue para o Compras.gov.br */
  }
  if (comCompras) {
    const anoAtual = new Date().getFullYear();
    const anos = ano ? [ano] : [String(anoAtual), String(anoAtual - 1)];
    const tentativas = anos.flatMap((a) => ["05", "06", "03"].map((m) => chaveDaCompra(uasg, m, numero, a))).filter((k) => k && !achadas.has(k));
    await Promise.all(
      tentativas.map(async (chave) => {
        try {
          const r = await pedir({ caminho: `${FE}/v1/compras/${chave}/participacao` });
          const dados = obj(r.dados);
          const c = obj(dados.compra);
          if (!Object.keys(c).length && !("isFornecedorParticipante" in dados)) return;
          achadas.set(chave, {
            chave,
            titulo: tituloDaChave(chave),
            orgao: [`UASG ${uasg}`, txt(c.nomeUasg ?? c.nomeOrgao)].filter(Boolean).join(" - "),
            objeto: txt(c.objetoCompra ?? c.objeto),
            encerramento: txt(c.dataHoraFimPropostas ?? c.dataHoraAbertura) || null,
            situacao: "",
            fonte: "compras",
          });
        } catch (e) {
          // A compra existe, só que a empresa ainda não participa dela.
          if (/vinculad|participante/i.test(mensagemDeErro(e))) {
            achadas.set(chave, { chave, titulo: tituloDaChave(chave), orgao: `UASG ${uasg}`, objeto: "", encerramento: null, situacao: "", fonte: "compras" });
          }
        }
      }),
    );
  }
  // Mais recentes primeiro.
  return [...achadas.values()].sort((a, b) => b.chave.slice(13).localeCompare(a.chave.slice(13)) || a.chave.localeCompare(b.chave));
}
