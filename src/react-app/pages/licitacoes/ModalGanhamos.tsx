import { Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { cotacaoDaProposta } from "../../../shared/negocio";
import type { Cotacao, ItemLicitacao, Licitacao, RascunhoProposta } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Alerta } from "../../components/Formulario";
import { Modal } from "../../components/Ui";
import { formatarMoeda, formatarNumero, paraNumero } from "../../formato";

type Situacao = "ganho" | "acompanhando" | "perdido" | "cancelado" | "";
type Linha = { situacao: Situacao; valor: string };

/** "Quais itens ganhamos?" — marca o resultado de cada item antes de mover para Ganhas. */
export function ModalGanhamos({
  licitacao,
  itens,
  cotacoes,
  aoFechar,
  aoConfirmar,
}: {
  licitacao: Licitacao;
  itens: ItemLicitacao[];
  cotacoes: Cotacao[];
  aoFechar: () => void;
  aoConfirmar: () => Promise<void>;
}) {
  const participando = itens.filter((i) => i.participar);
  const [linhas, setLinhas] = useState<Record<number, Linha>>({});
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Valor sugerido: lance já registrado > valor da proposta > preço do produto que vai na proposta.
  useEffect(() => {
    const sugerido = (i: ItemLicitacao, rascunho: RascunhoProposta | null) => {
      if (i.nosso_lance != null) return String(i.nosso_lance);
      const daProposta = rascunho?.itens?.[i.id]?.valor;
      if (daProposta) return daProposta;
      const escolhida = cotacaoDaProposta(cotacoes, i, licitacao.imposto_percentual, licitacao.lucro_percentual);
      return escolhida ? escolhida.calculo.precoVenda.toFixed(2) : "";
    };
    const montar = (rascunho: RascunhoProposta | null) =>
      setLinhas(
        Object.fromEntries(
          participando.map((i) => [i.id, { situacao: (i.resultado ?? (participando.length === 1 ? "ganho" : "")) as Situacao, valor: sugerido(i, rascunho) }]),
        ),
      );
    api<{ rascunho: RascunhoProposta | null }>(`/licitacoes/${licitacao.id}/proposta/rascunho`).then(
      (r) => montar(r.rascunho),
      () => montar(null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mudar = (id: number, novo: Partial<Linha>) => setLinhas((l) => ({ ...l, [id]: { ...l[id], ...novo } }));
  const ganhos = participando.filter((i) => linhas[i.id]?.situacao === "ganho");
  const total = ganhos.reduce((s, i) => s + (paraNumero(linhas[i.id].valor) ?? 0) * (i.quantidade ?? 0), 0);

  async function confirmar() {
    if (ganhos.length === 0) {
      setErro("Marque pelo menos um item que ganhamos.");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      for (const i of participando) {
        const l = linhas[i.id];
        const resultado = l.situacao || null;
        const lance = paraNumero(l.valor);
        if (resultado === (i.resultado ?? null) && (resultado !== "ganho" || lance === i.nosso_lance)) continue;
        await api(`/licitacoes/itens/${i.id}`, {
          metodo: "PATCH",
          corpo: { resultado, ...(resultado === "ganho" ? { nosso_lance: lance } : {}) },
        });
      }
      await aoConfirmar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setSalvando(false);
    }
  }

  return (
    <Modal titulo="Quais itens ganhamos?" aoFechar={aoFechar} largo>
      <p className="texto-suave pequeno" style={{ marginTop: 0 }}>
        Só os itens marcados como <strong>ganhos</strong> vão para o empenho no Pós-ganho, com o valor final abaixo. Os outros
        ficam como acompanhando, perdidos ou cancelados.
      </p>
      <Alerta>{erro}</Alerta>
      <div className="lista-ganhamos">
        {participando.map((i) => {
          const l = linhas[i.id];
          if (!l) return null;
          return (
            <div key={i.id} className={`linha-ganhamos ${l.situacao}`}>
              <span className="numero-item">{i.numero || "—"}</span>
              <span className="linha-ganhamos-descricao">
                {i.descricao || "Sem descrição"}
                <small className="texto-fraco">
                  {formatarNumero(i.quantidade)} {i.unidade}
                </small>
              </span>
              <div className="segmentado pequeno">
                {(
                  [
                    ["ganho", "Ganhamos"],
                    ["acompanhando", "Acompanhando"],
                    ["perdido", "Perdemos"],
                    ["cancelado", "Cancelado"],
                  ] as const
                ).map(([chave, nome]) => (
                  <button key={chave} className={l.situacao === chave ? "ativo" : ""} onClick={() => mudar(i.id, { situacao: l.situacao === chave ? "" : chave })}>
                    {nome}
                  </button>
                ))}
              </div>
              <div className="entrada valor-ganho" hidden={l.situacao !== "ganho"}>
                <input type="number" step="0.01" min="0" value={l.valor} onChange={(e) => mudar(i.id, { valor: e.target.value })} placeholder="Valor final unit." aria-label="Valor final unitário" />
              </div>
            </div>
          );
        })}
      </div>
      <div className="total-proposta">
        <span>{ganhos.length} item(ns) ganho(s) · Valor ganho</span>
        <strong>{formatarMoeda(total)}</strong>
      </div>
      <div className="botoes-modal">
        <button className="botao secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button className="botao acento" onClick={confirmar} disabled={salvando}>
          <Trophy /> {salvando ? "Salvando…" : "Confirmar e mover para Ganhas"}
        </button>
      </div>
    </Modal>
  );
}
