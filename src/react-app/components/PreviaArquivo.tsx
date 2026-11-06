import { Download, FileArchive, FileText, Loader2, SquareArrowOutUpRight } from "lucide-react";
import PizZip from "pizzip";
import { useEffect, useState } from "react";
import { LeitorPdf, temLeitorNativo } from "./LeitorPdf";

// Prévia de arquivos dentro da plataforma: PDF (leitor do navegador ou página por página),
// imagens, texto e arquivos .zip (lista o conteúdo e abre os de dentro).

export type Conteudo =
  | { tipo: "pdf" | "imagem" | "texto" | "outro"; nome: string; url: string; texto?: string; tamanho: number; dados?: Uint8Array }
  | { tipo: "zip"; nome: string; url: string; tamanho: number; entradas: { nome: string; tamanho: number; abrir: () => Conteudo }[] };

function extensao(nome: string) {
  return /\.([a-z0-9]{1,5})$/i.exec(nome)?.[1]?.toLowerCase() ?? "";
}

const TIPOS_MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain" };

export function montarConteudo(nome: string, dados: Uint8Array, urls: string[]): Conteudo {
  const b = dados;
  let ext = extensao(nome);
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) ext = "pdf";
  else if (b[0] === 0x50 && b[1] === 0x4b && !["docx", "xlsx", "odt", "ods", "pptx"].includes(ext)) ext = "zip";
  const url = URL.createObjectURL(new Blob([dados as BlobPart], { type: TIPOS_MIME[ext] ?? "application/octet-stream" }));
  urls.push(url);
  const tamanho = dados.byteLength;
  if (ext === "pdf") return { tipo: "pdf", nome, url, tamanho, dados };
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return { tipo: "imagem", nome, url, tamanho };
  if (["txt", "csv"].includes(ext)) return { tipo: "texto", nome, url, tamanho, texto: new TextDecoder("utf-8").decode(dados.slice(0, 200_000)) };
  if (ext === "zip") {
    try {
      const zip = new PizZip(dados);
      const entradas = Object.values(zip.files)
        .filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.DS_Store)/.test(f.name))
        .map((f) => {
          const nomeInterno = f.name.split("/").pop() || f.name;
          let pronto: Conteudo | null = null;
          return {
            nome: f.name,
            tamanho: (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0,
            abrir: () => (pronto ??= montarConteudo(nomeInterno, f.asUint8Array(), urls)),
          };
        });
      return { tipo: "zip", nome, url, tamanho, entradas };
    } catch {
      return { tipo: "outro", nome, url, tamanho };
    }
  }
  return { tipo: "outro", nome, url, tamanho };
}

const tamanhoLegivel = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function Visor({ conteudo }: { conteudo: Conteudo }) {
  const [interno, setInterno] = useState<Conteudo | null>(null);
  // Ao abrir um .zip, já mostra o primeiro PDF de dentro.
  useEffect(() => {
    setInterno(conteudo.tipo === "zip" ? conteudo.entradas.find((e) => /\.pdf$/i.test(e.nome))?.abrir() ?? null : null);
  }, [conteudo]);
  const acoes = (c: Conteudo) => (
    <div className="visor-acoes">
      <span className="texto-fraco pequeno" title={c.nome}>
        {c.nome} · {tamanhoLegivel(c.tamanho)}
      </span>
      {c.tipo === "pdf" && (
        <a className="botao secundario pequeno" href={c.url} target="_blank" rel="noreferrer">
          <SquareArrowOutUpRight /> Tela cheia
        </a>
      )}
      <a className="botao secundario pequeno" href={c.url} download={c.nome}>
        <Download /> Baixar
      </a>
    </div>
  );
  if (conteudo.tipo === "zip") {
    return (
      <div className="visor">
        {acoes(conteudo)}
        <div className={`visor-zip ${interno ? "com-previa" : ""}`}>
          <ul className="lista-zip">
            <li className="texto-fraco pequeno">Arquivo compactado com {conteudo.entradas.length} arquivo(s):</li>
            {conteudo.entradas.map((e) => (
              <li key={e.nome}>
                <button className={interno?.nome === (e.nome.split("/").pop() || e.nome) ? "ativo" : ""} onClick={() => setInterno(e.abrir())}>
                  <FileText size={14} /> <span>{e.nome}</span>
                </button>
              </li>
            ))}
          </ul>
          {interno && <Visor conteudo={interno} />}
        </div>
      </div>
    );
  }
  return (
    <div className="visor">
      {acoes(conteudo)}
      {conteudo.tipo === "pdf" &&
        (temLeitorNativo() || !conteudo.dados ? (
          <iframe className="visor-pdf" src={`${conteudo.url}#view=FitH`} title={conteudo.nome} />
        ) : (
          <LeitorPdf dados={conteudo.dados} />
        ))}
      {conteudo.tipo === "imagem" && <img className="visor-imagem" src={conteudo.url} alt={conteudo.nome} />}
      {conteudo.tipo === "texto" && <pre className="visor-texto">{conteudo.texto}</pre>}
      {conteudo.tipo === "outro" && (
        <div className="visor-sem-previa">
          <FileArchive />
          <p>
            Este tipo de arquivo (<strong>.{extensao(conteudo.nome) || "?"}</strong>) não abre aqui dentro.
            <br />
            Use <strong>Baixar</strong> para abrir no computador.
          </p>
        </div>
      )}
    </div>
  );
}

/** Baixa o arquivo do endereço (da própria plataforma) e mostra a prévia. */
export function PreviaArquivo({ url, nome }: { url: string; nome: string }) {
  const [conteudo, setConteudo] = useState<Conteudo | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    const urls: string[] = [];
    let vivo = true;
    setConteudo(null);
    setErro("");
    fetch(url, { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível abrir o arquivo.");
        const c = montarConteudo(nome, new Uint8Array(await r.arrayBuffer()), urls);
        if (vivo) setConteudo(c);
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Não foi possível abrir o arquivo."));
    return () => {
      vivo = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [url, nome]);
  if (erro) return <p className="alerta erro">{erro}</p>;
  if (!conteudo) return <p className="texto-fraco carregando-linha"><Loader2 className="girando" /> Abrindo o arquivo…</p>;
  return <Visor conteudo={conteudo} />;
}
