import { type ReactNode, useState } from "react";
import type { Usuario } from "../../shared/tipos";
import { api } from "../api";
import { navegar } from "../rota";
import { Marca } from "./Marca";

interface Props {
  usuario: Usuario;
  caminho: string;
  aoSair: () => void;
  children: ReactNode;
}

export function Layout({ usuario, caminho, aoSair, children }: Props) {
  const [menuAberto, setMenuAberto] = useState(false);

  const itens = [
    { caminho: "/", rotulo: "Painel" },
    ...(usuario.papel === "admin" ? [{ caminho: "/equipe", rotulo: "Equipe" }] : []),
    { caminho: "/conta", rotulo: "Minha conta" },
  ];

  async function sair() {
    try {
      await api("/auth/logout", { corpo: {} });
    } finally {
      navegar("/");
      aoSair();
    }
  }

  return (
    <div className="app">
      <header className="topo">
        <button
          className="botao-menu"
          aria-label="Abrir menu"
          aria-expanded={menuAberto}
          onClick={() => setMenuAberto((v) => !v)}
        >
          ☰
        </button>
        <Marca />
      </header>

      <aside className={`lateral ${menuAberto ? "aberta" : ""}`}>
        <div className="lateral-marca">
          <Marca />
        </div>
        <nav>
          {itens.map((item) => (
            <a
              key={item.caminho}
              href={item.caminho}
              className={caminho === item.caminho ? "ativo" : ""}
              onClick={(e) => {
                e.preventDefault();
                setMenuAberto(false);
                navegar(item.caminho);
              }}
            >
              {item.rotulo}
            </a>
          ))}
        </nav>
        <div className="lateral-usuario">
          <div className="lateral-nome">{usuario.nome}</div>
          <div className="texto-suave pequeno">{usuario.email}</div>
          <button className="botao secundario largura-total" onClick={sair}>
            Sair
          </button>
        </div>
      </aside>

      {menuAberto && <div className="fundo-menu" onClick={() => setMenuAberto(false)} />}

      <main className="conteudo">{children}</main>
    </div>
  );
}
