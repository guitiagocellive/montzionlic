// "Puxar dados da licitação" (aba Resultado do quadro): lê no Compras.gov.br, pelo aplicativo, a sua colocação, o seu
// valor e a situação de cada item, e devolve o que preencher no resultado (quem salva é a pessoa).
import { type CompraAcomp, idEmpresa, type PropostaEmpresa } from "../../../shared/acompanhamento";
import type { ItemLicitacao, Licitacao } from "../../../shared/tipos";
import { ponte } from "../../robo/ponte";
import { buscarCompras, chaveDoLink } from "./comprasCadastro";
import { analisarPropostas, carregarPropostas, pedir } from "./ItemCompras";

export interface ResultadoPuxado {
  resultado: "ganho" | "perdido" | "acompanhando";
  colocacao: number | null;
  nosso_lance: number | null;
  vencedor: string;
  valor_vencedor: number | null;
  motivo_perda: string;
  /** Explicação curta do que veio do Compras (situação). */
  situacao: string;
}

const valorDe = (p: PropostaEmpresa | null | undefined) => (p ? (p.valorNegociado ?? p.valorOfertado ?? p.valor) : null);

/** A compra desta licitação no Compras.gov.br (pelo link do PNCP ou procurando número + UASG). */
export async function chaveDaLicitacao(l: Licitacao): Promise<string> {
  const direta = chaveDoLink(l.link) || chaveDoLink(l.observacoes);
  if (direta) return direta;
  if (!l.numero || !l.uasg) throw new Error("Preencha o número e a UASG da licitação para achar a compra no Compras.gov.br.");
  const achadas = await buscarCompras(l.numero, l.uasg);
  if (!achadas.length) throw new Error(`Não achei a compra ${l.numero} da UASG ${l.uasg} no Compras.gov.br.`);
  if (achadas.length > 1) throw new Error(`Achei ${achadas.length} compras com o número ${l.numero} na UASG ${l.uasg}: coloque o link do PNCP na licitação para eu saber qual é.`);
  return achadas[0].chave;
}

export async function puxarDadosDaLicitacao(l: Licitacao, itens: ItemLicitacao[]): Promise<{ porItem: Record<number, ResultadoPuxado>; semDados: string[] }> {
  const chave = await chaveDaLicitacao(l);
  // A sua empresa: a da sua participação nesta compra (e, se não vier, a do login).
  const part = await pedir({ caminho: `/comprasnet-fase-externa/v1/compras/${chave}/participacao` }).catch(() => null);
  const participante = (part?.dados as { participante?: { identificacao?: unknown } } | undefined)?.participante;
  let cnpj = idEmpresa(participante?.identificacao);
  if (!cnpj) cnpj = idEmpresa((await ponte.acompanhamento().catch(() => null))?.cnpj);
  const compra = { chave } as CompraAcomp;
  const porItem: Record<number, ResultadoPuxado> = {};
  const semDados: string[] = [];
  for (const it of itens.filter((i) => i.participar)) {
    const n = Number.parseInt(String(it.numero ?? "").replace(/\D/g, ""), 10);
    if (!Number.isFinite(n)) continue;
    const dados = await carregarPropostas(compra, n, cnpj).catch(() => null);
    const minha = dados?.minha ?? null;
    if (!dados || !minha) {
      semDados.push(String(it.numero));
      continue;
    }
    const analise = analisarPropostas(dados, cnpj);
    const adjudicada = dados.todas.find((p) => p.codigo === "6") ?? null;
    let resultado: ResultadoPuxado["resultado"] = "acompanhando";
    let motivo = "";
    let vencedor: PropostaEmpresa | null = null;
    let situacao =
      minha.situacao ||
      (minha.pendencias.length
        ? `Convocada: ${minha.pendencias.map((x) => x.rotulo.toLowerCase()).join(", ")}`
        : dados.aviso && /julgamento/i.test(dados.aviso)
          ? "Disputa encerrada, aguardando o julgamento"
          : analise?.souPrimeira
            ? "1ª colocada — aguardando o pregoeiro analisar"
            : analise?.posicaoValida
              ? `${analise.posicaoValida}ª entre as propostas válidas`
              : "Em andamento");
    if (minha.codigo === "6") {
      resultado = "ganho";
      situacao = "Adjudicada para você";
    } else if (minha.desclassificada || minha.codigo === "5") {
      resultado = "perdido";
      motivo = minha.codigo === "5" ? "Inabilitação (documentação)" : "Desclassificação técnica";
      vencedor = adjudicada ?? analise?.primeiraValida ?? null;
    } else if (adjudicada && adjudicada.cnpj !== cnpj) {
      resultado = "perdido";
      motivo = "Preço";
      vencedor = adjudicada;
      situacao = `Adjudicada para ${adjudicada.empresa}`;
    }
    porItem[it.id] = {
      resultado,
      colocacao: analise?.minhaColocacao ?? minha.colocacao ?? null,
      nosso_lance: valorDe(minha),
      vencedor: vencedor?.empresa ?? "",
      valor_vencedor: valorDe(vencedor),
      motivo_perda: motivo,
      situacao: minha.motivo ? `${situacao} — ${minha.motivo}` : situacao,
    };
  }
  return { porItem, semDados };
}
