import { KeyRound, UserRound } from "lucide-react";
import type { Usuario } from "../../shared/tipos";
import { Avatar } from "../components/Avatar";
import { FormTrocarSenha } from "../components/FormTrocarSenha";

export function MinhaConta({ usuario }: { usuario: Usuario }) {
  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <h1>Minha conta</h1>
          <p className="texto-suave">Seus dados e sua senha de acesso.</p>
        </div>
      </div>

      <div className="grade-conta">
        <section className="cartao entrar" style={{ ["--i" as string]: 1 }}>
          <div className="cartao-titulo">
            <h2>
              <UserRound size={18} color="#f0abfc" aria-hidden="true" /> Perfil
            </h2>
          </div>
          <div className="perfil">
            <Avatar nome={usuario.nome} grande />
            <div>
              <strong>{usuario.nome}</strong>
              <span className="texto-suave">{usuario.email}</span>
            </div>
          </div>
          <dl className="dados">
            <dt>Perfil</dt>
            <dd>{usuario.papel === "admin" ? "Administrador" : "Membro"}</dd>
            <dt>Membro desde</dt>
            <dd>{new Date(usuario.criadoEm.replace(" ", "T") + "Z").toLocaleDateString("pt-BR")}</dd>
          </dl>
        </section>

        <section className="cartao entrar" style={{ ["--i" as string]: 2 }}>
          <div className="cartao-titulo">
            <h2>
              <KeyRound size={18} color="#f0abfc" aria-hidden="true" /> Alterar senha
            </h2>
          </div>
          <p className="texto-suave pequeno" style={{ marginTop: -6 }}>
            Ao alterar a senha, você será desconectado dos outros aparelhos.
          </p>
          <FormTrocarSenha />
        </section>
      </div>
    </>
  );
}
