import { LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";
import { SENHA_MINIMA } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { Alerta, Campo } from "./Formulario";

export function FormTrocarSenha({ aoConcluir }: { aoConcluir?: () => void }) {
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const dados = new FormData(form);
    setErro("");
    setSucesso("");
    if (dados.get("novaSenha") !== dados.get("confirmacao")) {
      setErro("As senhas não conferem.");
      return;
    }
    setEnviando(true);
    try {
      await api("/auth/senha", {
        corpo: { senhaAtual: dados.get("senhaAtual"), novaSenha: dados.get("novaSenha") },
      });
      form.reset();
      setSucesso("Senha alterada com sucesso.");
      aoConcluir?.();
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="formulario">
      <Alerta>{erro}</Alerta>
      <Alerta tipo="sucesso">{sucesso}</Alerta>
      <Campo
        rotulo="Senha atual"
        name="senhaAtual"
        type="password"
        icone={LockKeyhole}
        autoComplete="current-password"
        required
      />
      <Campo
        rotulo="Nova senha"
        name="novaSenha"
        type="password"
        icone={LockKeyhole}
        autoComplete="new-password"
        minLength={SENHA_MINIMA}
        ajuda={`Mínimo de ${SENHA_MINIMA} caracteres.`}
        required
      />
      <Campo
        rotulo="Confirme a nova senha"
        name="confirmacao"
        type="password"
        icone={LockKeyhole}
        autoComplete="new-password"
        required
      />
      <button className="botao" type="submit" disabled={enviando}>
        {enviando ? "Salvando…" : "Alterar senha"}
      </button>
    </form>
  );
}
