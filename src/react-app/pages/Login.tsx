import { type FormEvent, useState } from "react";
import { api, mensagemDeErro } from "../api";
import { Alerta, Campo, CartaoAcesso } from "../components/Formulario";

export function Login({ aoEntrar }: { aoEntrar: () => void }) {
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    setErro("");
    setEnviando(true);
    try {
      await api("/auth/login", {
        corpo: { email: dados.get("email"), senha: dados.get("senha") },
      });
      aoEntrar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <CartaoAcesso titulo="Entrar" subtitulo="Acesse com seu e-mail e senha.">
      <form onSubmit={enviar} className="formulario">
        <Alerta>{erro}</Alerta>
        <Campo rotulo="E-mail" name="email" type="email" autoComplete="email" required autoFocus />
        <Campo
          rotulo="Senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
        />
        <button className="botao" type="submit" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
        <p className="texto-suave pequeno centralizado">
          Esqueceu a senha? Peça a um administrador para redefinir.
        </p>
      </form>
    </CartaoAcesso>
  );
}
