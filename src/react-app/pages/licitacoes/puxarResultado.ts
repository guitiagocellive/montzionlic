// "Puxar dados da licitação" (aba Resultado do quadro): lê no Compras.gov.br, pelo aplicativo, a sua colocação, o seu
// valor e a situação de cada item, e devolve o que preencher no resultado (quem salva é a pessoa).
import { type CompraAcomp, idEmpresa, type PropostaEmpresa } from "../../../shared/acompanhamento";
import type { ItemLicitacao, Licitacao } from "../../../shared/tipos";
import { api } from "../../api";
import { formatarMoeda } from "../../formato";
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

const AUTO = "Puxado do Compras.gov.br";

/**
 * Puxa do Compras.gov.br e já salva: o resultado de cada item e o resumo da disputa (data do resultado, motivo
 * principal e uma observação com o que veio de cada item). Não apaga o que a pessoa escreveu: a data e o motivo só
 * são preenchidos se estiverem vazios, e a observação só é trocada se estiver vazia ou tiver sido puxada antes.
 */
export async function puxarESalvarResultado(
  l: Licitacao,
  itens: ItemLicitacao[],
  opcoes: { automatico?: boolean } = {},
): Promise<{ preenchidos: number; alterados: number; semDados: string[]; situacoes: Record<number, string> }> {
  const { porItem, semDados } = await puxarDadosDaLicitacao(l, itens);
  const ids = Object.keys(porItem).map(Number);
  if (!ids.length) return { preenchidos: 0, alterados: 0, semDados, situacoes: {} };
  let alterados = 0;
  for (const id of ids) {
    const d = porItem[id];
    const atual = itens.find((i) => i.id === id);
    // Na atualização automática, um resultado já fechado (ganho, perdido, cancelado) não volta para "acompanhando".
    if (opcoes.automatico && atual?.resultado && atual.resultado !== "acompanhando" && d.resultado === "acompanhando") d.resultado = atual.resultado as typeof d.resultado;
    const corpo = {
      resultado: d.resultado,
      colocacao: d.colocacao,
      nosso_lance: d.nosso_lance,
      vencedor: d.resultado === "perdido" ? d.vencedor || null : null,
      valor_vencedor: d.resultado === "perdido" ? d.valor_vencedor : null,
      motivo_perda: d.resultado === "perdido" ? d.motivo_perda || null : null,
    };
    // Só grava o que mudou.
    const igual =
      atual &&
      (atual.resultado ?? null) === corpo.resultado &&
      (atual.colocacao ?? null) === corpo.colocacao &&
      (atual.nosso_lance ?? null) === corpo.nosso_lance &&
      (atual.vencedor ?? null) === corpo.vencedor &&
      (atual.valor_vencedor ?? null) === corpo.valor_vencedor &&
      (atual.motivo_perda ?? null) === corpo.motivo_perda;
    if (igual) continue;
    alterados++;
    await api(`/licitacoes/itens/${id}`, { metodo: "PATCH", corpo });
  }
  const lista = ids.map((id) => ({ item: itens.find((i) => i.id === id)!, d: porItem[id] }));
  const definidos = lista.filter((x) => x.d.resultado !== "acompanhando");
  const perdidos = lista.filter((x) => x.d.resultado === "perdido");
  // Motivo principal: o mais comum entre os itens perdidos (só se todos os itens já tiverem resultado).
  const contagem = new Map<string, number>();
  for (const x of perdidos) if (x.d.motivo_perda) contagem.set(x.d.motivo_perda, (contagem.get(x.d.motivo_perda) ?? 0) + 1);
  const motivo = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const hoje = new Date();
  const hojeTexto = hoje.toLocaleDateString("pt-BR");
  const linhas = lista
    .sort((a, b) => String(a.item.numero).localeCompare(String(b.item.numero), "pt-BR", { numeric: true }))
    .map(({ item, d }) => {
      const partes = [`Item ${item.numero}: ${d.colocacao ? `${d.colocacao}º` : "sem colocação"}`];
      if (d.nosso_lance != null) partes.push(`nosso valor ${formatarMoeda(d.nosso_lance)}`);
      if (d.resultado === "perdido" && d.vencedor) partes.push(`vencedor ${d.vencedor}${d.valor_vencedor != null ? ` (${formatarMoeda(d.valor_vencedor)})` : ""}`);
      partes.push(d.situacao);
      return partes.join(" · ");
    });
  const geral: Record<string, unknown> = {};
  if ((alterados > 0 && l.observacao_resultado?.startsWith(AUTO)) || !l.observacao_resultado) {
    geral.observacao_resultado = `${AUTO} em ${hojeTexto}${semDados.length ? ` (sem dados nos itens ${semDados.join(", ")})` : ""}:\n${linhas.join("\n")}`;
  }
  const todosDefinidos = definidos.length === itens.filter((i) => i.participar).length;
  if (!l.data_resultado && todosDefinidos) {
    geral.data_resultado = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  }
  if (!l.motivo_perda && todosDefinidos && motivo && perdidos.length === lista.length) geral.motivo_perda = motivo;
  if (Object.keys(geral).length) await api(`/licitacoes/${l.id}`, { metodo: "PATCH", corpo: geral });
  return { preenchidos: ids.length, alterados, semDados, situacoes: Object.fromEntries(ids.map((id) => [id, porItem[id].situacao])) };
}
