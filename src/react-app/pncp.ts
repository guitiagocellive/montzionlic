// Busca de licitações no PNCP (Portal Nacional de Contratações Públicas).
// O PNCP aceita consultas direto do navegador, então nada disso passa pelo servidor da plataforma.

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

export interface FiltrosBusca {
  palavra: string;
  numero: string;
  ufs: string[];
  modalidades: string[];
  situacao: "recebendo_proposta" | "todas";
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
  municipio: string;
  uf: string;
  modalidade: string;
  modalidadeId: string;
  situacao: string;
  publicadoEm: string | null;
  abertura: string | null;
  encerramento: string | null;
  linkPncp: string;
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
  municipio_nome: string;
  uf: string;
  modalidade_licitacao_nome: string;
  modalidade_licitacao_id: string;
  situacao_nome: string;
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
      if (!r.ok) throw new Error(`PNCP respondeu ${r.status}`);
      const texto = await r.text();
      if (texto.trim()) return JSON.parse(texto) as T;
      ultimoErro = new Error("Resposta vazia do PNCP");
    } catch (err) {
      ultimoErro = err;
    }
    await new Promise((ok) => setTimeout(ok, 600 * (i + 1)));
  }
  throw ultimoErro instanceof Error ? new Error("O PNCP não respondeu agora. Tente de novo em instantes.") : new Error("Falha no PNCP");
}

const somenteNumero = (s: string) => s.replace(/\D/g, "");

export async function buscarLicitacoes(f: FiltrosBusca, pagina: number, porPagina = 20): Promise<{ total: number; itens: ResultadoPncp[] }> {
  const numero = f.numero.trim();
  const [numBase, numAno] = numero.split("/").map((x) => x.trim());
  // Número entre aspas ("80/2026") faz o PNCP trazer o número exato primeiro.
  const termo = [f.palavra.trim(), numero ? `"${numero}"` : ""].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    tipos_documento: "edital",
    ordenacao: "-data",
    pagina: String(pagina),
    tam_pagina: String(numero ? 100 : porPagina),
  });
  if (termo) params.set("q", termo);
  if (f.situacao === "recebendo_proposta") params.set("status", "recebendo_proposta");
  if (f.ufs.length) params.set("ufs", f.ufs.join("|"));
  if (f.modalidades.length) params.set("modalidades", f.modalidades.join("|"));

  const r = await buscarJson<{ total: number; items: ItemBusca[] }>(`${BUSCA}?${params}`);
  let itens = (r.items ?? []).map(
    (i): ResultadoPncp => ({
      id: i.numero_controle_pncp,
      titulo: i.title,
      objeto: i.description ?? "",
      numero: i.numero ?? "",
      ano: i.ano ?? "",
      sequencial: i.numero_sequencial ?? "",
      cnpj: i.orgao_cnpj,
      orgao: i.orgao_nome ?? "",
      unidade: i.unidade_nome ?? "",
      municipio: i.municipio_nome ?? "",
      uf: i.uf ?? "",
      modalidade: i.modalidade_licitacao_nome ?? "",
      modalidadeId: i.modalidade_licitacao_id ?? "",
      situacao: i.situacao_nome ?? "",
      publicadoEm: i.data_publicacao_pncp,
      abertura: i.data_inicio_vigencia,
      encerramento: i.data_fim_vigencia,
      linkPncp: `https://pncp.gov.br/app/editais/${i.orgao_cnpj}/${i.ano}/${i.numero_sequencial}`,
      cancelado: !!i.cancelado,
    }),
  );
  // Busca por número: a pesquisa do PNCP traz números parecidos; aqui ficam só os exatos.
  if (numBase) {
    const alvo = somenteNumero(numBase).replace(/^0+/, "");
    itens = itens.filter((i) => somenteNumero(i.numero).replace(/^0+/, "") === alvo && (!numAno || i.ano === numAno));
  }
  return { total: r.total ?? itens.length, itens };
}

// ---------------- Detalhes para importar ----------------

interface DetalheCompra {
  numeroCompra: string;
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
}

interface ArquivoCompra {
  titulo: string;
  tipoDocumentoNome: string;
  url: string;
  statusAtivo?: boolean;
}

function portalDe(link: string | null, usuario: string | null): string {
  const l = (link ?? "").toLowerCase();
  if (l.includes("comprasnet") || l.includes("compras.gov") || l.includes("estaleiro.serpro")) return "Compras.gov.br";
  if (l.includes("bll")) return "BLL Compras";
  if (l.includes("licitacoes-e") || l.includes("bb.com.br")) return "Licitações-e (Banco do Brasil)";
  if (l.includes("portaldecompraspublicas")) return "Portal de Compras Públicas";
  if (l.includes("bnc")) return "BNC Compras";
  if (l.includes("licitanet")) return "Licitanet";
  if (usuario && /compras\.gov/i.test(usuario)) return "Compras.gov.br";
  return usuario || "Portal do próprio órgão";
}

export interface LicitacaoImportada {
  dados: Record<string, unknown>;
  itens: { numero: string; descricao: string; quantidade: number | null; unidade: string | null; valor_referencia: number | null }[];
  edital: { titulo: string; url: string } | null;
}

/** Junta os dados, os itens e o edital de uma licitação do PNCP no formato da plataforma. */
export async function prepararImportacao(r: ResultadoPncp): Promise<LicitacaoImportada> {
  const base = `${r.cnpj}/compras/${r.ano}/${r.sequencial}`;
  // Os detalhes às vezes ainda não existem no PNCP (publicação recente): usa os dados da busca.
  const [detalhe, arquivos] = await Promise.all([
    buscarJson<DetalheCompra>(`${CONSULTA}/orgaos/${base}`, 1).catch(() => null),
    buscarJson<ArquivoCompra[]>(`${API}/orgaos/${base}/arquivos`, 2).catch(() => [] as ArquivoCompra[]),
  ]);
  const d: Partial<DetalheCompra> = detalhe && (detalhe as Partial<DetalheCompra>).numeroCompra ? detalhe : {};
  const itens: ItemCompra[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const lote = await buscarJson<ItemCompra[]>(`${API}/orgaos/${base}/itens?pagina=${pagina}&tamanhoPagina=50`, 2).catch(() => [] as ItemCompra[]);
    if (!Array.isArray(lote)) break;
    itens.push(...lote);
    if (lote.length < 50) break;
  }
  const sessao = d.dataEncerramentoProposta ?? d.dataAberturaProposta ?? r.encerramento;
  const modalidade = MODALIDADES_PNCP.find((m) => m.codigo === String(d.modalidadeId ?? r.modalidadeId))?.plataforma ?? "Outra";
  const lista = Array.isArray(arquivos) ? arquivos : [];
  const edital = lista.find((a) => a.statusAtivo !== false && /edital/i.test(a.tipoDocumentoNome)) ?? lista.find((a) => a.statusAtivo !== false) ?? null;
  return {
    dados: {
      pncp_id: r.id,
      etapa: "estudar",
      numero: `${d.numeroCompra || r.numero}/${d.anoCompra || r.ano}`,
      uasg: d.unidadeOrgao?.codigoUnidade || null,
      orgao: d.orgaoEntidade?.razaoSocial || r.orgao,
      objeto: (d.objetoCompra || r.objeto).slice(0, 4000),
      modalidade,
      data_sessao: sessao ? sessao.slice(0, 10) : null,
      horario: sessao && sessao.length >= 16 ? sessao.slice(11, 16) : null,
      portal: portalDe(d.linkSistemaOrigem ?? null, d.usuarioNome ?? null),
      link: d.linkSistemaOrigem || r.linkPncp,
      valor_estimado: d.valorTotalEstimado ?? null,
      registro_preco: !!d.srp,
      observacoes: `Importada do PNCP (${r.id}). ${r.linkPncp}`,
    },
    itens: itens.map((i) => ({
      numero: String(i.numeroItem),
      descricao: (i.descricao ?? "").slice(0, 4000),
      quantidade: i.quantidade ?? null,
      unidade: i.unidadeMedida ?? null,
      valor_referencia: i.valorUnitarioEstimado ?? null,
    })),
    edital: edital ? { titulo: edital.titulo || "Edital", url: edital.url } : null,
  };
}
