import { ArrowRight, LockKeyhole, Mail, UserRound } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { SENHA_MINIMA } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { Alerta, Campo, CartaoAcesso } from "../components/Formulario";
import { Carregando } from "../components/Ui";

/** Tela pública de quem recebeu o link de convite. */
export function Convite({ token, aoEntrar }: { token: string; aoEntrar: () => void }) {
  const [info, setInfo] = useState<{ email: string | null; empresa: string | null; cargo: string | null } | null>(null);
  const [invalido, setInvalido] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<{ email: string | null; empresa: string | null; cargo: string | null }>(`/convites/publico/${token}`).then(
      setInfo,
      (err) => setInvalido(mensagemDeErro(err)),
    );
  }, [token]);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("senha") !== f.get("confirmacao")) {
      setErro("As senhas não conferem.");
      return;
    }
    setErro("");
    setEnviando(true);
    try {
      await api(`/convites/publico/${token}`, {
        corpo: { nome: f.get("nome"), email: info?.email ?? f.get("email"), senha: f.get("senha") },
      });
      window.history.replaceState(null, "", "/");
      aoEntrar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  if (invalido) {
    return (
      <CartaoAcesso titulo="Convite indisponível" subtitulo={invalido}>
        <a className="botao largura-total" href="/">
          Ir para o login
        </a>
      </CartaoAcesso>
    );
  }
  if (!info) {
    return (
      <div className="tela-central">
        <Carregando />
      </div>
    );
  }

  return (
    <CartaoAcesso
      titulo="Você foi convidado"
      subtitulo={`Crie sua conta para entrar no time${info.empresa ? ` da ${info.empresa}` : ""}${info.cargo ? ` como ${info.cargo}` : ""}.`}
    >
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <Campo rotulo="Seu nome" name="nome" icone={UserRound} autoComplete="name" required autoFocus />
        {info.email ? (
          <Campo rotulo="E-mail" name="email" icone={Mail} value={info.email} readOnly />
        ) : (
          <Campo rotulo="E-mail" name="email" type="email" icone={Mail} autoComplete="email" required />
        )}
        <Campo
          rotulo="Senha"
          name="senha"
          type="password"
          icone={LockKeyhole}
          autoComplete="new-password"
          minLength={SENHA_MINIMA}
          ajuda={`Mínimo de ${SENHA_MINIMA} caracteres.`}
          required
        />
        <Campo rotulo="Confirme a senha" name="confirmacao" type="password" icone={LockKeyhole} autoComplete="new-password" required />
        <button className="botao" disabled={enviando}>
          {enviando ? "Criando conta…" : "Criar conta e entrar"}
          {!enviando && <ArrowRight />}
        </button>
      </form>
    </CartaoAcesso>
  );
}
