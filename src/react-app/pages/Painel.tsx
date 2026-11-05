import type { Usuario } from "../../shared/tipos";

export function Painel({ usuario }: { usuario: Usuario }) {
  return (
    <>
      <h1>Olá, {usuario.nome.split(" ")[0]}</h1>
      <p className="texto-suave">Bem-vindo à plataforma de gestão de licitações.</p>
      <section className="cartao vazio">
        <h2>Em construção</h2>
        <p className="texto-suave">
          Os módulos de licitações, documentos e prazos vão aparecer aqui.
        </p>
      </section>
    </>
  );
}
