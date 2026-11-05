import { CalendarClock, FileText, Gavel, ListChecks, Plus, Search, Tag } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { diasAte, ETAPAS_LICITACAO, MODALIDADES } from "../../../shared/negocio";
import type { LicitacaoResumo } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Avatar } from "../../components/Avatar";
import { Alerta, Campo } from "../../components/Formulario";
import { Kanban } from "../../components/Kanban";
import { avisar, Carregando, CampoSelect, Modal } from "../../components/Ui";
import { formatarDataCurta, formatarMoeda, hojeIso, textoPrazo } from "../../formato";
import { navegar } from "../../rota";

export function QuadroLicitacoes() {
  const [licitacoes, setLicitacoes] = useState<LicitacaoResumo[] | null>(null);
  const [busca, setBusca] = useState("");
  const [nicho, setNicho] = useState("");
  const [novaEm, setNovaEm] = useState<string | null>(null);

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
          <p className="texto-suave">Arraste os cards entre as etapas. Clique para abrir a ficha.</p>
        </div>
        <button className="botao" onClick={() => setNovaEm("estudar")}>
          <Plus aria-hidden="true" /> Nova licitação
        </button>
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
            aoNovo={(etapa) => setNovaEm(etapa)}
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

function CardLicitacao({ l, hoje }: { l: LicitacaoResumo; hoje: string }) {
  const dias = l.data_sessao ? diasAte(l.data_sessao, hoje) : null;
  const classePrazo =
    dias == null ? "" : dias < 0 ? "passou" : dias <= 1 ? "urgente" : dias <= 5 ? "proximo" : "";
  const ativa = !["perdida", "ganha"].includes(l.etapa);

  return (
    <>
      <div className="card-etiquetas">
        {l.modalidade && <span className="chip">{l.modalidade}</span>}
        {l.registro_preco === 1 && <span className="chip destaque">SRP</span>}
      </div>
      <h4 className="card-titulo">{l.numero ? `Nº ${l.numero}` : "Sem número"}</h4>
      <p className="card-orgao">{l.orgao || "Órgão não informado"}</p>
      {l.objeto && <p className="card-objeto">{l.objeto}</p>}

      {l.data_sessao && (
        <div className={`card-sessao ${ativa ? classePrazo : ""}`}>
          <CalendarClock aria-hidden="true" />
          <span>
            {formatarDataCurta(l.data_sessao)}
            {l.horario && ` · ${l.horario}`}
          </span>
          {ativa && dias != null && <strong>{textoPrazo(dias)}</strong>}
        </div>
      )}

      <div className="card-rodape">
        <div className="card-contadores">
          {l.nicho && (
            <span title="Nicho">
              <Tag aria-hidden="true" /> {l.nicho}
            </span>
          )}
          <span title="Itens que vamos participar">
            <ListChecks aria-hidden="true" /> {l.total_itens}
          </span>
          <span title="Arquivos">
            <FileText aria-hidden="true" /> {l.total_arquivos}
          </span>
        </div>
        {l.responsavel_nome && (
          <span title={`Responsável: ${l.responsavel_nome}`}>
            <Avatar nome={l.responsavel_nome} pequeno />
          </span>
        )}
      </div>
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
