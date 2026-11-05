import type { Usuario } from "../../shared/tipos";
import { CartaoAcesso } from "../components/Formulario";
import { FormTrocarSenha } from "../components/FormTrocarSenha";

export function TrocarSenhaObrigatoria({
  usuario,
  aoConcluir,
}: {
  usuario: Usuario;
  aoConcluir: () => void;
}) {
  return (
    <CartaoAcesso
      titulo={`Olá, ${usuario.nome.split(" ")[0]}`}
      subtitulo="Você está usando uma senha provisória. Crie uma senha pessoal para continuar."
    >
      <FormTrocarSenha aoConcluir={aoConcluir} />
    </CartaoAcesso>
  );
}
