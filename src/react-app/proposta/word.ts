import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import type { DadosMontados } from "../../shared/proposta";

// Roda no navegador: preenche o modelo do Word com os dados da proposta.

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

export function gerarDocumento(modelo: ArrayBuffer, dados: DadosMontados): Uint8Array {
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
