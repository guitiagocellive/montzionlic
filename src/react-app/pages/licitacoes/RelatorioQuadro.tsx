import { BellRing, CheckCircle2, ChevronRight, CircleAlert, RefreshCw, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { AvisoAcomp } from "../../../shared/acompanhamento";
import type { LicitacaoResumo } from "../../../shared/tipos";
import { Modal } from "../../components/Ui";
import { link, navegar } from "../../rota";
import { chaveDoLink } from "./comprasCadastro";
import type { DetalheSinc } from "./sincronizarQuadro";

// Relatório do "Checar licitações": só o que importa. Primeiro o que pede resposta (convocação, mensagem do
// pregoeiro, desclassificação), depois o que mudou (colocação, ganho, perda); o resto vira uma linha de resumo.

export interface DadosRelatorio {
  detalhes: DetalheSinc[];
  avisos: AvisoAcomp[];
  pausada: boolean;
}

/** A compra (chave de 17 dígitos) é desta licitação? Pelo link ou por UASG + número/ano. */
export function compraDaLicitacao(chave: string, l: Pick<LicitacaoResumo, "link" | "uasg" | "numero">) {
  const doLink = chaveDoLink(l.link ?? null);
  if (doLink) return doLink === chave;
  const [num, ano] = String(l.numero ?? "").split("/");
  if (!l.uasg || !num || !ano) return false;
  return chave.slice(0, 6) === l.uasg.padStart(6, "0") && Number(chave.slice(8, 13)) === Number(num.replace(/\D/g, "")) && chave.slice(13) === ano.trim();
}

const nomeLic = (d: { numero: string | null; orgao: string | null }) => `${d.numero ? `Nº ${d.numero}` : "Licitação"}${d.orgao ? ` · ${d.orgao}` : ""}`;

export function RelatorioQuadro({ dados, licitacoes, aoFechar }: { dados: DadosRelatorio; licitacoes: LicitacaoResumo[]; aoFechar: () => void }) {
  const [verSemMudanca, setVerSemMudanca] = useState(false);
  const mudaram = dados.detalhes.filter((d) => d.mudancas.length > 0);
  const semMudanca = dados.detalhes.filter((d) => !d.mudancas.length && !d.erro);
  const falhas = dados.detalhes.filter((d) => d.erro);
  // Só avisos que pedem atenção: convocação, mensagem urgente do pregoeiro, desclassificação/inabilitação.
  const urgentes = dados.avisos.filter((a) => a.urgente);
  const licDoAviso = (a: AvisoAcomp) => licitacoes.find((l) => compraDaLicitacao(a.compra, l));
  const nada = !urgentes.length && !mudaram.length && !falhas.length;

  return (
    <Modal titulo="Checagem das licitações" aoFechar={aoFechar} largo>
      <div className="relatorio-quadro">
        <p className="texto-suave resumo-relatorio">
          {dados.detalhes.length} licitação(ões) conferida(s) no Compras.gov.br · {mudaram.length} mudaram · {urgentes.length} pedem atenção
          {dados.pausada && " · pausada: há uma disputa com lances acontecendo (continua depois)"}
        </p>

        {nada && (
          <div className="relatorio-vazio">
            <CheckCircle2 />
            <strong>Tudo em dia</strong>
            <span className="texto-suave">Nenhuma convocação esperando resposta e nada mudou desde a última checagem.</span>
          </div>
        )}

        {urgentes.length > 0 && (
          <section className="bloco-relatorio urgente">
            <h3>
              <BellRing size={16} /> Precisa de resposta
            </h3>
            <ul>
              {urgentes.map((a) => {
                const l = licDoAviso(a);
                return (
                  <li key={a.chave}>
                    <div>
                      <strong>{a.titulo}</strong>
                      <span className="texto-suave">{a.mensagem}</span>
                      {l && <span className="texto-fraco pequeno">{nomeLic(l)}</span>}
                    </div>
                    <a className="botao secundario pequeno" {...link(`/licitacoes/acompanhamento?compra=${a.compra}`)} onClick={(e) => (aoFechar(), link(`/licitacoes/acompanhamento?compra=${a.compra}`).onClick(e))}>
                      {/^(Convocação|Mensagem)/.test(a.titulo) ? "Responder" : "Ver"} <ChevronRight size={14} />
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {mudaram.length > 0 && (
          <section className="bloco-relatorio">
            <h3>
              <TrendingUp size={16} /> O que mudou
            </h3>
            <ul>
              {mudaram.map((d) => (
                <li key={d.id}>
                  <div>
                    <strong>{nomeLic(d)}</strong>
                    {d.mudancas.map((m) => (
                      <span key={m} className={/perdido/.test(m) ? "texto-vermelho" : /ganho/.test(m) ? "texto-verde" : ""}>
                        {m}
                      </span>
                    ))}
                  </div>
                  <button
                    className="botao secundario pequeno"
                    onClick={() => {
                      aoFechar();
                      navegar(`/licitacoes/${d.id}?aba=resultado`);
                    }}
                  >
                    Abrir <ChevronRight size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {falhas.length > 0 && (
          <section className="bloco-relatorio">
            <h3>
              <CircleAlert size={16} /> Não deu para conferir
            </h3>
            <ul>
              {falhas.map((d) => (
                <li key={d.id}>
                  <div>
                    <strong>{nomeLic(d)}</strong>
                    <span className="texto-suave">{d.erro}</span>
                  </div>
                  <button
                    className="botao secundario pequeno"
                    onClick={() => {
                      aoFechar();
                      navegar(`/licitacoes/${d.id}?aba=dados`);
                    }}
                  >
                    Ajustar <ChevronRight size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {semMudanca.length > 0 && (
          <p className="texto-fraco pequeno sem-mudanca-relatorio">
            <RefreshCw size={13} /> {semMudanca.length} sem mudança{" "}
            <button className="botao-link sem-margem" onClick={() => setVerSemMudanca((v) => !v)}>
              {verSemMudanca ? "esconder" : "ver quais"}
            </button>
            {verSemMudanca && <span className="lista-sem-mudanca">{semMudanca.map((d) => `${nomeLic(d)}${d.colocacao ? ` (${d.colocacao}º)` : ""}`).join(" · ")}</span>}
          </p>
        )}
      </div>
    </Modal>
  );
}
