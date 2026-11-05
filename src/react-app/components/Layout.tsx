import {
  CalendarDays,
  CalendarRange,
  FileSignature,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Menu,
  PackageCheck,
  Truck,
  UserRound,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Usuario } from "../../shared/tipos";
import { api } from "../api";
import { navegar } from "../rota";
import { Avatar } from "./Avatar";
import { Marca } from "./Marca";

interface Props {
  usuario: Usuario;
  caminho: string;
  aoSair: () => void;
  children: ReactNode;
}

const dataHoje = () => {
  const texto = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

export function Layout({ usuario, caminho, aoSair, children }: Props) {
  const [menuAberto, setMenuAberto] = useState(false);

  const secoes: { titulo: string; itens: { caminho: string; rotulo: string; icone: LucideIcon }[] }[] = [
    {
      titulo: "Visão geral",
      itens: [
        { caminho: "/", rotulo: "Painel", icone: LayoutDashboard },
        { caminho: "/calendario", rotulo: "Calendário", icone: CalendarRange },
      ],
    },
    {
      titulo: "Licitações",
      itens: [
        { caminho: "/licitacoes", rotulo: "Quadro de licitações", icone: KanbanSquare },
        { caminho: "/fornecedores", rotulo: "Fornecedores", icone: Truck },
      ],
    },
    {
      titulo: "Pós-ganho",
      itens: [
        { caminho: "/pos-ganho", rotulo: "Empenhos e entregas", icone: PackageCheck },
        { caminho: "/atas", rotulo: "Atas vigentes", icone: FileSignature },
      ],
    },
    {
      titulo: "Conta",
      itens: [
        ...(usuario.papel === "admin" ? [{ caminho: "/equipe", rotulo: "Equipe", icone: Users }] : []),
        { caminho: "/conta", rotulo: "Minha conta", icone: UserRound },
      ],
    },
  ];

  const ativo = (destino: string) =>
    destino === "/" ? caminho === "/" : caminho === destino || caminho.startsWith(`${destino}/`);

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
      <header className="topo-celular">
        <button
          className="botao-menu"
          aria-label="Abrir menu"
          aria-expanded={menuAberto}
          onClick={() => setMenuAberto((v) => !v)}
        >
          <Menu />
        </button>
        <Marca />
        <Avatar nome={usuario.nome} />
      </header>

      <aside className={`lateral ${menuAberto ? "aberta" : ""}`}>
        <div className="lateral-interna">
          <div className="lateral-marca">
            <Marca />
          </div>
          <nav>
            {secoes.map((secao) => (
              <div key={secao.titulo} className="grupo-menu">
                <div className="secao-menu">{secao.titulo}</div>
                {secao.itens.map(({ caminho: destino, rotulo, icone: Icone }) => (
                  <a
                    key={destino}
                    href={destino}
                    className={ativo(destino) ? "ativo" : ""}
                    aria-current={ativo(destino) ? "page" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      setMenuAberto(false);
                      navegar(destino);
                    }}
                  >
                    <Icone aria-hidden="true" />
                    {rotulo}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className="lateral-rodape">
            <button className="botao secundario largura-total" onClick={sair}>
              <LogOut aria-hidden="true" />
              Sair
            </button>
          </div>
        </div>
      </aside>

      {menuAberto && <div className="fundo-menu" onClick={() => setMenuAberto(false)} />}

      <div className="conteudo-area">
        <div className="barra-topo">
          <div className="data-hoje">
            <CalendarDays aria-hidden="true" />
            {dataHoje()}
          </div>
          <div className="chip-usuario">
            <Avatar nome={usuario.nome} />
            <div>
              <strong>{usuario.nome}</strong>
              <span>{usuario.email}</span>
            </div>
          </div>
        </div>
        <main className="conteudo">{children}</main>
      </div>
    </div>
  );
}
