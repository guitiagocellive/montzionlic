import { FolderLock } from "lucide-react";

export function Documentacao() {
  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Documentação</span>
          <h1>Documentos da empresa</h1>
        </div>
      </div>
      <section className="cartao entrar" style={{ ["--i" as string]: 1 }}>
        <div className="em-breve">
          <span className="icone-brilho grande">
            <FolderLock />
          </span>
          <h2 style={{ margin: 0 }}>Em construção</h2>
          <p className="texto-suave">
            Aqui vão ficar as certidões, documentos de habilitação e atestados da empresa, com aviso de vencimento.
            Me conte como você quer essa área e eu monto.
          </p>
        </div>
      </section>
    </>
  );
}
