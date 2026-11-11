import {
  CalendarClock,
  ChevronDown,
  ExternalLink,
  FileSearch,
  FolderOpen,
  Globe,
  Hash,
  ListOrdered,
  Landmark,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { podeEditar } from "../../../shared/permissoes";
import type { LicitacaoResumo, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { avisar, Interruptor, Modal, Vazio } from "../../components/Ui";
import { useFecharAoClicarFora } from "../../components/useFecharAoClicarFora";
import { link, navegar } from "../../rota";
import {
  buscarLicitacoes,
  carregarMunicipios,
  ESFERAS,
  FILTROS_PADRAO,
  MODOS_DISPUTA,
  type FiltrosBusca,
  type ItemPncp,
  MODALIDADES_PNCP,
  type Municipio,
  ordenar,
  PERIODOS_SESSAO,
  PLATAFORMAS,
  prepararImportacao,
  type RespostaBusca,
  type ResultadoPncp,
  semAcento,
  UFS,
} from "../../pncp";
import { DetalhePncp, dataHora, type EtapaPncp, reais } from "./DetalhePncp";
import { EscolherItensPncp } from "./EscolherItensPncp";

const CHAVE_FILTROS = "montzion:busca-pncp";
const POR_TELA = 30;

function lerFiltros(): FiltrosBusca {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_FILTROS) ?? "null");
    return salvo ? { ...FILTROS_PADRAO, ...salvo } : FILTROS_PADRAO;
  } catch {
    return FILTROS_PADRAO;
  }
}

function FiltroMunicipios({ ufs, valor, aoMudar }: { ufs: string[]; valor: Municipio[]; aoMudar: (m: Municipio[]) => void }) {
  const [texto, setTexto] = useState("");
  const [lista, setLista] = useState<Municipio[] | null>(null);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useFecharAoClicarFora(caixa, aberto, () => setAberto(false));

  function carregar() {
    if (lista) return;
    carregarMunicipios().then(
      (dados) => setLista(Object.entries(dados).flatMap(([uf, ms]) => ms.map(([ibge, nome]) => ({ ibge, nome, uf })))),
      (e) => setErro(mensagemDeErro(e)),
    );
  }

  const sugestoes = useMemo(() => {
    const t = semAcento(texto.trim());
    if (!lista || t.length < 2) return [];
    return lista
      .filter((m) => (!ufs.length || ufs.includes(m.uf)) && !valor.some((v) => v.ibge === m.ibge) && semAcento(m.nome).includes(t))
      .sort((a, b) => Number(!semAcento(a.nome).startsWith(t)) - Number(!semAcento(b.nome).startsWith(t)) || a.nome.localeCompare(b.nome))
      .slice(0, 8);
  }, [texto, lista, ufs, valor]);

  function escolher(m: Municipio) {
    if (valor.length >= 10) return avisar("Escolha no máximo 10 municípios por busca.", "erro");
    aoMudar([...valor, m]);
    setTexto("");
  }

  return (
    <div className="filtro-municipios" ref={caixa}>
      <div className="chips-filtro">
        {valor.map((m) => (
          <span key={m.ibge} className="chip-filtro ativo com-x">
            {m.nome}/{m.uf}
            <button type="button" aria-label={`Tirar ${m.nome}`} onClick={() => aoMudar(valor.filter((v) => v.ibge !== m.ibge))}>
              <X size={12} />
            </button>
          </span>
        ))}
        <div className="entrada pequena-entrada">
          <input
            placeholder={ufs.length ? `Município (${ufs.join(", ")})` : "Digite o município"}
            value={texto}
            onFocus={() => {
              carregar();
              setAberto(true);
            }}
            onChange={(e) => {
              setTexto(e.target.value);
              setAberto(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (sugestoes[0]) escolher(sugestoes[0]);
              }
            }}
            aria-label="Município"
          />
          {aberto && texto.trim().length >= 2 && (
            <ul className="sugestoes-municipio">
              {!lista && !erro && <li className="texto-fraco">Carregando municípios…</li>}
              {erro && <li className="texto-fraco">{erro}</li>}
              {lista && !sugestoes.length && <li className="texto-fraco">Nenhum município encontrado{ufs.length ? " nos estados marcados" : ""}.</li>}
              {sugestoes.map((m) => (
                <li key={m.ibge}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(m)}>
                    {m.nome} <span className="texto-fraco">/{m.uf}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Quantos filtros de "Mais filtros" estão ligados. */
/** Quantos filtros da pesquisa avançada estão diferentes do padrão. */
function filtrosAvancados(f: FiltrosBusca) {
  const mod = [...f.modalidades].sort().join(",") !== [...FILTROS_PADRAO.modalidades].sort().join(",");
  return [
    f.ufs.length > 0,
    f.municipios.length > 0,
    f.plataformas.length > 0,
    mod,
    !!f.srp,
    f.esferas.length > 0,
    !!f.valorMin.trim() || !!f.valorMax.trim(),
    (f.modosDisputa ?? []).length > 0,
    !!f.tipoItem,
    !!f.meEpp,
    !!f.orgao.trim(),
    f.situacao === "todas",
  ].filter(Boolean).length;
}

/** "em 22h 53min", "em 9 dias", "encerrada" */
function tempoAte(iso: string | null): { texto: string; classe: string } | null {
  if (!iso) return null;
  const alvo = new Date(iso.length <= 10 ? `${iso}T23:59:59` : iso).getTime();
  if (!Number.isFinite(alvo)) return null;
  const min = Math.round((alvo - Date.now()) / 60000);
  if (min < 0) return { texto: "encerrada", classe: "passou" };
  if (min < 60) return { texto: `em ${min}min`, classe: "urgente" };
  if (min < 24 * 60) return { texto: `em ${Math.floor(min / 60)}h ${min % 60}min`, classe: "breve" };
  const dias = Math.round(min / (24 * 60));
  return { texto: `em ${dias} dia${dias > 1 ? "s" : ""}`, classe: dias <= 3 ? "breve" : "" };
}

/** Seção que abre e fecha dentro da pesquisa avançada. */
function SecaoFiltro({ titulo, aberta, aoAlternar, children, acoes }: { titulo: string; aberta: boolean; aoAlternar: () => void; children: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <section className={`secao-filtro ${aberta ? "aberta" : ""}`}>
      <button type="button" className="secao-filtro-topo" onClick={aoAlternar} aria-expanded={aberta}>
        <span>{titulo}</span>
        <ChevronDown />
      </button>
      <div className="secao-filtro-corpo">
        <div>
          {children}
          {acoes && <div className="secao-filtro-acoes">{acoes}</div>}
        </div>
      </div>
    </section>
  );
}

export function BuscarLicitacoes({ usuario }: { usuario: Usuario }) {
  const editar = podeEditar(usuario.permissoes, "licitacoes");
  const [filtros, setFiltros] = useState<FiltrosBusca>(lerFiltros);
  const [resposta, setResposta] = useState<RespostaBusca | null>(null);
  const [usados, setUsados] = useState<FiltrosBusca | null>(null);
  const [pagina, setPagina] = useState(1);
  const [mostrar, setMostrar] = useState(POR_TELA);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [noQuadro, setNoQuadro] = useState<Record<string, number>>({});
  const [importando, setImportando] = useState<{ id: string; etapa: string } | null>(null);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [buscaAberta, setBuscaAberta] = useState(() => !!lerFiltros().palavra);
  const [avancada, setAvancada] = useState(false);
  const [secoes, setSecoes] = useState<Record<string, boolean>>({ estados: true, portais: true, modalidades: true, modos: false, municipios: false, orgao: false, valores: false, outros: true });
  const campoBusca = useRef<HTMLInputElement>(null);
  const alternarSecao = (k: string) => setSecoes((x) => ({ ...x, [k]: !x[k] }));
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<EtapaPncp>("dados");
  const [escolhendo, setEscolhendo] = useState<ResultadoPncp | null>(null);
  const abrir = (id: string, e: EtapaPncp = "dados") => {
    setDetalhe(id);
    setEtapa(e);
  };

  // Quais licitações do PNCP já estão no quadro.
  useEffect(() => {
    api<{ licitacoes: LicitacaoResumo[] }>("/licitacoes").then(
      (r) => setNoQuadro(Object.fromEntries(r.licitacoes.filter((l) => l.pncp_id).map((l) => [l.pncp_id!, l.id]))),
      () => {},
    );
  }, []);

  const mudar = (novo: Partial<FiltrosBusca>) => setFiltros((f) => ({ ...f, ...novo }));
  const alternar = (lista: string[], valor: string) => (lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor]);

  async function buscar(pag = 1, f = filtros) {
    setBuscando(true);
    setErro("");
    try {
      localStorage.setItem(CHAVE_FILTROS, JSON.stringify(f));
    } catch {
      /* sem armazenamento */
    }
    try {
      const r = await buscarLicitacoes(f, pag);
      setUsados(f);
      setPagina(pag);
      if (pag === 1) setMostrar(POR_TELA);
      setResposta((atual) =>
        pag === 1 || !atual ? r : { ...r, itens: [...atual.itens, ...r.itens.filter((i) => !atual.itens.some((x) => x.id === i.id))] },
      );
    } catch (err) {
      setErro(mensagemDeErro(err));
      if (pag === 1) setResposta({ itens: [], total: 0, varredura: false });
    } finally {
      setBuscando(false);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    buscar(1);
  }

  // Atalhos de data e ordem já disparam a busca quando há resultados na tela.
  function mudarEBuscar(novo: Partial<FiltrosBusca>) {
    const f = { ...filtros, ...novo };
    setFiltros(f);
    if (resposta) buscar(1, f);
  }

  async function importar(r: ResultadoPncp, escolhidos: ItemPncp[]) {
    setEscolhendo(null);
    setImportando({ id: r.id, etapa: "Lendo dados…" });
    let id: number | null = null;
    try {
      const imp = await prepararImportacao(r, escolhidos);
      const criada = await api<{ licitacao: { id: number } }>("/licitacoes", { corpo: imp.dados });
      id = criada.licitacao.id;
      if (imp.itens.length) await api(`/licitacoes/${id}/itens`, { corpo: { itens: imp.itens } });
      // O servidor busca cada arquivo no PNCP e anexa (o navegador não consegue baixar direto de lá).
      let anexados = 0;
      for (const [n, a] of imp.arquivos.entries()) {
        setImportando({ id: r.id, etapa: `Anexando arquivo ${n + 1} de ${imp.arquivos.length}…` });
        const ok = await api(`/licitacoes/${id}/edital-pncp`, { corpo: a }).then(
          () => true,
          () => false,
        );
        if (ok) anexados++;
      }
      const criadaId = id;
      setNoQuadro((m) => ({ ...m, [r.id]: criadaId }));
      const faltaram = imp.arquivos.length - anexados;
      avisar(
        `Adicionada em "Para estudar" com ${imp.itens.length} item(ns) e ${anexados} arquivo(s)${faltaram ? ` (${faltaram} não veio do PNCP; tente pela ficha)` : ""}.`,
        faltaram ? "erro" : "sucesso",
      );
    } catch (err) {
      const criadaId = id;
      if (criadaId) setNoQuadro((m) => ({ ...m, [r.id]: criadaId }));
      const e = err as { status?: number };
      if (e.status === 409) avisar("Esta licitação já está no quadro.", "erro");
      else avisar(mensagemDeErro(err), "erro");
    } finally {
      setImportando(null);
    }
  }

  function limparFiltros() {
    setFiltros({ ...FILTROS_PADRAO, palavra: filtros.palavra });
  }

  const avancados = filtrosAvancados(filtros);
  const resultados = resposta?.itens ?? null;
  const visiveis = resposta?.varredura ? (resultados ?? []).slice(0, mostrar) : resultados ?? [];
  const posAberto = detalhe && resultados ? resultados.findIndex((x) => x.id === detalhe) : -1;
  const aberto = posAberto >= 0 ? resultados![posAberto] : null;
  function irPara(pos: number) {
    if (!resultados?.[pos]) return;
    setDetalhe(resultados[pos].id); // mantém a etapa (dados, itens ou arquivos) ao passar para a próxima
    if (resposta?.varredura && pos >= mostrar) setMostrar(pos + 1);
    // Chegando no fim do que já veio do PNCP: busca a próxima página.
    if (!resposta?.varredura && pos >= resultados.length - 2 && resultados.length < (resposta?.total ?? 0) && !buscando) buscar(pagina + 1);
  }
  const temMais = resposta ? (resposta.varredura ? mostrar < resposta.itens.length : resposta.itens.length < resposta.total) : false;

  // Mudar a ordem na tela reordena o que já veio (sem nova busca) quando já está tudo carregado.
  function mudarOrdem(ordem: FiltrosBusca["ordem"]) {
    const f = { ...filtros, ordem };
    setFiltros(f);
    if (!resposta) return;
    if (resposta.varredura || ordem === "sessao" || !usados || usados.ordem === "sessao" || ordem === "relevancia" || usados.ordem === "relevancia") buscar(1, f);
    else setResposta({ ...resposta, itens: ordenar(resposta.itens, ordem) });
  }

  function resumoBusca() {
    if (!resposta) return "";
    if (resposta.varredura) {
      const base = `${resposta.total.toLocaleString("pt-BR")} licitação(ões) encontrada(s)`;
      const incompleto = resposta.existentes && resposta.analisadas && resposta.analisadas < resposta.existentes;
      return incompleto
        ? `${base} entre as ${resposta.analisadas!.toLocaleString("pt-BR")} mais recentes de ${resposta.existentes!.toLocaleString("pt-BR")}. Para ver todas, marque estados ou use palavra-chave.`
        : base;
    }
    return `${resposta.total.toLocaleString("pt-BR")} resultado(s) · mostrando ${resposta.itens.length}`;
  }

  const marcarTodos = (k: "ufs" | "plataformas" | "modalidades", todos: string[]) => mudar({ [k]: todos } as Partial<FiltrosBusca>);

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Buscar licitações</h1>
          <p className="texto-suave">Editais publicados no PNCP (Portal Nacional de Contratações Públicas), o portal oficial onde os órgãos publicam.</p>
        </div>
      </div>

      <form className="barra-busca entrar" onSubmit={enviar}>
        <div className={`busca-lupa ${buscaAberta || filtros.palavra ? "aberta" : ""}`}>
          <button
            type="button"
            className="botao-lupa"
            onClick={() => {
              setBuscaAberta(true);
              setTimeout(() => campoBusca.current?.focus(), 60);
            }}
            aria-label="Buscar por palavra"
            title="Buscar por palavra (ex.: notebook, uniforme)"
          >
            <Search />
          </button>
          <input
            ref={campoBusca}
            placeholder="Encontrar: notebooks, uniformes, merenda escolar…"
            value={filtros.palavra}
            onChange={(e) => mudar({ palavra: e.target.value })}
            onBlur={() => !filtros.palavra && setBuscaAberta(false)}
            aria-label="Palavra-chave"
            tabIndex={buscaAberta || filtros.palavra ? 0 : -1}
          />
          {filtros.palavra && (
            <button type="button" className="limpar-lupa" onClick={() => mudar({ palavra: "" })} aria-label="Limpar palavra">
              <X size={14} />
            </button>
          )}
        </div>
        <label className="campo-barra">
          <Hash size={15} />
          <input placeholder="Nº da licitação" value={filtros.numero} onChange={(e) => mudar({ numero: e.target.value })} aria-label="Número da licitação" />
        </label>
        <label className="campo-barra">
          <Landmark size={15} />
          <input placeholder="UASG ou CNPJ do órgão" inputMode="numeric" value={filtros.uasg} onChange={(e) => mudar({ uasg: e.target.value })} aria-label="UASG ou CNPJ do órgão" />
        </label>
        <button type="button" className={`botao-barra ${avancados ? "com-filtros" : ""}`} onClick={() => setAvancada(true)} aria-label="Pesquisa avançada" title="Pesquisa avançada">
          <SlidersHorizontal />
          {avancados > 0 && <span className="contador-filtros">{avancados}</span>}
        </button>
        <label className="periodo-barra" title="Data da sessão">
          <CalendarClock size={15} />
          <select value={filtros.sessao} onChange={(e) => (e.target.value === "periodo" ? mudar({ sessao: "periodo" }) : mudarEBuscar({ sessao: e.target.value as FiltrosBusca["sessao"] }))} aria-label="Data da sessão">
            {PERIODOS_SESSAO.map((x) => (
              <option key={x.valor} value={x.valor}>
                {x.valor === "" ? "Sessão: qualquer data" : x.nome}
              </option>
            ))}
          </select>
        </label>
        {filtros.sessao === "periodo" && (
          <span className="datas-barra">
            <input type="date" value={filtros.sessaoDe} onChange={(e) => mudar({ sessaoDe: e.target.value })} aria-label="Sessão a partir de" />
            até
            <input type="date" value={filtros.sessaoAte} onChange={(e) => mudar({ sessaoAte: e.target.value })} aria-label="Sessão até" />
          </span>
        )}
        <button className="botao acento botao-buscar" disabled={buscando}>
          {buscando ? <Loader2 className="girando" /> : <Search />} Buscar
        </button>
      </form>

      {avancados > 0 && (
        <div className="filtros-ativos entrar">
          {filtros.ufs.length > 0 && <span className="chip">{filtros.ufs.join(", ")}</span>}
          {filtros.municipios.map((m) => (
            <span key={m.ibge} className="chip">
              {m.nome}/{m.uf}
            </span>
          ))}
          {filtros.modalidades.length > 0 && (
            <span className="chip">{filtros.modalidades.map((c) => MODALIDADES_PNCP.find((m) => m.codigo === c)?.nome).join(", ")}</span>
          )}
          {filtros.plataformas.length > 0 && <span className="chip">{filtros.plataformas.join(", ")}</span>}
          {filtros.srp === "sim" && <span className="chip">Só registro de preço</span>}
          {filtros.srp === "nao" && <span className="chip">Sem registro de preço</span>}
          {filtros.meEpp && <span className="chip">Exclusiva ME/EPP</span>}
          {filtros.tipoItem && <span className="chip">{filtros.tipoItem === "M" ? "Material" : "Serviço"}</span>}
          {(filtros.modosDisputa ?? []).length > 0 && <span className="chip">{filtros.modosDisputa.map((c) => MODOS_DISPUTA.find((m) => m.codigo === c)?.nome).join(", ")}</span>}
          {filtros.situacao === "todas" && <span className="chip">Todas as situações</span>}
          <button type="button" className="botao link pequeno" onClick={limparFiltros}>
            <X size={13} /> Limpar filtros
          </button>
        </div>
      )}

      {erro && <p className="alerta erro">{erro}</p>}

      {resultados === null ? (
        <section className="cartao">
          <Vazio icone={<FileSearch />} titulo={buscando ? "Buscando no PNCP…" : "Escolha os filtros e clique em Buscar"}>
            Dica: clique na lupa para buscar pelo produto (notebook, uniforme…), ou informe o número da licitação ou a UASG. Os estados, portais e modalidades
            ficam na pesquisa avançada (<SlidersHorizontal size={13} />).
          </Vazio>
        </section>
      ) : resultados.length === 0 && !buscando ? (
        <section className="cartao">
          <Vazio icone={<FileSearch />} titulo="Nenhuma licitação encontrada">
            Tente outra palavra, tire algum filtro, aumente o período da sessão ou escolha "Todas" em Situação.
          </Vazio>
        </section>
      ) : (
        <>
          <div className="barra-resultados">
            <p className="texto-fraco pequeno resumo-busca">
              {buscando && <Loader2 className="girando" size={13} />} {resumoBusca()}
            </p>
            <label className="ordem-resultados">
              <span className="texto-fraco pequeno">Ordenar por</span>
              <select value={filtros.ordem} onChange={(e) => mudarOrdem(e.target.value as FiltrosBusca["ordem"])} aria-label="Ordenar por">
                <option value="recentes">Publicadas recentemente</option>
                <option value="sessao">Sessão mais próxima</option>
                <option value="relevancia">Mais parecidas com a palavra</option>
              </select>
            </label>
          </div>
          <div className="lista-pncp">
            {visiveis.map((r) => {
              const idQuadro = noQuadro[r.id];
              const objetoAberto = abertos[r.id];
              const quando = tempoAte(r.encerramento);
              const importandoEste = importando?.id === r.id;
              return (
                <article
                  key={r.id}
                  className={`resultado-pncp clicavel ${r.cancelado || quando?.classe === "passou" ? "apagado" : ""}`}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a, button, input, select")) return;
                    if (window.getSelection()?.toString()) return; // estava selecionando texto
                    abrir(r.id);
                  }}
                >
                  <div className="resultado-topo">
                    <h3>
                      <button className="titulo-resultado" onClick={() => abrir(r.id)}>
                        {r.modalidade} Nº {r.numero}/{r.ano} - {r.orgao}
                        {r.uf && ` / ${r.uf}`}
                      </button>
                    </h3>
                    <div className="acoes-resultado">
                      <button className="botao-icone" onClick={() => abrir(r.id, "itens")} aria-label="Ver itens" title="Ver itens">
                        <ListOrdered />
                      </button>
                      <button className="botao-icone" onClick={() => abrir(r.id, "arquivos")} aria-label="Ver arquivos" title="Ver arquivos">
                        <FolderOpen />
                      </button>
                      <a className="botao-icone" href={r.linkPncp} target="_blank" rel="noreferrer noopener" aria-label="Ver no PNCP" title="Ver no PNCP">
                        <ExternalLink />
                      </a>
                      {r.linkPortal && (
                        <a className="botao-icone" href={r.linkPortal} target="_blank" rel="noreferrer noopener" aria-label={`Abrir no ${r.portal}`} title={`Abrir no ${r.portal}`}>
                          <Globe />
                        </a>
                      )}
                      {idQuadro ? (
                        <a className="botao secundario pequeno" {...link(`/licitacoes/${idQuadro}`)}>
                          <SquareArrowOutUpRight /> No quadro
                        </a>
                      ) : (
                        editar && (
                          <button className="botao acento pequeno" onClick={() => setEscolhendo(r)} disabled={!!importando}>
                            {importandoEste ? <Loader2 className="girando" /> : <Plus />}
                            {importandoEste ? importando.etapa : "Adicionar"}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  <p className={`resultado-pncp-objeto ${objetoAberto ? "aberto" : ""}`}>{r.objeto}</p>
                  {r.objeto.length > 260 && (
                    <button className="botao link pequeno ver-objeto" onClick={() => setAbertos((a) => ({ ...a, [r.id]: !objetoAberto }))}>
                      {objetoAberto ? "Ver menos" : "Ver objeto completo"}
                    </button>
                  )}
                  <div className="tags-resultado">
                    {r.municipio && (
                      <span className="tag-verde">
                        {r.municipio}/{r.uf}
                      </span>
                    )}
                    {r.uasg && <span className="tag-verde">UASG {r.uasg}</span>}
                    {r.unidade && r.unidade !== r.orgao && r.unidade !== "Unidade Única" && <span className="tag-verde">{r.unidade}</span>}
                    {r.esfera && <span className="tag-verde">{r.esfera}</span>}
                  </div>
                  <div className="linha-sessao">
                    <CalendarClock size={15} />
                    {r.encerramento ? <strong>{dataHora(r.encerramento)}</strong> : <span className="texto-fraco">Sem data de sessão</span>}
                    {quando && <span className={`pill-quando ${quando.classe}`}>{quando.texto}</span>}
                    {r.modoDisputa && <span className="texto-fraco">· {r.modoDisputa}</span>}
                  </div>
                  <div className="chips-fonte">
                    <span className="chip-contorno">Fonte: {r.portal}</span>
                    <span className="chip-contorno">{r.modalidade}</span>
                    {r.srp && <span className="chip-contorno laranja">Registro de preço</span>}
                    {r.valorEstimado && <span className="chip-contorno">Estimado {reais(r.valorEstimado)}</span>}
                    {r.cancelado && <span className="chip-contorno vermelho">Cancelada</span>}
                    {idQuadro && <span className="chip-contorno verde">Já no quadro</span>}
                  </div>
                </article>
              );
            })}
          </div>
          {temMais && (
            <div className="carregar-mais">
              <button className="botao secundario" onClick={() => (resposta?.varredura ? setMostrar((m) => m + POR_TELA) : buscar(pagina + 1))} disabled={buscando}>
                {buscando ? "Carregando…" : "Carregar mais"}
              </button>
            </div>
          )}
          {Object.values(noQuadro).length > 0 && (
            <p className="texto-fraco pequeno" style={{ textAlign: "center" }}>
              As licitações adicionadas ficam em{" "}
              <a
                className="link-suave"
                {...link("/licitacoes")}
                onClick={(e) => {
                  e.preventDefault();
                  navegar("/licitacoes");
                }}
              >
                Para estudar
              </a>
              , no quadro.
            </p>
          )}
        </>
      )}

      {avancada && (
        <Modal titulo="Pesquisa avançada" aoFechar={() => setAvancada(false)} largo>
          <form
            className="pesquisa-avancada"
            onSubmit={(e) => {
              e.preventDefault();
              setAvancada(false);
              if (filtros.palavra) setBuscaAberta(true);
              buscar(1);
            }}
          >
            <div className="palavras-avancada">
              <span className="texto-fraco pequeno">Palavras-chave, separadas por ponto e vírgula (;)</span>
              <div className="entrada com-icone">
                <Search />
                <input value={filtros.palavra} onChange={(e) => mudar({ palavra: e.target.value })} placeholder="Ex.: notebook; monitor; impressora" aria-label="Palavras-chave da pesquisa avançada" />
              </div>
            </div>
            <div className="grade-avancada">
              <label className="campo">
                <span>Data da sessão</span>
                <select value={filtros.sessao} onChange={(e) => mudar({ sessao: e.target.value as FiltrosBusca["sessao"] })} aria-label="Período da sessão">
                  {PERIODOS_SESSAO.map((x) => (
                    <option key={x.valor} value={x.valor}>
                      {x.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo">
                <span>Intervalo</span>
                <span className="datas-avancada">
                  <input type="date" value={filtros.sessaoDe} onChange={(e) => mudar({ sessao: "periodo", sessaoDe: e.target.value })} aria-label="Intervalo de" />
                  <input type="date" value={filtros.sessaoAte} onChange={(e) => mudar({ sessao: "periodo", sessaoAte: e.target.value })} aria-label="Intervalo até" />
                </span>
              </label>
              <label className="campo">
                <span>Tipo de item</span>
                <select value={filtros.tipoItem} onChange={(e) => mudar({ tipoItem: e.target.value as FiltrosBusca["tipoItem"] })} aria-label="Tipo de item">
                  <option value="">Todos</option>
                  <option value="M">Material</option>
                  <option value="S">Serviço</option>
                </select>
              </label>
              <label className="campo">
                <span>Situação</span>
                <select value={filtros.situacao} onChange={(e) => mudar({ situacao: e.target.value as FiltrosBusca["situacao"] })} aria-label="Situação">
                  <option value="recebendo_proposta">Recebendo propostas</option>
                  <option value="todas">Todas</option>
                </select>
              </label>
            </div>

            <SecaoFiltro
              titulo="Escolha os estados"
              aberta={secoes.estados}
              aoAlternar={() => alternarSecao("estados")}
              acoes={
                <>
                  <button type="button" className="botao link pequeno" onClick={() => marcarTodos("ufs", [])}>
                    desmarcar todos
                  </button>
                  <button type="button" className="botao link pequeno" onClick={() => marcarTodos("ufs", [...UFS])}>
                    marcar todos
                  </button>
                </>
              }
            >
              <div className="chips-filtro centralizados">
                {UFS.map((uf) => (
                  <button type="button" key={uf} className={`chip-filtro uf ${filtros.ufs.includes(uf) ? "ativo" : ""}`} onClick={() => mudar({ ufs: alternar(filtros.ufs, uf) })}>
                    {uf}
                  </button>
                ))}
              </div>
            </SecaoFiltro>

            <SecaoFiltro titulo="Municípios" aberta={secoes.municipios} aoAlternar={() => alternarSecao("municipios")}>
              <FiltroMunicipios ufs={filtros.ufs} valor={filtros.municipios} aoMudar={(municipios) => mudar({ municipios })} />
            </SecaoFiltro>

            <SecaoFiltro
              titulo="Escolha os portais de compra"
              aberta={secoes.portais}
              aoAlternar={() => alternarSecao("portais")}
              acoes={
                <>
                  <button type="button" className="botao link pequeno" onClick={() => marcarTodos("plataformas", [])}>
                    desmarcar todos
                  </button>
                  <button type="button" className="botao link pequeno" onClick={() => marcarTodos("plataformas", [...PLATAFORMAS])}>
                    marcar todos
                  </button>
                </>
              }
            >
              <div className="chips-filtro centralizados">
                {PLATAFORMAS.map((pl) => (
                  <button type="button" key={pl} className={`chip-filtro ${filtros.plataformas.includes(pl) ? "ativo" : ""}`} onClick={() => mudar({ plataformas: alternar(filtros.plataformas, pl) })}>
                    {pl}
                  </button>
                ))}
              </div>
            </SecaoFiltro>

            <SecaoFiltro
              titulo="Escolha as modalidades"
              aberta={secoes.modalidades}
              aoAlternar={() => alternarSecao("modalidades")}
              acoes={
                <>
                  <button type="button" className="botao link pequeno" onClick={() => marcarTodos("modalidades", [])}>
                    desmarcar todos
                  </button>
                  <button type="button" className="botao link pequeno" onClick={() => marcarTodos("modalidades", MODALIDADES_PNCP.map((m) => m.codigo))}>
                    marcar todos
                  </button>
                </>
              }
            >
              <div className="chips-filtro centralizados">
                {MODALIDADES_PNCP.map((m) => (
                  <button type="button" key={m.codigo} className={`chip-filtro ${filtros.modalidades.includes(m.codigo) ? "ativo" : ""}`} onClick={() => mudar({ modalidades: alternar(filtros.modalidades, m.codigo) })}>
                    {m.nome}
                  </button>
                ))}
              </div>
            </SecaoFiltro>

            <SecaoFiltro titulo="Modo de disputa" aberta={secoes.modos} aoAlternar={() => alternarSecao("modos")}>
              <div className="chips-filtro centralizados">
                {MODOS_DISPUTA.map((m) => (
                  <button type="button" key={m.codigo} className={`chip-filtro ${(filtros.modosDisputa ?? []).includes(m.codigo) ? "ativo" : ""}`} onClick={() => mudar({ modosDisputa: alternar(filtros.modosDisputa ?? [], m.codigo) })}>
                    {m.nome}
                  </button>
                ))}
              </div>
            </SecaoFiltro>

            <SecaoFiltro titulo="Filtrar por órgão" aberta={secoes.orgao} aoAlternar={() => alternarSecao("orgao")}>
              <div className="entrada">
                <input value={filtros.orgao} onChange={(e) => mudar({ orgao: e.target.value })} placeholder="Nome do órgão (ex.: Prefeitura de Campinas) ou CNPJ" aria-label="Órgão" />
              </div>
            </SecaoFiltro>

            <SecaoFiltro titulo="Filtrar por valores" aberta={secoes.valores} aoAlternar={() => alternarSecao("valores")}>
              <div className="grade-avancada">
                <label className="campo">
                  <span>Valor estimado de (R$)</span>
                  <span className="entrada">
                    <input inputMode="decimal" value={filtros.valorMin} onChange={(e) => mudar({ valorMin: e.target.value })} aria-label="Valor mínimo" />
                  </span>
                </label>
                <label className="campo">
                  <span>Até (R$)</span>
                  <span className="entrada">
                    <input inputMode="decimal" value={filtros.valorMax} onChange={(e) => mudar({ valorMax: e.target.value })} aria-label="Valor máximo" />
                  </span>
                </label>
              </div>
            </SecaoFiltro>

            <SecaoFiltro titulo="Outros filtros" aberta={secoes.outros} aoAlternar={() => alternarSecao("outros")}>
              <div className="outros-filtros">
                <Interruptor ligado={filtros.meEpp} aoMudar={(v) => mudar({ meEpp: v })} rotulo="Participação exclusiva (ME/EPP)" />
                <Interruptor ligado={filtros.srp === "nao"} aoMudar={(v) => mudar({ srp: v ? "nao" : "" })} rotulo="Excluir registros de preços" />
                <Interruptor ligado={filtros.srp === "sim"} aoMudar={(v) => mudar({ srp: v ? "sim" : "" })} rotulo="Só registros de preços" />
              </div>
              <div className="chips-filtro centralizados" style={{ marginTop: 10 }}>
                {ESFERAS.map((e) => (
                  <button type="button" key={e.codigo} className={`chip-filtro ${filtros.esferas.includes(e.codigo) ? "ativo" : ""}`} onClick={() => mudar({ esferas: alternar(filtros.esferas, e.codigo) })}>
                    {e.nome}
                  </button>
                ))}
              </div>
            </SecaoFiltro>

            <div className="rodape-avancada">
              <button type="button" className="botao secundario" onClick={limparFiltros}>
                Limpar filtros
              </button>
              <button className="botao acento">
                <Search /> Buscar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {aberto && (
        <DetalhePncp
          resultado={aberto}
          etapa={etapa}
          aoMudarEtapa={setEtapa}
          idQuadro={noQuadro[aberto.id]}
          podeImportar={editar}
          importando={importando?.id === aberto.id ? importando.etapa : null}
          ocupado={!!importando && importando.id !== aberto.id}
          aoImportar={() => setEscolhendo(aberto)}
          aoFechar={() => setDetalhe(null)}
          anterior={posAberto > 0 ? () => irPara(posAberto - 1) : undefined}
          proxima={posAberto >= 0 && posAberto < (resultados?.length ?? 0) - 1 ? () => irPara(posAberto + 1) : undefined}
          posicao={posAberto >= 0 ? `${posAberto + 1} de ${resposta?.varredura ? resultados!.length : resposta!.total}` : undefined}
        />
      )}
      {escolhendo && <EscolherItensPncp resultado={escolhendo} aoConfirmar={(itens) => importar(escolhendo, itens)} aoFechar={() => setEscolhendo(null)} />}
    </>
  );
}
