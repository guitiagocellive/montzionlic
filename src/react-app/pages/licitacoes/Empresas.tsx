import { BarChart3, Building2, ExternalLink, FileSearch, Info, Landmark, ListChecks, Loader2, MapPin, Package, Search, ShieldCheck, TrendingUp, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cnpjValido, type ItemPncp, type ResultadoItem, resumirEmpresa } from "../../../shared/empresa";
import { dataBr, SeletorIntervalo } from "../../components/Calendario";
import { baixarCsv } from "../../components/Periodo";
import { Vazio } from "../../components/Ui";
import { formatarData, formatarMoeda, formatarNumero } from "../../formato";
import { MapaMarcas } from "./MapaMarcas";
import { cnpjFormatado, emLotes, GraficoMeses, NOMES_UF, type Periodo, PERIODOS, periodoDe, Ranking } from "./Mercado";

// Análise de empresas (como no Siga Pregão): o que uma empresa vence em licitações, com dados oficiais
// e gratuitos — resultados publicados no PNCP (todas as plataformas) e cadastro do Compras.gov.br.

type Fornecedor = {
  cnpj: string;
  nomeRazaoSocialFornecedor: string;
  nomeCnae?: string | null;
  codigoCnae?: number | null;
  nomeMunicipio?: string | null;
  ufSigla?: string | null;
  porteEmpresaNome?: string | null;
  naturezaJuridicaNome?: string | null;
  habilitadoLicitar?: boolean | null;
  ativo?: boolean | null;
};
type Pagina<T> = { resultado?: T[]; totalPaginas?: number; totalRegistros?: number };
type Aba = "geral" | "vitorias" | "graficos" | "itens";
const CHAVE_RECENTES = "montzion:empresas-recentes";

async function pedir<T>(caminho: string): Promise<T> {
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetch(`/api/mercado${caminho}`, { credentials: "same-origin" });
    if (r.ok) return (await r.json()) as T;
    if (tentativa >= 2 || r.status === 400 || r.status === 401 || r.status === 403) {
      const corpo = await r.json().catch(() => null);
      throw new Error(corpo?.erro ?? "O Compras.gov.br não respondeu agora. Tente de novo em instantes.");
    }
    await new Promise((ok) => setTimeout(ok, 1200 * (tentativa + 1)));
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Divide o período em janelas de até 365 dias (limite da API). */
function janelas(de: string, ate: string): [string, string][] {
  const saida: [string, string][] = [];
  let inicio = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  while (inicio <= fim) {
    const corte = new Date(inicio);
    corte.setUTCDate(corte.getUTCDate() + 364);
    const ate2 = corte < fim ? corte : fim;
    saida.push([iso(inicio), iso(ate2)]);
    inicio = new Date(ate2);
    inicio.setUTCDate(inicio.getUTCDate() + 1);
  }
  return saida;
}

/** Baixa todas as páginas de uma consulta paginada. */
async function todasAsPaginas<T>(caminho: (pagina: number) => string, aoAvancar: () => void): Promise<T[]> {
  const p1 = await pedir<Pagina<T>>(caminho(1));
  aoAvancar();
  const total = Math.min(p1.totalPaginas ?? 1, 40);
  const resto = await emLotes(
    Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 2),
    3,
    async (n) => {
      const r = await pedir<Pagina<T>>(caminho(n));
      aoAvancar();
      return r.resultado ?? [];
    },
  );
  return [...(p1.resultado ?? []), ...resto.flat()];
}

function lerRecentes(): { cnpj: string; nome: string }[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? "[]");
  } catch {
    return [];
  }
}

const mascaraCnpj = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
};

function Bloco({ titulo, icone, children }: { titulo: string; icone: ReactNode; children: ReactNode }) {
  return (
    <section className="cartao bloco-empresa">
      <h3>
        {icone} {titulo}
      </h3>
      <div className="numeros-empresa">{children}</div>
    </section>
  );
}

function Numero({ valor, rotulo, tom }: { valor: ReactNode; rotulo: string; tom?: "verde" | "fraco" | "aviso" }) {
  return (
    <div className={`numero-empresa ${tom ?? ""}`}>
      <strong>{valor}</strong>
      <span>{rotulo}</span>
    </div>
  );
}

/** Pizza simples (duas fatias) em SVG. */
function Pizza({ partes, titulo }: { partes: { nome: string; valor: number; cor: string }[]; titulo: string }) {
  const total = partes.reduce((s, p) => s + p.valor, 0) || 1;
  let acumulado = 0;
  const raio = 15.9155; // circunferência 100
  return (
    <section className="cartao grafico-pizza">
      <h3>{titulo}</h3>
      <div className="pizza-corpo">
        <svg viewBox="0 0 42 42" role="img" aria-label={titulo}>
          <circle cx="21" cy="21" r={raio} fill="none" stroke="var(--superficie-2)" strokeWidth="7" />
          {partes.map((p) => {
            const pct = (p.valor / total) * 100;
            const el = (
              <circle
                key={p.nome}
                cx="21"
                cy="21"
                r={raio}
                fill="none"
                stroke={p.cor}
                strokeWidth="7"
                strokeDasharray={`${Math.max(0, pct - 0.6)} ${100 - Math.max(0, pct - 0.6)}`}
                strokeDashoffset={25 - acumulado}
              />
            );
            acumulado += pct;
            return el;
          })}
        </svg>
        <div className="pizza-legenda">
          {partes.map((p) => (
            <span key={p.nome}>
              <i style={{ background: p.cor }} />
              {p.nome}
              <b>{Math.round((p.valor / total) * 1000) / 10}%</b>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Empresas() {
  const [texto, setTexto] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe(12));
  const [cnpj, setCnpj] = useState("");
  const [fornecedor, setFornecedor] = useState<Fornecedor | null>(null);
  const [dados, setDados] = useState<{ resultados: ResultadoItem[]; itens: ItemPncp[] } | null>(null);
  const [progresso, setProgresso] = useState<{ feito: number; total: number; etapa: string } | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("vitorias");
  const [uf, setUf] = useState("");
  const [ordem, setOrdem] = useState<"compras" | "valor">("valor");
  const [orgaos, setOrgaos] = useState<Record<string, string>>({});
  const [recentes, setRecentes] = useState(lerRecentes);
  const [paginaItens, setPaginaItens] = useState(1);
  const pesquisa = useRef(0);

  const resumo = useMemo(() => (dados ? resumirEmpresa(dados.resultados, dados.itens, uf) : null), [dados, uf]);
  const geral = useMemo(() => (dados ? resumirEmpresa(dados.resultados, dados.itens) : null), [dados]);

  // Nome dos principais órgãos (o PNCP só traz o código).
  useEffect(() => {
    if (!geral) return;
    const faltam = geral.orgaosLista.slice(0, 15).map((o) => o.chave).filter((c) => /^\d+$/.test(c) && !orgaos[c]);
    if (!faltam.length) return;
    let vivo = true;
    void emLotes(faltam, 4, async (codigo) => {
      type Uasg = Pagina<{ nomeUasg?: string; nomeMunicipioIbge?: string; siglaUf?: string }>;
      let u = (await pedir<Uasg>(`/uasg?codigo=${codigo}`).catch(() => null))?.resultado?.[0];
      if (!u) u = (await pedir<Uasg>(`/uasg?codigo=${codigo}&ativo=false`).catch(() => null))?.resultado?.[0];
      return [codigo, u?.nomeUasg ? `${u.nomeUasg}${u.nomeMunicipioIbge ? ` — ${u.nomeMunicipioIbge}/${u.siglaUf ?? ""}` : ""}` : `UASG ${codigo}`] as const;
    }).then((pares) => vivo && setOrgaos((atual) => ({ ...atual, ...Object.fromEntries(pares) })));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geral]);

  async function analisar(numero = cnpj, p = periodo) {
    const id = ++pesquisa.current;
    setErro("");
    setDados(null);
    setFornecedor(null);
    setUf("");
    setPaginaItens(1);
    try {
      setProgresso({ feito: 0, total: 0, etapa: "Buscando o cadastro da empresa" });
      let f = (await pedir<Pagina<Fornecedor>>(`/fornecedor?cnpj=${numero}`)).resultado?.[0] ?? null;
      if (!f) f = (await pedir<Pagina<Fornecedor>>(`/fornecedor?cnpj=${numero}&ativo=false`)).resultado?.[0] ?? null;
      if (pesquisa.current !== id) return;
      setFornecedor(f);
      // Vitórias pela data do resultado; descrições pela data de publicação do item (começa 4 meses antes).
      const jv = janelas(p.de, p.ate);
      const inicioItens = new Date(`${p.de}T12:00:00Z`);
      inicioItens.setUTCMonth(inicioItens.getUTCMonth() - 4);
      const ji = janelas(iso(inicioItens), p.ate);
      let feito = 0;
      const total = jv.length + ji.length;
      const avancar = () => pesquisa.current === id && setProgresso({ feito: Math.min(++feito, total * 3), total: total * 3, etapa: "Baixando as vitórias no PNCP" });
      setProgresso({ feito: 0, total: total * 3, etapa: "Baixando as vitórias no PNCP" });
      const [resultados, itens] = await Promise.all([
        Promise.all(jv.map(([de, ate]) => todasAsPaginas<ResultadoItem>((n) => `/vitorias?cnpj=${numero}&inicio=${de}&fim=${ate}&pagina=${n}`, avancar))),
        Promise.all(ji.map(([de, ate]) => todasAsPaginas<ItemPncp>((n) => `/itens-vencidos?cnpj=${numero}&inicio=${de}&fim=${ate}&pagina=${n}`, avancar))),
      ]);
      if (pesquisa.current !== id) return;
      setDados({ resultados: resultados.flat(), itens: itens.flat() });
      const nome = f?.nomeRazaoSocialFornecedor ?? "";
      const novos = [{ cnpj: numero, nome }, ...recentes.filter((r) => r.cnpj !== numero)].slice(0, 6);
      setRecentes(novos);
      try {
        localStorage.setItem(CHAVE_RECENTES, JSON.stringify(novos));
      } catch {
        /* sem armazenamento: tudo bem */
      }
    } catch (e) {
      if (pesquisa.current === id) setErro(e instanceof Error ? e.message : "Não foi possível analisar agora.");
    } finally {
      if (pesquisa.current === id) setProgresso(null);
    }
  }

  function enviar(e?: FormEvent) {
    e?.preventDefault();
    const numero = texto.replace(/\D/g, "").slice(0, 14);
    if (!cnpjValido(numero)) return setErro("Digite um CNPJ válido (14 números).");
    setCnpj(numero);
    setTexto(mascaraCnpj(numero));
    void analisar(numero);
  }

  function mudarPeriodo(p: Periodo) {
    if (!p.de || !p.ate) return;
    setPeriodo(p);
    if (cnpj) void analisar(cnpj, p);
  }

  const nomeOrgao = (codigo: string) => orgaos[codigo] ?? `UASG ${codigo}`;
  const nomeEmpresa = fornecedor?.nomeRazaoSocialFornecedor ?? "";
  const itensFiltrados = resumo?.lista ?? [];
  const paginasItens = Math.max(1, Math.ceil(itensFiltrados.length / 20));
  const ABAS: { chave: Aba; nome: string; icone: ReactNode }[] = [
    { chave: "geral", nome: "Visão geral", icone: <Building2 size={15} /> },
    { chave: "vitorias", nome: "Vitórias em licitações", icone: <BarChart3 size={15} /> },
    { chave: "graficos", nome: "Gráficos e mapa", icone: <TrendingUp size={15} /> },
    { chave: "itens", nome: "Itens vencidos", icone: <ListChecks size={15} /> },
  ];

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Análise de empresas</h1>
          <p className="texto-suave">O que uma empresa vence em licitações: itens, valores, modalidades, órgãos, estados e produtos.</p>
        </div>
      </div>

      <section className="cartao busca-mercado entrar" style={{ ["--i" as string]: 1 }}>
        <form className="barra-busca-mercado" onSubmit={enviar}>
          <div className="entrada com-icone">
            <Search aria-hidden="true" />
            <input
              value={texto}
              onChange={(e) => setTexto(/[a-z]/i.test(e.target.value) ? e.target.value : mascaraCnpj(e.target.value))}
              onPaste={(e) => {
                const colado = e.clipboardData.getData("text");
                const numero = colado.replace(/\D/g, "");
                if (numero.length >= 14) {
                  e.preventDefault();
                  setTexto(mascaraCnpj(numero.slice(0, 14)));
                }
              }}
              placeholder="CNPJ da empresa (ex.: 12.345.678/0001-90)"
              aria-label="CNPJ da empresa"
              inputMode="numeric"
              autoFocus
            />
            {texto && (
              <button type="button" className="limpar-entrada" onClick={() => setTexto("")} aria-label="Limpar">
                <X size={14} />
              </button>
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
        {recentes.length > 0 && !dados && !progresso && (
          <div className="produtos-mercado">
            <span className="texto-fraco pequeno">Pesquisas recentes</span>
            <div className="chips-filtro">
              {recentes.map((r) => (
                <button
                  key={r.cnpj}
                  type="button"
                  className="chip-filtro"
                  onClick={() => {
                    setTexto(mascaraCnpj(r.cnpj));
                    setCnpj(r.cnpj);
                    void analisar(r.cnpj);
                  }}
                >
                  {r.nome ? `${r.nome.slice(0, 40)} · ` : ""}
                  {cnpjFormatado(r.cnpj)}
                </button>
              ))}
            </div>
          </div>
        )}
        {progresso && (
          <div className="progresso-mercado" role="status">
            <span className="texto-suave pequeno">
              {progresso.etapa}
              {progresso.total > 0 && ` · ${Math.round((progresso.feito / progresso.total) * 100)}%`}
            </span>
            <span className="barra-progresso fina">
              <span style={{ width: progresso.total ? `${Math.min(100, (progresso.feito / progresso.total) * 100)}%` : "8%" }} />
            </span>
          </div>
        )}
        {erro && <p className="alerta erro">{erro}</p>}
      </section>

      {!dados && !progresso && !erro && (
        <section className="cartao">
          <Vazio icone={<Search />} titulo="Pesquise uma empresa para começar">
            Digite o CNPJ de um concorrente (ou da sua empresa) e veja tudo o que ela venceu no período, em todas as plataformas que publicam no PNCP.
          </Vazio>
        </section>
      )}

      {dados && resumo && geral && (
        <>
          <div className="cabecalho-empresa entrar">
            <span className="texto-fraco pequeno">Empresa</span>
            <strong>
              {cnpjFormatado(cnpj)} — {nomeEmpresa || "Empresa não encontrada no cadastro do Compras.gov.br"}
            </strong>
            {uf && (
              <button className="chip-filtro ativo com-x" onClick={() => setUf("")}>
                {NOMES_UF[uf] ?? uf}
                <X size={12} />
              </button>
            )}
          </div>

          <div className="abas-empresa" role="tablist">
            {ABAS.map((a) => (
              <button key={a.chave} type="button" role="tab" aria-selected={aba === a.chave} className={aba === a.chave ? "ativa" : ""} onClick={() => setAba(a.chave)}>
                {a.icone} {a.nome}
              </button>
            ))}
          </div>

          {aba === "geral" && (
            <div className="grade-empresa">
              <section className="cartao ficha-empresa">
                <h3>
                  <Building2 size={16} /> Cadastro
                </h3>
                {fornecedor ? (
                  <dl>
                    <dt>Razão social</dt>
                    <dd>{fornecedor.nomeRazaoSocialFornecedor}</dd>
                    <dt>CNPJ</dt>
                    <dd>{cnpjFormatado(cnpj)}</dd>
                    <dt>Cidade</dt>
                    <dd>{[fornecedor.nomeMunicipio, fornecedor.ufSigla].filter(Boolean).join(" / ") || "—"}</dd>
                    <dt>Porte</dt>
                    <dd>{fornecedor.porteEmpresaNome ?? "—"}</dd>
                    <dt>Natureza jurídica</dt>
                    <dd>{fornecedor.naturezaJuridicaNome ?? "—"}</dd>
                    <dt>Atividade principal (CNAE)</dt>
                    <dd>{fornecedor.nomeCnae ? `${fornecedor.codigoCnae ?? ""} — ${fornecedor.nomeCnae}` : "—"}</dd>
                    <dt>Situação no Compras.gov.br</dt>
                    <dd>
                      {fornecedor.ativo === false ? "Inativa" : "Ativa"} · {fornecedor.habilitadoLicitar ? "habilitada a licitar" : "não habilitada a licitar"}
                    </dd>
                  </dl>
                ) : (
                  <p className="texto-fraco pequeno">Esta empresa não aparece no cadastro de fornecedores do Compras.gov.br (pode participar só de outras plataformas).</p>
                )}
              </section>
              <section className="cartao ficha-empresa">
                <h3>
                  <TrendingUp size={16} /> Resumo do período
                </h3>
                <dl>
                  <dt>Período</dt>
                  <dd>
                    {dataBr(periodo.de)} a {dataBr(periodo.ate)}
                  </dd>
                  <dt>Itens vencidos</dt>
                  <dd>{formatarNumero(geral.itens)}</dd>
                  <dt>Licitações com vitória</dt>
                  <dd>{formatarNumero(geral.licitacoes)}</dd>
                  <dt>Órgãos atendidos</dt>
                  <dd>{formatarNumero(geral.orgaos)}</dd>
                  <dt>Valor homologado</dt>
                  <dd>{formatarMoeda(geral.valor)}</dd>
                  <dt>Estados</dt>
                  <dd>{formatarNumero(geral.estados.length)}</dd>
                  <dt>Produto mais vencido</dt>
                  <dd>{geral.produtos.filter((p) => p.nome !== "SEM DESCRIÇÃO").sort((a, b) => b.compras - a.compras)[0]?.nome ?? "—"}</dd>
                </dl>
              </section>
            </div>
          )}

          {aba === "vitorias" && (
            <>
              <Bloco titulo="Vitórias" icone={<BarChart3 size={15} />}>
                <Numero valor={formatarNumero(resumo.itens)} rotulo="Itens vencidos" tom="verde" />
                <Numero valor={formatarNumero(resumo.licitacoes)} rotulo="Licitações com vitória" />
                <Numero valor={formatarNumero(resumo.orgaos)} rotulo="Órgãos atendidos" />
                <Numero valor={formatarNumero(resumo.cancelados)} rotulo="Resultados cancelados" tom="fraco" />
              </Bloco>
              <Bloco titulo="Valores" icone={<Landmark size={15} />}>
                <Numero valor={formatarMoeda(resumo.valor)} rotulo="Valor homologado" tom="verde" />
                <Numero valor={formatarMoeda(resumo.valor - resumo.valorAtas)} rotulo="Compras diretas" />
                <Numero valor={formatarMoeda(resumo.valorAtas)} rotulo="Registrado em atas (quantidade máxima)" tom="fraco" />
              </Bloco>
              <Bloco titulo="Vitórias por modalidade" icone={<Package size={15} />}>
                {resumo.porModalidade.length ? (
                  resumo.porModalidade.map((m) => <Numero key={m.nome} valor={formatarMoeda(m.valor)} rotulo={`${m.nome} · ${formatarNumero(m.itens)} itens`} />)
                ) : (
                  <Numero valor="—" rotulo="Sem vitórias no período" tom="fraco" />
                )}
              </Bloco>
              <p className="explicacao fonte-mercado">
                <Info aria-hidden="true" />
                <span>
                  Fonte: resultados oficiais publicados no PNCP (todas as plataformas de compra que publicam lá) e cadastro de fornecedores do
                  Compras.gov.br. A base aberta do governo traz só as <b>vitórias</b>: disputas perdidas, desclassificações e inabilitações não são
                  publicadas nela.
                </span>
              </p>
            </>
          )}

          {aba === "graficos" && (
            <>
              <section className="cartao painel-mercado">
                <MapaMarcas estados={geral.estados} ativo={uf} aoEscolher={(x) => setUf(uf === x ? "" : x)} />
                <div className="lado-mercado">
                  <GraficoMeses porMes={resumo.porMes} de={periodo.de} ate={periodo.ate} />
                  <div className="total-mercado">
                    <span className="texto-fraco pequeno">Valor homologado{uf ? ` em ${NOMES_UF[uf] ?? uf}` : ""}</span>
                    <strong className="texto-gradiente">{formatarMoeda(resumo.valor)}</strong>
                    <span className="texto-fraco pequeno">
                      {formatarNumero(resumo.itens)} itens · {formatarNumero(resumo.licitacoes)} licitações · {formatarNumero(resumo.orgaos)} órgãos
                    </span>
                  </div>
                </div>
              </section>
              <div className="grade-empresa graficos-empresa">
                <Pizza
                  titulo="Compras diretas × atas de registro de preços"
                  partes={[
                    { nome: "Compras diretas", valor: resumo.valor - resumo.valorAtas, cor: "var(--mapa-1)" },
                    { nome: "Atas (quantidade máxima)", valor: resumo.valorAtas, cor: "var(--mapa-2)" },
                  ]}
                />
                <Pizza
                  titulo="Valor por modalidade"
                  partes={resumo.porModalidade.slice(0, 3).map((m, i) => ({ nome: m.nome, valor: m.valor, cor: ["var(--mapa-1)", "var(--mapa-2)", "var(--mapa-3)"][i] }))}
                />
              </div>
              <div className="filtros-mercado">
                <span className="texto-fraco pequeno">{uf ? `Filtrado: ${NOMES_UF[uf] ?? uf}` : "Clique num estado do mapa para filtrar"}</span>
                <div className="segmentado" role="group" aria-label="Ordenar por">
                  <button type="button" className={ordem === "valor" ? "ativo" : ""} onClick={() => setOrdem("valor")}>
                    Valor homologado
                  </button>
                  <button type="button" className={ordem === "compras" ? "ativo" : ""} onClick={() => setOrdem("compras")}>
                    Licitações
                  </button>
                </div>
              </div>
              <div className="grade-mercado">
                <Ranking
                  titulo="Produtos que mais vence"
                  icone={<Package size={18} aria-hidden="true" />}
                  linhas={resumo.produtos}
                  ordem={ordem}
                  rotuloDestaques="Estados"
                  arquivo={`produtos-${cnpj}.csv`}
                  vazio="Sem vitórias."
                />
                <Ranking
                  titulo="Órgãos que mais compram dela"
                  icone={<Landmark size={18} aria-hidden="true" />}
                  linhas={resumo.orgaosLista.map((o) => ({ ...o, nome: nomeOrgao(o.chave) }))}
                  ordem={ordem}
                  rotuloDestaques="Produtos"
                  arquivo={`orgaos-${cnpj}.csv`}
                  vazio="Sem vitórias."
                />
                <Ranking
                  titulo="Estados onde mais vence"
                  icone={<MapPin size={18} aria-hidden="true" />}
                  linhas={geral.estados.map((e) => ({ ...e, nome: NOMES_UF[e.nome] ?? e.nome }))}
                  ordem={ordem}
                  rotuloDestaques="Produtos"
                  aoClicar={(l) => setUf(uf === l.chave ? "" : l.chave)}
                  ativo={uf}
                  arquivo={`estados-${cnpj}.csv`}
                  vazio="Sem vitórias."
                />
              </div>
            </>
          )}

          {aba === "itens" && (
            <section className="cartao">
              <div className="cartao-titulo">
                <h2>
                  <FileSearch size={18} aria-hidden="true" /> Itens vencidos{uf ? ` em ${NOMES_UF[uf] ?? uf}` : ""}
                </h2>
                <button
                  className="botao link"
                  onClick={() =>
                    baixarCsv(`itens-vencidos-${cnpj}.csv`, [
                      ["Data do resultado", "Item", "Órgão (UASG)", "UF", "Modalidade", "Ata (registro de preços)", "Quantidade", "Preço unitário (R$)", "Valor (R$)", "Situação", "PNCP"],
                      ...itensFiltrados.map((i) => [i.data, i.descricao, nomeOrgao(i.unidade), i.uf, i.modalidade, i.ata ? "sim" : "não", i.quantidade, i.precoUnitario, i.valor.toFixed(2), i.cancelado ? "cancelado" : "homologado", i.linkPncp ?? ""]),
                    ])
                  }
                >
                  CSV
                </button>
              </div>
              <div className="lista-correspondencias">
                {itensFiltrados.slice((paginaItens - 1) * 20, paginaItens * 20).map((i) => (
                  <article key={`${i.id}-${i.valor}`} className={`correspondencia ${i.cancelado ? "cancelada" : ""}`}>
                    <div className="correspondencia-topo">
                      <strong>{i.descricao.length > 220 ? `${i.descricao.slice(0, 220)}…` : i.descricao}</strong>
                      <span className="preco-correspondencia">{formatarMoeda(i.valor)}</span>
                    </div>
                    <div className="correspondencia-meta texto-fraco">
                      <span>{formatarData(i.data)}</span>
                      <span>
                        {nomeOrgao(i.unidade)}
                        {i.uf ? ` · ${i.uf}` : ""}
                      </span>
                      <span>{i.modalidade}</span>
                      {i.ata && <span>Ata de registro de preços</span>}
                      <span>
                        {formatarNumero(i.quantidade)} × {formatarMoeda(i.precoUnitario)}
                      </span>
                      {i.cancelado && <span className="texto-vermelho">Resultado cancelado</span>}
                      {i.linkPncp && (
                        <a href={i.linkPncp} target="_blank" rel="noreferrer">
                          Ver no PNCP <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {paginasItens > 1 && (
                <div className="paginacao-simples">
                  <button className="botao secundario pequeno" disabled={paginaItens <= 1} onClick={() => setPaginaItens(paginaItens - 1)}>
                    Anterior
                  </button>
                  <span className="texto-fraco pequeno">
                    Página {paginaItens} de {formatarNumero(paginasItens)} · {formatarNumero(itensFiltrados.length)} itens
                  </span>
                  <button className="botao secundario pequeno" disabled={paginaItens >= paginasItens} onClick={() => setPaginaItens(paginaItens + 1)}>
                    Próxima
                  </button>
                </div>
              )}
            </section>
          )}

          <p className="nota-fonte-empresa texto-fraco pequeno">
            <ShieldCheck size={13} /> Dados oficiais: PNCP (resultados de todas as plataformas) e Compras.gov.br (cadastro). Período {dataBr(periodo.de)} a{" "}
            {dataBr(periodo.ate)}.
          </p>
        </>
      )}
    </>
  );
}
