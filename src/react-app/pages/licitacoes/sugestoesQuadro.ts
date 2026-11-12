// Liga a compra do Compras.gov.br à licitação do quadro: valor, marca e modelo de cada item vêm do orçamento
// (e da aba Proposta), com o valor de referência do órgão mandando no cadastro.

import { cotacaoDaProposta } from "../../../shared/negocio";
import type { Cotacao, ItemLicitacao, Licitacao, LicitacaoResumo, RascunhoProposta } from "../../../shared/tipos";
import { api } from "../../api";
import { chaveDoLink, type ItemProposta, paraNumero, type Sugestao, valorSugerido } from "./comprasCadastro";

export interface FichaQuadro {
  licitacao: Licitacao;
  itens: ItemLicitacao[];
  cotacoes: Cotacao[];
}

export interface SugestaoItem extends Sugestao {
  /** O item existe na licitação do quadro. */
  noQuadro: boolean;
  /** Quantidade do edital (do item da licitação no quadro). */
  quantidade: number | null;
  participar: boolean;
}

const semZeros = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");

export function sugestoesDoQuadro(itensCompras: ItemProposta[], ficha: FichaQuadro, rascunho: RascunhoProposta | null): Map<number, SugestaoItem> {
  const { licitacao: l, itens, cotacoes } = ficha;
  const porNumero = new Map(itens.map((i) => [semZeros(i.numero), i]));
  const saida = new Map<number, SugestaoItem>();
  for (const it of itensCompras) {
    const nosso = porNumero.get(String(it.numero));
    if (!nosso) {
      saida.set(it.numero, { ...valorSugerido(it, { venda: null, custo: null, valorDigitado: null, marca: "", modelo: "" }), noQuadro: false, participar: false, quantidade: null });
      continue;
    }
    const escolhida = cotacaoDaProposta(cotacoes, nosso, l.imposto_percentual, l.lucro_percentual);
    const r = rascunho?.itens?.[String(nosso.id)];
    // O Compras.gov.br não mostrou o valor, mas o edital (PNCP) trouxe: usa o do edital como referência.
    const comQtd: ItemProposta = it.quantidade == null && nosso.quantidade != null ? { ...it, quantidade: nosso.quantidade } : it;
    const comEdital: ItemProposta =
      it.referencia.tipo === "nao-informado" && nosso.valor_referencia != null && nosso.valor_referencia > 0
        ? { ...comQtd, referencia: { tipo: "valor", valor: nosso.valor_referencia }, valorEstimado: nosso.valor_referencia }
        : comQtd;
    const s = valorSugerido(comEdital, {
      venda: escolhida ? escolhida.calculo.precoVenda : null,
      custo: escolhida ? escolhida.calculo.precoMinimo : null,
      valorDigitado: r?.valor ? paraNumero(r.valor) : null,
      marca: (r?.marca || escolhida?.cotacao.marca || "").trim(),
      modelo: (escolhida?.cotacao.produto || "").trim(),
    });
    const participar = !!nosso.participar && r?.incluir !== false;
    if (comEdital !== comQtd) s.origem = "Valor de referência do edital";
    saida.set(it.numero, { ...s, noQuadro: true, participar, quantidade: nosso.quantidade });
  }
  return saida;
}

export async function carregarFicha(id: number): Promise<{ ficha: FichaQuadro; rascunho: RascunhoProposta | null }> {
  const [ficha, r] = await Promise.all([
    api<FichaQuadro>(`/licitacoes/${id}`),
    api<{ rascunho: RascunhoProposta | null }>(`/licitacoes/${id}/proposta/rascunho`).catch(() => ({ rascunho: null })),
  ]);
  return { ficha, rascunho: r.rascunho };
}

/** A licitação do quadro que é esta compra (mesma UASG, número e ano), se houver. */
export async function licitacaoDaCompra(chave: string): Promise<number | null> {
  const { licitacoes } = await api<{ licitacoes: (LicitacaoResumo & { link?: string | null })[] }>("/licitacoes");
  const uasg = chave.slice(0, 6).replace(/^0+/, "");
  const numero = chave.slice(8, 13).replace(/^0+(?=\d)/, "");
  const ano = chave.slice(13);
  const achada = licitacoes.find((l) => {
    if (chaveDoLink(l.link) === chave) return true;
    const [n, a] = (l.numero ?? "").split("/");
    return semZeros(l.uasg) === uasg && semZeros(n) === numero && (!a || a.replace(/\D/g, "").slice(-4) === ano || `20${a.replace(/\D/g, "")}` === ano);
  });
  return achada?.id ?? null;
}
