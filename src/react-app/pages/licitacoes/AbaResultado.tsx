import { Save, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { MOTIVOS_PERDA, RESULTADOS_ITEM } from "../../../shared/negocio";
import type { ItemLicitacao, Licitacao } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Campo } from "../../components/Formulario";
import { avisar, CampoArea, CampoSelect, Vazio } from "../../components/Ui";
import { formatarMoeda, formatarNumero, paraNumero } from "../../formato";

type Linha = {
  resultado: string;
  colocacao: string;
  nosso_lance: string;
  vencedor: string;
  valor_vencedor: string;
  motivo_perda: string;
};

const paraLinha = (i: ItemLicitacao): Linha => ({
  resultado: i.resultado ?? "",
  colocacao: i.colocacao == null ? "" : String(i.colocacao),
  nosso_lance: i.nosso_lance == null ? "" : String(i.nosso_lance),
  vencedor: i.vencedor ?? "",
  valor_vencedor: i.valor_vencedor == null ? "" : String(i.valor_vencedor),
  motivo_perda: i.motivo_perda ?? "",
});

export function AbaResultado({
  licitacao,
  itens,
  podeEditar,
  aoMudar,
}: {
  licitacao: Licitacao;
  itens: ItemLicitacao[];
  podeEditar: boolean;
  aoMudar: () => Promise<void> | void;
}) {
  const participando = itens.filter((i) => i.participar);
  const [linhas, setLinhas] = useState<Record<number, Linha>>({});
  const [geral, setGeral] = useState({ data_resultado: "", motivo_perda: "", observacao_resultado: "" });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setLinhas(Object.fromEntries(participando.map((i) => [i.id, paraLinha(i)])));
    setGeral({
      data_resultado: licitacao.data_resultado ?? "",
      motivo_perda: licitacao.motivo_perda ?? "",
      observacao_resultado: licitacao.observacao_resultado ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, licitacao]);

  const mudar = (id: number, novo: Partial<Linha>) => setLinhas((l) => ({ ...l, [id]: { ...l[id], ...novo } }));

  const alteradas = participando.filter((i) => JSON.stringify(linhas[i.id]) !== JSON.stringify(paraLinha(i)));
  const geralMudou =
    geral.data_resultado !== (licitacao.data_resultado ?? "") ||
    geral.motivo_perda !== (licitacao.motivo_perda ?? "") ||
    geral.observacao_resultado !== (licitacao.observacao_resultado ?? "");

  async function salvar() {
    setSalvando(true);
    try {
      for (const i of alteradas) {
        const l = linhas[i.id];
        await api(`/licitacoes/itens/${i.id}`, {
          metodo: "PATCH",
          corpo: {
            resultado: l.resultado || null,
            colocacao: paraNumero(l.colocacao) == null ? null : Math.round(paraNumero(l.colocacao)!),
            nosso_lance: paraNumero(l.nosso_lance),
            vencedor: l.resultado === "perdido" ? l.vencedor : null,
            valor_vencedor: l.resultado === "perdido" ? paraNumero(l.valor_vencedor) : null,
            motivo_perda: l.resultado === "perdido" ? l.motivo_perda || null : null,
          },
        });
      }
      if (geralMudou) await api(`/licitacoes/${licitacao.id}`, { metodo: "PATCH", corpo: geral });
      avisar("Resultado salvo.");
      await aoMudar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setSalvando(false);
    }
  }

  const ganhos = participando.filter((i) => linhas[i.id]?.resultado === "ganho");
  const perdidos = participando.filter((i) => linhas[i.id]?.resultado === "perdido");
  const valorGanho = ganhos.reduce((s, i) => s + (paraNumero(linhas[i.id].nosso_lance) ?? 0) * (i.quantidade ?? 0), 0);

  return (
    <>
      <div className="resumo-linha">
        <div className="mini-indicador">
          <span>Itens disputados</span>
          <strong>{participando.length}</strong>
        </div>
        <div className="mini-indicador">
          <span>Ganhamos</span>
          <strong className="texto-verde">{ganhos.length}</strong>
        </div>
        <div className="mini-indicador">
          <span>Perdemos</span>
          <strong className="texto-vermelho">{perdidos.length}</strong>
        </div>
        <div className="mini-indicador">
          <span>Valor ganho</span>
          <strong>{formatarMoeda(valorGanho)}</strong>
        </div>
      </div>

      <section className="cartao">
        <div className="cartao-titulo">
          <h2>
            <Trophy size={17} /> Resultado por item
          </h2>
        </div>
        <p className="descricao">Registre como foi a disputa. Isso alimenta o histórico de concorrentes e os relatórios.</p>
        {participando.length === 0 ? (
          <Vazio icone={<Trophy />} titulo="Nenhum item marcado para participar" />
        ) : (
          <div className="lista-resultados">
            {participando.map((i) => {
              const l = linhas[i.id];
              if (!l) return null;
              return (
                <div key={i.id} className={`linha-resultado ${l.resultado}`}>
                  <div className="linha-resultado-topo">
                    <span className="numero-item">{i.numero || "—"}</span>
                    <span className="linha-resultado-descricao">
                      {i.descricao || "Sem descrição"}
                      <small className="texto-fraco">
                        Qtd {formatarNumero(i.quantidade)} {i.unidade} · Ref. {formatarMoeda(i.valor_referencia)}
                      </small>
                    </span>
                    <div className="segmentado">
                      {RESULTADOS_ITEM.map((r) => (
                        <button
                          key={r.chave}
                          className={l.resultado === r.chave ? "ativo" : ""}
                          disabled={!podeEditar}
                          onClick={() => mudar(i.id, { resultado: l.resultado === r.chave ? "" : r.chave })}
                        >
                          {r.nome}
                        </button>
                      ))}
                    </div>
                  </div>
                  {l.resultado && l.resultado !== "cancelado" && (
                    <div className={`grade-resultado ${l.resultado === "perdido" ? "perdido" : ""}`}>
                      <Campo rotulo="Colocação" name={`col-${i.id}`} type="number" min="1" value={l.colocacao} onChange={(e) => mudar(i.id, { colocacao: e.target.value })} disabled={!podeEditar} />
                      <Campo rotulo="Nosso lance final (unit.)" name={`lance-${i.id}`} type="number" step="0.01" min="0" value={l.nosso_lance} onChange={(e) => mudar(i.id, { nosso_lance: e.target.value })} disabled={!podeEditar} />
                      {l.resultado === "perdido" && (
                        <>
                          <Campo rotulo="Empresa vencedora" name={`venc-${i.id}`} value={l.vencedor} onChange={(e) => mudar(i.id, { vencedor: e.target.value })} disabled={!podeEditar} />
                          <Campo rotulo="Valor vencedor (unit.)" name={`vv-${i.id}`} type="number" step="0.01" min="0" value={l.valor_vencedor} onChange={(e) => mudar(i.id, { valor_vencedor: e.target.value })} disabled={!podeEditar} />
                          <CampoSelect rotulo="Motivo" value={l.motivo_perda} onChange={(e) => mudar(i.id, { motivo_perda: e.target.value })} vazio="Selecione" opcoes={MOTIVOS_PERDA} disabled={!podeEditar} />
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="cartao">
        <h2>Resumo da disputa</h2>
        <div className="grade-2">
          <Campo rotulo="Data do resultado" name="data_resultado" type="date" value={geral.data_resultado} onChange={(e) => setGeral((g) => ({ ...g, data_resultado: e.target.value }))} disabled={!podeEditar} />
          <CampoSelect
            rotulo="Motivo principal (se perdemos)"
            value={geral.motivo_perda}
            onChange={(e) => setGeral((g) => ({ ...g, motivo_perda: e.target.value }))}
            vazio="—"
            opcoes={MOTIVOS_PERDA}
            disabled={!podeEditar}
          />
        </div>
        <div style={{ marginTop: 14 }}>
          <CampoArea rotulo="Observações" rows={3} value={geral.observacao_resultado} onChange={(e) => setGeral((g) => ({ ...g, observacao_resultado: e.target.value }))} disabled={!podeEditar} />
        </div>
      </section>

      {podeEditar && (
        <div className={`barra-salvar ${alteradas.length > 0 || geralMudou ? "visivel" : ""}`}>
          <span>Você tem alterações não salvas no resultado.</span>
          <button className="botao" onClick={salvar} disabled={salvando}>
            <Save /> {salvando ? "Salvando…" : "Salvar resultado"}
          </button>
        </div>
      )}
    </>
  );
}
