import { CalendarClock, FileText, Gavel, ListChecks, Plus, Search } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { diasAte, ETAPAS_LICITACAO, MODALIDADES } from "../../../shared/negocio";
import { podeEditar } from "../../../shared/permissoes";
import type { LicitacaoResumo, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Avatar } from "../../components/Avatar";
import { Alerta, Campo } from "../../components/Formulario";
import { Kanban } from "../../components/Kanban";
import { avisar, Carregando, CampoSelect, Modal } from "../../components/Ui";
import { formatarDataCurta, formatarMoeda, hojeIso, textoPrazo } from "../../formato";
import { navegar } from "../../rota";
import { BotaoUmClique, ehDoCompras } from "./CadastroUmClique";

export function QuadroLicitacoes({ usuario }: { usuario: Usuario }) {
  const editar = podeEditar(usuario.permissoes, "licitacoes");
  const [licitacoes, setLicitacoes] = useState<LicitacaoResumo[] | null>(null);
  const [busca, setBusca] = useState("");
  const [nicho, setNicho] = useState("");
  // ?nova=1 (vindo do painel) já abre o formulário.
  const [novaEm, setNovaEm] = useState<string | null>(() => {
    if (!new URLSearchParams(location.search).get("nova")) return null;
    history.replaceState(null, "", "/licitacoes");
    return editar ? "estudar" : null;
  });

  async function carregar() {
    try {
      const { licitacoes } = await api<{ licitacoes: LicitacaoResumo[] }>("/licitacoes");
      setLicitacoes(licitacoes);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const nichos = useMemo(
    () => [...new Set((licitacoes ?? []).map((l) => l.nicho).filter(Boolean) as string[])].sort(),
    [licitacoes],
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (licitacoes ?? []).filter((l) => {
      if (nicho && l.nicho !== nicho) return false;
      if (!termo) return true;
      return [l.numero, l.orgao, l.uasg, l.objeto, l.modalidade, l.portal]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(termo));
    });
  }, [licitacoes, busca, nicho]);

  async function mover(card: LicitacaoResumo, etapa: string, posicao: number) {
    // Ganhou? Primeiro escolher quais itens foram ganhos (só eles vão para o empenho).
    if (etapa === "ganha" && card.etapa !== "ganha" && card.total_itens > 1 && card.itens_ganhos === 0) {
      navegar(`/licitacoes/${card.id}?ganhar=1`);
      return;
    }
    const anterior = licitacoes;
    setLicitacoes((ls) => ls!.map((l) => (l.id === card.id ? { ...l, etapa, posicao } : l)));
    try {
      const r = await api<{ execucaoCriada: number | null }>(`/licitacoes/${card.id}`, {
        metodo: "PATCH",
        corpo: { etapa, posicao },
      });
      if (r.execucaoCriada) avisar("Licitação ganha! O card também foi criado no Pós-ganho.");
    } catch (err) {
      setLicitacoes(anterior);
      avisar(mensagemDeErro(err), "erro");
    }
  }

  const hoje = hojeIso();

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Quadro de licitações</h1>
          <p className="texto-suave">
            {editar ? "Arraste os cards entre as etapas. Clique para abrir a ficha." : "Você está no modo de visualização."}
          </p>
        </div>
        {editar && (
          <button className="botao" onClick={() => setNovaEm("estudar")}>
            <Plus aria-hidden="true" /> Nova licitação
          </button>
        )}
      </div>

      <div className="barra-filtros entrar" style={{ ["--i" as string]: 1 }}>
        <div className="entrada com-icone busca">
          <Search aria-hidden="true" />
          <input
            placeholder="Buscar por número, órgão, UASG, objeto…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar licitações"
          />
        </div>
        <select value={nicho} onChange={(e) => setNicho(e.target.value)} aria-label="Filtrar por nicho">
          <option value="">Todos os nichos</option>
          {nichos.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </div>

      {licitacoes === null ? (
        <Carregando />
      ) : (
        <div className="entrar" style={{ ["--i" as string]: 2 }}>
          <Kanban
            etapas={ETAPAS_LICITACAO}
            cards={filtradas}
            aoAbrir={(c) => navegar(`/licitacoes/${c.id}`)}
            aoMover={mover}
            aoNovo={editar ? (etapa) => setNovaEm(etapa) : undefined}
            somenteLeitura={!editar}
            rodapeColuna={(_, cards) => {
              const total = cards.reduce((s, c) => s + (c.valor_estimado ?? 0), 0);
              return total > 0 ? <div className="coluna-rodape">{formatarMoeda(total)} estimados</div> : null;
            }}
            renderCard={(l) => <CardLicitacao l={l} hoje={hoje} />}
          />
        </div>
      )}

      {novaEm && (
        <ModalNovaLicitacao
          etapa={novaEm}
          aoFechar={() => setNovaEm(null)}
          aoCriar={(id) => navegar(`/licitacoes/${id}`)}
        />
      )}
    </>
  );
}

const valorCurto = (v: number) =>
  v >= 1_000_000 ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : v >= 1000 ? `R$ ${Math.round(v / 1000)} mil` : formatarMoeda(v);

function CardLicitacao({ l, hoje }: { l: LicitacaoResumo; hoje: string }) {
  const ativa = !["perdida", "ganha"].includes(l.etapa);
  const reaberta = ativa && !!l.data_reabertura && l.data_reabertura >= hoje;
  const data = reaberta ? l.data_reabertura : l.data_sessao;
  const hora = reaberta ? l.hora_reabertura : l.horario;
  const dias = data ? diasAte(data, hoje) : null;
  const classePrazo = dias == null ? "" : dias < 0 ? "passou" : dias <= 1 ? "urgente" : dias <= 5 ? "proximo" : "";
  const temResultado = l.itens_ganhos + l.itens_perdidos + l.itens_acompanhando > 0;

  return (
    <>
      <div className="card-topo">
        <h4 className="card-titulo">{l.numero ? `Nº ${l.numero}` : "Sem número"}</h4>
        {l.responsavel_nome && (
          <span title={`Responsável: ${l.responsavel_nome}`}>
            <Avatar nome={l.responsavel_nome} cor={l.responsavel_cor} foto={l.responsavel_foto} pequeno />
          </span>
        )}
      </div>
      <p className="card-orgao">{l.orgao || "Órgão não informado"}</p>
      <div className="card-etiquetas">
        {l.modalidade && <span className="chip">{l.modalidade}</span>}
        {l.uasg && <span className="chip">UASG {l.uasg}</span>}
        {l.registro_preco === 1 && <span className="chip destaque">SRP</span>}
        {l.etapa === "boa_colocacao" && l.colocacao && <span className="chip amarelo">{l.colocacao}º lugar</span>}
        {l.etapa === "boa_colocacao" && !l.acompanhar && <span className="chip">Sem acompanhar</span>}
      </div>

      {data && (
        <div className={`card-sessao ${ativa ? classePrazo : ""}`}>
          <CalendarClock aria-hidden="true" />
          <span>
            {reaberta ? "Reabre " : ""}
            {formatarDataCurta(data)}
            {hora && ` · ${hora}`}
          </span>
          {ativa && dias != null && dias >= 0 && <strong>{textoPrazo(dias)}</strong>}
        </div>
      )}

      {temResultado && (
        <div className="card-resultado">
          {l.itens_ganhos > 0 && <span className="verde">{l.itens_ganhos} ganho(s)</span>}
          {l.itens_acompanhando > 0 && <span className="amarelo">{l.itens_acompanhando} acompanhando</span>}
          {l.itens_perdidos > 0 && <span className="vermelho">{l.itens_perdidos} perdido(s)</span>}
        </div>
      )}

      <div className="card-rodape">
        <div className="card-contadores">
          <span title="Itens em que vamos participar">
            <ListChecks aria-hidden="true" /> {l.total_itens} itens
          </span>
          {l.total_arquivos > 0 && (
            <span title="Arquivos">
              <FileText aria-hidden="true" /> {l.total_arquivos}
            </span>
          )}
        </div>
        {l.valor_estimado != null && l.valor_estimado > 0 && <span className="card-valor">{valorCurto(l.valor_estimado)}</span>}
      </div>
      {ativa && l.total_cotacoes > 0 && ehDoCompras(l) && (
        <div className="card-um-clique">
          <BotaoUmClique licitacaoId={l.id} compacto />
        </div>
      )}
    </>
  );
}

function ModalNovaLicitacao({
  etapa,
  aoFechar,
  aoCriar,
}: {
  etapa: string;
  aoFechar: () => void;
  aoCriar: (id: number) => void;
}) {
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(e.currentTarget));
    setErro("");
    setEnviando(true);
    try {
      const { licitacao } = await api<{ licitacao: { id: number } }>("/licitacoes", { corpo: dados });
      aoCriar(licitacao.id);
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Nova licitação" aoFechar={aoFechar}>
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <p className="texto-suave pequeno" style={{ margin: 0 }}>
          Preencha o básico agora. Os outros dados (ou a leitura do edital pela IA) ficam na ficha.
        </p>
        <div className="grade-2">
          <Campo rotulo="Número da licitação" name="numero" icone={Gavel} placeholder="90012/2026" autoFocus />
          <Campo rotulo="UASG" name="uasg" placeholder="160123" />
        </div>
        <Campo rotulo="Órgão" name="orgao" placeholder="Ex.: Prefeitura de São Paulo" />
        <div className="grade-2">
          <CampoSelect rotulo="Modalidade" name="modalidade" opcoes={MODALIDADES} vazio="Selecione" />
          <CampoSelect
            rotulo="Etapa"
            name="etapa"
            defaultValue={etapa}
            opcoes={ETAPAS_LICITACAO.map((e) => ({ valor: e.chave, texto: e.nome }))}
          />
        </div>
        <div className="botoes-modal">
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao" disabled={enviando}>
            {enviando ? "Criando…" : "Criar e abrir ficha"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
