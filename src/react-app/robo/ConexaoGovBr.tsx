import { LogIn, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mensagemDeErro } from "../api";
import { avisar } from "../components/Ui";
import { BotaoRecarregarGovBr } from "./ErroCompras";
import { ponte, temPonte } from "./ponte";

// A conta gov.br é uma só para Cadastradas, Disputas e Acompanhamento: o aplicativo entra uma vez e as três
// páginas usam a mesma sessão. Aqui ficam a bolinha de conexão da pílula do menu e o popup "entre na sua conta".

export type EstadoConexao = "desconhecido" | "desconectado" | "aguardando" | "conectando" | "conectado";

export interface ConexaoGovBr {
  estado: EstadoConexao;
  /** Alguma compra com disputa acontecendo agora. */
  emDisputa: boolean;
}

export const TITULO_CONEXAO: Record<EstadoConexao, string> = {
  desconhecido: "",
  desconectado: "gov.br desconectado: clique para entrar",
  aguardando: "Entre na janela do gov.br que abriu (clique para ver)",
  conectando: "Conectando ao Compras.gov.br…",
  conectado: "Conectado ao gov.br",
};

const EVENTO_ABRIR = "montzion:entrar-govbr";

/** Abre o popup de login mesmo que a pessoa tenha clicado em "Agora não" (ex.: na bolinha da pílula). */
export function abrirPopupGovBr() {
  window.dispatchEvent(new Event(EVENTO_ABRIR));
}

function estadoDaFase(fase: string, conectado: boolean): EstadoConexao {
  if (fase === "pronto" || fase === "buscando" || fase === "erro-lista") return "conectado";
  if (fase === "entrando") return "conectando";
  if (fase === "aguardando-login") return "aguardando";
  if (fase === "sem-login") return conectado ? "conectado" : "desconectado";
  return "desconhecido";
}

/**
 * Lê do aplicativo (no próprio computador, sem ir à internet) se a conta gov.br está conectada e se há disputa
 * acontecendo. Mais rápido nas páginas da pílula, onde o popup depende disso.
 */
export function useConexaoGovBr(ativo: boolean, rapido: boolean): ConexaoGovBr {
  const [conexao, setConexao] = useState<ConexaoGovBr>({ estado: "desconhecido", emDisputa: false });
  const rapidoRef = useRef(rapido);
  rapidoRef.current = rapido;
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    let t = 0;
    let erros = 0;
    const ler = async () => {
      if (temPonte()) {
        try {
          const p = await ponte.painel();
          erros = 0;
          const novo: ConexaoGovBr = {
            estado: estadoDaFase(p?.fase ?? "", !!p?.conectado),
            emDisputa: !!p?.compras?.some((c) => c.lida && c.emDisputa),
          };
          if (vivo) setConexao((atual) => (atual.estado === novo.estado && atual.emDisputa === novo.emDisputa ? atual : novo));
        } catch {
          if (++erros > 3 && vivo) setConexao((atual) => (atual.estado === "desconhecido" ? atual : { estado: "desconhecido", emDisputa: false }));
        }
      }
      if (vivo) t = window.setTimeout(ler, rapidoRef.current ? 1500 : 5000);
    };
    ler();
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [ativo]);
  return conexao;
}

// "Agora não" vale por 10 minutos (e para esta sessão do aplicativo); a bolinha da pílula reabre na hora.
const CHAVE_FECHADO = "montzion:popup-govbr-fechado";
function fechadoAte(): number {
  try {
    return Number(sessionStorage.getItem(CHAVE_FECHADO) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function guardarFechado(ate: number) {
  try {
    sessionStorage.setItem(CHAVE_FECHADO, String(ate));
  } catch {
    /* sem armazenamento: só fecha agora */
  }
}

/** Entra com gov.br (ou mostra a janela de login que já está aberta). */
async function entrar(mostrar: boolean) {
  try {
    await ponte.entrar(mostrar);
  } catch (e) {
    avisar(mensagemDeErro(e), "erro");
  }
}

/**
 * Popup simples que aparece sozinho nas páginas da pílula (automatico) quando a conta gov.br não está conectada;
 * nas outras páginas, só pela bolinha da pílula. Um clique abre a
 * janela do gov.br (certificado ou senha, só no computador da pessoa); ao entrar, ele some sozinho.
 */
export function PopupGovBr({ estado, automatico }: { estado: EstadoConexao; automatico: boolean }) {
  const precisa = estado === "desconectado" || estado === "aguardando";
  const [visivel, setVisivel] = useState(false);
  const [indo, setIndo] = useState(false);
  const mostrou = useRef(false);

  // Espera 1,2 s com a conta desconectada antes de abrir: ao ligar, o aplicativo pode estar entrando sozinho.
  useEffect(() => {
    if (!precisa) {
      setVisivel(false);
      return;
    }
    if (!automatico || Date.now() < fechadoAte()) return;
    const t = setTimeout(() => setVisivel(true), 1200);
    return () => clearTimeout(t);
  }, [precisa, automatico]);

  useEffect(() => {
    const abrir = () => {
      guardarFechado(0);
      if (precisa) setVisivel(true);
      else entrar(true);
    };
    window.addEventListener(EVENTO_ABRIR, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR, abrir);
  }, [precisa]);

  // Conectou com o popup na tela: avisa uma vez.
  useEffect(() => {
    if (visivel) mostrou.current = true;
    if ((estado === "conectando" || estado === "conectado") && mostrou.current) {
      mostrou.current = false;
      avisar(estado === "conectado" ? "Conta gov.br conectada." : "Login feito. Conectando ao Compras.gov.br…");
    }
  }, [visivel, estado]);

  useEffect(() => {
    if (estado !== "desconectado") setIndo(false);
  }, [estado]);

  useEffect(() => {
    if (!visivel) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [visivel]);

  function fechar() {
    guardarFechado(Date.now() + 10 * 60_000);
    setVisivel(false);
  }

  async function clicar() {
    setIndo(true);
    await entrar(estado === "aguardando");
    setTimeout(() => setIndo(false), 4000);
  }

  if (!visivel || !precisa) return null;
  const aguardando = estado === "aguardando";
  return createPortal(
    <div className="popup-govbr-fundo" onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
      <div className="popup-govbr" role="dialog" aria-modal="true" aria-labelledby="popup-govbr-titulo">
        <button className="botao-icone fechar-popup-govbr" onClick={fechar} aria-label="Fechar">
          <X />
        </button>
        <span className="popup-govbr-icone">
          <ShieldCheck />
        </span>
        <h2 id="popup-govbr-titulo">{aguardando ? "Entre na janela do gov.br que abriu" : "Entre na sua conta gov.br"}</h2>
        <p className="texto-suave">
          {aguardando
            ? "Use o certificado ou a senha. Quando terminar, a janela fecha sozinha e tudo se conecta."
            : "Para prosseguir, clique aqui e entre na sua conta gov.br. Um único login conecta Cadastradas, Disputas e Acompanhamento."}
        </p>
        <button className="botao botao-govbr" onClick={clicar} disabled={indo} autoFocus>
          <LogIn /> {indo ? "Abrindo o gov.br…" : aguardando ? "Mostrar a janela de login" : "Entrar com gov.br"}
        </button>
        {aguardando && <BotaoRecarregarGovBr />}
        <button className="agora-nao-govbr" onClick={fechar}>
          Agora não
        </button>
        <span className="texto-fraco pequeno">Sua senha e seu certificado ficam só na janela do gov.br, no seu computador.</span>
      </div>
    </div>,
    document.body,
  );
}

/** No lugar da lista, quando a conta gov.br não está conectada (e o popup foi fechado): uma linha discreta. */
export function SemContaGovBr({ aguardando, texto }: { aguardando: boolean; texto: string }) {
  return (
    <div className="sem-conta-govbr entrar">
      <ShieldCheck aria-hidden="true" />
      <p className="texto-suave">{texto}</p>
      <button className="botao acento pequeno" onClick={() => entrar(aguardando)}>
        <LogIn size={14} /> {aguardando ? "Mostrar a janela de login" : "Entrar com gov.br"}
      </button>
    </div>
  );
}
