import { numeroPorExtenso, reaisPorExtenso } from "./extenso";

// Dados da proposta comercial (usados no Word e no PDF).
// Preenche um modelo de proposta (.docx) com os dados da licitação.
// No Word, os campos são escritos entre chaves, ex.: {orgao}. A tabela de itens
// usa {#itens} no começo da linha e {/itens} no fim.

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const dataBr = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
function dataExtenso(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}
function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ---------------- Modelos visuais do PDF ----------------

export const MODELOS_PDF = [
  { chave: "classico", nome: "Clássico", descricao: "Logo no centro, títulos coloridos e tabela com fundo suave." },
  { chave: "moderno", nome: "Moderno", descricao: "Faixa colorida no topo, dados em colunas e tabela listrada." },
  { chave: "timbrado", nome: "Timbrado", descricao: "Papel timbrado: dados da empresa no cabeçalho e no rodapé, letra serifada." },
  { chave: "compacto", nome: "Compacto", descricao: "Letra menor e dados lado a lado: cabe em menos páginas." },
  { chave: "simples", nome: "Simples", descricao: "Preto e branco, tabela com grade completa. Ideal para imprimir." },
] as const;

export type ModeloPdf = (typeof MODELOS_PDF)[number]["chave"];

export const CORES_PDF = [
  { cor: "#1f3b8a", nome: "Azul" },
  { cor: "#0f5e6e", nome: "Petróleo" },
  { cor: "#166534", nome: "Verde" },
  { cor: "#7f1d1d", nome: "Vinho" },
  { cor: "#c2410c", nome: "Laranja" },
  { cor: "#5b21b6", nome: "Roxo" },
  { cor: "#334155", nome: "Grafite" },
  { cor: "#111111", nome: "Preto" },
] as const;

export const ehModeloPdf = (v: unknown): v is ModeloPdf => MODELOS_PDF.some((m) => m.chave === v);
export const ehCorPdf = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

export interface EmpresaProposta {
  id: number;
  nome: string;
  cnpj: string | null;
  ie: string | null;
  endereco: string | null;
  cidade: string | null;
  telefone: string | null;
  email: string | null;
  representante_nome: string | null;
  representante_cpf: string | null;
  representante_rg: string | null;
  representante_cargo: string | null;
}

export interface DadosProposta {
  empresa: EmpresaProposta;
  /** Data da proposta (AAAA-MM-DD). */
  hoje: string;
  contratacao: string;
  numeroProposta: string;
  condicoes: string[];
  declaracoes: { titulo: string; texto: string }[];
  licitacao: {
    numero: string | null;
    uasg: string | null;
    orgao: string | null;
    objeto: string | null;
    modalidade: string | null;
    data_sessao: string | null;
    horario: string | null;
    portal: string | null;
  };
  conta: {
    banco: string;
    codigo_banco: string | null;
    agencia: string | null;
    conta: string | null;
    tipo: string | null;
    pix: string | null;
    titular: string | null;
  } | null;
  validadeDias: number;
  prazoEntrega: string;
  garantia: string;
  observacoes: string;
  itens: { numero: string | null; descricao: string | null; marca: string; unidade: string | null; quantidade: number; valorUnitario: number }[];
}

/** Lista de campos disponíveis (para mostrar na tela de modelos). */
export const CAMPOS_MODELO = [
  ["empresa_nome", "Nome da empresa"],
  ["empresa_cnpj", "CNPJ da empresa"],
  ["empresa_ie", "Inscrição estadual"],
  ["empresa_endereco", "Endereço da empresa"],
  ["empresa_cidade", "Cidade da empresa"],
  ["empresa_telefone", "Telefone"],
  ["empresa_email", "E-mail"],
  ["representante_nome", "Representante legal"],
  ["representante_cpf", "CPF do representante"],
  ["representante_cargo", "Cargo do representante"],
  ["representante_rg", "RG do representante"],
  ["contratacao", "Nº da contratação"],
  ["numero_proposta", "Nº da proposta"],
  ["validade_extenso", "Validade por extenso (ex.: sessenta)"],
  ["orgao", "Órgão"],
  ["uasg", "UASG"],
  ["numero_licitacao", "Número da licitação"],
  ["modalidade", "Modalidade"],
  ["objeto", "Objeto"],
  ["data_sessao", "Data da sessão"],
  ["horario", "Horário da sessão"],
  ["portal", "Portal"],
  ["data_proposta", "Data de hoje (dd/mm/aaaa)"],
  ["data_extenso", "Data de hoje por extenso"],
  ["validade_dias", "Validade da proposta (dias)"],
  ["validade_data", "Data final da validade"],
  ["prazo_entrega", "Prazo de entrega"],
  ["garantia", "Garantia"],
  ["observacoes", "Observações"],
  ["banco_nome", "Banco"],
  ["banco_codigo", "Código do banco"],
  ["agencia", "Agência"],
  ["conta", "Conta"],
  ["tipo_conta", "Tipo de conta"],
  ["pix", "Chave PIX"],
  ["titular", "Titular da conta"],
  ["valor_total", "Valor total (R$)"],
  ["valor_total_extenso", "Valor total por extenso"],
  ["quantidade_itens", "Quantidade de itens"],
] as const;

export const CAMPOS_ITEM = [
  ["item", "Número do item"],
  ["descricao", "Descrição"],
  ["marca", "Marca / modelo"],
  ["unidade", "Unidade"],
  ["quantidade", "Quantidade"],
  ["valor_unitario", "Valor unitário"],
  ["valor_total", "Valor total do item"],
] as const;

export function montarDados(d: DadosProposta) {
  const itens = d.itens.map((i) => ({
    item: i.numero ?? "",
    descricao: i.descricao ?? "",
    marca: i.marca,
    unidade: i.unidade ?? "",
    quantidade: numero.format(i.quantidade),
    valor_unitario: moeda.format(i.valorUnitario),
    valor_total: moeda.format(i.valorUnitario * i.quantidade),
  }));
  const total = d.itens.reduce((s, i) => s + i.valorUnitario * i.quantidade, 0);
  const e = d.empresa;
  return {
    empresa_id: e.id,
    empresa_nome: e.nome,
    empresa_cnpj: e.cnpj ?? "",
    empresa_ie: e.ie ?? "",
    empresa_endereco: e.endereco ?? "",
    empresa_cidade: e.cidade ?? "",
    empresa_telefone: e.telefone ?? "",
    empresa_email: e.email ?? "",
    representante_nome: e.representante_nome ?? "",
    representante_cpf: e.representante_cpf ?? "",
    representante_rg: e.representante_rg ?? "",
    representante_cargo: e.representante_cargo ?? "",
    contratacao: d.contratacao,
    numero_proposta: d.numeroProposta,
    condicoes: d.condicoes.map((texto) => ({ texto })),
    declaracoes: d.declaracoes,
    orgao: d.licitacao.orgao ?? "",
    uasg: d.licitacao.uasg ?? "",
    numero_licitacao: d.licitacao.numero ?? "",
    modalidade: d.licitacao.modalidade ?? "",
    objeto: d.licitacao.objeto ?? "",
    data_sessao: dataBr(d.licitacao.data_sessao),
    horario: d.licitacao.horario ?? "",
    portal: d.licitacao.portal ?? "",
    data_proposta: dataBr(d.hoje),
    data_extenso: dataExtenso(d.hoje),
    validade_dias: String(d.validadeDias),
    validade_extenso: numeroPorExtenso(d.validadeDias),
    validade_data: dataBr(somarDias(d.hoje, d.validadeDias)),
    prazo_entrega: d.prazoEntrega,
    garantia: d.garantia,
    observacoes: d.observacoes,
    banco_nome: d.conta?.banco ?? "",
    banco_codigo: d.conta?.codigo_banco ?? "",
    agencia: d.conta?.agencia ?? "",
    conta: d.conta?.conta ?? "",
    tipo_conta: d.conta?.tipo ?? "",
    pix: d.conta?.pix ?? "",
    titular: d.conta?.titular ?? "",
    valor_total: moeda.format(total),
    valor_total_extenso: reaisPorExtenso(total),
    quantidade_itens: String(d.itens.length),
    itens,
  };
}


export type DadosMontados = ReturnType<typeof montarDados>;

export const DECLARACAO_PADRAO =
  "Declaramos que nos preços propostos estão incluídas todas as despesas com tributos, fretes, encargos sociais e demais custos diretos e indiretos necessários ao fornecimento, e que concordamos com todas as condições do edital.";
