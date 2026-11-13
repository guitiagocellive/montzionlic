import {
  Download,
  FileArchive,
  Eye,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  PenLine,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { type DragEvent, lazy, Suspense, useRef, useState } from "react";
import { CATEGORIAS_ARQUIVO } from "../../shared/negocio";
import type { Arquivo, Documento, Empresa } from "../../shared/tipos";
import { api, enviarArquivo, mensagemDeErro } from "../api";
import { zipDaHabilitacao } from "../documentos/habilitacao";
import { montarZip, nomeDeArquivo, salvarNoComputador } from "../documentos/zip";
import { formatarData, formatarTamanho, hojeIso } from "../formato";
import { avisar, Modal, SeloAssinado, Vazio } from "./Ui";
import { PreviaArquivo } from "./PreviaArquivo";

const ModalAssinar = lazy(() => import("../assinatura/ModalAssinar").then((m) => ({ default: m.ModalAssinar })));

const VISUALIZAVEIS = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "application/zip", "application/x-zip-compressed"];

function IconeArquivo({ tipo }: { tipo: string | null }) {
  if (tipo?.startsWith("image/")) return <FileImage />;
  if (tipo?.includes("sheet") || tipo?.includes("excel")) return <FileSpreadsheet />;
  return <FileText />;
}

interface Props {
  arquivos: Arquivo[];
  destino: { licitacao_id: number } | { execucao_id: number };
  /** Categoria já escolhida para o próximo envio (ex.: "Edital" na licitação, "Empenho" no pós-ganho). */
  categoriaInicial: string;
  aoMudar: () => Promise<void> | void;
  /** Texto que explica de onde vêm os arquivos herdados (ex.: da licitação). */
  rotuloHerdados?: string;
  /** Pode assinar PDFs com o certificado da empresa. */
  podeAssinar?: boolean;
}

export function AbaArquivos({
  arquivos,
  destino,
  categoriaInicial,
  aoMudar,
  rotuloHerdados,
  podeAssinar = false,
}: Props) {
  const [categoria, setCategoria] = useState(categoriaInicial);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);
  const [vendo, setVendo] = useState<Arquivo | null>(null);
  const [juntando, setJuntando] = useState("");
  const [escolherEmpresa, setEscolherEmpresa] = useState<{ docs: Documento[]; empresas: Empresa[] } | null>(null);
  const [assinando, setAssinando] = useState<Arquivo | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  async function enviar(lista: FileList | File[]) {
    for (const arquivo of Array.from(lista)) {
      setEnviando(arquivo.name);
      try {
        const dados = new FormData();
        dados.set("arquivo", arquivo);
        dados.set("categoria", categoria);
        for (const [chave, valor] of Object.entries(destino)) dados.set(chave, String(valor));
        await enviarArquivo("/arquivos", dados);
        avisar(`"${arquivo.name}" enviado.`);
      } catch (err) {
        avisar(mensagemDeErro(err), "erro");
      }
    }
    setEnviando(null);
    await aoMudar();
  }

  function aoSoltar(e: DragEvent) {
    e.preventDefault();
    setSobre(false);
    if (e.dataTransfer.files.length) enviar(e.dataTransfer.files);
  }

  async function excluir(a: Arquivo) {
    if (!confirm(`Excluir "${a.nome}"?`)) return;
    try {
      await api(`/arquivos/${a.id}`, { metodo: "DELETE" });
      await aoMudar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  async function mudarCategoria(a: Arquivo, nova: string) {
    try {
      await api(`/arquivos/${a.id}`, { metodo: "PATCH", corpo: { categoria: nova } });
      await aoMudar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  async function baixarBytes(a: Arquivo) {
    const r = await fetch(`/api/arquivos/${a.id}?baixar=1`, { credentials: "same-origin" });
    if (!r.ok) throw new Error("Não foi possível abrir o arquivo.");
    return new Uint8Array(await r.arrayBuffer());
  }

  async function guardarAssinado(original: Arquivo, pdf: Uint8Array, pedido: string) {
    const dados = new FormData();
    const nome = original.nome.replace(/\.pdf$/i, "") + " (assinado).pdf";
    dados.set("arquivo", new Blob([pdf.slice().buffer as ArrayBuffer], { type: "application/pdf" }), nome);
    dados.set("categoria", original.categoria ?? "Outro");
    dados.set("pedido_assinatura", pedido);
    if (original.execucao_id) dados.set("execucao_id", String(original.execucao_id));
    else dados.set("licitacao_id", String(original.licitacao_id));
    await enviarArquivo("/arquivos", dados);
    setAssinando(null);
    avisar("PDF assinado digitalmente. A cópia assinada está na lista.");
    await aoMudar();
  }

  // "Documentos de habilitação": junta num .zip os documentos da aba Documentação (uma pasta por habilitação),
  // salva no computador e já anexa o .zip aos arquivos da licitação.
  async function documentosHabilitacao(empresaId?: number | "todas", dados?: { docs: Documento[]; empresas: Empresa[] }) {
    if (!("licitacao_id" in destino)) return;
    setJuntando("Buscando os documentos…");
    try {
      let lidos = dados;
      if (!lidos) {
        const [d, e] = await Promise.all([
          api<{ documentos: Documento[] }>("/documentos"),
          api<{ empresas: Empresa[] }>("/empresas").catch(() => ({ empresas: [] as Empresa[] })),
        ]);
        lidos = { docs: d.documentos, empresas: e.empresas };
      }
      const { docs, empresas } = lidos;
      // Mais de uma empresa com documentos: pergunta de qual.
      const comDocs = empresas.filter((e) => docs.some((d) => d.arquivo_nome && d.empresa_id === e.id));
      if (empresaId === undefined && comDocs.length > 1) {
        setEscolherEmpresa({ docs, empresas: comDocs });
        return;
      }
      const hoje = hojeIso();
      const pacote = zipDaHabilitacao(docs, empresas, hoje, { empresaId: empresaId ?? (comDocs.length === 1 ? comDocs[0].id : "todas") });
      if (!pacote.arquivos.length) {
        avisar("Nenhum documento com arquivo na aba Documentação. Cadastre os documentos de habilitação lá primeiro.", "erro");
        return;
      }
      const blob = await montarZip(pacote.arquivos, (feitos, total) => setJuntando(`Juntando ${feitos} de ${total}…`));
      const nome = `${nomeDeArquivo(pacote.nome)}.zip`;
      salvarNoComputador(blob, nome);
      if (blob.size > 50 * 1024 * 1024) {
        avisar("Zip salvo no computador. Ele passa de 50 MB, então não deu para anexar aqui: envie as partes separadas.", "erro");
        return;
      }
      setJuntando("Anexando à licitação…");
      const envio = new FormData();
      envio.set("arquivo", new File([blob], nome, { type: "application/zip" }));
      envio.set("categoria", "Habilitação");
      envio.set("licitacao_id", String(destino.licitacao_id));
      await enviarArquivo("/arquivos", envio);
      avisar(
        `${pacote.arquivos.length} documento(s) salvos no computador e anexados à licitação.${pacote.vencidos ? ` Atenção: ${pacote.vencidos} vencido(s), marcados no nome.` : ""}`,
        pacote.vencidos ? "erro" : "sucesso",
      );
      await aoMudar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setJuntando("");
    }
  }

  const proprios = arquivos.filter((a) => !rotuloHerdados || a.execucao_id);
  const herdados = rotuloHerdados ? arquivos.filter((a) => !a.execucao_id) : [];

  const renderLista = (lista: Arquivo[], podeExcluir: boolean) => (
    <div className="lista-arquivos">
      {lista.map((a) => {
        const visualizavel = VISUALIZAVEIS.includes(a.tipo_mime ?? "");
        return (
          <article key={a.id} className="linha-arquivo">
            <span className={`icone-brilho ${a.assinado_em ? "verde" : ""}`}>
              {a.assinado_em ? <ShieldCheck /> : <IconeArquivo tipo={a.tipo_mime} />}
            </span>
            <div className="arquivo-texto">
              <button className="arquivo-nome" onClick={() => (visualizavel ? setVendo(a) : window.open(`/api/arquivos/${a.id}?baixar=1`))}>
                {a.nome}
              </button>
              <span className="texto-fraco pequeno">
                {formatarTamanho(a.tamanho)} · {formatarData(a.criado_em)}
                {a.enviado_por_nome && ` · ${a.enviado_por_nome}`}
              </span>
              <SeloAssinado arquivo={a} />
            </div>
            <select
              className="seletor-pequeno"
              value={a.categoria ?? "Outro"}
              onChange={(e) => mudarCategoria(a, e.target.value)}
              aria-label="Categoria do arquivo"
            >
              {CATEGORIAS_ARQUIVO.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <div className="arquivo-acoes">
              {podeAssinar && a.tipo_mime === "application/pdf" && !a.assinado_em && (
                <button className="botao secundario" onClick={() => setAssinando(a)} title="Assinar com o certificado digital da empresa">
                  <PenLine aria-hidden="true" /> Assinar
                </button>
              )}
              {visualizavel && (
                <button className="botao-icone" onClick={() => setVendo(a)} aria-label="Visualizar">
                  <Eye />
                </button>
              )}
              <a className="botao-icone" href={`/api/arquivos/${a.id}?baixar=1`} aria-label="Baixar">
                <Download />
              </a>
              {podeExcluir && (
                <button className="botao-icone perigo" onClick={() => excluir(a)} aria-label="Excluir">
                  <Trash2 />
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );

  return (
    <>
      <section className="cartao">
        <div className="cartao-titulo">
          <h2>
            <FolderOpen size={18} color="#f0abfc" aria-hidden="true" /> Arquivos
          </h2>
          <div className="acoes-arquivos">
            {"licitacao_id" in destino && (
              <button
                className="botao secundario pequeno"
                onClick={() => documentosHabilitacao()}
                disabled={!!juntando}
                title="Junta os documentos da aba Documentação num .zip, salva no computador e anexa aqui"
              >
                <FileArchive aria-hidden="true" /> {juntando || "Documentos de habilitação"}
              </button>
            )}
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria do envio">
              {CATEGORIAS_ARQUIVO.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div
          className={`zona-envio ${sobre ? "sobre" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setSobre(true);
          }}
          onDragLeave={() => setSobre(false)}
          onDrop={aoSoltar}
          onClick={() => entrada.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && entrada.current?.click()}
        >
          <UploadCloud aria-hidden="true" />
          {enviando ? (
            <strong>Enviando "{enviando}"…</strong>
          ) : (
            <>
              <strong>Arraste os arquivos aqui ou clique para escolher</strong>
              <span className="texto-fraco pequeno">
                PDF, imagens, Word, Excel… até 50 MB. Categoria: {categoria}
              </span>
            </>
          )}
          <input
            ref={entrada}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) enviar(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {proprios.length === 0 ? (
          <Vazio icone={<FolderOpen />} titulo="Nenhum arquivo enviado" />
        ) : (
          renderLista(proprios, true)
        )}
      </section>

      {herdados.length > 0 && (
        <section className="cartao">
          <h2>{rotuloHerdados}</h2>
          {renderLista(herdados, false)}
        </section>
      )}

      {vendo && (
        <Modal titulo={vendo.nome} aoFechar={() => setVendo(null)} largo>
          <PreviaArquivo url={`/api/arquivos/${vendo.id}`} nome={vendo.nome} />
        </Modal>
      )}

      {assinando && (
        <Suspense fallback={null}>
          <ModalAssinar
            titulo={`Assinar "${assinando.nome}"`}
            carregar={() => baixarBytes(assinando)}
            opcoes={{ motivo: assinando.categoria ? `${assinando.categoria} assinado(a) digitalmente` : "Documento assinado digitalmente" }}
            aoAssinado={(pdf, pedido) => guardarAssinado(assinando, pdf, pedido)}
            aoFechar={() => setAssinando(null)}
          />
        </Suspense>
      )}

      {escolherEmpresa && (
        <Modal titulo="De qual empresa?" aoFechar={() => setEscolherEmpresa(null)}>
          <p className="texto-suave" style={{ marginTop: 0 }}>
            Escolha a empresa dos documentos de habilitação que vão para esta licitação.
          </p>
          <div className="lista-escolha-empresa">
            {escolherEmpresa.empresas.map((e) => (
              <button
                key={e.id}
                className="botao secundario"
                onClick={() => {
                  const dados = escolherEmpresa;
                  setEscolherEmpresa(null);
                  documentosHabilitacao(e.id, dados);
                }}
              >
                {e.nome}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
