import { BotaoCadastrarCompra } from "./CadastroProposta";
import {
  CalendarClock,
  ChevronDown,
  ClipboardList,
  FolderOpen,
  ListOrdered,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Image as Imagem,
  Landmark,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Share,
  SquareArrowOutUpRight,
  Tag,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Conteudo, montarConteudo, Visor } from "../../components/PreviaArquivo";
import { Modal } from "../../components/Ui";
import { link } from "../../rota";
import { type ArquivoPncp, detalheCompra, type ItemPncp, listarArquivos, listarItens, type ResultadoPncp, urlPrevia } from "../../pncp";
import { MarcasDoItem, tituloDoItem } from "./MarcasDoItem";

export function dataHora(iso: string | null) {
  if (!iso) return "";
  const [d, h] = iso.split("T");
  const [a, m, dia] = d.split("-");
  return `${dia}/${m}/${a}${h && h.slice(0, 5) !== "00:00" ? ` às ${h.slice(0, 5)}` : ""}`;
}

export const reais = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

/** "hoje", "amanhã", "em 3 dias", "encerrada" */
export function quandoSessao(iso: string | null): { texto: string; classe: string } | null {
  if (!iso) return null;
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const hoje = new Date();
  const dias = Math.round((new Date(a, m - 1, d).getTime() - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()) / 86400000);
  if (dias < 0) return { texto: "encerrada", classe: "" };
  if (dias === 0) return { texto: "hoje", classe: "urgente" };
  if (dias === 1) return { texto: "amanhã", classe: "urgente" };
  return { texto: `em ${dias} dias`, classe: dias <= 3 ? "breve" : "" };
}

type Carga<T> = { estado: "carregando" } | { estado: "erro"; erro: string } | { estado: "pronto"; dados: T };

function useCarga<T>(buscar: () => Promise<T>, chave: string): [Carga<T>, () => void] {
  const [carga, setCarga] = useState<Carga<T>>({ estado: "carregando" });
  const [vez, setVez] = useState(0);
  useEffect(() => {
    let vivo = true;
    setCarga({ estado: "carregando" });
    buscar().then(
      (dados) => vivo && setCarga({ estado: "pronto", dados }),
      (e) => vivo && setCarga({ estado: "erro", erro: e instanceof Error ? e.message : "Falha ao buscar no PNCP." }),
    );
    return () => {
      vivo = false;
    };
  }, [chave, vez]); // eslint-disable-line react-hooks/exhaustive-deps
  return [carga, () => setVez((v) => v + 1)];
}

function Falha({ erro, tentar }: { erro: string; tentar: () => void }) {
  return (
    <div className="alerta erro">
      {erro}{" "}
      <button className="botao link pequeno" onClick={tentar}>
        <RefreshCw size={13} /> Tentar de novo
      </button>
    </div>
  );
}

function Carregando({ texto }: { texto: string }) {
  return (
    <p className="texto-fraco carregando-linha">
      <Loader2 className="girando" /> {texto}
    </p>
  );
}

// ---------------- Arquivos (lista + prévia) ----------------

function Arquivos({ carga, tentar }: { carga: Carga<ArquivoPncp[]>; tentar: () => void }) {
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const atual = useRef<string | null>(null);
  const [cache] = useState(() => new Map<string, Conteudo>());
  const [urls] = useState<string[]>(() => []);
  const [conteudo, setConteudo] = useState<Conteudo | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  async function abrir(a: ArquivoPncp) {
    atual.current = a.url;
    setEscolhido(a.url);
    setErro("");
    const pronto = cache.get(a.url);
    if (pronto) return setConteudo(pronto);
    setConteudo(null);
    setAbrindo(true);
    try {
      const r = await fetch(urlPrevia(a.url), { credentials: "same-origin" });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { erro?: string } | null;
        throw new Error(j?.erro ?? "Não foi possível abrir o arquivo.");
      }
      const nomeServidor = r.headers.get("X-Nome-Arquivo");
      const nome = (nomeServidor ? decodeURIComponent(nomeServidor) : "") || `${a.titulo}.pdf`;
      const c = montarConteudo(nome, new Uint8Array(await r.arrayBuffer()), urls);
      cache.set(a.url, c);
      if (atual.current === a.url) setConteudo(c);
    } catch (e) {
      if (atual.current === a.url) setErro(e instanceof Error ? e.message : "Não foi possível abrir o arquivo.");
    } finally {
      if (atual.current === a.url) setAbrindo(false);
    }
  }

  // Já abre o primeiro arquivo (normalmente o edital).
  useEffect(() => {
    if (carga.estado === "pronto" && carga.dados.length && !atual.current) {
      const edital = carga.dados.find((a) => /edital|aviso/i.test(a.tipo)) ?? carga.dados[0];
      abrir(edital);
    }
  }, [carga]); // eslint-disable-line react-hooks/exhaustive-deps

  if (carga.estado === "carregando") return <Carregando texto="Buscando os arquivos no PNCP…" />;
  if (carga.estado === "erro") return <Falha erro={carga.erro} tentar={tentar} />;
  if (!carga.dados.length) return <p className="texto-fraco">O órgão ainda não publicou arquivos desta licitação no PNCP.</p>;
  return (
    <div className="arquivos-pncp">
      <ul className="lista-arquivos-pncp">
        {carga.dados.map((a) => (
          <li key={a.url}>
            <button className={escolhido === a.url ? "ativo" : ""} onClick={() => abrir(a)}>
              {/imagem|foto/i.test(a.tipo) ? <Imagem size={16} /> : <FileText size={16} />}
              <span>
                <strong>{a.titulo}</strong>
                <small>
                  {a.tipo}
                  {a.publicadoEm ? ` · ${dataHora(a.publicadoEm).split(" às")[0]}` : ""}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="area-visor">
        {abrindo && <Carregando texto="Abrindo o arquivo…" />}
        {erro && <p className="alerta erro">{erro}</p>}
        {conteudo && !abrindo && <Visor conteudo={conteudo} />}
      </div>
    </div>
  );
}

// ---------------- Itens ----------------

function Itens({ carga, tentar, limite }: { carga: Carga<ItemPncp[]>; tentar: () => void; limite?: number }) {
  const [todos, setTodos] = useState(!limite);
  const [aberto, setAberto] = useState<string | null>(null);
  const [completo, setCompleto] = useState<Set<string>>(new Set());
  const [marcas, setMarcas] = useState<ItemPncp | null>(null);
  if (carga.estado === "carregando") return <Carregando texto="Buscando os itens no PNCP…" />;
  if (carga.estado === "erro") return <Falha erro={carga.erro} tentar={tentar} />;
  const itens = carga.dados;
  if (!itens.length) return <p className="texto-fraco">Os itens ainda não foram publicados no PNCP.</p>;
  const total = itens.reduce((s, i) => s + (i.valorTotal ?? 0), 0);
  const visiveis = todos || !limite ? itens : itens.slice(0, limite);
  return (
    <>
      <div className="bolhas-itens">
        {visiveis.map((i) => {
          const estaAberto = aberto === i.numero;
          const longo = i.descricao.length > 260;
          const verTudo = completo.has(i.numero);
          return (
            <div key={i.numero} className={`bolha-item ${estaAberto ? "aberta" : ""}`}>
              <button type="button" className="bolha-topo" onClick={() => setAberto(estaAberto ? null : i.numero)} aria-expanded={estaAberto}>
                <span className="bolha-numero">{i.numero}</span>
                <span className="bolha-titulo">
                  <strong>{tituloDoItem(i.descricao)}</strong>
                  <span className="texto-fraco">
                    Qtd. {i.quantidade?.toLocaleString("pt-BR") ?? "—"}
                    {i.unidade ? ` ${i.unidade}` : ""}
                    {i.valorTotal ? ` · ${reais(i.valorTotal)}` : ""}
                  </span>
                </span>
                {i.beneficio && <span className="selo-me">ME/EPP</span>}
                <ChevronDown className="bolha-seta" size={18} aria-hidden="true" />
              </button>
              <div className="bolha-corpo">
                <div>
                  <div className="bolha-numeros">
                    <div>
                      <span>Tipo</span>
                      <strong>{i.tipo || "—"}</strong>
                    </div>
                    <div>
                      <span>Quantidade</span>
                      <strong>
                        {i.quantidade?.toLocaleString("pt-BR") ?? "—"} {i.unidade ?? ""}
                      </strong>
                    </div>
                    <div>
                      <span>Unitário (ref.)</span>
                      <strong>{reais(i.valorUnitario)}</strong>
                    </div>
                    <div>
                      <span>Total (ref.)</span>
                      <strong>{reais(i.valorTotal)}</strong>
                    </div>
                  </div>
                  <p className="bolha-descricao">{longo && !verTudo ? `${i.descricao.slice(0, 260)}…` : i.descricao}</p>
                  {longo && (
                    <button
                      type="button"
                      className="botao-link sem-margem"
                      onClick={() => setCompleto((c) => (c.has(i.numero) ? new Set([...c].filter((x) => x !== i.numero)) : new Set([...c, i.numero])))}
                    >
                      {verTudo ? "Mostrar menos" : "Ler descrição completa"}
                    </button>
                  )}
                  {i.beneficio && <span className="chip pequeno-chip">{i.beneficio}</span>}
                  <span className="bolha-rotulo">Analisar no mercado</span>
                  <div className="bolha-acoes">
                    <button type="button" className="botao secundario pequeno" onClick={() => setMarcas(i)}>
                      <Tag size={14} /> Marcas
                    </button>
                    <a className="botao secundario pequeno" {...link(`/licitacoes/mercado?produto=${encodeURIComponent(tituloDoItem(i.descricao))}`)}>
                      <TrendingUp size={14} /> Preços e concorrência
                    </a>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {total > 0 && (
        <p className="total-bolhas">
          Total de referência ({itens.length} itens): <strong>{reais(total)}</strong>
        </p>
      )}
      {!!limite && itens.length > limite && (
        <button className="botao link pequeno" onClick={() => setTodos((t) => !t)}>
          {todos ? "Mostrar menos" : `Ver todos os ${itens.length} itens`}
        </button>
      )}
      {marcas && <MarcasDoItem descricao={marcas.descricao} codigoCatalogo={marcas.codigoCatalogo} aoFechar={() => setMarcas(null)} />}
    </>
  );
}

// ---------------- Janela ----------------

export type EtapaPncp = "dados" | "itens" | "arquivos";

interface Props {
  resultado: ResultadoPncp;
  etapa: EtapaPncp;
  aoMudarEtapa: (e: EtapaPncp) => void;
  idQuadro?: number;
  podeImportar: boolean;
  importando: string | null; // etapa da importação desta licitação
  ocupado: boolean; // importando outra
  aoImportar: () => void;
  aoFechar: () => void;
  /** Botão "Compartilhar" (link da licitação para WhatsApp, e-mail…). */
  aoCompartilhar?: () => void;
  anterior?: () => void;
  proxima?: () => void;
  posicao?: string;
}

export function DetalhePncp(props: Props) {
  const { resultado: r, posicao, aoFechar } = props;
  // Para que lado a próxima licitação entra (desliza da direita na "Próxima", da esquerda na "Anterior").
  const [lado, setLado] = useState<"" | "vai" | "volta">("");
  const anterior = props.anterior && (() => (setLado("volta"), props.anterior!()));
  const proxima = props.proxima && (() => (setLado("vai"), props.proxima!()));

  // Setas do teclado passam de uma licitação para outra.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (alvo.closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft" && anterior) anterior();
      if (e.key === "ArrowRight" && proxima) proxima();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [anterior, proxima]);

  return (
    <Modal titulo={`${r.modalidade} nº ${r.numero}/${r.ano}`} aoFechar={aoFechar} largo classe="modal-destaque">
      {(anterior || proxima) && (
        <div className="navegar-pncp">
          <button className="botao secundario pequeno" onClick={anterior} disabled={!anterior}>
            <ChevronLeft /> Anterior
          </button>
          {posicao && <span className="texto-fraco pequeno">{posicao}</span>}
          <button className="botao secundario pequeno" onClick={proxima} disabled={!proxima}>
            Próxima <ChevronRight />
          </button>
        </div>
      )}
      <div key={r.id} className={`troca-pncp ${lado}`}>
        <Corpo {...props} />
      </div>
    </Modal>
  );
}

function Corpo({ resultado: r, etapa, aoMudarEtapa, idQuadro, podeImportar, importando, ocupado, aoImportar, aoCompartilhar }: Props) {
  const [itens, tentarItens] = useCarga(() => listarItens(r), r.id);
  const [arquivos, tentarArquivos] = useCarga(() => listarArquivos(r), r.id);
  const [extra] = useCarga(() => detalheCompra(r), r.id);
  // Cada etapa monta na primeira visita e continua montada (a prévia não baixa de novo ao voltar).
  const [vistas, setVistas] = useState(() => new Set<EtapaPncp>([etapa]));
  useEffect(() => setVistas((v) => (v.has(etapa) ? v : new Set(v).add(etapa))), [etapa]);

  const dados = extra.estado === "pronto" ? extra.dados : null;
  const linkPortal = r.linkPortal ?? dados?.linkPortal ?? null;
  const somaItens = useMemo(() => (itens.estado === "pronto" ? itens.dados.reduce((s, i) => s + (i.valorTotal ?? 0), 0) : 0), [itens]);
  const valorRef = r.valorEstimado ?? (somaItens > 0 ? somaItens : null);
  const quando = quandoSessao(r.encerramento);
  const qtdItens = itens.estado === "pronto" ? itens.dados.length : null;
  const qtdArquivos = arquivos.estado === "pronto" ? arquivos.dados.length : null;

  const fatos: { rotulo: string; valor: string; detalhe?: string; classe?: string }[] = [
    {
      rotulo: "Sessão",
      valor: r.encerramento ? dataHora(r.encerramento) : "Não informada",
      detalhe: quando ? (quando.texto === "encerrada" ? "Prazo de propostas encerrado" : `Sessão ${quando.texto}`) : undefined,
      classe: quando?.classe,
    },
    {
      rotulo: "Valor de referência",
      valor: valorRef ? reais(valorRef) : "Sigiloso / não informado",
      detalhe: !r.valorEstimado && valorRef ? "Soma dos itens" : qtdItens != null ? `${qtdItens} item(ns)` : undefined,
    },
    { rotulo: "Registro de preço", valor: r.srp ? "Sim (SRP)" : "Não", classe: r.srp ? "azul" : "" },
    { rotulo: "Modalidade", valor: r.modalidade, detalhe: r.modoDisputa ? `Disputa ${r.modoDisputa.toLowerCase()}` : undefined },
    { rotulo: "Plataforma", valor: dados?.portal ?? r.portal },
    { rotulo: "UASG / unidade", valor: r.uasg || "—", detalhe: r.unidade && r.unidade !== "Unidade Única" ? r.unidade : undefined },
  ];

  const maisInfo: [string, string][] = [
    ["Órgão", r.orgao],
    ["CNPJ do órgão", r.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")],
    ["Município", `${r.municipio ? `${r.municipio}/` : ""}${r.uf}`],
    ["Esfera", r.esfera],
    ["Nº do processo", dados?.processo ?? ""],
    ["Início das propostas", dataHora(r.abertura)],
    ["Publicada no PNCP", dataHora(r.publicadoEm)],
    ["Situação", r.cancelado ? "Cancelada" : r.situacao],
    ["Amparo legal", r.amparo],
    ["Nº de controle PNCP", r.id],
  ];

  const etapas: { chave: EtapaPncp; titulo: string; info?: string; Icone: typeof ClipboardList }[] = [
    { chave: "dados", titulo: "Dados", Icone: ClipboardList },
    { chave: "itens", titulo: "Itens", info: qtdItens != null ? String(qtdItens) : undefined, Icone: ListOrdered },
    { chave: "arquivos", titulo: "Arquivos", info: qtdArquivos != null ? String(qtdArquivos) : undefined, Icone: FolderOpen },
  ];

  return (
    <div className="ficha-pncp">
      <div className="ficha-pncp-topo">
        <p className="resultado-pncp-orgao">
          <Landmark size={13} /> {r.orgao}
          <span className="separador">·</span>
          <MapPin size={13} /> {r.municipio ? `${r.municipio}/` : ""}
          {r.uf}
          {r.encerramento && (
            <>
              <span className="separador">·</span>
              <CalendarClock size={13} /> Sessão {dataHora(r.encerramento)}
            </>
          )}
        </p>
        <div className="detalhe-pncp-links">
          <a className="botao secundario pequeno" href={r.linkPncp} target="_blank" rel="noreferrer noopener">
            <ExternalLink /> Ver no PNCP
          </a>
          {linkPortal && (
            <a className="botao secundario pequeno" href={linkPortal} target="_blank" rel="noreferrer noopener" title={linkPortal}>
              <ExternalLink /> Abrir no {dados?.portal ?? r.portal}
            </a>
          )}
          {aoCompartilhar && (
            <button className="botao secundario pequeno" onClick={aoCompartilhar}>
              <Share /> Compartilhar
            </button>
          )}
          {!r.cancelado && <BotaoCadastrarCompra link={linkPortal} />}
          {r.cancelado && <span className="chip vermelho">Cancelada</span>}
          <span className="espaco" />
          {idQuadro ? (
            <a className="botao secundario pequeno" {...link(`/licitacoes/${idQuadro}`)}>
              <SquareArrowOutUpRight /> Já no quadro · abrir
            </a>
          ) : (
            podeImportar && (
              <button className="botao acento pequeno" onClick={aoImportar} disabled={!!importando || ocupado}>
                {importando ? <Loader2 className="girando" /> : <Plus />} {importando ?? "Adicionar ao quadro"}
              </button>
            )
          )}
        </div>
      </div>

      <nav className="abas-ficha etapas-pncp" aria-label="Etapas da licitação">
        {etapas.map(({ chave, titulo, info, Icone }) => (
          <button key={chave} className={`aba-ficha ${etapa === chave ? "ativa" : ""}`} onClick={() => aoMudarEtapa(chave)}>
            <Icone />
            <span>{titulo}</span>
            {info && <small>{info}</small>}
          </button>
        ))}
      </nav>

      {vistas.has("dados") && (
        <div hidden={etapa !== "dados"} className="etapa-pncp">
          <div className="fatos-pncp">
            {fatos.map((f) => (
              <div key={f.rotulo} className={`fato-pncp ${f.classe ?? ""}`}>
                <span>{f.rotulo}</span>
                <strong>{f.valor}</strong>
                {f.detalhe && <small>{f.detalhe}</small>}
              </div>
            ))}
          </div>
          <section>
            <h4 className="titulo-secao-pncp">Objeto</h4>
            <p className="objeto-completo">{r.objeto}</p>
            {r.informacao && r.informacao !== r.objeto && <p className="texto-suave pequeno informacao-pncp">{r.informacao}</p>}
          </section>
          <section>
            <h4 className="titulo-secao-pncp">Mais informações</h4>
            <dl className="resumo-pncp">
              {maisInfo
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </section>
          <div className="atalhos-etapa">
            <button className="botao secundario" onClick={() => aoMudarEtapa("itens")}>
              <ListOrdered /> Ver itens{qtdItens != null ? ` (${qtdItens})` : ""}
            </button>
            <button className="botao secundario" onClick={() => aoMudarEtapa("arquivos")}>
              <FolderOpen /> Ver arquivos{qtdArquivos != null ? ` (${qtdArquivos})` : ""}
            </button>
          </div>
        </div>
      )}

      {vistas.has("itens") && (
        <div hidden={etapa !== "itens"} className="etapa-pncp">
          <h4 className="titulo-secao-pncp">
            Itens{qtdItens != null ? ` (${qtdItens})` : ""}
            {somaItens > 0 && <span className="texto-fraco"> · referência {reais(somaItens)}</span>}
          </h4>
          <Itens carga={itens} tentar={tentarItens} />
        </div>
      )}

      {vistas.has("arquivos") && (
        <div hidden={etapa !== "arquivos"} className="etapa-pncp">
          <Arquivos carga={arquivos} tentar={tentarArquivos} />
        </div>
      )}
    </div>
  );
}
