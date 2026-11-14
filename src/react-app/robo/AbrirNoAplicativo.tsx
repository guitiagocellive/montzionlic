import { Download, ExternalLink, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { link } from "../rota";
import { noAplicativo } from "./ponte";

// Link da plataforma (ex.: licitação compartilhada) aberto no navegador de um computador com Windows: oferece abrir
// no aplicativo Montzion. O navegador entrega o link ao aplicativo pelo endereço montzion:// (o Windows pergunta na
// primeira vez; marcando "sempre permitir", as próximas abrem direto). A escolha fica lembrada neste computador.

const CHAVE = "montzion:abrir-links-no-app"; // "app" | "navegador"

export function lerEscolha(): string {
  try {
    return localStorage.getItem(CHAVE) ?? "";
  } catch {
    return "";
  }
}

export function guardarEscolha(v: "app" | "navegador" | "") {
  try {
    if (v) localStorage.setItem(CHAVE, v);
    else localStorage.removeItem(CHAVE);
  } catch {
    /* sem armazenamento: só vale agora */
  }
}

/** Vale oferecer o aplicativo: navegador comum no Windows (fora do aplicativo e do app instalado pelo navegador). */
export function deveOferecerAplicativo(): boolean {
  if (noAplicativo()) return false;
  if (!/Windows/i.test(navigator.userAgent)) return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return false;
  return lerEscolha() !== "navegador";
}

function abrirNoApp(caminho: string) {
  window.location.href = `montzion://abrir?caminho=${encodeURIComponent(caminho)}`;
}

export function AbrirNoAplicativo({ caminho, aoContinuar }: { caminho: string; aoContinuar: () => void }) {
  const automatico = lerEscolha() === "app";
  const [abrindo, setAbrindo] = useState(automatico);
  const [lembrar, setLembrar] = useState(true);

  useEffect(() => {
    if (automatico) abrirNoApp(caminho);
  }, [automatico, caminho]);

  function abrir() {
    if (lembrar) guardarEscolha("app");
    setAbrindo(true);
    abrirNoApp(caminho);
  }

  function continuar() {
    if (lembrar && !abrindo) guardarEscolha("navegador");
    aoContinuar();
  }

  return createPortal(
    <div className="popup-govbr-fundo">
      <div className="popup-govbr abrir-no-app" role="dialog" aria-modal="true" aria-labelledby="abrir-no-app-titulo">
        <span className="popup-govbr-icone">
          <Monitor />
        </span>
        {abrindo ? (
          <>
            <h2 id="abrir-no-app-titulo">Abrindo no aplicativo Montzion…</h2>
            <p className="texto-suave">
              Se o navegador perguntar, clique em <b>Abrir Montzion</b> (marque "Sempre permitir" para não perguntar de novo). Já pode fechar esta aba.
            </p>
            <button className="botao secundario" onClick={() => abrirNoApp(caminho)}>
              <ExternalLink size={15} /> Tentar de novo
            </button>
            <span className="texto-fraco pequeno">
              Não abriu? O aplicativo pode não estar instalado ou estar desatualizado:{" "}
              <a {...link("/configuracoes/aplicativo")}>
                <Download size={12} /> baixar a versão nova
              </a>
              .
            </span>
            <button className="agora-nao-govbr" onClick={continuar}>
              Continuar no navegador
            </button>
          </>
        ) : (
          <>
            <h2 id="abrir-no-app-titulo">Abrir no aplicativo Montzion?</h2>
            <p className="texto-suave">Este link pode abrir direto no aplicativo do Windows, onde ficam o robô e o acompanhamento.</p>
            <button className="botao botao-govbr" onClick={abrir} autoFocus>
              <Monitor size={16} /> Abrir no aplicativo
            </button>
            <button className="agora-nao-govbr" onClick={continuar}>
              Continuar no navegador
            </button>
            <label className="lembrar-escolha texto-suave pequeno">
              <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> Lembrar a escolha neste computador
            </label>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
