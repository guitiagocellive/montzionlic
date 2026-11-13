// Os documentos de habilitação (aba Documentação) prontos para o .zip, com uma pasta por habilitação.
// Usado pelo "Baixar tudo" da Documentação e pelo "Documentos de habilitação" dos arquivos da licitação.
import { diasAte, HABILITACOES, habilitacaoDaCategoria } from "../../shared/negocio";
import type { Documento, Empresa } from "../../shared/tipos";
import { formatarData } from "../formato";
import { type ArquivoZip, nomeDeArquivo } from "./zip";

export const docVencido = (d: Documento, hoje: string) => !!d.validade && diasAte(d.validade, hoje) < 0;

export function zipDaHabilitacao(
  docs: Documento[],
  empresas: Empresa[],
  hoje: string,
  opcoes: { empresaId?: number | "todas"; habilitacao?: string } = {},
): { nome: string; arquivos: ArquivoZip[]; vencidos: number } {
  const empresaId = opcoes.empresaId ?? "todas";
  const nomeEmpresa = (id: number | null) => empresas.find((e) => e.id === id)?.nome;
  // Documento sem empresa marcada vale para todas.
  const comArquivo = docs.filter((d) => d.arquivo_nome && (empresaId === "todas" || d.empresa_id === empresaId || d.empresa_id == null));
  const nome = [
    "Documentos de habilitação",
    empresaId !== "todas" ? nomeEmpresa(empresaId) : "",
    opcoes.habilitacao ? HABILITACOES.find((h) => h.chave === opcoes.habilitacao)?.nome : "",
    formatarData(hoje).replaceAll("/", "-"),
  ]
    .filter(Boolean)
    .join(" - ");
  const arquivos = comArquivo.map((d) => {
    const h = habilitacaoDaCategoria(d.categoria);
    const pasta = `${HABILITACOES.indexOf(h) + 1} - ${h.nome}`;
    const extensao = d.arquivo_nome?.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "";
    const empresa = empresaId === "todas" && empresas.length > 1 ? nomeEmpresa(d.empresa_id) : "";
    const vencido = docVencido(d, hoje) ? " (VENCIDO)" : "";
    return {
      caminho: `${empresa ? `${nomeDeArquivo(empresa)}/` : ""}${pasta}/${nomeDeArquivo(d.nome)}${vencido}${extensao}`,
      url: `/api/documentos/${d.id}/arquivo?baixar=1`,
    };
  });
  return { nome, arquivos, vencidos: comArquivo.filter((d) => docVencido(d, hoje)).length };
}
