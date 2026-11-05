import { type FormEvent, useState } from "react";
import { SENHA_MINIMA } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { Alerta, Campo, CartaoAcesso } from "../components/Formulario";

export function PrimeiroAcesso({ aoConcluir }: { aoConcluir: () => void }) {
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    if (dados.get("senha") !== dados.get("confirmacao")) {
      setErro("As senhas não conferem.");
      return;
    }
    setErro("");
    setEnviando(true);
    try {
      await api("/auth/setup", {
        corpo: { nome: dados.get("nome"), email: dados.get("email"), senha: dados.get("senha") },
      });
      aoConcluir();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <CartaoAcesso
      titulo="Primeiro acesso"
      subtitulo="Crie a conta do administrador. Depois você cadastra o resto do time."
    >
      <form onSubmit={enviar} className="formulario">
        <Alerta>{erro}</Alerta>
        <Campo rotulo="Seu nome" name="nome" autoComplete="name" required autoFocus />
        <Campo rotulo="E-mail" name="email" type="email" autoComplete="email" required />
        <Campo
          rotulo="Senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          minLength={SENHA_MINIMA}
          ajuda={`Mínimo de ${SENHA_MINIMA} caracteres.`}
          required
        />
        <Campo
          rotulo="Confirme a senha"
          name="confirmacao"
          type="password"
          autoComplete="new-password"
          required
        />
        <button className="botao" type="submit" disabled={enviando}>
          {enviando ? "Criando…" : "Criar administrador"}
        </button>
      </form>
    </CartaoAcesso>
  );
}
