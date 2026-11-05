import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { reaisPorExtenso } from "../shared/extenso";
import type { Configuracoes } from "../shared/tipos";

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

export interface DadosProposta {
  config: Configuracoes;
  hoje: string;
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
  const c = d.config;
  return {
    empresa_nome: c.empresa_nome,
    empresa_cnpj: c.empresa_cnpj,
    empresa_ie: c.empresa_ie,
    empresa_endereco: c.empresa_endereco,
    empresa_cidade: c.empresa_cidade,
    empresa_telefone: c.empresa_telefone,
    empresa_email: c.empresa_email,
    representante_nome: c.representante_nome,
    representante_cpf: c.representante_cpf,
    representante_cargo: c.representante_cargo,
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

/** Confere se o arquivo é um .docx que dá para usar como modelo. */
export function validarModelo(dados: ArrayBuffer): string | null {
  try {
    const zip = new PizZip(dados);
    if (!zip.file("word/document.xml")) return "O arquivo não parece ser um documento do Word (.docx).";
    new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    return null;
  } catch (err) {
    return mensagemDoModelo(err);
  }
}

export function gerarDocumento(modelo: ArrayBuffer, dados: ReturnType<typeof montarDados>): Uint8Array {
  const zip = new PizZip(modelo);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(dados);
  return doc.getZip().generate({ type: "uint8array", compression: "DEFLATE" });
}

/** Traduz os erros do preenchimento para algo que dê para corrigir no Word. */
export function mensagemDoModelo(err: unknown): string {
  const e = err as { properties?: { errors?: { properties?: { explanation?: string; xtag?: string } }[] } };
  const erros = e.properties?.errors ?? [];
  if (erros.length > 0) {
    const tags = erros
      .map((x) => x.properties?.xtag)
      .filter(Boolean)
      .slice(0, 5);
    return `O modelo tem campos com problema${tags.length ? ` (${tags.map((t) => `{${t}}`).join(", ")})` : ""}. Confira se cada campo abre e fecha chaves, e se a tabela tem {#itens} e {/itens}.`;
  }
  return "Não foi possível ler o modelo. Confira se é um .docx válido.";
}
