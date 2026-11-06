import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type DocPdf = Awaited<ReturnType<typeof import("pdfjs-dist")["getDocument"]>["promise"]>;

/** O navegador tem leitor de PDF próprio? (computador: sim; celular e alguns navegadores: não) */
export const temLeitorNativo = () =>
  (navigator as { pdfViewerEnabled?: boolean }).pdfViewerEnabled === true && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

const POR_VEZ = 3;

/** Mostra o PDF página por página (usado quando o navegador não abre PDF sozinho). */
export function LeitorPdf({ dados }: { dados: Uint8Array }) {
  const [doc, setDoc] = useState<DocPdf | null>(null);
  const [erro, setErro] = useState("");
  const [quantas, setQuantas] = useState(POR_VEZ);
  const caixa = useRef<HTMLDivElement>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    let tarefa: { destroy: () => Promise<void> } | null = null;
    import("pdfjs-dist")
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const t = pdfjs.getDocument({ data: dados.slice() });
        tarefa = t;
        const aberto = await t.promise;
        if (vivo) setDoc(aberto);
      })
      .catch(() => vivo && setErro("Não foi possível mostrar este PDF aqui. Use Baixar."));
    return () => {
      vivo = false;
      tarefa?.destroy();
    };
  }, [dados]);

  // Carrega mais páginas quando chega perto do fim.
  useEffect(() => {
    if (!doc || !fim.current || !caixa.current) return;
    const obs = new IntersectionObserver((e) => e[0].isIntersecting && setQuantas((q) => Math.min(q + POR_VEZ, doc.numPages)), {
      root: caixa.current,
      rootMargin: "600px",
    });
    obs.observe(fim.current);
    return () => obs.disconnect();
  }, [doc]);

  if (erro) return <p className="alerta erro">{erro}</p>;
  if (!doc) return <p className="texto-fraco carregando-linha"><Loader2 className="girando" /> Preparando o PDF…</p>;
  return (
    <div className="leitor-pdf" ref={caixa}>
      {Array.from({ length: Math.min(quantas, doc.numPages) }, (_, i) => (
        <Pagina key={i} doc={doc} numero={i + 1} caixa={caixa} />
      ))}
      <div ref={fim} className="texto-fraco pequeno leitor-pdf-rodape">
        {quantas < doc.numPages ? "Carregando mais páginas…" : `${doc.numPages} página(s)`}
      </div>
    </div>
  );
}

function Pagina({ doc, numero, caixa }: { doc: DocPdf; numero: number; caixa: React.RefObject<HTMLDivElement | null> }) {
  const tela = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let tarefa: { cancel: () => void; promise: Promise<void> } | null = null;
    let vivo = true;
    (async () => {
      const pag = await doc.getPage(numero);
      if (!vivo || !tela.current) return;
      const base = pag.getViewport({ scale: 1 });
      const largura = Math.max(200, (caixa.current?.clientWidth ?? 600) - 24);
      const s = largura / base.width;
      const viewport = pag.getViewport({ scale: s * Math.min(window.devicePixelRatio || 1, 2) });
      const canvas = tela.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${base.width * s}px`;
      canvas.style.height = `${base.height * s}px`;
      tarefa = pag.render({ canvas, viewport });
      await tarefa.promise.catch(() => {});
    })();
    return () => {
      vivo = false;
      tarefa?.cancel();
    };
  }, [doc, numero, caixa]);
  return <canvas ref={tela} className="leitor-pdf-pagina" aria-label={`Página ${numero}`} />;
}
