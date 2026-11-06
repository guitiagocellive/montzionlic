import { ExternalLink, FileText, Image as Imagem, Loader2, Plus, RefreshCw, SquareArrowOutUpRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { link } from "../../rota";
import { type ArquivoPncp, type ItemPncp, listarArquivos, listarItens, type ResultadoPncp, urlPrevia } from "../../pncp";
import { Modal } from "../../components/Ui";
import { type Conteudo, montarConteudo, Visor } from "../../components/PreviaArquivo";

export function dataHora(iso: string | null) {
  if (!iso) return "";
  const [d, h] = iso.split("T");
  const [a, m, dia] = d.split("-");
  return `${dia}/${m}/${a}${h && h.slice(0, 5) !== "00:00" ? ` às ${h.slice(0, 5)}` : ""}`;
}

export const reais = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

function AbaArquivos({ resultado }: { resultado: ResultadoPncp }) {
  const [arquivos, setArquivos] = useState<ArquivoPncp[] | null>(null);
  const [erroLista, setErroLista] = useState("");
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const atual = useRef<string | null>(null);
  const [cache] = useState(() => new Map<string, Conteudo>());
  const [urls] = useState<string[]>(() => []);
  const [conteudo, setConteudo] = useState<Conteudo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  function carregarLista() {
    setErroLista("");
    setArquivos(null);
    listarArquivos(resultado).then(
      (l) => {
        setArquivos(l);
        if (l.length) abrir(l[0]);
      },
      (e) => setErroLista(e instanceof Error ? e.message : "Falha ao listar os arquivos."),
    );
  }
  useEffect(carregarLista, [resultado.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function abrir(a: ArquivoPncp) {
    atual.current = a.url;
    setEscolhido(a.url);
    setErro("");
    const pronto = cache.get(a.url);
    if (pronto) return setConteudo(pronto);
    setConteudo(null);
    setCarregando(true);
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
      if (atual.current === a.url) setCarregando(false);
    }
  }

  if (erroLista)
    return (
      <div className="alerta erro">
        {erroLista}{" "}
        <button className="botao link pequeno" onClick={carregarLista}>
          <RefreshCw size={13} /> Tentar de novo
        </button>
      </div>
    );
  if (!arquivos) return <p className="texto-fraco carregando-linha"><Loader2 className="girando" /> Buscando os arquivos no PNCP…</p>;
  if (!arquivos.length) return <p className="texto-fraco">O órgão ainda não publicou arquivos desta licitação no PNCP.</p>;
  return (
    <div className="arquivos-pncp">
      <ul className="lista-arquivos-pncp">
        {arquivos.map((a) => (
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
        {carregando && <p className="texto-fraco carregando-linha"><Loader2 className="girando" /> Abrindo o arquivo…</p>}
        {erro && <p className="alerta erro">{erro}</p>}
        {conteudo && !carregando && <Visor conteudo={conteudo} />}
      </div>
    </div>
  );
}

function AbaItens({ resultado }: { resultado: ResultadoPncp }) {
  const [itens, setItens] = useState<ItemPncp[] | null>(null);
  const [erro, setErro] = useState("");
  const carregar = () => {
    setErro("");
    setItens(null);
    listarItens(resultado).then(setItens, (e) => setErro(e instanceof Error ? e.message : "Falha ao buscar os itens."));
  };
  useEffect(carregar, [resultado.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => (itens ?? []).reduce((s, i) => s + (i.valorTotal ?? 0), 0), [itens]);
  if (erro)
    return (
      <div className="alerta erro">
        {erro}{" "}
        <button className="botao link pequeno" onClick={carregar}>
          <RefreshCw size={13} /> Tentar de novo
        </button>
      </div>
    );
  if (!itens) return <p className="texto-fraco carregando-linha"><Loader2 className="girando" /> Buscando os itens no PNCP…</p>;
  if (!itens.length) return <p className="texto-fraco">Os itens ainda não foram publicados no PNCP.</p>;
  return (
    <div className="tabela-rolavel">
      <table className="tabela-fin itens-pncp">
        <thead>
          <tr>
            <th>Item</th>
            <th>Descrição</th>
            <th className="num">Qtd.</th>
            <th>Unid.</th>
            <th className="num">Valor unit. estimado</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.numero}>
              <td>{i.numero}</td>
              <td>
                {i.descricao}
                {i.beneficio && <span className="chip pequeno-chip">{i.beneficio}</span>}
              </td>
              <td className="num">{i.quantidade?.toLocaleString("pt-BR") ?? "—"}</td>
              <td>{i.unidade ?? ""}</td>
              <td className="num">{reais(i.valorUnitario)}</td>
              <td className="num">{reais(i.valorTotal)}</td>
            </tr>
          ))}
        </tbody>
        {total > 0 && (
          <tfoot>
            <tr>
              <td colSpan={5}>{itens.length} item(ns) · total estimado</td>
              <td className="num">{reais(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Resumo({ r }: { r: ResultadoPncp }) {
  const campos: [string, string][] = [
    ["Órgão", r.orgao],
    ["Unidade compradora", [r.uasg && `UASG ${r.uasg}`, r.unidade].filter(Boolean).join(" · ")],
    ["Município", `${r.municipio ? `${r.municipio}/` : ""}${r.uf}`],
    ["Esfera", r.esfera],
    ["Modalidade", r.modalidade],
    ["Modo de disputa", r.modoDisputa],
    ["Registro de preço", r.srp ? "Sim (SRP)" : "Não"],
    ["Valor estimado", r.valorEstimado ? reais(r.valorEstimado) : "Não informado / sigiloso"],
    ["Início das propostas", dataHora(r.abertura)],
    ["Sessão (fim das propostas)", dataHora(r.encerramento)],
    ["Publicada no PNCP", dataHora(r.publicadoEm)],
    ["Situação", r.cancelado ? "Cancelada" : r.situacao],
    ["Portal da disputa", r.portal],
    ["Amparo legal", r.amparo],
    ["Nº de controle PNCP", r.id],
  ];
  return (
    <>
      <dl className="resumo-pncp">
        {campos
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <h4 className="titulo-objeto">Objeto</h4>
      <p className="objeto-completo">{r.objeto}</p>
    </>
  );
}

export function DetalhePncp({
  resultado: r,
  abaInicial = "arquivos",
  idQuadro,
  podeImportar,
  importando,
  aoImportar,
  aoFechar,
}: {
  resultado: ResultadoPncp;
  abaInicial?: "resumo" | "itens" | "arquivos";
  idQuadro?: number;
  podeImportar: boolean;
  importando: boolean;
  aoImportar: () => void;
  aoFechar: () => void;
}) {
  const [aba, setAba] = useState(abaInicial);
  // Cada aba carrega na primeira vez que é aberta e continua montada (não baixa de novo ao voltar).
  const [vistas, setVistas] = useState(() => new Set([abaInicial]));
  const irPara = (a: typeof aba) => {
    setAba(a);
    setVistas((v) => new Set(v).add(a));
  };
  return (
    <Modal titulo={`${r.modalidade} nº ${r.numero}/${r.ano}`} aoFechar={aoFechar} largo>
      <div className="detalhe-pncp">
        <p className="resultado-pncp-orgao">
          {r.orgao} · {r.municipio ? `${r.municipio}/` : ""}
          {r.uf}
          {r.encerramento && <> · Sessão {dataHora(r.encerramento)}</>}
        </p>
        <div className="detalhe-pncp-links">
          <a className="botao secundario pequeno" href={r.linkPncp} target="_blank" rel="noreferrer noopener">
            <ExternalLink /> Ver no PNCP
          </a>
          {r.linkPortal && (
            <a className="botao secundario pequeno" href={r.linkPortal} target="_blank" rel="noreferrer noopener">
              <ExternalLink /> {r.portal}
            </a>
          )}
          {idQuadro ? (
            <a className="botao secundario pequeno" {...link(`/licitacoes/${idQuadro}`)}>
              <SquareArrowOutUpRight /> Abrir no quadro
            </a>
          ) : (
            podeImportar && (
              <button className="botao acento pequeno" onClick={aoImportar} disabled={importando}>
                {importando ? <Loader2 className="girando" /> : <Plus />} {importando ? "Importando…" : "Adicionar ao quadro"}
              </button>
            )
          )}
        </div>
        <div className="segmentado abas-pncp">
          {(["arquivos", "itens", "resumo"] as const).map((a) => (
            <button key={a} type="button" className={aba === a ? "ativo" : ""} onClick={() => irPara(a)}>
              {a === "arquivos" ? "Arquivos" : a === "itens" ? "Itens" : "Resumo"}
            </button>
          ))}
        </div>
        {vistas.has("arquivos") && <div hidden={aba !== "arquivos"}><AbaArquivos resultado={r} /></div>}
        {vistas.has("itens") && <div hidden={aba !== "itens"}><AbaItens resultado={r} /></div>}
        {vistas.has("resumo") && <div hidden={aba !== "resumo"}><Resumo r={r} /></div>}
      </div>
    </Modal>
  );
}
