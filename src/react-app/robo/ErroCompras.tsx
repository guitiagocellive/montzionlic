import { LogIn, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { mensagemDeErro } from "../api";
import { avisar } from "../components/Ui";
import { ponte, temPonte } from "./ponte";

/**
 * Erro ao falar com o Compras.gov.br, com "Tentar de novo" e "Entrar com gov.br" no mesmo lugar: a pessoa entra
 * na janela do gov.br sem sair da tela, e a plataforma tenta de novo sozinha assim que a sessão volta.
 */
export function ErroCompras({ erro, aoTentar }: { erro: string; aoTentar: () => void }) {
  const [esperando, setEsperando] = useState(false);
  const app = temPonte();

  useEffect(() => {
    if (!esperando) return;
    let vivo = true;
    const t = setInterval(async () => {
      try {
        const p = await ponte.painel();
        if (vivo && p.conectado && p.fase === "pronto") {
          setEsperando(false);
          aoTentar();
        }
      } catch {
        /* aplicativo ocupado: tenta no próximo */
      }
    }, 2000);
    const limite = setTimeout(() => vivo && setEsperando(false), 5 * 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
      clearTimeout(limite);
    };
  }, [esperando, aoTentar]);

  async function entrar() {
    try {
      await ponte.entrar(true);
      setEsperando(true);
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    }
  }

  async function recarregar() {
    try {
      await ponte.recarregarLogin();
      setEsperando(true);
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    }
  }

  return (
    <div className="alerta erro linha-erro-item erro-compras">
      <span>
        {erro}
        {esperando && (
          <em>
            {" "}
            Entre na janela do gov.br que abriu: assim que a sessão voltar, a plataforma tenta de novo sozinha. Se a página
            do gov.br travou ou deu erro, clique em "Recarregar janela do gov.br".
          </em>
        )}
      </span>
      <div className="botoes-erro-compras">
        {app && (
          <button className="botao acento pequeno" onClick={entrar} disabled={esperando}>
            <LogIn size={14} /> {esperando ? "Aguardando o login…" : "Entrar com gov.br"}
          </button>
        )}
        {app && esperando && <BotaoRecarregarGovBr aoRecarregar={recarregar} />}
        <button className="botao secundario pequeno" onClick={aoTentar}>
          <RefreshCw size={14} /> Tentar de novo
        </button>
      </div>
    </div>
  );
}

/** "Recarregar janela do gov.br": para quando a página de login travou, ficou em branco ou deu erro de conexão. */
export function BotaoRecarregarGovBr({ aoRecarregar }: { aoRecarregar?: () => void }) {
  const [indo, setIndo] = useState(false);
  if (!temPonte()) return null;
  async function clicar() {
    setIndo(true);
    try {
      if (aoRecarregar) await aoRecarregar();
      else await ponte.recarregarLogin();
      avisar("Abrindo a página de login do gov.br de novo.");
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setTimeout(() => setIndo(false), 3000);
    }
  }
  return (
    <button className="botao secundario pequeno botao-recarregar-govbr" onClick={clicar} disabled={indo}>
      <RotateCcw size={14} /> {indo ? "Recarregando…" : "Recarregar janela do gov.br"}
    </button>
  );
}
