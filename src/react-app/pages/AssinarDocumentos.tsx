import { Download, Eye, FileSignature, FileText, Search, Settings, ShieldAlert, ShieldCheck, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { type DragEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIAS_ARQUIVO } from "../../shared/negocio";
import { podeEditar, podeVer } from "../../shared/permissoes";
import type { CertificadoInfo, LicitacaoResumo, Usuario } from "../../shared/tipos";
import { api, enviarArquivo, mensagemDeErro } from "../api";
import { PreviaArquivo } from "../components/PreviaArquivo";
import { avisar, Carregando, Modal, Vazio } from "../components/Ui";
import { formatarTamanho } from "../formato";
import { link } from "../rota";

const ModalAssinar = lazy(() => import("../assinatura/ModalAssinar").then((m) => ({ default: m.ModalAssinar })));

interface Assinado {
  id: number;
  nome: string;
  tamanho: number | null;
  titular: string;
  assinado_em: number;
  assinado_por_nome: string | null;
}

interface AssinadoNaLicitacao extends Assinado {
  categoria: string | null;
  licitacao_id: number | null;
  execucao_id: number | null;
  licitacao_numero: string | null;
  licitacao_orgao: string | null;
  numero_empenho: string | null;
}

const quando = (ms: number) => new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const semExtensao = (nome: string) => nome.replace(/\.pdf$/i, "");

function baixarBytes(bytes: Uint8Array, nome: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function AssinarDocumentos({ usuario }: { usuario: Usuario }) {
  const podeAssinar = podeEditar(usuario.permissoes, "assinatura");
  const verLicitacoes = podeVer(usuario.permissoes, "licitacoes");
  const enviarLicitacao = podeEditar(usuario.permissoes, "licitacoes");
  const admin = usuario.papel === "admin";

  const [certificado, setCertificado] = useState<CertificadoInfo | null | undefined>(undefined);
  const [avulsos, setAvulsos] = useState<Assinado[] | null>(null);
  const [nasLicitacoes, setNasLicitacoes] = useState<AssinadoNaLicitacao[]>([]);
  const [licitacoes, setLicitacoes] = useState<LicitacaoResumo[]>([]);
  const [destino, setDestino] = useState("");
  const [categoria, setCategoria] = useState("Outro");
  const [baixarAoAssinar, setBaixarAoAssinar] = useState(true);
  const [fila, setFila] = useState<File[]>([]);
  const [total, setTotal] = useState(0);
  const [vendo, setVendo] = useState<{ url: string; nome: string } | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [busca, setBusca] = useState("");
  const entrada = useRef<HTMLInputElement>(null);

  function carregar() {
    api<{ avulsos: Assinado[]; nas_licitacoes: AssinadoNaLicitacao[] }>("/assinaturas").then(
      (r) => {
        setAvulsos(r.avulsos);
        setNasLicitacoes(r.nas_licitacoes);
      },
      (e) => avisar(mensagemDeErro(e), "erro"),
    );
  }

  useEffect(() => {
    carregar();
    api<{ certificado: CertificadoInfo }>("/certificado").then(
      (r) => setCertificado(r.certificado),
      () => setCertificado(null),
    );
    if (enviarLicitacao) api<{ licitacoes: LicitacaoResumo[] }>("/licitacoes").then((r) => setLicitacoes(r.licitacoes), () => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const certificadoPronto = !!certificado?.configurado && certificado.segredo_configurado && (certificado.dias_restantes ?? 0) >= 0;
  const motivo = !podeAssinar
    ? "Você pode ver os documentos assinados, mas não tem permissão para assinar (Configurações → Equipe → permissão Assinatura digital)."
    : certificado === undefined
      ? ""
      : !certificado?.configurado
        ? "Nenhum certificado digital cadastrado."
        : !certificado.segredo_configurado
          ? "A assinatura ainda não foi ativada no servidor."
          : (certificado.dias_restantes ?? 0) < 0
            ? "O certificado da empresa venceu."
            : "";
  const liberado = podeAssinar && certificadoPronto;

  function escolher(lista: FileList | File[]) {
    const arquivos = Array.from(lista);
    const pdfs = arquivos.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (pdfs.length < arquivos.length) avisar("Só arquivos PDF podem ser assinados. Os outros foram deixados de fora.", "erro");
    if (!pdfs.length) return;
    setFila(pdfs);
    setTotal(pdfs.length);
  }

  function aoSoltar(e: DragEvent) {
    e.preventDefault();
    setArrastando(false);
    if (!liberado) return;
    if (e.dataTransfer.files.length) escolher(e.dataTransfer.files);
  }

  const atual = fila[0] ?? null;
  const posicao = total - fila.length + 1;
  const licitacaoDestino = licitacoes.find((l) => String(l.id) === destino);

  async function aoAssinado(pdf: Uint8Array, pedido: string) {
    if (!atual) return;
    const nome = `${semExtensao(atual.name)} (assinado).pdf`;
    const dados = new FormData();
    dados.set("arquivo", new Blob([pdf as BlobPart], { type: "application/pdf" }), nome);
    dados.set("pedido_assinatura", pedido);
    if (licitacaoDestino) {
      dados.set("licitacao_id", String(licitacaoDestino.id));
      dados.set("categoria", categoria);
      await enviarArquivo("/arquivos", dados);
    } else {
      dados.set("nome", nome);
      await enviarArquivo("/assinaturas", dados);
    }
    if (baixarAoAssinar) baixarBytes(pdf, nome);
    avisar(licitacaoDestino ? `"${nome}" assinado e guardado na licitação ${licitacaoDestino.numero ?? ""}.` : `"${nome}" assinado.`);
    setFila((f) => f.slice(1));
    carregar();
  }

  function cancelar() {
    if (fila.length > 1) avisar(`Assinatura cancelada. ${fila.length} documento(s) não foram assinados.`, "erro");
    setFila([]);
  }

  async function excluir(d: Assinado) {
    if (!window.confirm(`Excluir "${d.nome}"? O arquivo assinado será apagado.`)) return;
    try {
      await api(`/assinaturas/${d.id}`, { metodo: "DELETE" });
      avisar("Documento excluído.");
      carregar();
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    }
  }

  const termo = busca.trim().toLowerCase();
  const avulsosFiltrados = useMemo(() => (avulsos ?? []).filter((d) => !termo || `${d.nome} ${d.titular} ${d.assinado_por_nome ?? ""}`.toLowerCase().includes(termo)), [avulsos, termo]);
  const licFiltrados = useMemo(
    () => nasLicitacoes.filter((d) => !termo || `${d.nome} ${d.licitacao_numero ?? ""} ${d.licitacao_orgao ?? ""} ${d.numero_empenho ?? ""}`.toLowerCase().includes(termo)),
    [nasLicitacoes, termo],
  );

  if (avulsos === null) return <Carregando />;

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Documentação</span>
          <h1>Assinar documentos</h1>
          <p className="texto-suave">Assine qualquer PDF com o certificado digital da empresa: declarações, propostas, contratos, atas, ofícios…</p>
        </div>
      </div>

      <section className={`cartao assinar-cartao entrar ${liberado ? "" : "bloqueado"}`}>
        <div className="assinar-status">
          {certificadoPronto ? (
            <span className="etiqueta verde">
              <ShieldCheck size={14} /> Certificado de <strong>{certificado?.titular}</strong>
              {certificado?.documento ? ` (${certificado.documento})` : ""} · vence em {certificado?.dias_restantes} dia(s)
            </span>
          ) : (
            certificado !== undefined && (
              <span className="etiqueta amarela">
                <ShieldAlert size={14} /> {motivo || "Certificado indisponível."}
              </span>
            )
          )}
          {podeAssinar && certificadoPronto && motivo && <span className="texto-fraco pequeno">{motivo}</span>}
          {!podeAssinar && <span className="texto-fraco pequeno">{motivo}</span>}
          {admin && !certificadoPronto && (
            <a className="botao secundario pequeno" {...link("/configuracoes/certificado")}>
              <Settings /> Configurar certificado
            </a>
          )}
        </div>

        <div
          className={`zona-assinar ${arrastando ? "arrastando" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (liberado) setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={aoSoltar}
          onClick={() => liberado && entrada.current?.click()}
          role="button"
          tabIndex={liberado ? 0 : -1}
          aria-disabled={!liberado}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && liberado && entrada.current?.click()}
        >
          <FileSignature />
          <strong>{liberado ? "Arraste os PDFs aqui ou clique para escolher" : "Assinatura indisponível"}</strong>
          <span className="texto-fraco pequeno">
            {liberado ? "Pode escolher vários de uma vez. Em cada um você escolhe a página e o lugar do carimbo." : motivo}
          </span>
        </div>
        <input
          ref={entrada}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) escolher(e.target.files);
            e.target.value = "";
          }}
        />

        {liberado && (
          <div className="assinar-opcoes">
            <label className="campo">
              <span>Guardar o documento assinado em</span>
              <select value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Onde guardar">
                <option value="">Documentos assinados (esta página)</option>
                {enviarLicitacao &&
                  licitacoes.map((l) => (
                    <option key={l.id} value={l.id}>
                      Licitação {l.numero ?? "s/ nº"} · {(l.orgao ?? "").slice(0, 60)}
                    </option>
                  ))}
              </select>
            </label>
            {licitacaoDestino && (
              <label className="campo">
                <span>Categoria na licitação</span>
                <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria">
                  {CATEGORIAS_ARQUIVO.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="opcao-baixar">
              <input type="checkbox" checked={baixarAoAssinar} onChange={(e) => setBaixarAoAssinar(e.target.checked)} />
              Baixar o PDF assinado logo depois de assinar
            </label>
          </div>
        )}
      </section>

      <div className="barra-assinados">
        <h2>Documentos assinados</h2>
        {(avulsos.length > 0 || nasLicitacoes.length > 0) && (
          <div className="entrada com-icone pequena-entrada largo">
            <Search />
            <input placeholder="Procurar pelo nome, licitação ou titular" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Procurar documento" />
          </div>
        )}
      </div>

      <section className="cartao">
        {avulsosFiltrados.length === 0 ? (
          <Vazio icone={<FileSignature />} titulo={termo ? "Nenhum documento com esse nome" : "Nenhum documento assinado aqui ainda"}>
            {!termo && "Os PDFs assinados nesta página aparecem aqui, prontos para ver e baixar."}
          </Vazio>
        ) : (
          <div className="lista-arquivos">
            {avulsosFiltrados.map((d) => (
              <div key={d.id} className="linha-arquivo">
                <span className="icone-redondo verde">
                  <ShieldCheck />
                </span>
                <div className="arquivo-texto">
                  <button className="arquivo-nome" onClick={() => setVendo({ url: `/api/assinaturas/${d.id}`, nome: d.nome })}>
                    {d.nome}
                  </button>
                  <span className="texto-fraco pequeno">
                    {quando(d.assinado_em)}
                    {d.assinado_por_nome && ` · por ${d.assinado_por_nome}`} · certificado de {d.titular}
                    {d.tamanho ? ` · ${formatarTamanho(d.tamanho)}` : ""}
                  </span>
                </div>
                <button className="botao-icone" onClick={() => setVendo({ url: `/api/assinaturas/${d.id}`, nome: d.nome })} aria-label="Ver">
                  <Eye />
                </button>
                <a className="botao-icone" href={`/api/assinaturas/${d.id}?baixar=1`} aria-label="Baixar">
                  <Download />
                </a>
                {podeAssinar && (
                  <button className="botao-icone perigo" onClick={() => excluir(d)} aria-label="Excluir">
                    <Trash2 />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {verLicitacoes && licFiltrados.length > 0 && (
        <section className="cartao">
          <h2>Assinados nas licitações e empenhos</h2>
          <p className="texto-fraco pequeno" style={{ margin: "-6px 0 10px" }}>
            Os últimos documentos assinados dentro das fichas (propostas, declarações…).
          </p>
          <div className="lista-arquivos">
            {licFiltrados.map((d) => (
              <div key={`l${d.id}`} className="linha-arquivo">
                <span className="icone-redondo verde">
                  <FileText />
                </span>
                <div className="arquivo-texto">
                  <button className="arquivo-nome" onClick={() => setVendo({ url: `/api/arquivos/${d.id}`, nome: d.nome })}>
                    {d.nome}
                  </button>
                  <span className="texto-fraco pequeno">
                    {d.licitacao_id
                      ? `Licitação ${d.licitacao_numero ?? ""}${d.licitacao_orgao ? ` · ${d.licitacao_orgao}` : ""}`
                      : `Empenho ${d.numero_empenho ?? ""}`}
                    {" · "}
                    {quando(d.assinado_em)}
                    {d.assinado_por_nome && ` · por ${d.assinado_por_nome}`}
                  </span>
                </div>
                <a
                  className="botao-icone"
                  {...link(d.licitacao_id ? `/licitacoes/${d.licitacao_id}?aba=arquivos` : `/pos-ganho/${d.execucao_id}`)}
                  aria-label="Abrir a ficha"
                  title="Abrir a ficha"
                >
                  <SquareArrowOutUpRight />
                </a>
                <a className="botao-icone" href={`/api/arquivos/${d.id}?baixar=1`} aria-label="Baixar">
                  <Download />
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {vendo && (
        <Modal titulo={vendo.nome} aoFechar={() => setVendo(null)} largo>
          <PreviaArquivo url={vendo.url} nome={vendo.nome} />
        </Modal>
      )}

      {atual && (
        <Suspense fallback={null}>
          <ModalAssinar
            key={`${atual.name}-${posicao}`}
            titulo={`Assinar "${atual.name}"${total > 1 ? ` (${posicao} de ${total})` : ""}`}
            carregar={async () => new Uint8Array(await atual.arrayBuffer())}
            opcoes={{ motivo: "Documento assinado digitalmente" }}
            aoAssinado={aoAssinado}
            aoFechar={cancelar}
          />
        </Suspense>
      )}
    </>
  );
}

