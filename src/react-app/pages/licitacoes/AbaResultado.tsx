import { DownloadCloud, Loader2, Save, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { ETAPAS_EXECUCAO, MOTIVOS_PERDA, nomeEtapa, RESULTADOS_ITEM } from "../../../shared/negocio";
import type { ItemLicitacao, Licitacao } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Campo } from "../../components/Formulario";
import { avisar, CampoArea, CampoSelect, Vazio } from "../../components/Ui";
import { formatarMoeda, formatarNumero, paraNumero } from "../../formato";
import { link } from "../../rota";
import { temPonte } from "../../robo/ponte";
import { puxarESalvarResultado } from "./puxarResultado";

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
  execucoes = [],
  aoNovoEmpenho,
}: {
  licitacao: Licitacao;
  itens: ItemLicitacao[];
  podeEditar: boolean;
  aoMudar: () => Promise<void> | void;
  /** Empenhos desta licitação no Pós-ganho. */
  execucoes?: { id: number; etapa: string; numero_empenho: string | null }[];
  /** Licitação ganha: registrar mais um empenho. */
  aoNovoEmpenho?: () => void;
}) {
  const participando = itens.filter((i) => i.participar);
  const [linhas, setLinhas] = useState<Record<number, Linha>>({});
  const [geral, setGeral] = useState({ data_resultado: "", motivo_perda: "", observacao_resultado: "" });
  const [salvando, setSalvando] = useState(false);
  const [puxando, setPuxando] = useState(false);
  const [puxados, setPuxados] = useState<Record<number, string>>({});

  // Lê no Compras.gov.br (pelo aplicativo) a colocação, o seu valor e a situação de cada item e já salva, junto com o
  // resumo da disputa (data, motivo e observação). Nada para preencher na mão.
  async function puxar() {
    if (alteradas.length > 0 || geralMudou) {
      if (!confirm("Você tem alterações não salvas no resultado. Puxar do Compras.gov.br troca os itens pelo que está lá. Continuar?")) return;
    }
    setPuxando(true);
    try {
      const { preenchidos, semDados, situacoes } = await puxarESalvarResultado(licitacao, itens);
      if (!preenchidos) avisar(`O Compras.gov.br ainda não mostra a sua proposta nos itens${semDados.length ? ` ${semDados.join(", ")}` : ""}.`, "erro");
      else {
        await aoMudar();
        setPuxados(situacoes);
        avisar(`Resultado puxado do Compras.gov.br e salvo: ${preenchidos} item(ns)${semDados.length ? ` (sem dados: ${semDados.join(", ")})` : ""}, com o resumo da disputa.`);
      }
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setPuxando(false);
    }
  }

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
  const acompanhando = participando.filter((i) => linhas[i.id]?.resultado === "acompanhando");
  const semResultado = participando.filter((i) => !linhas[i.id]?.resultado);
  const valorGanho = ganhos.reduce((s, i) => s + (paraNumero(linhas[i.id].nosso_lance) ?? 0) * (i.quantidade ?? 0), 0);

  return (
    <>
      {/* Mini painel do resultado: itens por situação, valor ganho e os empenhos no Pós-ganho. */}
      <section className="cartao painel-resultado">
        <div className="painel-resultado-numeros">
          <div>
            <span>Disputados</span>
            <strong>{participando.length}</strong>
          </div>
          <div>
            <span>Ganhos</span>
            <strong className="texto-verde">{ganhos.length}</strong>
          </div>
          <div>
            <span>Acompanhando</span>
            <strong className="texto-amarelo">{acompanhando.length}</strong>
          </div>
          <div>
            <span>Perdidos</span>
            <strong className="texto-vermelho">{perdidos.length}</strong>
          </div>
          <div>
            <span>Sem resultado</span>
            <strong className="texto-fraco">{semResultado.length}</strong>
          </div>
          <div className="valor">
            <span>Valor ganho</span>
            <strong>{formatarMoeda(valorGanho)}</strong>
          </div>
        </div>
        {participando.length > 0 && (
          <div className="barra-resultado" aria-hidden="true">
            {ganhos.length > 0 && <i className="verde" style={{ flex: ganhos.length }} />}
            {acompanhando.length > 0 && <i className="amarelo" style={{ flex: acompanhando.length }} />}
            {perdidos.length > 0 && <i className="vermelho" style={{ flex: perdidos.length }} />}
            {semResultado.length > 0 && <i className="cinza" style={{ flex: semResultado.length }} />}
          </div>
        )}
        {(execucoes.length > 0 || aoNovoEmpenho) && (
          <div className="empenhos-resultado">
            {execucoes.map((e) => (
              <a key={e.id} className="link-empenho" {...link(`/pos-ganho/${e.id}`)}>
                <Trophy size={14} /> {e.numero_empenho ? `Empenho ${e.numero_empenho}` : "Empenho no Pós-ganho"} · {nomeEtapa(ETAPAS_EXECUCAO, e.etapa)}
              </a>
            ))}
            {aoNovoEmpenho && (
              <button className="botao-link sem-margem" onClick={aoNovoEmpenho}>
                + Registrar {execucoes.length ? "outro " : ""}empenho desta licitação
              </button>
            )}
          </div>
        )}
      </section>

      <section className="cartao">
        <div className="cartao-titulo">
          <h2>
            <Trophy size={17} /> Resultado por item
          </h2>
          {participando.length > 0 && podeEditar && (
            <button
              className="botao secundario pequeno"
              onClick={puxar}
              disabled={puxando || !temPonte()}
              title={temPonte() ? "Lê no Compras.gov.br a sua colocação, o seu valor e a situação de cada item" : "Abra a plataforma pelo aplicativo Montzion para puxar do Compras.gov.br"}
            >
              {puxando ? <Loader2 className="girando" size={15} /> : <DownloadCloud size={15} />} {puxando ? "Puxando do Compras.gov.br…" : "Puxar dados da licitação"}
            </button>
          )}
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
                      {puxados[i.id] && <small className="puxado-compras">Compras.gov.br: {puxados[i.id]}</small>}
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
