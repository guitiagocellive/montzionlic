import { CalendarClock, Package, Plus, Search } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { diasAte, ETAPAS_ANTES_DA_ENTREGA, ETAPAS_EXECUCAO, MODALIDADES } from "../../../shared/negocio";
import { podeEditar } from "../../../shared/permissoes";
import type { ExecucaoResumo, LicitacaoResumo, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Avatar } from "../../components/Avatar";
import { Alerta, Campo } from "../../components/Formulario";
import { Kanban } from "../../components/Kanban";
import { avisar, CampoSelect, Carregando, Interruptor, Modal } from "../../components/Ui";
import { formatarDataCurta, formatarMoeda, hojeIso, textoPrazo } from "../../formato";
import { navegar } from "../../rota";

export function QuadroExecucao({ usuario }: { usuario: Usuario }) {
  const editar = podeEditar(usuario.permissoes, "posganho");
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
        {editar && (
          <button className="botao" onClick={() => setNovo(true)}>
            <Plus aria-hidden="true" /> Novo empenho
          </button>
        )}
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
            somenteLeitura={!editar}
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
                    <span className="card-rodape-dir">
                      {e.valor_total > 0 && <strong className="card-valor">{formatarMoeda(e.valor_total)}</strong>}
                      {e.responsavel_nome && (
                        <span title={`Responsável: ${e.responsavel_nome}`}>
                          <Avatar nome={e.responsavel_nome} cor={e.responsavel_cor} foto={e.responsavel_foto} pequeno />
                        </span>
                      )}
                    </span>
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
  const [modo, setModo] = useState<"plataforma" | "antiga">("plataforma");
  const [srp, setSrp] = useState(false);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<{ licitacoes: LicitacaoResumo[] }>("/licitacoes").then(
      (r) => {
        const lista = r.licitacoes.filter((l) => l.etapa === "ganha");
        setGanhas(lista);
        if (lista.length === 0) setModo("antiga");
      },
      () => {
        setGanhas([]);
        setModo("antiga");
      },
    );
  }, []);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const valor = (k: string) => String(f.get(k) ?? "").trim();
    setErro("");
    setEnviando(true);
    try {
      const empenho = {
        numero_empenho: valor("numero_empenho") || null,
        data_empenho: valor("data_empenho") || null,
        prazo_dias: valor("prazo_dias") ? Math.round(Number(valor("prazo_dias"))) : null,
        prazo_tipo: valor("prazo_tipo") || "corridos",
        etapa: valor("etapa") || "aguardando_empenho",
      };
      const corpo =
        modo === "plataforma"
          ? { licitacao_id: Number(f.get("licitacao_id")), ...empenho }
          : {
              ...empenho,
              registro_preco: srp,
              nova_licitacao: {
                numero: valor("lic_numero"),
                orgao: valor("lic_orgao"),
                uasg: valor("lic_uasg"),
                modalidade: valor("lic_modalidade"),
                objeto: valor("lic_objeto"),
                registro_preco: srp,
              },
            };
      const { execucao } = await api<{ execucao: { id: number } }>("/execucoes", { corpo });
      navegar(`/pos-ganho/${execucao.id}?aba=itens`);
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Novo empenho" aoFechar={aoFechar} largo>
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <div className="segmentado">
          <button type="button" className={modo === "plataforma" ? "ativo" : ""} onClick={() => setModo("plataforma")} disabled={!ganhas?.length}>
            Licitação já na plataforma
          </button>
          <button type="button" className={modo === "antiga" ? "ativo" : ""} onClick={() => setModo("antiga")}>
            Licitação de antes da plataforma
          </button>
        </div>

        {ganhas === null ? (
          <Carregando />
        ) : modo === "plataforma" ? (
          <>
            <p className="texto-suave pequeno" style={{ margin: 0 }}>
              Para mais um empenho de uma licitação ganha (por exemplo, outro pedido de um registro de preço).
            </p>
            <CampoSelect
              rotulo="Licitação ganha"
              name="licitacao_id"
              required
              opcoes={ganhas.map((l) => ({
                valor: l.id,
                texto: `Nº ${l.numero ?? "—"} · ${l.orgao ?? "Órgão não informado"}`,
              }))}
            />
          </>
        ) : (
          <>
            <p className="texto-suave pequeno" style={{ margin: 0 }}>
              Para empenhos que vocês já fornecem e cuja licitação não foi feita pela plataforma. A licitação é cadastrada já como
              <strong> Ganha</strong> e depois você preenche os itens à mão.
            </p>
            <div className="grade-3">
              <Campo rotulo="Nº da licitação" name="lic_numero" placeholder="90012/2025" />
              <Campo rotulo="UASG" name="lic_uasg" />
              <CampoSelect rotulo="Modalidade" name="lic_modalidade" vazio="Selecione" opcoes={MODALIDADES} />
            </div>
            <Campo rotulo="Órgão" name="lic_orgao" required placeholder="Nome do órgão" />
            <Campo rotulo="Objeto" name="lic_objeto" placeholder="O que foi comprado" />
            <Interruptor ligado={srp} aoMudar={setSrp} rotulo="É registro de preço (ata)" />
          </>
        )}

        <h3 className="subtitulo-form">Empenho</h3>
        <div className="grade-3">
          <Campo rotulo="Número do empenho" name="numero_empenho" placeholder="2026NE000123" />
          <Campo rotulo="Data do empenho" name="data_empenho" type="date" />
          <CampoSelect
            rotulo="Situação atual"
            name="etapa"
            defaultValue={modo === "antiga" ? "empenho_recebido" : "aguardando_empenho"}
            key={modo}
            opcoes={ETAPAS_EXECUCAO.map((e) => ({ valor: e.chave, texto: e.nome }))}
          />
        </div>
        <div className="grade-3">
          <Campo rotulo="Prazo de entrega (dias)" name="prazo_dias" type="number" min="0" />
          <CampoSelect
            rotulo="Tipo de prazo"
            name="prazo_tipo"
            opcoes={[
              { valor: "corridos", texto: "Dias corridos" },
              { valor: "uteis", texto: "Dias úteis" },
            ]}
          />
        </div>
        <div className="botoes-modal">
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao" disabled={enviando || ganhas === null || (modo === "plataforma" && !ganhas.length)}>
            {enviando ? "Criando…" : "Criar empenho"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
