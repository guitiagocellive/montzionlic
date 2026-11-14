import { avisar } from "../../components/Ui";
import type { ResultadoPncp } from "../../pncp";
import { dataHora, reais } from "./DetalhePncp";

// Compartilhar uma licitação da busca: no celular abre o "Compartilhar" do aparelho (WhatsApp, e-mail…);
// no computador copia o texto com os links. Vai junto o link da plataforma (abre direto na janela da licitação,
// para quem é da equipe) e o link público do edital no PNCP (para quem não tem acesso à plataforma).

/** Link da plataforma que abre a licitação direto na busca. */
export function linkDaLicitacao(id: string) {
  return `${window.location.origin}/licitacoes/buscar?pncp=${encodeURIComponent(id)}`;
}

const resumir = (t: string, max: number) => (t.length > max ? `${t.slice(0, max).trimEnd()}…` : t);

function textoDaLicitacao(r: ResultadoPncp) {
  const local = r.municipio ? ` (${r.municipio}/${r.uf})` : r.uf ? ` (${r.uf})` : "";
  return [
    `${r.modalidade} nº ${r.numero}/${r.ano} — ${r.orgao}${local}`,
    r.objeto && `Objeto: ${resumir(r.objeto.replace(/\s+/g, " ").trim(), 220)}`,
    r.encerramento && `Sessão: ${dataHora(r.encerramento)}`,
    r.valorEstimado && `Valor estimado: ${reais(r.valorEstimado)}`,
    `Edital no PNCP: ${r.linkPncp}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Navegador sem acesso à área de transferência: copia pelo jeito antigo.
    const campo = document.createElement("textarea");
    campo.value = texto;
    campo.style.position = "fixed";
    campo.style.opacity = "0";
    document.body.appendChild(campo);
    campo.select();
    const ok = document.execCommand("copy");
    campo.remove();
    return ok;
  }
}

export async function compartilharLicitacao(r: ResultadoPncp) {
  const titulo = `${r.modalidade} nº ${r.numero}/${r.ano}`;
  const texto = textoDaLicitacao(r);
  const url = linkDaLicitacao(r.id);
  const toque = window.matchMedia("(pointer: coarse)").matches;
  if (toque && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: titulo, text: `${texto}\nAbrir na Montzion:`, url });
      return;
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return; // a pessoa fechou o compartilhar
    }
  }
  const ok = await copiar(`${texto}\nAbrir na Montzion: ${url}`);
  avisar(ok ? "Link da licitação copiado. É só colar no WhatsApp ou no e-mail." : "Não consegui copiar o link.", ok ? "sucesso" : "erro");
}
