// Atualização do Quadro pelo Compras.gov.br (feita pelo aplicativo, com a conta gov.br de quem está usando):
// percorre as licitações cuja sessão já aconteceu e que ainda não fecharam, puxa o resultado de cada uma,
// grava só o que mudou, atualiza a colocação do card e manda o resumo para o sino da equipe.
import type { CompraAcomp } from "../../../shared/acompanhamento";
import type { ItemLicitacao, Licitacao, LicitacaoResumo } from "../../../shared/tipos";
import { api } from "../../api";
import { ehDoCompras } from "./CadastroUmClique";
import { chaveDoLink } from "./comprasCadastro";
import { puxarESalvarResultado } from "./puxarResultado";

const CHAVE_ULTIMA = "montzion:sinc-quadro";
const CHAVE_MUDOU = "montzion:sinc-quadro-mudou";

export interface DetalheSinc {
  id: number;
  numero: string | null;
  orgao: string | null;
  mudancas: string[];
  colocacao: number | null;
  /** O Compras.gov.br ainda não mostra a nossa proposta (ou não deu para ler). */
  semDados: boolean;
  erro: string;
}

export interface UltimaSinc {
  em: number;
  dia: string;
  total: number;
  mudaram: number;
}

export function lerUltimaSinc(): UltimaSinc | null {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_ULTIMA) ?? "null") as UltimaSinc | null;
  } catch {
    return null;
  }
}

/** Licitações que mudaram hoje (id → resumo), para a marca "mudou hoje" nos cards. */
export function lerMudouHoje(): Record<number, string> {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_MUDOU) ?? "{}") as { dia?: string; ids?: Record<number, string> };
    return bruto.dia === diaDeHoje() ? (bruto.ids ?? {}) : {};
  } catch {
    return {};
  }
}

function guardar(chave: string, valor: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem armazenamento: vale só nesta tela */
  }
}

export const diaDeHoje = () => new Date().toLocaleDateString("sv-SE");

/** A compra (chave de 17 dígitos) é desta licitação? Pelo link ou por UASG + número/ano. */
export function compraDaLicitacao(chave: string, l: Pick<LicitacaoResumo, "link" | "uasg" | "numero">) {
  const doLink = chaveDoLink(l.link ?? null);
  if (doLink) return doLink === chave;
  const [num, ano] = String(l.numero ?? "").split("/");
  if (!l.uasg || !num || !ano) return false;
  return chave.slice(0, 6) === l.uasg.padStart(6, "0") && Number(chave.slice(8, 13)) === Number(num.replace(/\D/g, "")) && chave.slice(13) === ano.trim();
}

export interface CadastroNoPortal {
  id: number;
  numero: string | null;
  orgao: string | null;
  itens: number;
}

/**
 * Licitações do quadro com proposta no Compras.gov.br que não foram cadastradas pela plataforma (alguém cadastrou
 * direto no portal): aparecem nas participações lidas pelo aplicativo. Marca no quadro como cadastradas.
 */
export async function detectarCadastrosNoPortal(lista: LicitacaoResumo[], participacoes: CompraAcomp[]): Promise<CadastroNoPortal[]> {
  const achados: CadastroNoPortal[] = [];
  for (const l of lista) {
    if (l.compras_cadastrado_em || l.etapa === "perdida" || !ehDoCompras(l)) continue;
    const c = participacoes.find((p) => compraDaLicitacao(p.chave, l));
    if (!c) continue;
    const itens = c.itens.length || l.total_itens || 0;
    try {
      await api(`/licitacoes/${l.id}`, { metodo: "PATCH", corpo: { compras_cadastrado_em: new Date().toISOString(), compras_itens: itens } });
      l.compras_cadastrado_em = new Date().toISOString();
      l.compras_itens = itens;
      achados.push({ id: l.id, numero: l.numero, orgao: l.orgao, itens });
    } catch {
      /* tenta de novo na próxima checagem */
    }
  }
  return achados;
}

/** Participações em andamento no Compras.gov.br que não têm card no quadro. */
export function participacoesForaDoQuadro(lista: LicitacaoResumo[], participacoes: CompraAcomp[]) {
  return participacoes.filter((c) => !c.encerrada && !lista.some((l) => compraDaLicitacao(c.chave, l)));
}

/** Vale a pena puxar: do Compras, com proposta cadastrada (pela plataforma ou no portal), sessão já aconteceu e a
 * licitação ainda não fechou. */
export function elegivelParaSinc(l: LicitacaoResumo, hoje: string): boolean {
  if (!ehDoCompras(l) || !l.compras_cadastrado_em) return false;
  const data = l.data_reabertura && l.data_reabertura <= hoje ? l.data_reabertura : l.data_sessao;
  if (!data || data > hoje) return false;
  if (l.etapa === "perdida") return false;
  if (l.etapa === "ganha") return l.itens_acompanhando > 0;
  return l.total_itens > 0;
}

export async function sincronizarQuadro(
  lista: LicitacaoResumo[],
  opcoes: { aoProgredir: (feitas: number, total: number) => void; deveParar: () => boolean },
): Promise<UltimaSinc & { avisos: number; pausada: boolean; detalhes: DetalheSinc[] }> {
  const hoje = diaDeHoje();
  const mudou = lerMudouHoje();
  let mudaram = 0;
  let feitas = 0;
  let avisos = 0;
  let pausada = false;
  const detalhes: DetalheSinc[] = [];
  for (const resumo of lista) {
    if (opcoes.deveParar()) {
      pausada = true;
      break;
    }
    opcoes.aoProgredir(feitas, lista.length);
    try {
      const ficha = await api<{ licitacao: Licitacao; itens: ItemLicitacao[] }>(`/licitacoes/${resumo.id}`);
      const r = await puxarESalvarResultado(ficha.licitacao, ficha.itens, { automatico: true });
      // Colocação do card: a melhor entre os itens ainda em disputa.
      if (r.melhorColocacao != null && r.melhorColocacao !== ficha.licitacao.colocacao) {
        await api(`/licitacoes/${resumo.id}`, { metodo: "PATCH", corpo: { colocacao: r.melhorColocacao } }).catch(() => {});
      }
      detalhes.push({ id: resumo.id, numero: resumo.numero, orgao: resumo.orgao, mudancas: r.mudancas, colocacao: r.melhorColocacao, semDados: !r.preenchidos, erro: "" });
      if (r.alterados > 0) {
        mudaram++;
        mudou[resumo.id] = r.mudancas.join(" · ") || "Resultado atualizado";
        if (r.mudancas.length) {
          await api(`/licitacoes/${resumo.id}/aviso-resultado`, {
            corpo: {
              titulo: `${resumo.numero ? `Nº ${resumo.numero}` : "Licitação"}${resumo.orgao ? ` · ${resumo.orgao}` : ""}: resultado atualizado`,
              mensagem: r.mudancas.join(" · "),
            },
          })
            .then(() => avisos++)
            .catch(() => {});
        }
      }
    } catch (e) {
      // Compra não achada no Compras ou fora do ar: segue para a próxima.
      console.warn(`Atualização do quadro: licitação ${resumo.numero ?? resumo.id}:`, e instanceof Error ? e.message : e);
      detalhes.push({ id: resumo.id, numero: resumo.numero, orgao: resumo.orgao, mudancas: [], colocacao: null, semDados: true, erro: e instanceof Error ? e.message : "Não consegui ler no Compras.gov.br." });
    }
    feitas++;
  }
  opcoes.aoProgredir(feitas, lista.length);
  guardar(CHAVE_MUDOU, { dia: hoje, ids: mudou });
  const ultima: UltimaSinc = { em: Date.now(), dia: hoje, total: feitas, mudaram };
  // Parou por causa de uma disputa: não conta como "atualizado hoje" (tenta de novo quando a disputa acabar).
  if (!pausada) guardar(CHAVE_ULTIMA, ultima);
  return { ...ultima, avisos, pausada, detalhes };
}
