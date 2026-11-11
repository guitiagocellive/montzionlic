import { Building2, Download, Info, Loader2, MapPin, Search, Tag, TrendingUp, X } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { buscarNoCatalogo, type Linha, type RegistroPreco, resumir, semRepetidos } from "../../../shared/mercado";
import { baixarCsv } from "../../components/Periodo";
import { Vazio } from "../../components/Ui";
import { formatarMoeda, formatarNumero } from "../../formato";

// Inteligência de mercado: quais marcas e empresas mais vendem um produto ao governo e
// quais estados mais compram. Dados abertos do Compras.gov.br (pesquisa de preços).

type Pdm = [number, string, number, number]; // código, nome, classe, ativo
type Catalogo = { classes: Record<string, string>; pdms: Pdm[] };
type Candidato = { codigo: number; nome: string; classe: string; total: number };

const PERIODOS = [
  { meses: 3, rotulo: "3 meses" },
  { meses: 6, rotulo: "6 meses" },
  { meses: 12, rotulo: "12 meses" },
  { meses: 24, rotulo: "24 meses" },
];
const POR_PAGINA = 500;
const LIMITE_PAGINAS = 40; // até 20 mil registros por pesquisa (os mais recentes)
const MOSTRAR = 15;

const NOMES_UF: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

let catalogoCache: Promise<Catalogo> | null = null;
function carregarCatalogo() {
  catalogoCache ??= fetch("/dados/pdms.json").then((r) => {
    if (!r.ok) throw new Error("Não foi possível carregar o catálogo de produtos.");
    return r.json() as Promise<Catalogo>;
  });
  catalogoCache.catch(() => (catalogoCache = null));
  return catalogoCache;
}

const dataIso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function intervalo(meses: number): [string, string] {
  const fim = new Date();
  const inicio = new Date(fim);
  inicio.setMonth(inicio.getMonth() - meses);
  return [dataIso(inicio), dataIso(fim)];
}

async function consultar(pdm: number, pagina: number, [inicio, fim]: [string, string], tamanho = POR_PAGINA) {
  const p = new URLSearchParams({ pdm: String(pdm), pagina: String(pagina), inicio, fim, ...(tamanho === 10 ? { tamanho: "10" } : {}) });
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetch(`/api/mercado/precos?${p}`, { credentials: "same-origin" });
    if (r.ok) return (await r.json()) as { resultado?: RegistroPreco[]; totalRegistros?: number; totalPaginas?: number };
    if (tentativa >= 2 || r.status === 400 || r.status === 401 || r.status === 403) {
      const corpo = await r.json().catch(() => null);
      throw new Error(corpo?.erro ?? "O Compras.gov.br não respondeu agora. Tente de novo em instantes.");
    }
    await new Promise((ok) => setTimeout(ok, 1200 * (tentativa + 1)));
  }
}

/** Executa tarefas com no máximo `n` ao mesmo tempo. */
async function emLotes<T, R>(lista: T[], n: number, tarefa: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(lista.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, lista.length) }, async () => {
      while (proximo < lista.length) {
        const i = proximo++;
        saida[i] = await tarefa(lista[i]);
      }
    }),
  );
  return saida;
}

const valorCurto = (v: number) =>
  v >= 1e9 ? `R$ ${formatarNumero(Math.round(v / 1e8) / 10)} bi` : v >= 1e6 ? `R$ ${formatarNumero(Math.round(v / 1e5) / 10)} mi` : v >= 1e4 ? `R$ ${formatarNumero(Math.round(v / 1e3))} mil` : formatarMoeda(v);
const cnpjFormatado = (c?: string) => (c && c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c ?? "");

function Ranking({
  titulo,
  icone,
  linhas,
  ordem,
  rotuloDestaques,
  aoClicar,
  ativo,
  arquivo,
  nomeLinha,
  vazio,
}: {
  titulo: string;
  icone: ReactNode;
  linhas: Linha[];
  ordem: "compras" | "valor";
  rotuloDestaques: string;
  aoClicar?: (l: Linha) => void;
  ativo?: string;
  arquivo: string;
  nomeLinha?: (l: Linha) => ReactNode;
  vazio: string;
}) {
  const [todas, setTodas] = useState(false);
  const ordenadas = useMemo(
    () => [...linhas].sort((a, b) => (ordem === "valor" ? b.valor - a.valor || b.compras - a.compras : b.compras - a.compras || b.valor - a.valor)),
    [linhas, ordem],
  );
  const visiveis = todas ? ordenadas : ordenadas.slice(0, MOSTRAR);
  const max = Math.max(1, ...ordenadas.map((l) => (ordem === "valor" ? l.valor : l.compras)));
  return (
    <section className="cartao ranking-mercado">
      <div className="cartao-titulo">
        <h2>
          {icone} {titulo}
        </h2>
        {linhas.length > 0 && (
          <button
            className="botao link"
            onClick={() =>
              baixarCsv(arquivo, [
                ["Posição", "Nome", "CNPJ", "Licitações ganhas", "Quantidade", "Valor homologado (R$)", "Preço unitário mediano (R$)", rotuloDestaques],
                ...ordenadas.map((l, i) => [i + 1, l.nome, cnpjFormatado(l.cnpj), l.compras, l.quantidade, l.valor.toFixed(2), l.precoMediano?.toFixed(2) ?? "", l.destaques.map((d) => d.nome).join(" / ")]),
              ])
            }
          >
            <Download size={14} /> CSV
          </button>
        )}
      </div>
      {linhas.length === 0 ? (
        <p className="texto-fraco pequeno">{vazio}</p>
      ) : (
        <ol className="lista-ranking">
          {visiveis.map((l, i) => {
            const medida = ordem === "valor" ? l.valor : l.compras;
            const conteudo = (
              <>
                <span className="posicao-ranking">{i + 1}</span>
                <span className="corpo-ranking">
                  <span className="nome-ranking">{nomeLinha ? nomeLinha(l) : l.nome}</span>
                  <span className="barra-progresso fina" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, (medida / max) * 100)}%` }} />
                  </span>
                  {l.destaques.length > 0 && (
                    <span className="destaques-ranking texto-fraco">
                      {rotuloDestaques}: {l.destaques.map((d) => d.nome).join(", ")}
                    </span>
                  )}
                </span>
                <span className="numeros-ranking">
                  <strong>{ordem === "valor" ? valorCurto(l.valor) : `${formatarNumero(l.compras)} ${l.compras === 1 ? "licitação" : "licitações"}`}</strong>
                  <span className="texto-fraco">
                    {ordem === "valor" ? `${formatarNumero(l.compras)} licit.` : valorCurto(l.valor)}
                    {l.precoMediano != null && ` · ${formatarMoeda(l.precoMediano)}/un`}
                  </span>
                </span>
              </>
            );
            const dica = `${l.nome}: ${formatarNumero(l.compras)} licitações, ${formatarNumero(l.quantidade)} unidades, ${formatarMoeda(l.valor)} homologados, preço mediano ${formatarMoeda(l.precoMediano)}`;
            return (
              <li key={l.chave} className={ativo === l.chave ? "ativo" : ""}>
                {aoClicar ? (
                  <button type="button" className="linha-ranking clicavel" onClick={() => aoClicar(l)} title={`${dica}. Clique para ver só este estado.`}>
                    {conteudo}
                  </button>
                ) : (
                  <div className="linha-ranking" title={dica}>
                    {conteudo}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {ordenadas.length > MOSTRAR && (
        <button className="botao link ver-todas" onClick={() => setTodas(!todas)}>
          {todas ? "Mostrar menos" : `Ver todas (${ordenadas.length})`}
        </button>
      )}
    </section>
  );
}

export function Mercado() {
  const [texto, setTexto] = useState("");
  const [meses, setMeses] = useState(12);
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [escolhidos, setEscolhidos] = useState<number[]>([]);
  const [registros, setRegistros] = useState<RegistroPreco[] | null>(null);
  const [info, setInfo] = useState<{ existentes: number; baixados: number; produtos: string[] } | null>(null);
  const [progresso, setProgresso] = useState<{ feito: number; total: number; etapa: string } | null>(null);
  const [erro, setErro] = useState("");
  const [uf, setUf] = useState("");
  const [ordem, setOrdem] = useState<"compras" | "valor">("compras");
  const [todosProdutos, setTodosProdutos] = useState(false);
  const pesquisa = useRef(0);

  const resumo = useMemo(() => (registros ? resumir(registros, uf) : null), [registros, uf]);
  const geral = useMemo(() => (registros ? resumir(registros) : null), [registros]);

  async function analisar(lista: Candidato[], codigos: number[], periodo: number, id: number) {
    const datas = intervalo(periodo);
    const alvos = lista.filter((c) => codigos.includes(c.codigo) && c.total > 0);
    if (!alvos.length) {
      setRegistros([]);
      setInfo({ existentes: 0, baixados: 0, produtos: [] });
      return;
    }
    // Páginas de cada produto (as mais recentes primeiro), até o limite.
    const tarefas: { codigo: number; pagina: number }[] = [];
    const paginas = alvos.map((a) => Math.ceil(a.total / POR_PAGINA));
    for (let n = 1; tarefas.length < LIMITE_PAGINAS && paginas.some((p) => p >= n); n++)
      alvos.forEach((a, i) => n <= paginas[i] && tarefas.length < LIMITE_PAGINAS && tarefas.push({ codigo: a.codigo, pagina: n }));
    let feito = 0;
    setProgresso({ feito, total: tarefas.length, etapa: "Baixando as compras" });
    const partes = await emLotes(tarefas, 4, async (t) => {
      const r = await consultar(t.codigo, t.pagina, datas);
      if (pesquisa.current === id) setProgresso({ feito: ++feito, total: tarefas.length, etapa: "Baixando as compras" });
      return r.resultado ?? [];
    });
    if (pesquisa.current !== id) return;
    const todos = semRepetidos(partes.flat());
    setRegistros(todos);
    setInfo({ existentes: alvos.reduce((s, a) => s + a.total, 0), baixados: todos.length, produtos: alvos.map((a) => a.nome) });
  }

  async function pesquisar(e?: FormEvent) {
    e?.preventDefault();
    const t = texto.trim();
    if (t.length < 2) return setErro("Digite o produto, por exemplo: ar-condicionado.");
    const id = ++pesquisa.current;
    setErro("");
    setUf("");
    setRegistros(null);
    setInfo(null);
    setCandidatos(null);
    try {
      setProgresso({ feito: 0, total: 0, etapa: "Procurando no catálogo do governo" });
      const catalogo = await carregarCatalogo();
      const achados = buscarNoCatalogo(catalogo.pdms, t, 30);
      if (!achados.length) {
        setCandidatos([]);
        setProgresso(null);
        return;
      }
      // Conta as compras de cada produto parecido para mostrar primeiro o que o governo mais compra.
      const datas = intervalo(meses);
      setProgresso({ feito: 0, total: achados.length, etapa: "Contando as compras de cada produto" });
      let feito = 0;
      const totais = await emLotes(achados, 6, async (p) => {
        const r = await consultar(p[0], 1, datas, 10).catch(() => null);
        if (pesquisa.current === id) setProgresso({ feito: ++feito, total: achados.length, etapa: "Contando as compras de cada produto" });
        return r?.totalRegistros ?? 0;
      });
      if (pesquisa.current !== id) return;
      const lista = achados
        .map((p, i) => ({ codigo: p[0], nome: p[1].replace(/^"+|"+$/g, ""), classe: catalogo.classes[String(p[2])] ?? "", total: totais[i] }))
        .sort((a, b) => b.total - a.total);
      setCandidatos(lista);
      const maior = lista[0]?.total ?? 0;
      const marcados = lista.filter((c, i) => c.total > 0 && (i === 0 || c.total >= maior * 0.25)).slice(0, 4).map((c) => c.codigo);
      setEscolhidos(marcados);
      await analisar(lista, marcados, meses, id);
    } catch (err) {
      if (pesquisa.current === id) setErro(err instanceof Error ? err.message : "Não foi possível pesquisar agora.");
    } finally {
      if (pesquisa.current === id) setProgresso(null);
    }
  }

  async function refazer(codigos: number[], periodo = meses) {
    if (!candidatos) return;
    const id = ++pesquisa.current;
    setErro("");
    setRegistros(null);
    try {
      let lista = candidatos;
      if (periodo !== meses) {
        const datas = intervalo(periodo);
        setProgresso({ feito: 0, total: lista.length, etapa: "Contando as compras de cada produto" });
        const totais = await emLotes(lista, 4, async (c) => (await consultar(c.codigo, 1, datas, 10).catch(() => null))?.totalRegistros ?? 0);
        if (pesquisa.current !== id) return;
        lista = lista.map((c, i) => ({ ...c, total: totais[i] })).sort((a, b) => b.total - a.total);
        setCandidatos(lista);
      }
      await analisar(lista, codigos, periodo, id);
    } catch (err) {
      if (pesquisa.current === id) setErro(err instanceof Error ? err.message : "Não foi possível pesquisar agora.");
    } finally {
      if (pesquisa.current === id) setProgresso(null);
    }
  }

  function alternarProduto(codigo: number) {
    const novos = escolhidos.includes(codigo) ? escolhidos.filter((c) => c !== codigo) : [...escolhidos, codigo];
    setEscolhidos(novos);
    if (novos.length) void refazer(novos);
    else setRegistros([]);
  }

  function mudarPeriodo(m: number) {
    setMeses(m);
    if (candidatos?.length && escolhidos.length) void refazer(escolhidos, m);
  }

  const ufsComDados = geral?.estados.map((e) => e.chave) ?? [];
  const pctSemMarca = resumo && resumo.registros ? Math.round((resumo.semMarca / resumo.registros) * 100) : 0;

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Inteligência de mercado</h1>
          <p className="texto-suave">Quais marcas e empresas mais vendem um produto para o governo e quais estados mais compram.</p>
        </div>
      </div>

      <section className="cartao busca-mercado entrar" style={{ ["--i" as string]: 1 }}>
        <form className="barra-busca-mercado" onSubmit={pesquisar}>
          <div className="entrada com-icone">
            <Search aria-hidden="true" />
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Produto: ar-condicionado, caneta, papel A4…" aria-label="Produto" autoFocus />
            {texto && (
              <button type="button" className="limpar-entrada" onClick={() => setTexto("")} aria-label="Limpar">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="segmentado" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p.meses} type="button" className={meses === p.meses ? "ativo" : ""} onClick={() => mudarPeriodo(p.meses)}>
                {p.rotulo}
              </button>
            ))}
          </div>
          <button className="botao" disabled={!!progresso}>
            {progresso ? <Loader2 className="girando" size={16} /> : <TrendingUp size={16} />} Pesquisar
          </button>
        </form>

        {candidatos && candidatos.length > 0 && (
          <div className="produtos-mercado">
            <span className="texto-fraco pequeno">Produtos do catálogo do governo (marque os que interessam):</span>
            <div className="chips-filtro">
              {candidatos
                .filter((c) => c.total > 0 || escolhidos.includes(c.codigo))
                .filter((c, i) => todosProdutos || i < 8 || escolhidos.includes(c.codigo))
                .map((c) => (
                  <button
                    key={c.codigo}
                    type="button"
                    className={`chip-filtro ${escolhidos.includes(c.codigo) ? "ativo" : ""}`}
                    onClick={() => alternarProduto(c.codigo)}
                    disabled={!!progresso}
                    title={c.classe}
                  >
                    {c.nome} <span className="texto-fraco">{formatarNumero(c.total)}</span>
                  </button>
                ))}
              {candidatos.filter((c) => c.total > 0).length > 8 && (
                <button type="button" className="botao link" onClick={() => setTodosProdutos(!todosProdutos)}>
                  {todosProdutos ? "Menos produtos" : `+${candidatos.filter((c) => c.total > 0).length - 8} produtos`}
                </button>
              )}
            </div>
          </div>
        )}

        {progresso && (
          <div className="progresso-mercado" role="status">
            <span className="texto-suave pequeno">
              {progresso.etapa}
              {progresso.total > 0 && ` · ${progresso.feito} de ${progresso.total}`}
            </span>
            <span className="barra-progresso fina">
              <span style={{ width: progresso.total ? `${(progresso.feito / progresso.total) * 100}%` : "8%" }} />
            </span>
          </div>
        )}
        {erro && <p className="alerta erro">{erro}</p>}
      </section>

      {candidatos && candidatos.length === 0 && !progresso && (
        <section className="cartao">
          <Vazio icone={<Search />} titulo="Nenhum produto com esse nome no catálogo">
            Tente uma palavra mais simples, como "condicionado", "caneta" ou "papel".
          </Vazio>
        </section>
      )}

      {!candidatos && !progresso && !erro && (
        <section className="cartao">
          <Vazio icone={<TrendingUp />} titulo="Pesquise um produto">
            Veja as marcas mais vendidas, as empresas que mais ganham e os estados que mais compram, com o preço praticado.
          </Vazio>
        </section>
      )}

      {resumo && info && (
        <>
          {resumo.registros === 0 && !uf ? (
            <section className="cartao">
              <Vazio icone={<TrendingUp />} titulo="Nenhuma compra no período">
                Escolha um período maior ou marque outro produto do catálogo.
              </Vazio>
            </section>
          ) : (
            <>
              <div className="filtros-mercado entrar" style={{ ["--i" as string]: 2 }}>
                <label className="campo-inline">
                  <MapPin size={15} aria-hidden="true" />
                  <select value={uf} onChange={(e) => setUf(e.target.value)} aria-label="Estado">
                    <option value="">Todos os estados</option>
                    {ufsComDados.map((s) => (
                      <option key={s} value={s}>
                        {NOMES_UF[s] ?? s}
                      </option>
                    ))}
                  </select>
                </label>
                {uf && (
                  <button className="chip-filtro ativo com-x" onClick={() => setUf("")}>
                    {NOMES_UF[uf] ?? uf}
                    <X size={12} />
                  </button>
                )}
                <div className="segmentado" role="group" aria-label="Ordenar por">
                  <button type="button" className={ordem === "compras" ? "ativo" : ""} onClick={() => setOrdem("compras")}>
                    Licitações ganhas
                  </button>
                  <button type="button" className={ordem === "valor" ? "ativo" : ""} onClick={() => setOrdem("valor")}>
                    Valor
                  </button>
                </div>
              </div>

              <section className="kpis">
                <div className="kpi entrar" style={{ ["--i" as string]: 3 }}>
                  <div className="kpi-topo">
                    <span className="kpi-nome">Licitações</span>
                    <span className="icone-redondo"><TrendingUp /></span>
                  </div>
                  <div className="kpi-valor">{formatarNumero(resumo.compras)}</div>
                  <div className="kpi-det">{formatarNumero(resumo.registros)} itens vencidos{uf ? ` em ${NOMES_UF[uf] ?? uf}` : ""}</div>
                </div>
                <div className="kpi entrar" style={{ ["--i" as string]: 4 }}>
                  <div className="kpi-topo">
                    <span className="kpi-nome">Valor homologado</span>
                    <span className="icone-redondo"><Building2 /></span>
                  </div>
                  <div className="kpi-valor">{valorCurto(resumo.valor)}</div>
                  <div className="kpi-det">{formatarNumero(resumo.quantidade)} unidades</div>
                </div>
                <div className="kpi entrar" style={{ ["--i" as string]: 5 }}>
                  <div className="kpi-topo">
                    <span className="kpi-nome">Marcas</span>
                    <span className="icone-redondo"><Tag /></span>
                  </div>
                  <div className="kpi-valor">{formatarNumero(resumo.marcas.length)}</div>
                  <div className="kpi-det">{pctSemMarca}% dos itens sem marca identificável</div>
                </div>
                <div className="kpi entrar" style={{ ["--i" as string]: 6 }}>
                  <div className="kpi-topo">
                    <span className="kpi-nome">Empresas vencedoras</span>
                    <span className="icone-redondo"><Building2 /></span>
                  </div>
                  <div className="kpi-valor">{formatarNumero(resumo.empresas.length)}</div>
                  <div className="kpi-det">{formatarNumero(resumo.estados.length)} estados compraram</div>
                </div>
              </section>

              <div className="grade-mercado">
                <Ranking
                  titulo={uf ? `Marcas mais vendidas em ${NOMES_UF[uf] ?? uf}` : "Marcas mais vendidas"}
                  icone={<Tag size={18} aria-hidden="true" />}
                  linhas={resumo.marcas}
                  ordem={ordem}
                  rotuloDestaques={uf ? "Estado" : "Mais vendida em"}
                  arquivo={`marcas-${texto.trim() || "produto"}${uf ? `-${uf}` : ""}.csv`}
                  vazio="Nenhuma marca identificada."
                />
                <Ranking
                  titulo={uf ? `Empresas que mais venderam em ${NOMES_UF[uf] ?? uf}` : "Empresas que mais venderam"}
                  icone={<Building2 size={18} aria-hidden="true" />}
                  linhas={resumo.empresas}
                  ordem={ordem}
                  rotuloDestaques="Marcas"
                  arquivo={`empresas-${texto.trim() || "produto"}${uf ? `-${uf}` : ""}.csv`}
                  nomeLinha={(l) => (
                    <>
                      {l.nome}
                      {l.cnpj && <small className="texto-fraco cnpj-ranking">{cnpjFormatado(l.cnpj)}</small>}
                    </>
                  )}
                  vazio="Nenhuma empresa."
                />
                <Ranking
                  titulo="Estados que mais compraram"
                  icone={<MapPin size={18} aria-hidden="true" />}
                  linhas={(geral?.estados ?? []).map((e) => ({ ...e, nome: NOMES_UF[e.nome] ?? e.nome }))}
                  ordem={ordem}
                  rotuloDestaques="Marcas mais compradas"
                  aoClicar={(l) => setUf(uf === l.chave ? "" : l.chave)}
                  ativo={uf}
                  arquivo={`estados-${texto.trim() || "produto"}.csv`}
                  vazio="Sem estado informado."
                />
              </div>

              <p className="explicacao fonte-mercado">
                <Info aria-hidden="true" />
                <span>
                  Fonte: dados abertos do Compras.gov.br (pesquisa de preços), com as compras feitas pela plataforma Compras.gov.br — governo federal e
                  estados e municípios que a usam. Outras plataformas (BLL, Licitanet, Portal de Compras Públicas…) não entram.{" "}
                  {info.baixados < info.existentes
                    ? `Analisadas as ${formatarNumero(info.baixados)} compras mais recentes de ${formatarNumero(info.existentes)}. `
                    : `${formatarNumero(info.baixados)} itens analisados. `}
                  A marca é digitada por cada fornecedor e foi padronizada pela plataforma; nomes escritos de formas muito diferentes podem aparecer separados.
                  O valor inclui as quantidades registradas em atas (registro de preços), que nem sempre são compradas inteiras.
                  {resumo.descartados > 0 && ` ${formatarNumero(resumo.descartados)} item(ns) com preço fora da realidade foram deixados de fora.`}
                </span>
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
