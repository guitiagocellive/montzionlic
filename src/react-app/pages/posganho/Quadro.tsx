import { CalendarClock, Package, Plus, Search } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { diasAte, ETAPAS_ANTES_DA_ENTREGA, ETAPAS_EXECUCAO } from "../../../shared/negocio";
import type { ExecucaoResumo, LicitacaoResumo } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Alerta } from "../../components/Formulario";
import { Kanban } from "../../components/Kanban";
import { avisar, CampoSelect, Carregando, Modal } from "../../components/Ui";
import { formatarDataCurta, formatarMoeda, hojeIso, textoPrazo } from "../../formato";
import { navegar } from "../../rota";

export function QuadroExecucao() {
  const [execucoes, setExecucoes] = useState<ExecucaoResumo[] | null>(null);
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState(false);

  async function carregar() {
    try {
      const { execucoes } = await api<{ execucoes: ExecucaoResumo[] }>("/execucoes");
      setExecucoes(execucoes);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return execucoes ?? [];
    return (execucoes ?? []).filter((e) =>
      [e.numero_empenho, e.orgao, e.licitacao_numero, e.uasg, e.nicho]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(termo)),
    );
  }, [execucoes, busca]);

  async function mover(card: ExecucaoResumo, etapa: string, posicao: number) {
    const anterior = execucoes;
    setExecucoes((ls) => ls!.map((e) => (e.id === card.id ? { ...e, etapa, posicao } : e)));
    try {
      await api(`/execucoes/${card.id}`, { metodo: "PATCH", corpo: { etapa, posicao } });
    } catch (err) {
      setExecucoes(anterior);
      avisar(mensagemDeErro(err), "erro");
    }
  }

  const hoje = hojeIso();

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Pós-ganho</span>
          <h1>Empenhos e entregas</h1>
          <p className="texto-suave">
            Licitações ganhas entram aqui sozinhas. Cada card é um empenho, do recebimento até o atestado.
          </p>
        </div>
        <button className="botao" onClick={() => setNovo(true)}>
          <Plus aria-hidden="true" /> Novo empenho
        </button>
      </div>

      <div className="barra-filtros entrar" style={{ ["--i" as string]: 1 }}>
        <div className="entrada com-icone busca">
          <Search aria-hidden="true" />
          <input
            placeholder="Buscar por empenho, órgão, licitação…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar empenhos"
          />
        </div>
      </div>

      {execucoes === null ? (
        <Carregando />
      ) : (
        <div className="entrar" style={{ ["--i" as string]: 2 }}>
          <Kanban
            etapas={ETAPAS_EXECUCAO}
            cards={filtradas}
            aoAbrir={(c) => navegar(`/pos-ganho/${c.id}`)}
            aoMover={mover}
            rodapeColuna={(_, cards) => {
              const total = cards.reduce((s, c) => s + (c.valor_total ?? 0), 0);
              return total > 0 ? <div className="coluna-rodape">{formatarMoeda(total)}</div> : null;
            }}
            renderCard={(e) => {
              const dias = e.data_limite ? diasAte(e.data_limite, hoje) : null;
              const pendente = ETAPAS_ANTES_DA_ENTREGA.includes(e.etapa);
              const classe =
                dias == null || !pendente ? "" : dias < 0 ? "passou" : dias <= 2 ? "urgente" : dias <= 7 ? "proximo" : "";
              return (
                <>
                  <div className="card-etiquetas">
                    {e.modalidade && <span className="chip">{e.modalidade}</span>}
                    {e.registro_preco === 1 && <span className="chip destaque">SRP</span>}
                  </div>
                  <h4 className="card-titulo">
                    {e.numero_empenho ? `Empenho ${e.numero_empenho}` : "Aguardando nº do empenho"}
                  </h4>
                  <p className="card-orgao">{e.orgao || "Órgão não informado"}</p>
                  <p className="card-objeto">Licitação nº {e.licitacao_numero || "—"}</p>
                  {e.data_limite && (
                    <div className={`card-sessao ${classe}`}>
                      <CalendarClock aria-hidden="true" />
                      <span>Entrega até {formatarDataCurta(e.data_limite)}</span>
                      {pendente && dias != null && <strong>{dias < 0 ? "Atrasado" : textoPrazo(dias)}</strong>}
                    </div>
                  )}
                  <div className="card-rodape">
                    <div className="card-contadores">
                      <span title="Itens">
                        <Package aria-hidden="true" /> {e.total_itens}
                      </span>
                    </div>
                    {e.valor_total > 0 && <strong className="card-valor">{formatarMoeda(e.valor_total)}</strong>}
                  </div>
                </>
              );
            }}
          />
        </div>
      )}

      {novo && <ModalNovoEmpenho aoFechar={() => setNovo(false)} />}
    </>
  );
}

function ModalNovoEmpenho({ aoFechar }: { aoFechar: () => void }) {
  const [ganhas, setGanhas] = useState<LicitacaoResumo[] | null>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<{ licitacoes: LicitacaoResumo[] }>("/licitacoes").then(
      (r) => setGanhas(r.licitacoes.filter((l) => l.etapa === "ganha")),
      (err) => setErro(mensagemDeErro(err)),
    );
  }, []);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErro("");
    setEnviando(true);
    try {
      const { execucao } = await api<{ execucao: { id: number } }>("/execucoes", {
        corpo: { licitacao_id: Number(f.get("licitacao_id")), numero_empenho: f.get("numero_empenho") },
      });
      navegar(`/pos-ganho/${execucao.id}`);
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Novo empenho" aoFechar={aoFechar}>
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <p className="texto-suave pequeno" style={{ margin: 0 }}>
          Use para um novo empenho de uma licitação já ganha (por exemplo, mais um pedido de um registro de preço).
        </p>
        {ganhas === null ? (
          <Carregando />
        ) : ganhas.length === 0 ? (
          <Alerta>Nenhuma licitação na etapa "Ganhas" ainda.</Alerta>
        ) : (
          <>
            <CampoSelect
              rotulo="Licitação ganha"
              name="licitacao_id"
              required
              opcoes={ganhas.map((l) => ({
                valor: l.id,
                texto: `Nº ${l.numero ?? "—"} · ${l.orgao ?? "Órgão não informado"}`,
              }))}
            />
            <div className="campo">
              <label htmlFor="numero_empenho">
                <span className="texto-suave pequeno">Número do empenho (opcional)</span>
              </label>
              <div className="entrada">
                <input id="numero_empenho" name="numero_empenho" placeholder="2026NE000123" />
              </div>
            </div>
          </>
        )}
        <div className="botoes-modal">
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao" disabled={enviando || !ganhas?.length}>
            {enviando ? "Criando…" : "Criar empenho"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
