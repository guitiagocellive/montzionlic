import { CalendarClock, ExternalLink, FileSearch, Loader2, MapPin, Plus, Search, SquareArrowOutUpRight, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { podeEditar } from "../../../shared/permissoes";
import type { LicitacaoResumo, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { avisar, Vazio } from "../../components/Ui";
import { link, navegar } from "../../rota";
import { buscarLicitacoes, type FiltrosBusca, MODALIDADES_PNCP, prepararImportacao, type ResultadoPncp, UFS } from "../../pncp";

const CHAVE_FILTROS = "montzion:busca-pncp";
const FILTROS_PADRAO: FiltrosBusca = { palavra: "", numero: "", ufs: [], modalidades: ["6", "8"], situacao: "recebendo_proposta" };

function lerFiltros(): FiltrosBusca {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_FILTROS) ?? "null");
    return salvo ? { ...FILTROS_PADRAO, ...salvo } : FILTROS_PADRAO;
  } catch {
    return FILTROS_PADRAO;
  }
}

function dataHora(iso: string | null) {
  if (!iso) return "";
  const [d, h] = iso.split("T");
  const [a, m, dia] = d.split("-");
  return `${dia}/${m}/${a}${h ? ` às ${h.slice(0, 5)}` : ""}`;
}

export function BuscarLicitacoes({ usuario }: { usuario: Usuario }) {
  const editar = podeEditar(usuario.permissoes, "licitacoes");
  const [filtros, setFiltros] = useState<FiltrosBusca>(lerFiltros);
  const [resultados, setResultados] = useState<ResultadoPncp[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [noQuadro, setNoQuadro] = useState<Record<string, number>>({});
  const [importando, setImportando] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [verUfs, setVerUfs] = useState(false);

  // Quais licitações do PNCP já estão no quadro.
  useEffect(() => {
    api<{ licitacoes: LicitacaoResumo[] }>("/licitacoes").then(
      (r) => setNoQuadro(Object.fromEntries(r.licitacoes.filter((l) => l.pncp_id).map((l) => [l.pncp_id!, l.id]))),
      () => {},
    );
  }, []);

  const mudar = (novo: Partial<FiltrosBusca>) => setFiltros((f) => ({ ...f, ...novo }));
  const alternar = (lista: string[], valor: string) => (lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor]);

  async function buscar(pag = 1) {
    setBuscando(true);
    setErro("");
    try {
      localStorage.setItem(CHAVE_FILTROS, JSON.stringify(filtros));
    } catch {
      /* sem armazenamento */
    }
    try {
      const r = await buscarLicitacoes(filtros, pag);
      setTotal(r.total);
      setPagina(pag);
      setResultados((atual) => (pag === 1 ? r.itens : [...(atual ?? []), ...r.itens.filter((i) => !(atual ?? []).some((x) => x.id === i.id))]));
    } catch (err) {
      setErro(mensagemDeErro(err));
      if (pag === 1) setResultados([]);
    } finally {
      setBuscando(false);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    buscar(1);
  }

  async function importar(r: ResultadoPncp) {
    setImportando(r.id);
    try {
      const imp = await prepararImportacao(r);
      const criada = await api<{ licitacao: { id: number } }>("/licitacoes", { corpo: imp.dados });
      const id = criada.licitacao.id;
      if (imp.itens.length) await api(`/licitacoes/${id}/itens`, { corpo: { itens: imp.itens } });
      let comEdital = false;
      if (imp.edital) {
        // O servidor busca o edital no PNCP e anexa (o navegador não consegue baixar direto de lá).
        comEdital = await api(`/licitacoes/${id}/edital-pncp`, { corpo: { url: imp.edital.url, titulo: imp.edital.titulo } }).then(
          () => true,
          () => false,
        );
      }
      setNoQuadro((m) => ({ ...m, [r.id]: id }));
      avisar(
        `Adicionada em "Para estudar" com ${imp.itens.length} item(ns)${comEdital ? " e o edital anexado" : ""}.`,
      );
    } catch (err) {
      const e = err as { status?: number };
      if (e.status === 409) avisar("Esta licitação já está no quadro.", "erro");
      else avisar(mensagemDeErro(err), "erro");
    } finally {
      setImportando(null);
    }
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
            {MODALIDADES_PNCP.slice(0, 6).map((m) => (
              <button type="button" key={m.codigo} className={`chip-filtro ${filtros.modalidades.includes(m.codigo) ? "ativo" : ""}`} onClick={() => mudar({ modalidades: alternar(filtros.modalidades, m.codigo) })}>
                {m.nome}
              </button>
            ))}
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
      </form>

      {erro && <p className="alerta erro">{erro}</p>}

      {resultados === null ? (
        <section className="cartao">
          <Vazio icone={<FileSearch />} titulo="Escolha os filtros e clique em Buscar">
            Dica: use o nome do produto que vocês vendem e marque os estados em que atendem.
          </Vazio>
        </section>
      ) : resultados.length === 0 && !buscando ? (
        <section className="cartao">
          <Vazio icone={<FileSearch />} titulo="Nenhuma licitação encontrada">
            Tente outra palavra, tire algum filtro ou escolha "Todas" em Situação.
          </Vazio>
        </section>
      ) : (
        <>
          <p className="texto-fraco pequeno resumo-busca">
            {filtros.numero.trim() ? `${resultados.length} licitação(ões) com esse número` : `${total.toLocaleString("pt-BR")} resultado(s) · mostrando ${resultados.length}`}
          </p>
          <div className="lista-pncp">
            {resultados.map((r) => {
              const idQuadro = noQuadro[r.id];
              const aberto = abertos[r.id];
              return (
                <article key={r.id} className={`resultado-pncp ${r.cancelado ? "cancelado" : ""}`}>
                  <div className="resultado-pncp-etiquetas">
                    <span className="chip">{r.modalidade}</span>
                    <span className="chip">
                      <MapPin size={11} /> {r.municipio ? `${r.municipio}/` : ""}
                      {r.uf}
                    </span>
                    {r.encerramento && (
                      <span className="chip destaque">
                        <CalendarClock size={11} /> Propostas até {dataHora(r.encerramento)}
                      </span>
                    )}
                    {r.cancelado && <span className="chip vermelho">Cancelada</span>}
                    {idQuadro && <span className="chip verde">Já no quadro</span>}
                  </div>
                  <h3>
                    {r.modalidade} nº {r.numero}/{r.ano}
                  </h3>
                  <p className="resultado-pncp-orgao">
                    {r.orgao}
                    {r.unidade && r.unidade !== r.orgao && r.unidade !== "Unidade Única" ? ` · ${r.unidade}` : ""}
                  </p>
                  <p className={`resultado-pncp-objeto ${aberto ? "aberto" : ""}`}>{r.objeto}</p>
                  {r.objeto.length > 220 && (
                    <button className="botao link pequeno" onClick={() => setAbertos((a) => ({ ...a, [r.id]: !aberto }))}>
                      {aberto ? "Ver menos" : "Ver objeto completo"}
                    </button>
                  )}
                  <div className="resultado-pncp-acoes">
                    <span className="texto-fraco pequeno">Publicada em {dataHora(r.publicadoEm).split(" às")[0]}</span>
                    <a className="botao secundario pequeno" href={r.linkPncp} target="_blank" rel="noreferrer noopener">
                      <ExternalLink /> Ver no PNCP
                    </a>
                    {idQuadro ? (
                      <a className="botao secundario pequeno" {...link(`/licitacoes/${idQuadro}`)}>
                        <SquareArrowOutUpRight /> Abrir no quadro
                      </a>
                    ) : (
                      editar && (
                        <button className="botao acento pequeno" onClick={() => importar(r)} disabled={!!importando}>
                          {importando === r.id ? <Loader2 className="girando" /> : <Plus />}
                          {importando === r.id ? "Importando…" : "Adicionar ao quadro"}
                        </button>
                      )
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {!filtros.numero.trim() && resultados.length < total && (
            <div className="carregar-mais">
              <button className="botao secundario" onClick={() => buscar(pagina + 1)} disabled={buscando}>
                {buscando ? "Carregando…" : "Carregar mais"}
              </button>
            </div>
          )}
          {Object.values(noQuadro).length > 0 && (
            <p className="texto-fraco pequeno" style={{ textAlign: "center" }}>
              As licitações adicionadas ficam em <a className="link-suave" {...link("/licitacoes")} onClick={(e) => { e.preventDefault(); navegar("/licitacoes"); }}>Para estudar</a>, no quadro.
            </p>
          )}
        </>
      )}
    </>
  );
}
