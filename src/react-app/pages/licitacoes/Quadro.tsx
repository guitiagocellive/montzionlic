import {
  ArrowRightLeft,
  Calculator,
  CalendarClock,
  Copy,
  DownloadCloud,
  ExternalLink,
  FileText,
  FolderOpen,
  Gavel,
  ListChecks,
  Pencil,
  Plus,
  Search,
  SquareArrowOutUpRight,
  Trash2,
  Trophy,
  Zap,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { diasAte, ETAPAS_LICITACAO, MODALIDADES } from "../../../shared/negocio";
import { podeEditar } from "../../../shared/permissoes";
import type { ItemLicitacao, Licitacao, LicitacaoResumo, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Avatar } from "../../components/Avatar";
import { Alerta, Campo } from "../../components/Formulario";
import { Kanban } from "../../components/Kanban";
import { type ItemMenu, MenuContexto } from "../../components/MenuContexto";
import { temPonte } from "../../robo/ponte";
import { avisar, Carregando, CampoSelect, Modal } from "../../components/Ui";
import { formatarDataCurta, formatarMoeda, hojeIso, textoPrazo } from "../../formato";
import { navegar } from "../../rota";
import { BotaoUmClique, CadastroUmClique, ehDoCompras } from "./CadastroUmClique";
import { puxarESalvarResultado } from "./puxarResultado";

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

  const [menu, setMenu] = useState<{ l: LicitacaoResumo; x: number; y: number } | null>(null);
  const [cadastrando, setCadastrando] = useState<number | null>(null);

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

  async function puxarResultado(l: LicitacaoResumo) {
    try {
      avisar("Puxando o resultado do Compras.gov.br…");
      const ficha = await api<{ licitacao: Licitacao; itens: ItemLicitacao[] }>(`/licitacoes/${l.id}`);
      const { preenchidos, semDados } = await puxarESalvarResultado(ficha.licitacao, ficha.itens);
      if (!preenchidos) avisar(`O Compras.gov.br ainda não mostra a sua proposta nos itens${semDados.length ? ` ${semDados.join(", ")}` : ""}.`, "erro");
      else avisar(`Resultado salvo em ${preenchidos} item(ns), com o resumo da disputa. Veja na aba Resultado.`);
      await carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  async function excluir(l: LicitacaoResumo) {
    if (!confirm(`Excluir a licitação ${l.numero ?? ""} do quadro, com itens, cotações, arquivos e empenhos? Isso não pode ser desfeito.`)) return;
    try {
      await api(`/licitacoes/${l.id}`, { metodo: "DELETE" });
      avisar("Licitação excluída.");
      await carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  /** Ações do botão direito: mudam conforme a etapa (cadastrar, alterar ou puxar o resultado do Compras.gov.br). */
  function itensDoMenu(l: LicitacaoResumo): ItemMenu[] {
    const abrir = (aba = "") => navegar(`/licitacoes/${l.id}${aba ? `?aba=${aba}` : ""}`);
    const ativa = !["perdida", "ganha"].includes(l.etapa);
    const data = l.data_reabertura && l.data_reabertura >= hoje ? l.data_reabertura : l.data_sessao;
    const jaAconteceu = !ativa || l.etapa === "boa_colocacao" || (!!data && data < hoje);
    const doCompras = ehDoCompras(l);
    const semApp = !temPonte();
    const itens: ItemMenu[] = [
      { rotulo: "Abrir ficha", icone: <SquareArrowOutUpRight size={15} />, aoClicar: () => abrir() },
      { rotulo: "Ver itens", icone: <ListChecks size={15} />, dica: String(l.total_itens), aoClicar: () => abrir("itens") },
      { rotulo: "Orçamento", icone: <Calculator size={15} />, aoClicar: () => abrir("orcamento") },
      { rotulo: "Proposta", icone: <FileText size={15} />, aoClicar: () => abrir("proposta") },
      { rotulo: "Resultado", icone: <Trophy size={15} />, aoClicar: () => abrir("resultado") },
      { rotulo: "Ver anexos", icone: <FolderOpen size={15} />, dica: l.total_arquivos ? String(l.total_arquivos) : undefined, aoClicar: () => abrir("arquivos") },
    ];
    if (doCompras && editar) {
      itens.push({ separador: true }, { titulo: "Compras.gov.br" });
      if (jaAconteceu) {
        itens.push({
          rotulo: "Puxar resultado da disputa",
          icone: <DownloadCloud size={15} />,
          desativado: semApp,
          motivo: "Abra a plataforma pelo aplicativo Montzion",
          aoClicar: () => puxarResultado(l),
        });
      } else if (l.compras_cadastrado_em) {
        itens.push({ rotulo: "Alterar proposta", icone: <Pencil size={15} />, dica: `${l.compras_itens ?? 0} itens`, aoClicar: () => setCadastrando(l.id) });
      } else {
        itens.push({ rotulo: "Cadastrar proposta", icone: <Zap size={15} />, aoClicar: () => setCadastrando(l.id) });
      }
    }
    itens.push({ separador: true });
    if (editar) {
      itens.push({
        rotulo: "Mover para",
        icone: <ArrowRightLeft size={15} />,
        submenu: ETAPAS_LICITACAO.filter((e) => e.chave !== l.etapa).map((e) => ({
          rotulo: e.nome,
          icone: <span className="bolinha-etapa" style={{ background: e.cor }} />,
          aoClicar: () => mover(l, e.chave, 0),
        })),
      });
    }
    if (l.link) itens.push({ rotulo: "Abrir no portal", icone: <ExternalLink size={15} />, aoClicar: () => window.open(l.link!, "_blank", "noopener") });
    if (l.numero || l.uasg) {
      itens.push({
        rotulo: "Copiar número e UASG",
        icone: <Copy size={15} />,
        aoClicar: () =>
          navigator.clipboard
            .writeText([l.numero && `Nº ${l.numero}`, l.uasg && `UASG ${l.uasg}`].filter(Boolean).join(" · "))
            .then(() => avisar("Copiado."), () => avisar("Não consegui copiar.", "erro")),
      });
    }
    if (usuario.papel === "admin") itens.push({ separador: true }, { rotulo: "Excluir do quadro", icone: <Trash2 size={15} />, perigo: true, aoClicar: () => excluir(l) });
    return itens;
  }

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
            renderCard={(l) => <CardLicitacao l={l} hoje={hoje} aoMudar={carregar} />}
            aoMenu={(l, x, y) => setMenu({ l, x, y })}
          />
        </div>
      )}

      {menu && <MenuContexto x={menu.x} y={menu.y} itens={itensDoMenu(menu.l)} aoFechar={() => setMenu(null)} />}
      {cadastrando != null && (
        <CadastroUmClique
          licitacaoId={cadastrando}
          aoFechar={() => {
            setCadastrando(null);
            carregar();
          }}
        />
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

function CardLicitacao({ l, hoje, aoMudar }: { l: LicitacaoResumo; hoje: string; aoMudar: () => void }) {
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
      {ativa && (l.total_cotacoes > 0 || !!l.compras_cadastrado_em) && ehDoCompras(l) && (
        <div className="card-um-clique">
          {l.compras_cadastrado_em && <span className="chip verde pequeno">Proposta no Compras · {l.compras_itens ?? 0} item(ns)</span>}
          <BotaoUmClique licitacaoId={l.id} compacto cadastrada={!!l.compras_cadastrado_em} aoFechar={aoMudar} />
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
          Preencha o básico agora. Os outros dados ficam na ficha.
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
