import {
  Bot,
  Download,
  Eye,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  PenLine,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { CATEGORIAS_ARQUIVO } from "../../shared/negocio";
import type { AnaliseIA, Arquivo } from "../../shared/tipos";
import { api, enviarArquivo, mensagemDeErro } from "../api";
import { formatarData, formatarTamanho } from "../formato";
import { ResultadoIA } from "./ResultadoIA";
import { avisar, Modal, SeloAssinado, Vazio } from "./Ui";

const VISUALIZAVEIS = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"];
const ANALISAVEIS = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/html",
];

function IconeArquivo({ tipo }: { tipo: string | null }) {
  if (tipo?.startsWith("image/")) return <FileImage />;
  if (tipo?.includes("sheet") || tipo?.includes("excel")) return <FileSpreadsheet />;
  return <FileText />;
}

interface Props {
  arquivos: Arquivo[];
  destino: { licitacao_id: number } | { execucao_id: number };
  tipoAnalise: "edital" | "empenho";
  aoMudar: () => Promise<void> | void;
  aoAplicarDados: (dados: Record<string, unknown>) => Promise<void>;
  aoImportarItens: (itens: Record<string, unknown>[]) => Promise<void>;
  /** Texto que explica de onde vêm os arquivos herdados (ex.: da licitação). */
  rotuloHerdados?: string;
  /** Pode assinar PDFs com o certificado da empresa. */
  podeAssinar?: boolean;
}

export function AbaArquivos({
  arquivos,
  destino,
  tipoAnalise,
  aoMudar,
  aoAplicarDados,
  aoImportarItens,
  rotuloHerdados,
  podeAssinar = false,
}: Props) {
  const [categoria, setCategoria] = useState(tipoAnalise === "edital" ? "Edital" : "Empenho");
  const [enviando, setEnviando] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);
  const [vendo, setVendo] = useState<Arquivo | null>(null);
  const [analisando, setAnalisando] = useState<number | null>(null);
  const [assinando, setAssinando] = useState<number | null>(null);
  const [analise, setAnalise] = useState<{ arquivo: Arquivo; dados: AnaliseIA } | null>(null);
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

  async function assinar(a: Arquivo) {
    if (!confirm(`Assinar "${a.nome}" com o certificado digital da empresa? Será criada uma cópia assinada.`)) return;
    setAssinando(a.id);
    try {
      await api(`/arquivos/${a.id}/assinar`, { corpo: {} });
      avisar("PDF assinado digitalmente. A cópia assinada está na lista.");
      await aoMudar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setAssinando(null);
    }
  }

  async function analisar(a: Arquivo, refazer = false) {
    setAnalisando(a.id);
    try {
      if (!refazer && a.analisado) {
        const { analise } = await api<{ analise: AnaliseIA | null }>(`/arquivos/${a.id}/analise`);
        if (analise) {
          setAnalise({ arquivo: a, dados: analise });
          return;
        }
      }
      const { analise } = await api<{ analise: AnaliseIA }>(`/arquivos/${a.id}/analisar?tipo=${tipoAnalise}`, {
        corpo: {},
      });
      setAnalise({ arquivo: a, dados: analise });
      await aoMudar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setAnalisando(null);
    }
  }

  const proprios = arquivos.filter((a) => !rotuloHerdados || a.execucao_id);
  const herdados = rotuloHerdados ? arquivos.filter((a) => !a.execucao_id) : [];

  const renderLista = (lista: Arquivo[], podeExcluir: boolean) => (
    <div className="lista-arquivos">
      {lista.map((a) => {
        const visualizavel = VISUALIZAVEIS.includes(a.tipo_mime ?? "");
        const analisavel = ANALISAVEIS.includes(a.tipo_mime ?? "");
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
              {analisavel && (
                <button
                  className={`botao ia ${a.analisado ? "secundario" : ""}`}
                  onClick={() => analisar(a)}
                  disabled={analisando !== null}
                >
                  {analisando === a.id ? (
                    <>
                      <span className="anel mini" /> Lendo…
                    </>
                  ) : (
                    <>
                      <Sparkles aria-hidden="true" /> {a.analisado ? "Ver análise" : "Analisar com IA"}
                    </>
                  )}
                </button>
              )}
              {podeAssinar && a.tipo_mime === "application/pdf" && !a.assinado_em && (
                <button className="botao secundario" onClick={() => assinar(a)} disabled={assinando !== null} title="Assinar com o certificado digital da empresa">
                  {assinando === a.id ? (
                    <>
                      <span className="anel mini" /> Assinando…
                    </>
                  ) : (
                    <>
                      <PenLine aria-hidden="true" /> Assinar
                    </>
                  )}
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
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria do envio">
            {CATEGORIAS_ARQUIVO.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
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

        <div className="dica-ia">
          <Bot aria-hidden="true" />
          <span>
            Clique em <strong>Analisar com IA</strong> em um {tipoAnalise === "edital" ? "edital ou termo de referência" : "empenho"}{" "}
            para a IA ler o documento, resumir e preencher os dados e itens. A IA gratuita tem um limite diário
            (cerca de 8 a 10 editais por dia).
          </span>
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
          <div className="visualizador">
            {vendo.tipo_mime?.startsWith("image/") ? (
              <img src={`/api/arquivos/${vendo.id}`} alt={vendo.nome} />
            ) : (
              <iframe src={`/api/arquivos/${vendo.id}`} title={vendo.nome} />
            )}
          </div>
          <div className="botoes-modal">
            <a className="botao secundario" href={`/api/arquivos/${vendo.id}`} target="_blank" rel="noreferrer">
              Abrir em nova aba
            </a>
            <a className="botao" href={`/api/arquivos/${vendo.id}?baixar=1`}>
              <Download aria-hidden="true" /> Baixar
            </a>
          </div>
        </Modal>
      )}

      {analise && (
        <ResultadoIA
          nomeArquivo={analise.arquivo.nome}
          analise={analise.dados}
          aoFechar={() => setAnalise(null)}
          aoRefazer={() => {
            const a = analise.arquivo;
            setAnalise(null);
            analisar(a, true);
          }}
          aoAplicarDados={aoAplicarDados}
          aoImportarItens={aoImportarItens}
        />
      )}
    </>
  );
}
