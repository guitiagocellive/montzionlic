import {
  ArrowRightLeft,
  Calculator,
  CalendarClock,
  CircleCheck,
  Copy,
  DownloadCloud,
  ExternalLink,
  FileText,
  FolderOpen,
  Gavel,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  SquareArrowOutUpRight,
  Trash2,
  Trophy,
  Zap,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { diasAte, ETAPAS_LICITACAO, MODALIDADES } from "../../../shared/negocio";
import { podeEditar } from "../../../shared/permissoes";
import type { ItemLicitacao, Licitacao, LicitacaoResumo, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Avatar } from "../../components/Avatar";
import { Alerta, Campo } from "../../components/Formulario";
import { Kanban } from "../../components/Kanban";
import { type ItemMenu, MenuContexto } from "../../components/MenuContexto";
import { ponte, temPonte } from "../../robo/ponte";
import { type AvisoAcomp, avisosDe, montarCompras } from "../../../shared/acompanhamento";
import { type DadosRelatorio, RelatorioQuadro } from "./RelatorioQuadro";
import { lerCodigoSolicitada } from "./ItemCompras";
import { abrirPopupGovBr, useConexaoGovBr } from "../../robo/ConexaoGovBr";
import { diaDeHoje, elegivelParaSinc, lerMudouHoje, lerUltimaSinc, sincronizarQuadro } from "./sincronizarQuadro";
import { avisar, Carregando, CampoSelect, Modal } from "../../components/Ui";
import { formatarMoeda, hojeIso } from "../../formato";
import { navegar } from "../../rota";
import { CadastroUmClique, ehDoCompras, situacaoCadastro } from "./CadastroUmClique";
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
  // Atualização pelo Compras.gov.br: sozinha uma vez por dia (com o gov.br conectado) e pela pílula do cabeçalho.
  const conexao = useConexaoGovBr(temPonte(), false);
  const [sinc, setSinc] = useState<{ rodando: boolean; feitas: number; total: number }>({ rodando: false, feitas: 0, total: 0 });
  const [ultimaSinc, setUltimaSinc] = useState(lerUltimaSinc);
  const [mudouHoje, setMudouHoje] = useState(lerMudouHoje);
  const emDisputa = useRef(false);
  emDisputa.current = conexao.emDisputa;
  const rodando = useRef(false);
  const [relatorio, setRelatorio] = useState<DadosRelatorio | null>(null);
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

  // "Checar licitações": confere todas no Compras.gov.br e abre o relatório só com o que importa.
  async function checarLicitacoes() {
    if (!temPonte()) return;
    if (!conectado) return abrirPopupGovBr();
    const r = await atualizarQuadro(true, true);
    let avisos: AvisoAcomp[] = [];
    try {
      // Código oficial de "solicitada" (convocação para anexos etc.): sem ele as convocações não são reconhecidas.
      await lerCodigoSolicitada().catch(() => false);
      const p = await ponte.acompanhamento();
      avisos = avisosDe(montarCompras(p.andamento ?? null, p.detalhes ?? null), p.agora ?? Date.now());
    } catch {
      /* sem a leitura do Acompanhamento: o relatório mostra só as mudanças */
    }
    setRelatorio({ detalhes: r?.detalhes ?? [], avisos, pausada: !!r?.pausada });
  }

  async function atualizarQuadro(manual: boolean, silencioso = false) {
    if (rodando.current || !licitacoes) return null;
    const lista = licitacoes.filter((l) => elegivelParaSinc(l, hoje));
    if (!lista.length) {
      if (manual && !silencioso) avisar("Nenhuma licitação para atualizar agora (só as que já tiveram sessão e ainda não fecharam).");
      return null;
    }
    rodando.current = true;
    setSinc({ rodando: true, feitas: 0, total: lista.length });
    try {
      const r = await sincronizarQuadro(lista, {
        aoProgredir: (feitas, total) => setSinc({ rodando: true, feitas, total }),
        // Disputa acontecendo: o robô tem prioridade, a atualização para e continua depois.
        deveParar: () => emDisputa.current,
      });
      setUltimaSinc(lerUltimaSinc());
      setMudouHoje(lerMudouHoje());
      if (r.pausada && !silencioso) avisar("Atualização do quadro pausada: há uma disputa acontecendo. Ela continua sozinha quando a disputa acabar.");
      if (r.mudaram > 0) {
        if (!silencioso) avisar(`Quadro atualizado do Compras.gov.br: ${r.mudaram} licitação(ões) mudaram. O resumo está no sino.`);
        await carregar();
      } else if (manual && !silencioso) avisar("Quadro atualizado: nada mudou no Compras.gov.br.");
      return r;
    } finally {
      rodando.current = false;
      setSinc({ rodando: false, feitas: 0, total: 0 });
    }
  }

  // Primeira vez no dia, com o gov.br conectado: atualiza sozinho.
  const conectado = conexao.estado === "conectado";
  useEffect(() => {
    if (!conectado || !licitacoes || !editar || conexao.emDisputa) return;
    if (lerUltimaSinc()?.dia === diaDeHoje()) return;
    const t = setTimeout(() => atualizarQuadro(false), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conectado, licitacoes === null, editar, conexao.emDisputa]);

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
      const cad = situacaoCadastro(l, l.itens_orcados ?? 0, l.total_itens, hoje);
      if (jaAconteceu) {
        itens.push({
          rotulo: "Puxar resultado da disputa",
          icone: <DownloadCloud size={15} />,
          desativado: semApp,
          motivo: "Abra a plataforma pelo aplicativo Montzion",
          aoClicar: () => puxarResultado(l),
        });
      } else if (cad.mostrar && cad.alterar) {
        itens.push({ rotulo: "Alterar proposta", icone: <Pencil size={15} />, dica: `${l.compras_itens ?? 0} itens`, aoClicar: () => setCadastrando(l.id) });
      } else if (cad.mostrar) {
        itens.push({
          rotulo: "Cadastrar proposta",
          icone: <Zap size={15} />,
          dica: cad.pode ? `${cad.orcados}/${cad.total} orçados` : undefined,
          desativado: !cad.pode,
          motivo: cad.aviso,
          aoClicar: () => setCadastrando(l.id),
        });
        if (!cad.pode) itens.push({ rotulo: "Fazer o orçamento", icone: <Calculator size={15} />, aoClicar: () => abrir("orcamento") });
      } else {
        // Antes do Orçamento não há o que cadastrar: tira o título "Compras.gov.br" e o separador.
        itens.pop();
        itens.pop();
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
        <div className="cabecalho-acoes">
          {editar && temPonte() && (
            <button className="botao secundario" onClick={checarLicitacoes} disabled={sinc.rodando} title="Confere todas as licitações no Compras.gov.br e mostra só o que importa: colocação, ganho ou perda e convocações esperando resposta">
              <ScanSearch aria-hidden="true" /> {sinc.rodando ? "Checando…" : "Checar licitações"}
            </button>
          )}
          {editar && (
            <button
              type="button"
              className={`chip-sinc ${!temPonte() ? "fora" : !conectado ? "desconectado" : ""}`}
              disabled={sinc.rodando || !temPonte()}
              onClick={() => (!conectado && conexao.estado !== "conectando" ? abrirPopupGovBr() : atualizarQuadro(true))}
              title={
                !temPonte()
                  ? "Abra a plataforma pelo aplicativo Montzion para atualizar do Compras.gov.br"
                  : !conectado
                    ? "Conecte a conta gov.br para atualizar as licitações"
                    : "Atualiza sozinho uma vez por dia. Clique para atualizar agora as licitações que já tiveram sessão."
              }
            >
              <RefreshCw size={13} className={sinc.rodando ? "girando" : ""} />
              {!temPonte()
                ? "Atualiza pelo aplicativo"
                : sinc.rodando
                  ? `Atualizando ${Math.min(sinc.feitas + 1, sinc.total)} de ${sinc.total}…`
                  : !conectado
                    ? "Conectar gov.br para atualizar"
                    : conexao.emDisputa && ultimaSinc?.dia !== diaDeHoje()
                      ? "Atualiza depois da disputa"
                      : ultimaSinc
                      ? `${ultimaSinc.dia === diaDeHoje() ? "Atualizado hoje" : "Atualizado em " + ultimaSinc.dia.split("-").reverse().slice(0, 2).join("/")} às ${new Date(ultimaSinc.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${ultimaSinc.mudaram ? ` · ${ultimaSinc.mudaram} mudaram` : ""}`
                      : "Atualizar do Compras.gov.br"}
            </button>
          )}
          {editar && (
            <button className="botao" onClick={() => setNovaEm("estudar")}>
              <Plus aria-hidden="true" /> Nova licitação
            </button>
          )}
        </div>
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
            renderCard={(l) => <CardLicitacao l={l} hoje={hoje} mudou={mudouHoje[l.id]} aoMover={editar ? (etapa) => mover(l, etapa, 0) : undefined} />}
            aoMenu={(l, x, y) => setMenu({ l, x, y })}
          />
        </div>
      )}

      {relatorio && licitacoes && <RelatorioQuadro dados={relatorio} licitacoes={licitacoes} aoFechar={() => setRelatorio(null)} />}
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

/** "Hoje, 08:00", "Amanhã, 08:00" ou "19/11, 09:30". */
function quandoCurto(data: string, hora: string | null, dias: number | null) {
  const dia = dias === 0 ? "Hoje" : dias === 1 ? "Amanhã" : dias === -1 ? "Ontem" : `${data.slice(8, 10)}/${data.slice(5, 7)}`;
  return hora ? `${dia}, ${hora}` : dia;
}

/** Nome curto da modalidade para o card: "Pregão", "Dispensa", "Concorrência"... */
const modalidadeCurta = (m: string | null) => (m ? m.replace(/\s+(eletrônic[oa]|presencial)$/i, "") : "");

function CardLicitacao({ l, hoje, mudou, aoMover }: { l: LicitacaoResumo; hoje: string; mudou?: string; aoMover?: (etapa: string) => void }) {
  const ativa = !["perdida", "ganha"].includes(l.etapa);
  const reaberta = ativa && !!l.data_reabertura && l.data_reabertura >= hoje;
  const data = reaberta ? l.data_reabertura : l.data_sessao;
  const hora = reaberta ? l.hora_reabertura : l.horario;
  const dias = data ? diasAte(data, hoje) : null;
  const classePrazo = !ativa || dias == null ? "" : dias < 0 ? "passou" : dias === 0 ? "urgente" : dias === 1 ? "amanha" : "";
  const meta = [modalidadeCurta(l.modalidade), l.registro_preco === 1 ? "SRP" : ""].filter(Boolean).join(" · ");
  // Sugere a etapa, sem mover sozinho. Ganhas só com todos os itens fechados e algum ganho (julgado e habilitado ou
  // adjudicado); itens ainda em julgamento depois da sessão: "Boa colocação" (acompanhar).
  const fechados = l.itens_ganhos + l.itens_perdidos;
  const sessaoPassou = !!data && data < hoje;
  const sugestao =
    !ativa || !aoMover || l.total_itens === 0
      ? null
      : l.itens_acompanhando === 0 && fechados >= l.total_itens
        ? l.itens_ganhos > 0
          ? { etapa: "ganha", texto: "Mover para Ganhas?" }
          : { etapa: "perdida", texto: "Mover para Perdidas?" }
        : l.itens_acompanhando > 0 && sessaoPassou && ["estudar", "fazer", "orcamento"].includes(l.etapa)
          ? { etapa: "boa_colocacao", texto: "Mover para Boa colocação (acompanhar)?" }
          : null;

  return (
    <>
      <div className="card-topo">
        <h4 className="card-titulo">
          {l.numero ? `Nº ${l.numero}` : "Sem número"}
          {l.uasg && <small className="card-uasg">UASG {l.uasg}</small>}
          {mudou && <span className="card-mudou" title={`Mudou hoje no Compras.gov.br: ${mudou}`} aria-label="Mudou hoje" />}
        </h4>
        {l.responsavel_nome && (
          <span title={`Responsável: ${l.responsavel_nome}`}>
            <Avatar nome={l.responsavel_nome} cor={l.responsavel_cor} foto={l.responsavel_foto} pequeno />
          </span>
        )}
      </div>
      <p className="card-orgao">{l.orgao || "Órgão não informado"}</p>
      {meta && <p className="card-meta">{meta}</p>}

      <div className="card-linha" />
      <div className="card-rodape">
        {data ? (
          <span className={`card-quando ${classePrazo}`} title={reaberta ? "Reabertura da sessão" : "Sessão"}>
            <CalendarClock aria-hidden="true" />
            {reaberta ? "Reabre " : ""}
            {quandoCurto(data, hora, dias)}
          </span>
        ) : (
          <span className="card-quando sem-data">Sem data</span>
        )}
        {l.valor_estimado != null && l.valor_estimado > 0 && <span className="card-valor">{valorCurto(l.valor_estimado)}</span>}
      </div>
      <div className="card-status">
        <span title="Itens em que vamos participar">
          <ListChecks aria-hidden="true" /> {l.total_itens} {l.total_itens === 1 ? "item" : "itens"}
        </span>
        {l.total_arquivos > 0 && (
          <span title="Arquivos">
            <FileText aria-hidden="true" /> {l.total_arquivos}
          </span>
        )}
        {l.compras_cadastrado_em && (
          <span className="verde" title={`Proposta cadastrada no Compras.gov.br (${l.compras_itens ?? 0} itens)`}>
            <CircleCheck aria-hidden="true" /> No Compras
          </span>
        )}
        {ativa && l.colocacao && <span className={l.colocacao === 1 ? "verde" : "amarelo"}>{l.colocacao}º lugar</span>}
        {l.itens_ganhos > 0 && <span className="verde">{l.itens_ganhos} ganho(s)</span>}
        {l.itens_acompanhando > 0 && <span className="amarelo">{l.itens_acompanhando} acompanhando</span>}
        {l.itens_perdidos > 0 && <span className="vermelho">{l.itens_perdidos} perdido(s)</span>}
      </div>
      {mudou && <p className="card-mudou-texto">{mudou}</p>}
      {sugestao && (
        <button
          type="button"
          className="card-sugestao"
          onClick={(e) => {
            e.stopPropagation();
            aoMover!(sugestao.etapa);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {sugestao.texto}
        </button>
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
