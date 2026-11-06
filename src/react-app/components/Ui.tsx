import { CircleAlert, CircleCheck, ShieldCheck, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useRef,
  useState,
} from "react";

// ---------------- Janela (modal) ----------------

export function Modal({
  titulo,
  aoFechar,
  children,
  largo = false,
}: {
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
  largo?: boolean;
}) {
  const fundo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Com uma janela aberta por cima de outra, o Esc fecha só a de cima.
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const todas = document.querySelectorAll(".modal-fundo");
      if (todas[todas.length - 1] === fundo.current) aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      if (!document.querySelector(".modal-fundo")) document.body.style.overflow = "";
    };
  }, [aoFechar]);

  // Renderiza direto no <body> para ficar sempre por cima do topo e do menu.
  return createPortal(
    <div ref={fundo} className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className={`modal ${largo ? "largo" : ""}`} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-topo">
          <h2>{titulo}</h2>
          <button className="botao-icone" onClick={aoFechar} aria-label="Fechar">
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------------- Campos extras ----------------

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  rotulo: string;
  opcoes: (string | { valor: string | number; texto: string })[];
  vazio?: string;
}

export function CampoSelect({ rotulo, opcoes, vazio, id, ...resto }: SelectProps) {
  const idCampo = id ?? resto.name;
  return (
    <div className="campo">
      <label htmlFor={idCampo}>
        <span className="texto-suave pequeno">{rotulo}</span>
      </label>
      <select id={idCampo} {...resto}>
        {vazio !== undefined && <option value="">{vazio}</option>}
        {opcoes.map((o) =>
          typeof o === "string" ? (
            <option key={o} value={o}>
              {o}
            </option>
          ) : (
            <option key={o.valor} value={o.valor}>
              {o.texto}
            </option>
          ),
        )}
      </select>
    </div>
  );
}

interface AreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  rotulo: string;
}

export function CampoArea({ rotulo, id, ...resto }: AreaProps) {
  const idCampo = id ?? resto.name;
  return (
    <div className="campo">
      <label htmlFor={idCampo}>
        <span className="texto-suave pequeno">{rotulo}</span>
      </label>
      <textarea id={idCampo} rows={4} {...resto} />
    </div>
  );
}

export function Interruptor({
  ligado,
  aoMudar,
  rotulo,
}: {
  ligado: boolean;
  aoMudar: (v: boolean) => void;
  rotulo: string;
}) {
  return (
    <label className="interruptor">
      <input type="checkbox" checked={ligado} onChange={(e) => aoMudar(e.target.checked)} />
      <span className="trilho" aria-hidden="true" />
      <span>{rotulo}</span>
    </label>
  );
}

// ---------------- Estados vazios e carregando ----------------

export function Vazio({ icone, titulo, children }: { icone: ReactNode; titulo: string; children?: ReactNode }) {
  return (
    <div className="vazio-bloco">
      <span className="icone-brilho grande">{icone}</span>
      <strong>{titulo}</strong>
      {children && <div className="texto-suave pequeno">{children}</div>}
    </div>
  );
}

export function Carregando() {
  return (
    <div className="carregando bloco">
      <div className="anel" />
    </div>
  );
}

// ---------------- Selo de assinatura digital ----------------

export function SeloAssinado({ arquivo }: { arquivo: { assinado_em?: number | null; assinatura_titular?: string | null; assinado_por_nome?: string | null } }) {
  if (!arquivo.assinado_em) return null;
  const quando = new Date(arquivo.assinado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const detalhe = [
    arquivo.assinatura_titular && `Certificado: ${arquivo.assinatura_titular}`,
    arquivo.assinado_por_nome && `Assinado por ${arquivo.assinado_por_nome}`,
    quando,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="selo-assinado" title={detalhe}>
      <ShieldCheck /> Assinado digitalmente
    </span>
  );
}

// ---------------- Avisos rápidos (toast) ----------------

type Aviso = { id: number; texto: string; tipo: "sucesso" | "erro" };

export function avisar(texto: string, tipo: Aviso["tipo"] = "sucesso") {
  window.dispatchEvent(new CustomEvent("aviso", { detail: { texto, tipo } }));
}

export function Avisos() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  useEffect(() => {
    let contador = 0;
    const aoAvisar = (e: Event) => {
      const { texto, tipo } = (e as CustomEvent).detail;
      const id = ++contador;
      setAvisos((a) => [...a, { id, texto, tipo }]);
      setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 4500);
    };
    window.addEventListener("aviso", aoAvisar);
    return () => window.removeEventListener("aviso", aoAvisar);
  }, []);

  return (
    <div className="avisos" aria-live="polite">
      {avisos.map((a) => (
        <div key={a.id} className={`aviso ${a.tipo}`}>
          {a.tipo === "erro" ? <CircleAlert /> : <CircleCheck />}
          <span>{a.texto}</span>
        </div>
      ))}
    </div>
  );
}
