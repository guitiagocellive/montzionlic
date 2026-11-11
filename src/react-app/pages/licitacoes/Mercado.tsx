import { ArrowRight, Building2, Download, FileSearch, Info, Loader2, MapPin, Search, Tag, TrendingUp, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { buscarNoCatalogo, type Linha, type RegistroPreco, resumir, semRepetidos } from "../../../shared/mercado";
import { dataBr, SeletorIntervalo } from "../../components/Calendario";
import { baixarCsv } from "../../components/Periodo";
import { useFecharAoClicarFora } from "../../components/useFecharAoClicarFora";
import { Vazio } from "../../components/Ui";
import { formatarData, formatarMoeda, formatarNumero } from "../../formato";
import { MapaMarcas } from "./MapaMarcas";

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

type Angulo = "correspondencias" | "estados" | "marcas" | "empresas";
type Periodo = { meses: number | null; de: string; ate: string };

const periodoDe = (meses: number): Periodo => {
  const [de, ate] = intervalo(meses);
  return { meses, de, ate };
};

/** Lista das compras encontradas (correspondências), 20 por página. */
function Correspondencias({ registros, uf }: { registros: RegistroPreco[]; uf: string }) {
  const [pagina, setPagina] = useState(1);
  const lista = useMemo(
    () => registros.filter((r) => !uf || (r.estado ?? "").toUpperCase() === uf).sort((a, b) => (b.dataCompra ?? "").localeCompare(a.dataCompra ?? "")),
    [registros, uf],
  );
  useEffect(() => setPagina(1), [registros, uf]);
  const paginas = Math.max(1, Math.ceil(lista.length / 20));
  const visiveis = lista.slice((pagina - 1) * 20, pagina * 20);
  return (
    <section className="cartao">
      <div className="cartao-titulo">
        <h2>
          <FileSearch size={18} aria-hidden="true" /> Correspondências{uf ? ` em ${NOMES_UF[uf] ?? uf}` : ""}
        </h2>
        <button
          className="botao link"
          onClick={() =>
            baixarCsv(`correspondencias${uf ? `-${uf}` : ""}.csv`, [
              ["Data", "Item", "Órgão", "UF", "Município", "Empresa", "CNPJ", "Marca/modelo informado", "Quantidade", "Preço unitário (R$)"],
              ...lista.map((r) => [r.dataCompra ?? "", r.descricaoItem ?? "", r.nomeOrgao ?? "", r.estado ?? "", r.municipio ?? "", r.nomeFornecedor ?? "", cnpjFormatado(r.niFornecedor ?? ""), r.marca ?? "", r.quantidade ?? "", r.precoUnitario ?? ""]),
            ])
          }
        >
          <Download size={14} /> CSV
        </button>
      </div>
      <div className="lista-correspondencias">
        {visiveis.map((r, i) => (
          <article key={`${r.idItemCompra ?? r.idCompra}-${r.niFornecedor}-${i}`} className="correspondencia">
            <div className="correspondencia-topo">
              <strong>{r.descricaoItem || r.nomePdm || "Item"}</strong>
              <span className="preco-correspondencia">{formatarMoeda(r.precoUnitario)}<small>/un</small></span>
            </div>
            <div className="correspondencia-meta texto-fraco">
              <span>{formatarData(r.dataCompra)}</span>
              <span>{[r.nomeOrgao, r.municipio && `${r.municipio}/${r.estado}`].filter(Boolean).join(" · ")}</span>
              <span>
                Vencedor: <b>{r.nomeFornecedor || "—"}</b>
              </span>
              {r.marca && (
                <span>
                  Marca/modelo: <b>{r.marca}</b>
                </span>
              )}
              <span>Qtd: {formatarNumero(r.quantidade)}</span>
            </div>
          </article>
        ))}
      </div>
      {paginas > 1 && (
        <div className="paginacao-simples">
          <button className="botao secundario pequeno" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
            Anterior
          </button>
          <span className="texto-fraco pequeno">
            Página {pagina} de {formatarNumero(paginas)} · {formatarNumero(lista.length)} itens
          </span>
          <button className="botao secundario pequeno" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>
            Próxima
          </button>
        </div>
      )}
    </section>
  );
}

export function Mercado() {
  const [texto, setTexto] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe(12));
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [escolhidos, setEscolhidos] = useState<number[]>([]);
  const [registros, setRegistros] = useState<RegistroPreco[] | null>(null);
  const [info, setInfo] = useState<{ existentes: number; baixados: number; produtos: string[] } | null>(null);
  const [progresso, setProgresso] = useState<{ feito: number; total: number; etapa: string } | null>(null);
  const [erro, setErro] = useState("");
  const [uf, setUf] = useState("");
  const [ordem, setOrdem] = useState<"compras" | "valor">("compras");
  const [angulo, setAngulo] = useState<Angulo>("marcas");
  const [todosProdutos, setTodosProdutos] = useState(false);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [sugerindo, setSugerindo] = useState(false);
  const [marcada, setMarcada] = useState(-1);
  const pesquisa = useRef(0);
  const caixaBusca = useRef<HTMLDivElement>(null);
  const ancoraAngulos = useRef<HTMLDivElement>(null);
  useFecharAoClicarFora(caixaBusca, sugerindo, () => setSugerindo(false));

  const resumo = useMemo(() => (registros ? resumir(registros, uf) : null), [registros, uf]);
  const geral = useMemo(() => (registros ? resumir(registros) : null), [registros]);

  // Sugestões enquanto digita (do catálogo oficial guardado na plataforma: na hora e sem custo).
  const sugestoes = useMemo(() => {
    const t = texto.trim();
    if (!catalogo || t.length < 2) return [];
    return buscarNoCatalogo(catalogo.pdms, t, 8);
  }, [catalogo, texto]);

  function abrirSugestoes() {
    setSugerindo(true);
    if (!catalogo) carregarCatalogo().then(setCatalogo, () => {});
  }

  async function analisar(lista: Candidato[], codigos: number[], p: Periodo, id: number) {
    const datas: [string, string] = [p.de, p.ate];
    const alvos = lista.filter((c) => codigos.includes(c.codigo) && c.total > 0);
    if (!alvos.length) {
      setRegistros([]);
      setInfo({ existentes: 0, baixados: 0, produtos: [] });
      return;
    }
    // Páginas de cada produto (as mais recentes primeiro), até o limite.
    const tarefas: { codigo: number; pagina: number }[] = [];
    const paginas = alvos.map((a) => Math.ceil(a.total / POR_PAGINA));
    for (let n = 1; tarefas.length < LIMITE_PAGINAS && paginas.some((x) => x >= n); n++)
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

  async function contar(lista: { codigo: number }[], p: Periodo, id: number) {
    let feito = 0;
    setProgresso({ feito: 0, total: lista.length, etapa: "Contando as compras de cada produto" });
    return emLotes(lista, 6, async (c) => {
      const r = await consultar(c.codigo, 1, [p.de, p.ate], 10).catch(() => null);
      if (pesquisa.current === id) setProgresso({ feito: ++feito, total: lista.length, etapa: "Contando as compras de cada produto" });
      return r?.totalRegistros ?? 0;
    });
  }

  async function pesquisar(termo = texto, forcado?: Pdm, p = periodo) {
    const t = termo.trim();
    setSugerindo(false);
    if (t.length < 2) return setErro("Digite o produto, por exemplo: ar-condicionado.");
    const id = ++pesquisa.current;
    setErro("");
    setUf("");
    setRegistros(null);
    setInfo(null);
    setCandidatos(null);
    setTodosProdutos(false);
    try {
      setProgresso({ feito: 0, total: 0, etapa: "Procurando no catálogo do governo" });
      const cat = catalogo ?? (await carregarCatalogo());
      setCatalogo(cat);
      let achados = buscarNoCatalogo(cat.pdms, t, 30);
      if (forcado) achados = [forcado, ...achados.filter((x) => x[0] !== forcado[0])];
      if (!achados.length) {
        setCandidatos([]);
        return;
      }
      // Conta as compras de cada produto parecido para mostrar primeiro o que o governo mais compra.
      const totais = await contar(achados.map((x) => ({ codigo: x[0] })), p, id);
      if (pesquisa.current !== id) return;
      const lista = achados
        .map((x, i) => ({ codigo: x[0], nome: x[1].replace(/^"+|"+$/g, ""), classe: cat.classes[String(x[2])] ?? "", total: totais[i] }))
        .sort((a, b) => b.total - a.total);
      setCandidatos(lista);
      const maior = lista[0]?.total ?? 0;
      const marcados = forcado
        ? [forcado[0]]
        : lista.filter((c, i) => c.total > 0 && (i === 0 || c.total >= maior * 0.25)).slice(0, 4).map((c) => c.codigo);
      setEscolhidos(marcados);
      await analisar(lista, marcados, p, id);
    } catch (err) {
      if (pesquisa.current === id) setErro(err instanceof Error ? err.message : "Não foi possível pesquisar agora.");
    } finally {
      if (pesquisa.current === id) setProgresso(null);
    }
  }

  async function refazer(codigos: number[], p = periodo, recontar = false) {
    if (!candidatos) return;
    const id = ++pesquisa.current;
    setErro("");
    setRegistros(null);
    try {
      let lista = candidatos;
      if (recontar) {
        const totais = await contar(lista, p, id);
        if (pesquisa.current !== id) return;
        lista = lista.map((c, i) => ({ ...c, total: totais[i] })).sort((a, b) => b.total - a.total);
        setCandidatos(lista);
      }
      await analisar(lista, codigos, p, id);
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

  function mudarPeriodo(p: Periodo) {
    if (!p.de || !p.ate) return;
    setPeriodo(p);
    if (candidatos?.length && escolhidos.length) void refazer(escolhidos, p, true);
  }

  function escolherSugestao(x: Pdm) {
    const nome = x[1].replace(/^"+|"+$/g, "");
    setTexto(nome);
    void pesquisar(nome, x);
  }

  function irPara(a: Angulo) {
    setAngulo(a);
    requestAnimationFrame(() => ancoraAngulos.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const ufsComDados = geral?.estados.map((e) => e.chave) ?? [];
  const pctSemMarca = resumo && resumo.registros ? Math.round((resumo.semMarca / resumo.registros) * 100) : 0;
  const modelos = (resumo?.modelos ?? []).filter((m) => m.compras >= 2);
  const termo = info?.produtos.length === 1 ? info.produtos[0] : texto.trim();
  const ANGULOS: { chave: Angulo; nome: string; icone: ReactNode; valor: number; legenda: string }[] = resumo
    ? [
        { chave: "correspondencias", nome: "Correspondências", icone: <FileSearch />, valor: resumo.compras, legenda: `licitações com ${formatarNumero(resumo.registros)} itens vencidos` },
        { chave: "estados", nome: "Estados", icone: <MapPin />, valor: geral?.estados.length ?? 0, legenda: "estados compraram" },
        { chave: "marcas", nome: "Marcas", icone: <Tag />, valor: resumo.marcas.length, legenda: `marcas vencedoras · ${pctSemMarca}% sem marca identificável` },
        { chave: "empresas", nome: "Empresas", icone: <Building2 />, valor: resumo.empresas.length, legenda: "empresas vencedoras" },
      ]
    : [];

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Inteligência de mercado</h1>
          <p className="texto-suave">Analise o mercado de compras públicas: quem vence, quais marcas e onde, com base nas licitações encerradas.</p>
        </div>
      </div>

      <section className="cartao busca-mercado entrar" style={{ ["--i" as string]: 1 }}>
        <form
          className="barra-busca-mercado"
          onSubmit={(e) => {
            e.preventDefault();
            if (sugerindo && marcada >= 0 && sugestoes[marcada]) escolherSugestao(sugestoes[marcada]);
            else void pesquisar();
          }}
        >
          <div className="entrada com-icone caixa-sugestoes" ref={caixaBusca}>
            <Search aria-hidden="true" />
            <input
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setMarcada(-1);
                abrirSugestoes();
              }}
              onFocus={abrirSugestoes}
              onKeyDown={(e) => {
                if (!sugestoes.length) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSugerindo(true);
                  setMarcada((m) => Math.min(sugestoes.length - 1, m + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMarcada((m) => Math.max(-1, m - 1));
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setSugerindo(false);
                }
              }}
              placeholder="Produto: ar-condicionado, caneta, papel A4…"
              aria-label="Produto"
              role="combobox"
              aria-expanded={sugerindo && sugestoes.length > 0}
              aria-controls="sugestoes-mercado"
              autoComplete="off"
              autoFocus
            />
            {texto && (
              <button type="button" className="limpar-entrada" onClick={() => setTexto("")} aria-label="Limpar">
                <X size={14} />
              </button>
            )}
            {sugerindo && sugestoes.length > 0 && (
              <ul className="sugestoes-mercado" id="sugestoes-mercado" role="listbox">
                {sugestoes.map((x, i) => (
                  <li key={x[0]} role="option" aria-selected={i === marcada}>
                    <button type="button" className={i === marcada ? "marcada" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => escolherSugestao(x)}>
                      <Search size={13} aria-hidden="true" />
                      <span>{x[1].replace(/^"+|"+$/g, "")}</span>
                      <small className="texto-fraco">{catalogo?.classes[String(x[2])] ?? ""}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button className="botao" disabled={!!progresso} aria-label="Analisar">
            {progresso ? <Loader2 className="girando" size={16} /> : <TrendingUp size={16} />} <span className="rotulo-analisar">Analisar</span>
          </button>
        </form>

        <div className="periodo-mercado">
          <span className="texto-fraco pequeno">Período</span>
          <div className="segmentado" role="group" aria-label="Período">
            {PERIODOS.map((x) => (
              <button key={x.meses} type="button" className={periodo.meses === x.meses ? "ativo" : ""} onClick={() => mudarPeriodo(periodoDe(x.meses))}>
                {x.rotulo}
              </button>
            ))}
          </div>
          <SeletorIntervalo de={periodo.de} ate={periodo.ate} aoMudar={(de, ate) => mudarPeriodo({ meses: null, de, ate })} rotulo="Período" atalhos={false} />
        </div>

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
            Veja no mapa onde mais se compra, as marcas e empresas que mais vencem e o preço praticado, com dados reais do Compras.gov.br.
          </Vazio>
        </section>
      )}

      {resumo && geral && info && (
        <>
          {geral.registros === 0 ? (
            <section className="cartao">
              <Vazio icone={<TrendingUp />} titulo="Nenhuma compra no período">
                Escolha um período maior ou marque outro produto do catálogo.
              </Vazio>
            </section>
          ) : (
            <>
              {(uf || termo) && (
                <div className="filtros-aplicados entrar">
                  <span className="texto-fraco pequeno">Filtros aplicados</span>
                  {termo && <span className="chip-filtro ativo">{termo}</span>}
                  {uf && (
                    <button className="chip-filtro ativo com-x" onClick={() => setUf("")}>
                      {NOMES_UF[uf] ?? uf}
                      <X size={12} />
                    </button>
                  )}
                </div>
              )}

              <section className="cartao painel-mercado entrar" style={{ ["--i" as string]: 2 }}>
                <MapaMarcas estados={geral.estados} ativo={uf} aoEscolher={(x) => setUf(uf === x ? "" : x)} />
                <div className="total-mercado">
                  <span className="texto-fraco pequeno">Valor total homologado{uf ? ` em ${NOMES_UF[uf] ?? uf}` : ""}</span>
                  <strong className="texto-gradiente">{formatarMoeda(resumo.valor)}</strong>
                  <span className="texto-fraco pequeno">
                    {formatarNumero(resumo.compras)} licitações · {formatarNumero(resumo.quantidade)} unidades · {dataBr(periodo.de)} a {dataBr(periodo.ate)}
                  </span>
                </div>
              </section>

              <div className="titulo-angulos" ref={ancoraAngulos}>
                <span>Ângulos de análise</span>
              </div>
              <div className="angulos-mercado">
                {ANGULOS.map((a) => (
                  <button key={a.chave} type="button" className={`angulo ${angulo === a.chave ? "ativo" : ""}`} onClick={() => irPara(a.chave)} aria-pressed={angulo === a.chave}>
                    <span className="icone-redondo">{a.icone}</span>
                    <span className="angulo-nome">{a.nome}</span>
                    <strong>{formatarNumero(a.valor)}</strong>
                    <span className="texto-fraco pequeno">{a.legenda}</span>
                    <span className="angulo-acao">
                      Analisar <ArrowRight size={13} />
                    </span>
                  </button>
                ))}
              </div>

              {angulo !== "correspondencias" && (
                <div className="filtros-mercado">
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
                  <div className="segmentado" role="group" aria-label="Ordenar por">
                    <button type="button" className={ordem === "compras" ? "ativo" : ""} onClick={() => setOrdem("compras")}>
                      Vitórias
                    </button>
                    <button type="button" className={ordem === "valor" ? "ativo" : ""} onClick={() => setOrdem("valor")}>
                      Valor homologado
                    </button>
                  </div>
                </div>
              )}

              <div className="conteudo-angulo">
                {angulo === "correspondencias" && <Correspondencias registros={registros ?? []} uf={uf} />}
                {angulo === "marcas" && (
                  <div className={modelos.length >= 3 ? "grade-mercado" : ""}>
                    <Ranking
                      titulo={uf ? `Marcas que mais venceram em ${NOMES_UF[uf] ?? uf}` : "Marcas que mais venceram"}
                      icone={<Tag size={18} aria-hidden="true" />}
                      linhas={resumo.marcas}
                      ordem={ordem}
                      rotuloDestaques={uf ? "Estado" : "Mais vence em"}
                      arquivo={`marcas-${texto.trim() || "produto"}${uf ? `-${uf}` : ""}.csv`}
                      vazio="Nenhuma marca identificada."
                    />
                    {modelos.length >= 3 && (
                      <Ranking
                        titulo="Modelos que mais venceram"
                        icone={<Tag size={18} aria-hidden="true" />}
                        linhas={modelos}
                        ordem={ordem}
                        rotuloDestaques="Marca"
                        arquivo={`modelos-${texto.trim() || "produto"}${uf ? `-${uf}` : ""}.csv`}
                        vazio="Nenhum modelo informado."
                      />
                    )}
                  </div>
                )}
                {angulo === "empresas" && (
                  <Ranking
                    titulo={uf ? `Empresas que mais venceram em ${NOMES_UF[uf] ?? uf}` : "Empresas que mais venceram"}
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
                )}
                {angulo === "estados" && (
                  <Ranking
                    titulo="Estados que mais compraram"
                    icone={<MapPin size={18} aria-hidden="true" />}
                    linhas={geral.estados.map((e) => ({ ...e, nome: NOMES_UF[e.nome] ?? e.nome }))}
                    ordem={ordem}
                    rotuloDestaques="Marcas que mais venceram"
                    aoClicar={(l) => setUf(uf === l.chave ? "" : l.chave)}
                    ativo={uf}
                    arquivo={`estados-${texto.trim() || "produto"}.csv`}
                    vazio="Sem estado informado."
                  />
                )}
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
