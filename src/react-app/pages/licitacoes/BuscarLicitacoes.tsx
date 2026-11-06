import {
  CalendarClock,
  ExternalLink,
  FileSearch,
  FolderOpen,
  Landmark,
  Loader2,
  MapPin,
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
import { avisar, Vazio } from "../../components/Ui";
import { useFecharAoClicarFora } from "../../components/useFecharAoClicarFora";
import { link, navegar } from "../../rota";
import {
  buscarLicitacoes,
  carregarMunicipios,
  ESFERAS,
  FILTROS_PADRAO,
  type FiltrosBusca,
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
import { DetalhePncp, dataHora, quandoSessao, reais } from "./DetalhePncp";

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
function filtrosExtras(f: FiltrosBusca) {
  return [f.municipios.length > 0, !!f.uasg.trim(), !!f.orgao.trim(), f.esferas.length > 0, !!f.valorMin.trim() || !!f.valorMax.trim()].filter(Boolean).length;
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
  const [verUfs, setVerUfs] = useState(false);
  const [maisFiltros, setMaisFiltros] = useState(() => filtrosExtras(lerFiltros()) > 0);
  const [detalhe, setDetalhe] = useState<string | null>(null);

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

  async function importar(r: ResultadoPncp) {
    setImportando({ id: r.id, etapa: "Lendo dados e itens…" });
    let id: number | null = null;
    try {
      const imp = await prepararImportacao(r);
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

  const extras = filtrosExtras(filtros);
  const resultados = resposta?.itens ?? null;
  const visiveis = resposta?.varredura ? (resultados ?? []).slice(0, mostrar) : resultados ?? [];
  const posAberto = detalhe && resultados ? resultados.findIndex((x) => x.id === detalhe) : -1;
  const aberto = posAberto >= 0 ? resultados![posAberto] : null;
  function irPara(pos: number) {
    if (!resultados?.[pos]) return;
    setDetalhe(resultados[pos].id);
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

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Buscar licitações</h1>
          <p className="texto-suave">Editais publicados no PNCP (Portal Nacional de Contratações Públicas), o portal oficial onde os órgãos publicam.</p>
        </div>
      </div>

      <form className="cartao filtros-pncp entrar" onSubmit={enviar}>
        <div className="filtros-pncp-linha">
          <div className="entrada com-icone busca">
            <Search />
            <input
              placeholder="Palavra-chave: produto ou objeto (ex.: notebook, pilha, material de limpeza)"
              value={filtros.palavra}
              onChange={(e) => mudar({ palavra: e.target.value })}
              aria-label="Palavra-chave"
            />
          </div>
          <div className="entrada numero-pncp">
            <input placeholder="Nº da licitação (ex.: 90008/2026)" value={filtros.numero} onChange={(e) => mudar({ numero: e.target.value })} aria-label="Número da licitação" />
          </div>
          <button className="botao acento" disabled={buscando}>
            {buscando ? <Loader2 className="girando" /> : <Search />} Buscar
          </button>
        </div>

        <div className="filtros-pncp-grupo">
          <span className="rotulo-filtro">Data da sessão</span>
          <div className="chips-filtro">
            {PERIODOS_SESSAO.map((p) => (
              <button
                type="button"
                key={p.valor}
                className={`chip-filtro ${filtros.sessao === p.valor ? "ativo" : ""}`}
                onClick={() => (p.valor === "periodo" ? mudar({ sessao: "periodo" }) : mudarEBuscar({ sessao: p.valor }))}
              >
                {p.nome}
              </button>
            ))}
            {filtros.sessao === "periodo" && (
              <span className="periodo-sessao">
                <input type="date" value={filtros.sessaoDe} onChange={(e) => mudar({ sessaoDe: e.target.value })} aria-label="Sessão a partir de" />
                até
                <input type="date" value={filtros.sessaoAte} onChange={(e) => mudar({ sessaoAte: e.target.value })} aria-label="Sessão até" />
              </span>
            )}
          </div>
        </div>

        <div className="filtros-pncp-grupo">
          <span className="rotulo-filtro">Situação</span>
          <div className="segmentado pequeno">
            <button type="button" className={filtros.situacao === "recebendo_proposta" ? "ativo" : ""} onClick={() => mudar({ situacao: "recebendo_proposta" })}>
              Recebendo propostas
            </button>
            <button type="button" className={filtros.situacao === "todas" ? "ativo" : ""} onClick={() => mudar({ situacao: "todas" })}>
              Todas
            </button>
          </div>
        </div>

        <div className="filtros-pncp-grupo">
          <span className="rotulo-filtro">Modalidade</span>
          <div className="chips-filtro">
            {MODALIDADES_PNCP.map((m) => (
              <button type="button" key={m.codigo} className={`chip-filtro ${filtros.modalidades.includes(m.codigo) ? "ativo" : ""}`} onClick={() => mudar({ modalidades: alternar(filtros.modalidades, m.codigo) })}>
                {m.nome}
              </button>
            ))}
            {filtros.modalidades.length === 0 ? (
              <span className="texto-fraco pequeno">Todas as modalidades</span>
            ) : (
              <button type="button" className="botao link pequeno" onClick={() => mudar({ modalidades: [] })}>
                <X size={13} /> Todas
              </button>
            )}
          </div>
        </div>

        <div className="filtros-pncp-grupo">
          <span className="rotulo-filtro">Registro de preço</span>
          <div className="segmentado pequeno">
            {([["", "Tanto faz"], ["sim", "Só registro de preço"], ["nao", "Sem registro de preço"]] as const).map(([v, t]) => (
              <button key={v} type="button" className={filtros.srp === v ? "ativo" : ""} onClick={() => mudar({ srp: v })}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="filtros-pncp-grupo">
          <span className="rotulo-filtro">Plataforma</span>
          <div className="chips-filtro">
            {PLATAFORMAS.map((pl) => (
              <button type="button" key={pl} className={`chip-filtro ${filtros.plataformas.includes(pl) ? "ativo" : ""}`} onClick={() => mudar({ plataformas: alternar(filtros.plataformas, pl) })}>
                {pl}
              </button>
            ))}
            {filtros.plataformas.length === 0 ? (
              <span className="texto-fraco pequeno">Todas as plataformas</span>
            ) : (
              <button type="button" className="botao link pequeno" onClick={() => mudar({ plataformas: [] })}>
                <X size={13} /> Todas
              </button>
            )}
          </div>
        </div>

        <div className="filtros-pncp-grupo">
          <span className="rotulo-filtro">Estado</span>
          <div className="chips-filtro">
            {filtros.ufs.length === 0 && !verUfs && <span className="texto-fraco pequeno">Todos os estados</span>}
            {(verUfs ? UFS : filtros.ufs).map((uf) => (
              <button type="button" key={uf} className={`chip-filtro uf ${filtros.ufs.includes(uf) ? "ativo" : ""}`} onClick={() => mudar({ ufs: alternar(filtros.ufs, uf) })}>
                {uf}
              </button>
            ))}
            <button type="button" className="botao link pequeno" onClick={() => setVerUfs((v) => !v)}>
              {verUfs ? "Fechar" : "Escolher estados"}
            </button>
            {filtros.ufs.length > 0 && (
              <button type="button" className="botao link pequeno" onClick={() => mudar({ ufs: [] })}>
                <X size={13} /> Limpar
              </button>
            )}
          </div>
        </div>

        <div className="mais-filtros-topo">
          <button type="button" className="botao link pequeno" onClick={() => setMaisFiltros((v) => !v)} aria-expanded={maisFiltros}>
            <SlidersHorizontal size={14} /> {maisFiltros ? "Menos filtros" : "Mais filtros"}
            {extras > 0 && <span className="contador-filtros">{extras}</span>}
          </button>
          <span className="texto-fraco pequeno">Município, UASG, órgão, esfera e valor</span>
          {(extras > 0 || filtros.sessao || filtros.numero || filtros.srp || filtros.plataformas.length > 0) && (
            <button type="button" className="botao link pequeno" onClick={limparFiltros}>
              <X size={13} /> Limpar filtros
            </button>
          )}
        </div>

        {maisFiltros && (
          <div className="mais-filtros">
            <div className="filtros-pncp-grupo">
              <span className="rotulo-filtro">Município</span>
              <FiltroMunicipios ufs={filtros.ufs} valor={filtros.municipios} aoMudar={(municipios) => mudar({ municipios })} />
            </div>
            <div className="filtros-pncp-grupo">
              <span className="rotulo-filtro">UASG</span>
              <div className="entrada pequena-entrada">
                <input placeholder="Código da unidade (ex.: 158149)" inputMode="numeric" value={filtros.uasg} onChange={(e) => mudar({ uasg: e.target.value })} aria-label="UASG" />
              </div>
              <span className="rotulo-filtro curto">Órgão</span>
              <div className="entrada pequena-entrada largo">
                <input placeholder="Nome ou CNPJ do órgão" value={filtros.orgao} onChange={(e) => mudar({ orgao: e.target.value })} aria-label="Órgão" />
              </div>
            </div>
            <div className="filtros-pncp-grupo">
              <span className="rotulo-filtro">Esfera</span>
              <div className="chips-filtro">
                {ESFERAS.map((e) => (
                  <button type="button" key={e.codigo} className={`chip-filtro ${filtros.esferas.includes(e.codigo) ? "ativo" : ""}`} onClick={() => mudar({ esferas: alternar(filtros.esferas, e.codigo) })}>
                    {e.nome}
                  </button>
                ))}
              </div>
            </div>
            <div className="filtros-pncp-grupo">
              <span className="rotulo-filtro">Valor estimado</span>
              <div className="entrada pequena-entrada">
                <input placeholder="De R$" inputMode="decimal" value={filtros.valorMin} onChange={(e) => mudar({ valorMin: e.target.value })} aria-label="Valor mínimo" />
              </div>
              <div className="entrada pequena-entrada">
                <input placeholder="Até R$" inputMode="decimal" value={filtros.valorMax} onChange={(e) => mudar({ valorMax: e.target.value })} aria-label="Valor máximo" />
              </div>
            </div>
          </div>
        )}
      </form>

      {erro && <p className="alerta erro">{erro}</p>}

      {resultados === null ? (
        <section className="cartao">
          <Vazio icone={<FileSearch />} titulo={buscando ? "Buscando no PNCP…" : "Escolha os filtros e clique em Buscar"}>
            Dica: use o nome do produto que vocês vendem, marque os estados em que atendem e use "Próximos 3 dias" para ver as sessões que estão chegando.
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
              const aberto = abertos[r.id];
              const quando = quandoSessao(r.encerramento);
              const importandoEste = importando?.id === r.id;
              return (
                <article
                  key={r.id}
                  className={`resultado-pncp clicavel ${r.cancelado ? "cancelado" : ""}`}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a, button, input, select")) return;
                    if (window.getSelection()?.toString()) return; // estava selecionando texto
                    setDetalhe(r.id);
                  }}
                >
                  <div className="resultado-pncp-etiquetas">
                    <span className="chip">{r.modalidade}</span>
                    {r.srp && <span className="chip azul" title="Sistema de Registro de Preços">Registro de preço</span>}
                    <span className="chip">
                      <MapPin size={11} /> {r.municipio ? `${r.municipio}/` : ""}
                      {r.uf}
                    </span>
                    {r.encerramento && (
                      <span className={`chip destaque sessao ${quando?.classe ?? ""}`}>
                        <CalendarClock size={11} /> Sessão {dataHora(r.encerramento)}
                        {quando && quando.texto !== "encerrada" && <strong> · {quando.texto}</strong>}
                      </span>
                    )}
                    {r.cancelado && <span className="chip vermelho">Cancelada</span>}
                    {idQuadro && <span className="chip verde">Já no quadro</span>}
                  </div>
                  <h3>
                    <button className="titulo-resultado" onClick={() => setDetalhe(r.id)}>
                      {r.modalidade} nº {r.numero}/{r.ano}
                    </button>
                  </h3>
                  <p className="resultado-pncp-orgao">
                    <Landmark size={12} /> {r.orgao}
                    {r.unidade && r.unidade !== r.orgao && r.unidade !== "Unidade Única" ? ` · ${r.unidade}` : ""}
                    {r.uasg && ` · UASG ${r.uasg}`}
                  </p>
                  <p className={`resultado-pncp-objeto ${aberto ? "aberto" : ""}`}>{r.objeto}</p>
                  {r.objeto.length > 220 && (
                    <button className="botao link pequeno" onClick={() => setAbertos((a) => ({ ...a, [r.id]: !aberto }))}>
                      {aberto ? "Ver menos" : "Ver objeto completo"}
                    </button>
                  )}
                  <div className="resultado-pncp-numeros">
                    {r.valorEstimado && (
                      <span>
                        Valor estimado <strong>{reais(r.valorEstimado)}</strong>
                      </span>
                    )}
                    {r.modoDisputa && <span>Disputa {r.modoDisputa.toLowerCase()}</span>}
                    {r.esfera && <span>{r.esfera}</span>}
                    <span>Publicada em {dataHora(r.publicadoEm).split(" às")[0]}</span>
                  </div>
                  <div className="resultado-pncp-acoes">
                    <button className="botao secundario pequeno" onClick={() => setDetalhe(r.id)}>
                      <FolderOpen /> Ver tudo
                    </button>
                    <a className="botao secundario pequeno" href={r.linkPncp} target="_blank" rel="noreferrer noopener">
                      <ExternalLink /> PNCP
                    </a>
                    {r.linkPortal ? (
                      <a className="botao secundario pequeno" href={r.linkPortal} target="_blank" rel="noreferrer noopener" title={r.linkPortal}>
                        <ExternalLink /> {r.portal}
                      </a>
                    ) : (
                      <span className="texto-fraco pequeno portal-sem-link">Portal: {r.portal}</span>
                    )}
                    {idQuadro ? (
                      <a className="botao secundario pequeno" {...link(`/licitacoes/${idQuadro}`)}>
                        <SquareArrowOutUpRight /> Abrir no quadro
                      </a>
                    ) : (
                      editar && (
                        <button className="botao acento pequeno" onClick={() => importar(r)} disabled={!!importando}>
                          {importandoEste ? <Loader2 className="girando" /> : <Plus />}
                          {importandoEste ? importando.etapa : "Adicionar ao quadro"}
                        </button>
                      )
                    )}
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

      {aberto && (
        <DetalhePncp
          resultado={aberto}
          idQuadro={noQuadro[aberto.id]}
          podeImportar={editar}
          importando={importando?.id === aberto.id ? importando.etapa : null}
          ocupado={!!importando && importando.id !== aberto.id}
          aoImportar={() => importar(aberto)}
          aoFechar={() => setDetalhe(null)}
          anterior={posAberto > 0 ? () => irPara(posAberto - 1) : undefined}
          proxima={posAberto >= 0 && posAberto < (resultados?.length ?? 0) - 1 ? () => irPara(posAberto + 1) : undefined}
          posicao={posAberto >= 0 ? `${posAberto + 1} de ${resposta?.varredura ? resultados!.length : resposta!.total}` : undefined}
        />
      )}
    </>
  );
}
