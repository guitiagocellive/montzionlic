import { BellRing, CheckCircle2, ChevronRight, ClipboardCheck, TrendingUp } from "lucide-react";
import type { AvisoAcomp } from "../../../shared/acompanhamento";
import type { LicitacaoResumo } from "../../../shared/tipos";
import { Modal } from "../../components/Ui";
import { link, navegar } from "../../rota";
import type { CompraAcomp } from "../../../shared/acompanhamento";
import { type CadastroNoPortal, compraDaLicitacao, type DetalheSinc } from "./sincronizarQuadro";

// Relatório do "Checar licitações": só o que importa. Primeiro o que pede resposta (convocação, mensagem do
// pregoeiro, desclassificação), depois o que mudou (colocação, ganho, perda) e as cadastradas direto no portal.

export interface DadosRelatorio {
  detalhes: DetalheSinc[];
  avisos: AvisoAcomp[];
  pausada: boolean;
  /** Cadastradas direto no portal (agora marcadas no quadro). */
  noPortal: CadastroNoPortal[];
  /** Participações no Compras.gov.br sem card no quadro. */
  foraDoQuadro: CompraAcomp[];
}


const nomeLic = (d: { numero: string | null; orgao: string | null }) => `${d.numero ? `Nº ${d.numero}` : "Licitação"}${d.orgao ? ` · ${d.orgao}` : ""}`;

export function RelatorioQuadro({ dados, licitacoes, aoFechar }: { dados: DadosRelatorio; licitacoes: LicitacaoResumo[]; aoFechar: () => void }) {
  const mudaram = dados.detalhes.filter((d) => d.mudancas.length > 0);
  const falhas = dados.detalhes.filter((d) => d.erro);
  // Só avisos que pedem atenção: convocação, mensagem urgente do pregoeiro, desclassificação/inabilitação.
  const urgentes = dados.avisos.filter((a) => a.urgente);
  const licDoAviso = (a: AvisoAcomp) => licitacoes.find((l) => compraDaLicitacao(a.compra, l));
  const nada = !urgentes.length && !mudaram.length && !dados.noPortal.length;

  return (
    <Modal titulo="Checagem das licitações" aoFechar={aoFechar} largo>
      <div className="relatorio-quadro">
        {dados.pausada && <p className="texto-suave resumo-relatorio">Parte da checagem ficou para depois: há uma disputa com lances acontecendo.</p>}

        {nada && (
          <div className="relatorio-vazio">
            <CheckCircle2 />
            <strong>Tudo em dia</strong>
            <span className="texto-suave">
              {dados.detalhes.length} licitação(ões) cadastrada(s) conferida(s): nenhuma convocação esperando resposta e nada mudou.
            </span>
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

        {dados.noPortal.length > 0 && (
          <section className="bloco-relatorio">
            <h3>
              <ClipboardCheck size={16} /> Cadastradas direto no portal
            </h3>
            <ul>
              {dados.noPortal.map((d) => (
                <li key={d.id}>
                  <div>
                    <strong>{nomeLic(d)}</strong>
                    <span className="texto-suave">A proposta foi cadastrada no Compras.gov.br fora da plataforma ({d.itens} item(ns)). Marquei como cadastrada no quadro.</span>
                  </div>
                  <button
                    className="botao secundario pequeno"
                    onClick={() => {
                      aoFechar();
                      navegar(`/licitacoes/${d.id}`);
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
          <p className="texto-fraco pequeno nota-relatorio">
            {falhas.length === 1 ? "1 licitação não pôde ser conferida" : `${falhas.length} licitações não puderam ser conferidas`}:{" "}
            {falhas.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ", "}
                <button
                  className="botao-link sem-margem"
                  title={d.erro}
                  onClick={() => {
                    aoFechar();
                    navegar(`/licitacoes/${d.id}?aba=dados`);
                  }}
                >
                  {d.numero ? `Nº ${d.numero}` : "licitação"}
                </button>
              </span>
            ))}{" "}
            (falta o link do PNCP ou a compra não foi achada).
          </p>
        )}
      </div>
    </Modal>
  );
}
