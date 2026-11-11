// Busca de licitações no PNCP (Portal Nacional de Contratações Públicas).
// A pesquisa e a lista de itens/arquivos saem direto do navegador; só o download dos arquivos
// passa pelo servidor da plataforma (o PNCP não deixa o navegador baixar direto).

const BUSCA = "https://pncp.gov.br/api/search/";
const CONSULTA = "https://pncp.gov.br/api/consulta/v1";
const API = "https://pncp.gov.br/api/pncp/v1";

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN",
  "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

/** Modalidades do PNCP (código → nome na plataforma). */
export const MODALIDADES_PNCP: { codigo: string; nome: string; plataforma: string }[] = [
  { codigo: "6", nome: "Pregão eletrônico", plataforma: "Pregão eletrônico" },
  { codigo: "8", nome: "Dispensa", plataforma: "Dispensa eletrônica" },
  { codigo: "4", nome: "Concorrência eletrônica", plataforma: "Concorrência eletrônica" },
  { codigo: "7", nome: "Pregão presencial", plataforma: "Pregão presencial" },
  { codigo: "5", nome: "Concorrência presencial", plataforma: "Concorrência" },
  { codigo: "9", nome: "Inexigibilidade", plataforma: "Inexigibilidade" },
  { codigo: "12", nome: "Credenciamento", plataforma: "Credenciamento" },
  { codigo: "1", nome: "Leilão eletrônico", plataforma: "Leilão" },
  { codigo: "13", nome: "Leilão presencial", plataforma: "Leilão" },
];

export const ESFERAS = [
  { codigo: "F", nome: "Federal" },
  { codigo: "E", nome: "Estadual" },
  { codigo: "M", nome: "Municipal" },
  { codigo: "D", nome: "Distrital" },
];

/** Atalhos de data da sessão (dias a partir de hoje). */
export const PERIODOS_SESSAO = [
  { valor: "", nome: "Qualquer data" },
  { valor: "hoje", nome: "Hoje" },
  { valor: "amanha", nome: "Amanhã" },
  { valor: "3", nome: "Próximos 3 dias" },
  { valor: "7", nome: "7 dias" },
  { valor: "15", nome: "15 dias" },
  { valor: "30", nome: "30 dias" },
  { valor: "periodo", nome: "Escolher datas" },
] as const;

export interface Municipio {
  ibge: number;
  nome: string;
  uf: string;
}

export interface FiltrosBusca {
  palavra: string;
  numero: string;
  ufs: string[];
  modalidades: string[];
  situacao: "recebendo_proposta" | "todas";
  municipios: Municipio[];
  plataformas: string[];
  uasg: string;
  orgao: string; // nome ou CNPJ
  srp: "" | "sim" | "nao";
  esferas: string[];
  valorMin: string;
  valorMax: string;
  sessao: (typeof PERIODOS_SESSAO)[number]["valor"];
  sessaoDe: string;
  sessaoAte: string;
  ordem: "recentes" | "relevancia" | "sessao";
  modosDisputa: string[];
  tipoItem: "" | "M" | "S";
  /** Só participação exclusiva para ME/EPP. */
  meEpp: boolean;
}

/** Modos de disputa do PNCP (modos_disputa). */
export const MODOS_DISPUTA = [
  { codigo: "1", nome: "Aberto" },
  { codigo: "3", nome: "Aberto e fechado" },
  { codigo: "6", nome: "Fechado e aberto" },
  { codigo: "2", nome: "Fechado" },
  { codigo: "4", nome: "Dispensa com disputa" },
];

export const FILTROS_PADRAO: FiltrosBusca = {
  palavra: "",
  numero: "",
  ufs: [],
  modalidades: ["6", "8"],
  situacao: "recebendo_proposta",
  municipios: [],
  plataformas: [],
  uasg: "",
  orgao: "",
  srp: "",
  esferas: [],
  valorMin: "",
  valorMax: "",
  sessao: "",
  sessaoDe: "",
  sessaoAte: "",
  ordem: "recentes",
  modosDisputa: [],
  tipoItem: "",
  meEpp: false,
};

/** O campo "UASG ou CNPJ do órgão": 14 dígitos = CNPJ do órgão; senão, código da UASG. */
export function codigoOrgao(f: Pick<FiltrosBusca, "uasg" | "orgao">) {
  const campo = somenteNumero(f.uasg);
  const cnpj = campo.length === 14 ? campo : somenteNumero(f.orgao).length === 14 ? somenteNumero(f.orgao) : "";
  return { uasg: campo.length === 14 ? "" : semZeros(f.uasg), cnpj };
}

export interface ResultadoPncp {
  id: string; // numero_controle_pncp
  titulo: string;
  objeto: string;
  numero: string;
  ano: string;
  sequencial: string;
  cnpj: string;
  orgao: string;
  unidade: string;
  uasg: string;
  municipio: string;
  uf: string;
  esfera: string;
  modalidade: string;
  modalidadeId: string;
  modoDisputa: string;
  situacao: string;
  srp: boolean;
  valorEstimado: number | null;
  amparo: string;
  publicadoEm: string | null;
  abertura: string | null;
  encerramento: string | null;
  linkPncp: string;
  portal: string;
  linkPortal: string | null;
  informacao: string;
  cancelado: boolean;
}

interface ItemBusca {
  numero_controle_pncp: string;
  title: string;
  description: string;
  numero: string;
  ano: string;
  numero_sequencial: string;
  orgao_cnpj: string;
  orgao_nome: string;
  unidade_nome: string;
  unidade_codigo: string | null;
  municipio_nome: string;
  uf: string;
  esfera_nome: string | null;
  modalidade_licitacao_nome: string;
  modalidade_licitacao_id: string;
  modo_disputa_nome: string | null;
  situacao_nome: string;
  srp: boolean | null;
  valor_total_estimado: number | null;
  amparo_legal_nome: (string | null)[] | null;
  usuario_nome: string | null;
  link_sistema_origem: string | null;
  informacao_complementar: string | null;
  data_publicacao_pncp: string | null;
  data_inicio_vigencia: string | null;
  data_fim_vigencia: string | null;
  cancelado: boolean;
}

/** O PNCP às vezes responde vazio: tenta de novo algumas vezes. */
async function buscarJson<T>(url: string, tentativas = 3): Promise<T> {
  let ultimoErro: unknown = null;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (r.status === 204) return [] as unknown as T;
      if (r.status === 400) {
        const t = await r.text();
        throw Object.assign(new Error(t.replace(/^"|"$/g, "") || "Filtro inválido no PNCP"), { definitivo: true });
      }
      if (!r.ok) throw new Error(`PNCP respondeu ${r.status}`);
      const texto = await r.text();
      if (texto.trim()) return JSON.parse(texto) as T;
      ultimoErro = new Error("Resposta vazia do PNCP");
    } catch (err) {
      if ((err as { definitivo?: boolean }).definitivo) throw err;
      ultimoErro = err;
    }
    if (i < tentativas - 1) await new Promise((ok) => setTimeout(ok, 600 * (i + 1)));
  }
  throw ultimoErro instanceof Error ? new Error("O PNCP não respondeu agora. Tente de novo em instantes.") : new Error("Falha no PNCP");
}

const somenteNumero = (s: string) => s.replace(/\D/g, "");
const semZeros = (s: string) => somenteNumero(s).replace(/^0+/, "");

// ---------------- Portal onde a disputa acontece ----------------

const PORTAIS: { teste: RegExp; nome: string; inicio: string }[] = [
  { teste: /comprasnet|compras\.gov|estaleiro\.serpro/i, nome: "Compras.gov.br", inicio: "https://www.gov.br/compras/pt-br" },
  { teste: /bll/i, nome: "BLL Compras", inicio: "https://bll.org.br" },
  { teste: /licitacoes-e|bb\.com\.br|Licita[çc][õo]es-E/i, nome: "Licitações-e (BB)", inicio: "https://www.licitacoes-e.com.br" },
  { teste: /portaldecompraspublicas|ECustomize/i, nome: "Portal de Compras Públicas", inicio: "https://www.portaldecompraspublicas.com.br" },
  { teste: /bnc|Bolsa Nacional/i, nome: "BNC Compras", inicio: "https://bnccompras.com" },
  { teste: /licitanet/i, nome: "Licitanet", inicio: "https://licitanet.com.br" },
  { teste: /pregaobanrisul|PROCERGS/i, nome: "Pregão Banrisul", inicio: "https://pregaobanrisul.com.br" },
  { teste: /licitamaisbrasil|Licita Mais/i, nome: "Licita Mais Brasil", inicio: "https://licitamaisbrasil.com.br" },
  { teste: /bbmnet/i, nome: "BBMNET", inicio: "https://bbmnet.com.br" },
  { teste: /comprasbr|compras br/i, nome: "ComprasBR", inicio: "https://comprasbr.com.br" },
  { teste: /licitardigital|Licitar Digital/i, nome: "Licitar Digital", inicio: "https://licitardigital.com.br" },
];

/** Plataformas que aparecem no filtro (as mais usadas no PNCP) + "Outras". */
export const PLATAFORMAS = [
  "Compras.gov.br",
  "Licitações-e (BB)",
  "Portal de Compras Públicas",
  "BNC Compras",
  "BLL Compras",
  "Licitanet",
  "BBMNET",
  "Licitar Digital",
  "ComprasBR",
  "Outras",
];

function linkValido(link: string | null | undefined): string | null {
  const l = (link ?? "").trim();
  return /^https?:\/\/[^\s]+\.[^\s]+/i.test(l) ? l : null;
}

/** Nome do portal da disputa e o link (direto para a licitação quando o PNCP informa). */
export function portalDaLicitacao(link: string | null | undefined, usuario: string | null | undefined): { nome: string; link: string | null; direto: boolean } {
  const direto = linkValido(link);
  const conhecido = PORTAIS.find((p) => (direto && p.teste.test(direto)) || (usuario && p.teste.test(usuario)));
  const nome = conhecido?.nome ?? ((usuario ?? "").trim() || "Portal do órgão");
  if (direto) return { nome, link: direto, direto: true };
  return { nome, link: conhecido?.inicio ?? null, direto: false };
}

function converter(i: ItemBusca): ResultadoPncp {
  const portal = portalDaLicitacao(i.link_sistema_origem, i.usuario_nome);
  return {
    id: i.numero_controle_pncp,
    titulo: i.title,
    objeto: i.description ?? "",
    numero: i.numero ?? "",
    ano: i.ano ?? "",
    sequencial: i.numero_sequencial ?? "",
    cnpj: i.orgao_cnpj,
    orgao: i.orgao_nome ?? "",
    unidade: i.unidade_nome ?? "",
    uasg: i.unidade_codigo ?? "",
    municipio: i.municipio_nome ?? "",
    uf: i.uf ?? "",
    esfera: i.esfera_nome ?? "",
    modalidade: (i.modalidade_licitacao_nome ?? "").replace(" - ", " "),
    modalidadeId: i.modalidade_licitacao_id ?? "",
    modoDisputa: i.modo_disputa_nome && i.modo_disputa_nome !== "Não se aplica" ? i.modo_disputa_nome : "",
    situacao: i.situacao_nome ?? "",
    srp: !!i.srp,
    valorEstimado: typeof i.valor_total_estimado === "number" && i.valor_total_estimado > 0 ? i.valor_total_estimado : null,
    amparo: (i.amparo_legal_nome ?? []).filter(Boolean).join("; "),
    publicadoEm: i.data_publicacao_pncp,
    abertura: i.data_inicio_vigencia,
    encerramento: i.data_fim_vigencia,
    linkPncp: `https://pncp.gov.br/app/editais/${i.orgao_cnpj}/${i.ano}/${i.numero_sequencial}`,
    portal: portal.nome,
    linkPortal: portal.link,
    informacao: (i.informacao_complementar ?? "").trim(),
    cancelado: !!i.cancelado,
  };
}

// ---------------- Datas ----------------

function dataLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Intervalo [de, até] (AAAA-MM-DD) do filtro de data da sessão, ou null quando não há filtro. */
export function intervaloSessao(f: Pick<FiltrosBusca, "sessao" | "sessaoDe" | "sessaoAte">, hoje = new Date()): [string, string] | null {
  if (!f.sessao) return null;
  const mais = (dias: number) => dataLocal(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + dias));
  if (f.sessao === "hoje") return [mais(0), mais(0)];
  if (f.sessao === "amanha") return [mais(1), mais(1)];
  if (f.sessao === "periodo") {
    if (!f.sessaoDe && !f.sessaoAte) return null;
    return [f.sessaoDe || "0000-00-00", f.sessaoAte || "9999-12-31"];
  }
  return [mais(0), mais(Number(f.sessao))];
}

// ---------------- Pesquisa ----------------

export interface RespostaBusca {
  itens: ResultadoPncp[];
  /** Total de licitações que batem com os filtros (no PNCP, ou depois do filtro local). */
  total: number;
  /** true quando a plataforma baixou várias páginas e filtrou aqui (data da sessão, UASG, vários municípios...). */
  varredura: boolean;
  /** Na varredura: quantas licitações do PNCP foram analisadas e quantas existiam. */
  analisadas?: number;
  existentes?: number;
}

function parametros(f: FiltrosBusca, ibge: number | null) {
  const numero = f.numero.trim();
  const orgao = f.orgao.trim();
  const { uasg, cnpj } = codigoOrgao(f);
  const nomeOrgao = somenteNumero(orgao).length === 14 ? "" : orgao;
  // Palavras separadas por ";" viram uma busca com todas elas.
  const palavras = f.palavra.split(";").map((x) => x.trim()).filter(Boolean).join(" ");
  // Número entre aspas ("80/2026") faz o PNCP trazer o número exato primeiro.
  const termo = [palavras, numero ? `"${numero}"` : "", uasg, cnpj, nomeOrgao].filter(Boolean).join(" ");
  const p = new URLSearchParams({ tipos_documento: "edital", ordenacao: f.ordem === "relevancia" && termo ? "relevancia" : "-data" });
  if (termo) p.set("q", termo);
  if (f.situacao === "recebendo_proposta") p.set("status", "recebendo_proposta");
  if (f.ufs.length) p.set("ufs", f.ufs.join("|"));
  if (f.modalidades.length) p.set("modalidades", f.modalidades.join("|"));
  if (f.esferas.length) p.set("esferas", f.esferas.join("|"));
  if (f.srp) p.set("srp", f.srp === "sim" ? "true" : "false");
  const vMin = Number(f.valorMin.replace(/\./g, "").replace(",", "."));
  const vMax = Number(f.valorMax.replace(/\./g, "").replace(",", "."));
  if (f.valorMin.trim() && vMin >= 0) p.set("valor_total_estimado_min", String(vMin));
  if (f.valorMax.trim() && vMax > 0) p.set("valor_total_estimado_max", String(vMax));
  if (ibge) p.set("codigo_ibge", String(ibge));
  if (f.modosDisputa?.length) p.set("modos_disputa", f.modosDisputa.join("|"));
  if (f.tipoItem) p.set("tipos_item", f.tipoItem);
  if (f.meEpp) p.set("beneficios", "1");
  return p;
}

/** Filtros que o PNCP não faz: aplicados aqui depois de baixar os resultados. */
function filtroLocal(f: FiltrosBusca) {
  const [numBase, numAno] = f.numero.trim().split("/").map((x) => x.trim());
  const alvoNumero = numBase ? semZeros(numBase) : "";
  const { uasg, cnpj } = codigoOrgao(f);
  const intervalo = intervaloSessao(f);
  const plataformas = f.plataformas ?? [];
  const conhecidas = PLATAFORMAS.filter((x) => x !== "Outras");
  const ativo = !!(alvoNumero || uasg || cnpj || intervalo || plataformas.length);
  const passa = (i: ResultadoPncp) => {
    if (alvoNumero && (semZeros(i.numero) !== alvoNumero || (numAno && i.ano !== numAno))) return false;
    if (uasg && semZeros(i.uasg) !== uasg) return false;
    if (cnpj && i.cnpj !== cnpj) return false;
    if (plataformas.length && !plataformas.includes(i.portal) && !(plataformas.includes("Outras") && !conhecidas.includes(i.portal))) return false;
    if (intervalo) {
      const dia = (i.encerramento ?? "").slice(0, 10);
      if (!dia || dia < intervalo[0] || dia > intervalo[1]) return false;
    }
    return true;
  };
  return { ativo, passa };
}

const POR_PAGINA_VARREDURA = 500;
const LIMITE_VARREDURA = 3000; // por consulta (por município)

async function varrer(f: FiltrosBusca, ibge: number | null): Promise<{ itens: ResultadoPncp[]; existentes: number }> {
  const pagina = async (n: number) => {
    const p = parametros(f, ibge);
    p.set("pagina", String(n));
    p.set("tam_pagina", String(POR_PAGINA_VARREDURA));
    const r = await buscarJson<{ total: number; items: ItemBusca[] }>(`${BUSCA}?${p}`);
    return { total: r.total ?? 0, itens: (r.items ?? []).map(converter) };
  };
  // A primeira página diz quantas existem; as outras vêm em paralelo.
  const primeira = await pagina(1);
  const paginas = Math.min(Math.ceil(primeira.total / POR_PAGINA_VARREDURA), LIMITE_VARREDURA / POR_PAGINA_VARREDURA);
  const resto = await emLotes(
    Array.from({ length: Math.max(0, paginas - 1) }, (_, i) => i + 2),
    3,
    pagina,
  );
  return { itens: [primeira, ...resto].flatMap((x) => x.itens), existentes: primeira.total };
}

/** Executa tarefas com no máximo `n` ao mesmo tempo. */
async function emLotes<T, R>(lista: T[], n: number, tarefa: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(lista.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, lista.length) }, async () => {
      while (proximo < lista.length) {
        const i = proximo++;
        saida[i] = await tarefa(lista[i]);
      }
    }),
  );
  return saida;
}

export function ordenar(itens: ResultadoPncp[], ordem: FiltrosBusca["ordem"]): ResultadoPncp[] {
  const copia = [...itens];
  if (ordem === "sessao") {
    const agora = dataLocal(new Date());
    // Sessões futuras primeiro (a mais próxima no topo); as que já passaram vão para o fim.
    copia.sort((a, b) => {
      const da = a.encerramento ?? "9999";
      const db = b.encerramento ?? "9999";
      const pa = da.slice(0, 10) < agora ? 1 : 0;
      const pb = db.slice(0, 10) < agora ? 1 : 0;
      return pa - pb || (pa ? db.localeCompare(da) : da.localeCompare(db));
    });
  } else if (ordem === "recentes") {
    copia.sort((a, b) => (b.publicadoEm ?? "").localeCompare(a.publicadoEm ?? ""));
  }
  return copia;
}

/** Precisa baixar tudo e filtrar aqui? (data da sessão, plataforma, UASG, CNPJ, nº, vários municípios ou ordem por sessão) */
export function usaVarredura(f: FiltrosBusca) {
  return filtroLocal(f).ativo || f.municipios.length > 1 || f.ordem === "sessao";
}

export async function buscarLicitacoes(f: FiltrosBusca, pagina: number, porPagina = 20): Promise<RespostaBusca> {
  if (usaVarredura(f)) {
    const local = filtroLocal(f);
    const cidades = f.municipios.length ? f.municipios.map((m) => m.ibge) : [null];
    const partes = await emLotes(cidades, 4, (ibge) => varrer(f, ibge));
    const vistos = new Set<string>();
    const todos: ResultadoPncp[] = [];
    for (const p of partes) for (const i of p.itens) if (!vistos.has(i.id)) vistos.add(i.id) && todos.push(i);
    const filtrados = ordenar(todos.filter(local.passa), f.ordem);
    return {
      itens: filtrados,
      total: filtrados.length,
      varredura: true,
      analisadas: todos.length,
      existentes: partes.reduce((s, p) => s + p.existentes, 0),
    };
  }
  const p = parametros(f, f.municipios[0]?.ibge ?? null);
  p.set("pagina", String(pagina));
  p.set("tam_pagina", String(porPagina));
  const r = await buscarJson<{ total: number; items: ItemBusca[] }>(`${BUSCA}?${p}`);
  const itens = (r.items ?? []).map(converter);
  return { total: r.total ?? itens.length, itens, varredura: false };
}

// ---------------- Municípios (lista do IBGE, em /dados/municipios.json) ----------------

let municipiosCache: Promise<Record<string, [number, string][]>> | null = null;

export function carregarMunicipios() {
  municipiosCache ??= fetch("/dados/municipios.json")
    .then((r) => {
      if (!r.ok) throw new Error("Não foi possível carregar a lista de municípios.");
      return r.json() as Promise<Record<string, [number, string][]>>;
    })
    .catch((err) => {
      municipiosCache = null;
      throw err;
    });
  return municipiosCache;
}

export const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------------- Detalhes: itens e arquivos ----------------

interface DetalheCompra {
  numeroCompra: string;
  processo?: string | null;
  anoCompra: number;
  objetoCompra: string;
  srp: boolean;
  valorTotalEstimado: number | null;
  dataAberturaProposta: string | null;
  dataEncerramentoProposta: string | null;
  linkSistemaOrigem: string | null;
  usuarioNome: string | null;
  modalidadeId: number;
  modalidadeNome: string;
  orgaoEntidade: { razaoSocial: string; cnpj: string };
  unidadeOrgao: { codigoUnidade: string; nomeUnidade: string; municipioNome: string; ufSigla: string };
}

interface ItemCompra {
  numeroItem: number;
  descricao: string;
  quantidade: number | null;
  unidadeMedida: string | null;
  valorUnitarioEstimado: number | null;
  valorTotal: number | null;
  materialOuServicoNome?: string | null;
  criterioJulgamentoNome?: string | null;
  tipoBeneficioNome?: string | null;
  catalogoCodigoItem?: string | number | null;
}

export interface ArquivoPncp {
  titulo: string;
  tipo: string;
  url: string;
  publicadoEm: string | null;
}

export interface ItemPncp {
  numero: string;
  descricao: string;
  quantidade: number | null;
  unidade: string | null;
  valorUnitario: number | null;
  valorTotal: number | null;
  tipo: string;
  beneficio: string;
  /** Código do item no catálogo do governo (CATMAT/CATSER), quando o PNCP informa. */
  codigoCatalogo: number | null;
}

const baseCompra = (r: Pick<ResultadoPncp, "cnpj" | "ano" | "sequencial">) => `${r.cnpj}/compras/${r.ano}/${r.sequencial}`;

export async function listarArquivos(r: ResultadoPncp): Promise<ArquivoPncp[]> {
  const lista = await buscarJson<
    { titulo: string; tipoDocumentoNome: string; url: string; statusAtivo?: boolean; dataPublicacaoPncp?: string }[]
  >(`${API}/orgaos/${baseCompra(r)}/arquivos`, 3);
  return (Array.isArray(lista) ? lista : [])
    .filter((a) => a.statusAtivo !== false && a.url)
    .map((a) => ({ titulo: a.titulo || a.tipoDocumentoNome || "Arquivo", tipo: a.tipoDocumentoNome || "Documento", url: a.url, publicadoEm: a.dataPublicacaoPncp ?? null }));
}

const cacheItens = new Map<string, Promise<ItemPncp[]>>();

/** Itens da compra no PNCP (guarda o resultado para não buscar de novo na mesma tela). */
export function listarItens(r: ResultadoPncp): Promise<ItemPncp[]> {
  let p = cacheItens.get(r.id);
  if (!p) {
    p = buscarItens(r).catch((e) => {
      cacheItens.delete(r.id);
      throw e;
    });
    cacheItens.set(r.id, p);
  }
  return p;
}

async function buscarItens(r: ResultadoPncp): Promise<ItemPncp[]> {
  const itens: ItemCompra[] = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const lote = await buscarJson<ItemCompra[]>(`${API}/orgaos/${baseCompra(r)}/itens?pagina=${pagina}&tamanhoPagina=50`, 3);
    if (!Array.isArray(lote)) break;
    itens.push(...lote);
    if (lote.length < 50) break;
  }
  return itens.map((i) => ({
    numero: String(i.numeroItem),
    descricao: i.descricao ?? "",
    quantidade: i.quantidade ?? null,
    unidade: i.unidadeMedida ?? null,
    valorUnitario: i.valorUnitarioEstimado ?? null,
    valorTotal: i.valorTotal ?? (i.quantidade != null && i.valorUnitarioEstimado != null ? i.quantidade * i.valorUnitarioEstimado : null),
    tipo: i.materialOuServicoNome ?? "",
    beneficio: i.tipoBeneficioNome && !/sem benef|não se aplica/i.test(i.tipoBeneficioNome) ? i.tipoBeneficioNome : "",
    codigoCatalogo: Number(i.catalogoCodigoItem) > 0 ? Number(i.catalogoCodigoItem) : null,
  }));
}

/** Dados extras da compra (nº do processo, link de origem). O PNCP às vezes ainda não tem: devolve null. */
export async function detalheCompra(r: ResultadoPncp): Promise<{ processo: string; linkPortal: string | null; portal: string } | null> {
  const d = await buscarJson<Partial<DetalheCompra>>(`${CONSULTA}/orgaos/${baseCompra(r)}`, 1).catch(() => null);
  if (!d || !d.numeroCompra) return null;
  const portal = portalDaLicitacao(d.linkSistemaOrigem ?? r.linkPortal, d.usuarioNome ?? r.portal);
  return { processo: (d.processo ?? "").trim(), linkPortal: portal.link, portal: portal.nome };
}

/** Categoria do arquivo na plataforma a partir do tipo informado no PNCP. */
export function categoriaDoArquivo(tipo: string): string {
  if (/edital|aviso de contrata/i.test(tipo)) return "Edital";
  if (/termo de refer/i.test(tipo)) return "Termo de referência";
  if (/^ata/i.test(tipo)) return "Ata";
  return "Anexo";
}

/** Endereço da prévia (o servidor busca no PNCP e repassa). */
export const urlPrevia = (url: string) => `/api/pncp/arquivo?url=${encodeURIComponent(url)}`;

// ---------------- Importar para o quadro ----------------

export interface LicitacaoImportada {
  dados: Record<string, unknown>;
  itens: { numero: string; descricao: string; quantidade: number | null; unidade: string | null; valor_referencia: number | null }[];
  arquivos: { titulo: string; url: string; categoria: string }[];
}

/** Junta os dados, os itens e os arquivos de uma licitação do PNCP no formato da plataforma. */
export async function prepararImportacao(r: ResultadoPncp, escolhidos?: ItemPncp[]): Promise<LicitacaoImportada> {
  // Os detalhes às vezes ainda não existem no PNCP (publicação recente): usa os dados da busca.
  const [detalhe, arquivos, itens] = await Promise.all([
    buscarJson<DetalheCompra>(`${CONSULTA}/orgaos/${baseCompra(r)}`, 1).catch(() => null),
    listarArquivos(r).catch(() => [] as ArquivoPncp[]),
    escolhidos ? Promise.resolve(escolhidos) : listarItens(r).catch(() => [] as ItemPncp[]),
  ]);
  const d: Partial<DetalheCompra> = detalhe && (detalhe as Partial<DetalheCompra>).numeroCompra ? detalhe : {};
  const sessao = d.dataEncerramentoProposta ?? d.dataAberturaProposta ?? r.encerramento;
  const modalidade = MODALIDADES_PNCP.find((m) => m.codigo === String(d.modalidadeId ?? r.modalidadeId))?.plataforma ?? "Outra";
  const portal = portalDaLicitacao(d.linkSistemaOrigem ?? r.linkPortal, d.usuarioNome ?? r.portal);
  // Edital primeiro; o resto na ordem do PNCP.
  const ordenados = [...arquivos].sort((a, b) => Number(categoriaDoArquivo(b.tipo) === "Edital") - Number(categoriaDoArquivo(a.tipo) === "Edital"));
  return {
    dados: {
      pncp_id: r.id,
      etapa: "estudar",
      numero: `${d.numeroCompra || r.numero}/${d.anoCompra || r.ano}`,
      uasg: d.unidadeOrgao?.codigoUnidade || r.uasg || null,
      orgao: d.orgaoEntidade?.razaoSocial || r.orgao,
      objeto: (d.objetoCompra || r.objeto).slice(0, 4000),
      modalidade,
      data_sessao: sessao ? sessao.slice(0, 10) : null,
      horario: sessao && sessao.length >= 16 ? sessao.slice(11, 16) : null,
      portal: portal.nome,
      link: (portal.direto ? portal.link : null) || r.linkPncp,
      valor_estimado: d.valorTotalEstimado ?? r.valorEstimado ?? null,
      registro_preco: d.srp ?? r.srp,
      observacoes: `Importada do PNCP (${r.id}). ${r.linkPncp}`,
    },
    itens: itens.map((i) => ({
      numero: i.numero,
      descricao: i.descricao.slice(0, 4000),
      quantidade: i.quantidade,
      unidade: i.unidade,
      valor_referencia: i.valorUnitario,
    })),
    arquivos: ordenados.slice(0, 20).map((a) => ({ titulo: a.titulo, url: a.url, categoria: categoriaDoArquivo(a.tipo) })),
  };
}
