// Monta a proposta no navegador (Word ou PDF) e envia para os arquivos da licitação.
// Assim o servidor não faz o trabalho pesado e tudo cabe no plano grátis da Cloudflare.
import type { DadosMontados } from "../../shared/proposta";
import { enviarArquivo } from "../api";

export interface RespostaDados {
  dados: DadosMontados;
  nome: string;
  modelo: { id: number; nome: string } | null;
  pdf: { tem_logo: boolean; marca_dagua: boolean; empresa_id: number };
}

const TIPO_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function baixar(caminho: string): Promise<Response> {
  const r = await fetch(`/api${caminho}`, { credentials: "same-origin" });
  if (!r.ok) throw new Error("Não foi possível baixar o arquivo necessário.");
  return r;
}

export async function montarWord(r: RespostaDados): Promise<Uint8Array> {
  if (!r.modelo) throw new Error("Escolha o modelo da proposta.");
  const [{ gerarDocumento, mensagemDoModelo }, modelo] = await Promise.all([
    import("./word"),
    baixar(`/propostas/modelos/${r.modelo.id}/arquivo`).then((x) => x.arrayBuffer()),
  ]);
  try {
    return gerarDocumento(modelo, r.dados);
  } catch (err) {
    throw new Error(mensagemDoModelo(err));
  }
}

export async function montarPdf(r: RespostaDados): Promise<Uint8Array> {
  const { gerarPropostaPdf } = await import("./pdf");
  let logo: { bytes: Uint8Array; tipo: string } | null = null;
  if (r.pdf.tem_logo) {
    try {
      const resposta = await baixar(`/empresas/${r.pdf.empresa_id}/logo`);
      logo = { bytes: new Uint8Array(await resposta.arrayBuffer()), tipo: resposta.headers.get("content-type") ?? "image/png" };
    } catch {
      logo = null;
    }
  }
  return gerarPropostaPdf(r.dados, { logo, marcaDagua: r.pdf.marca_dagua });
}

/** Guarda a proposta montada nos arquivos da licitação. */
export function enviarProposta(
  licitacaoId: number,
  bytes: Uint8Array,
  formato: "docx" | "pdf",
  extras: { nome: string; modelo?: string; pedido?: string },
) {
  const dados = new FormData();
  const tipo = formato === "pdf" ? "application/pdf" : TIPO_DOCX;
  dados.set("arquivo", new Blob([bytes.slice().buffer as ArrayBuffer], { type: tipo }), `${extras.nome}.${formato}`);
  dados.set("nome", extras.nome);
  if (extras.modelo) dados.set("modelo", extras.modelo);
  if (extras.pedido) dados.set("pedido_assinatura", extras.pedido);
  return enviarArquivo<{ arquivo: { id: number; nome: string } }>(`/licitacoes/${licitacaoId}/proposta/arquivo`, dados);
}
