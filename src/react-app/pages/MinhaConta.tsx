import type { Usuario } from "../../shared/tipos";
import { FormTrocarSenha } from "../components/FormTrocarSenha";

export function MinhaConta({ usuario }: { usuario: Usuario }) {
  return (
    <>
      <h1>Minha conta</h1>
      <section className="cartao">
        <h2>Dados</h2>
        <dl className="dados">
          <dt>Nome</dt>
          <dd>{usuario.nome}</dd>
          <dt>E-mail</dt>
          <dd>{usuario.email}</dd>
          <dt>Perfil</dt>
          <dd>{usuario.papel === "admin" ? "Administrador" : "Membro"}</dd>
        </dl>
      </section>
      <section className="cartao estreito">
        <h2>Alterar senha</h2>
        <p className="texto-suave pequeno">
          Ao alterar a senha, você será desconectado dos outros aparelhos.
        </p>
        <FormTrocarSenha />
      </section>
    </>
  );
}
