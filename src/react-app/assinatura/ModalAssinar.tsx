import { ChevronLeft, ChevronRight, MousePointerClick, PenLine, ShieldCheck } from "lucide-react";
import type { PDFDocument } from "pdf-lib";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { CertificadoInfo } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { Alerta } from "../components/Formulario";
import { Modal } from "../components/Ui";
import { abrirParaAssinar, assinarPdf, type OpcoesAssinatura, posicaoPadrao, type PosicaoSelo, SELO } from "./pdf";

type PdfJs = typeof import("pdfjs-dist");
type DocumentoJs = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

interface Props {
  titulo: string;
  /** Bytes do PDF a assinar. */
  carregar: () => Promise<Uint8Array>;
  /** Motivo e local da assinatura. Sem local, usa a cidade da empresa (Configurações). */
  opcoes: { motivo: string; local?: string; contato?: string };
  aoAssinado: (pdf: Uint8Array, pedido: string) => Promise<void>;
  aoFechar: () => void;
}

/** Janela para escolher onde vai o carimbo e assinar o PDF com o certificado da empresa. */
export function ModalAssinar({ titulo, carregar, opcoes, aoAssinado, aoFechar }: Props) {
  const [erro, setErro] = useState("");
  const [certificado, setCertificado] = useState<CertificadoInfo | null>(null);
  const [docLib, setDocLib] = useState<PDFDocument | null>(null);
  const [docJs, setDocJs] = useState<DocumentoJs | null>(null);
  const [pagina, setPagina] = useState(0);
  const [posicao, setPosicao] = useState<PosicaoSelo | null>(null);
  const [escala, setEscala] = useState(1);
  const [tamanhoPagina, setTamanhoPagina] = useState({ largura: 595, altura: 842 });
  const [assinando, setAssinando] = useState(false);
  const [local, setLocal] = useState(opcoes.local ?? "");
  const tela = useRef<HTMLCanvasElement>(null);
  const caixa = useRef<HTMLDivElement>(null);

  // Abre o PDF (pdf-lib para assinar, pdf.js para mostrar) e o status do certificado.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [bytes, cert, pdfjs, cidade] = await Promise.all([
          carregar(),
          api<{ certificado: CertificadoInfo }>("/certificado").then((r) => r.certificado),
          import("pdfjs-dist"),
          opcoes.local
            ? Promise.resolve(opcoes.local)
            : api<{ configuracoes: { empresa_cidade?: string } }>("/configuracoes").then((r) => r.configuracoes.empresa_cidade ?? "", () => ""),
        ]);
        setLocal(cidade || "Brasil");
        if (!cert.configurado) throw new Error("Nenhum certificado digital cadastrado (Configurações → Certificado digital).");
        if ((cert.dias_restantes ?? 0) < 0) throw new Error("O certificado digital da empresa venceu.");
        const lib = await abrirParaAssinar(bytes);
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const js = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        if (!vivo) return;
        const ultima = lib.getPageCount() - 1;
        setCertificado(cert);
        setDocLib(lib);
        setDocJs(js);
        setPagina(ultima);
        setPosicao(posicaoPadrao(lib.getPage(ultima).getSize().width, ultima));
      } catch (err) {
        if (vivo) setErro(mensagemDeErro(err));
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desenha a página escolhida.
  useEffect(() => {
    if (!docJs || !tela.current || !caixa.current) return;
    let tarefa: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const pag = await docJs.getPage(pagina + 1);
      const base = pag.getViewport({ scale: 1 });
      const largura = Math.min(caixa.current!.clientWidth, 620);
      const s = largura / base.width;
      const viewport = pag.getViewport({ scale: s * (window.devicePixelRatio || 1) });
      const canvas = tela.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${base.width * s}px`;
      canvas.style.height = `${base.height * s}px`;
      setEscala(s);
      setTamanhoPagina({ largura: base.width, altura: base.height });
      tarefa = pag.render({ canvas, viewport });
      await tarefa.promise.catch(() => {});
    })();
    return () => tarefa?.cancel();
  }, [docJs, pagina]);

  function mudarPagina(nova: number) {
    if (!docLib) return;
    setPagina(nova);
    setPosicao(posicaoPadrao(docLib.getPage(nova).getSize().width, nova));
  }

  function aoClicar(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const cx = (e.clientX - r.left) / escala;
    const cy = (e.clientY - r.top) / escala;
    const x = Math.min(Math.max(cx - SELO.largura / 2, 0), tamanhoPagina.largura - SELO.largura);
    const y = Math.min(Math.max(tamanhoPagina.altura - cy - SELO.altura / 2, 0), tamanhoPagina.altura - SELO.altura);
    setPosicao({ pagina, x, y });
  }

  async function assinar() {
    if (!docLib || !posicao || !certificado) return;
    setAssinando(true);
    setErro("");
    try {
      const r = await assinarPdf(
        docLib,
        posicao,
        { titular: certificado.titular ?? "", documento: certificado.documento ?? null, tamanhoCertificados: certificado.tamanho_certificados },
        { ...opcoes, local: local || "Brasil" } satisfies OpcoesAssinatura,
      );
      await aoAssinado(r.pdf, r.pedido);
    } catch (err) {
      setErro(mensagemDeErro(err));
      // O PDF já foi alterado; reabre do zero para tentar de novo.
      try {
        setDocLib(await abrirParaAssinar(await carregar()));
      } catch {
        /* mantém a mensagem */
      }
    } finally {
      setAssinando(false);
    }
  }

  const total = docLib?.getPageCount() ?? 0;
  const pronto = !!docLib && !!docJs && !!posicao;

  return (
    <Modal titulo={titulo} aoFechar={aoFechar} largo>
      {erro && <Alerta>{erro}</Alerta>}
      {!pronto && !erro && (
        <div className="carregando bloco">
          <div className="anel" />
        </div>
      )}
      <div className="assinar-corpo" hidden={!pronto}>
        <p className="texto-fraco pequeno assinar-dica">
          <MousePointerClick size={15} /> Clique na página onde o carimbo deve ficar. Use as setas para trocar de página.
        </p>
        <div className="assinar-paginas">
          <button className="botao-icone" onClick={() => mudarPagina(pagina - 1)} disabled={pagina === 0} aria-label="Página anterior">
            <ChevronLeft />
          </button>
          <span>
            Página {pagina + 1} de {total}
          </span>
          <button className="botao-icone" onClick={() => mudarPagina(pagina + 1)} disabled={pagina >= total - 1} aria-label="Próxima página">
            <ChevronRight />
          </button>
        </div>
        <div className="assinar-caixa" ref={caixa}>
          <div className="assinar-pagina" onClick={aoClicar}>
            <canvas ref={tela} />
            {posicao && posicao.pagina === pagina && (
              <div
                className="assinar-selo"
                style={{
                  left: posicao.x * escala,
                  top: (tamanhoPagina.altura - posicao.y - SELO.altura) * escala,
                  width: SELO.largura * escala,
                  height: SELO.altura * escala,
                }}
              >
                <ShieldCheck /> <span>Assinado digitalmente</span>
              </div>
            )}
          </div>
        </div>
        {certificado && (
          <p className="texto-fraco pequeno" style={{ margin: "10px 0 0" }}>
            Certificado A1 de <strong>{certificado.titular}</strong>
            {certificado.documento ? ` (${certificado.documento})` : ""}.
          </p>
        )}
      </div>
      <div className="botoes-modal">
        <button className="botao secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button className="botao acento" onClick={assinar} disabled={!pronto || assinando}>
          <PenLine /> {assinando ? "Assinando…" : "Assinar aqui"}
        </button>
      </div>
    </Modal>
  );
}
