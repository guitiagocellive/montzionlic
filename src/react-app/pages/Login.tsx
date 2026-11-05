import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
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
    <CartaoAcesso titulo="Bem-vindo de volta" subtitulo="Acesse a plataforma com seu e-mail e senha.">
      <form onSubmit={enviar} className="formulario">
        <Alerta>{erro}</Alerta>
        <Campo
          rotulo="E-mail"
          name="email"
          type="email"
          icone={Mail}
          placeholder="voce@empresa.com.br"
          autoComplete="email"
          required
          autoFocus
        />
        <Campo
          rotulo="Senha"
          name="senha"
          type="password"
          icone={LockKeyhole}
          placeholder="Sua senha"
          autoComplete="current-password"
          required
        />
        <button className="botao" type="submit" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
          {!enviando && <ArrowRight aria-hidden="true" />}
        </button>
        <p className="texto-fraco pequeno centralizado" style={{ margin: 0 }}>
          Esqueceu a senha? Peça a um administrador para redefinir.
        </p>
      </form>
    </CartaoAcesso>
  );
}
