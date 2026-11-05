import { LogOut, Moon, Settings, Sparkle, Sun, UserRound } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { Usuario } from "../../shared/tipos";
import { api } from "../api";
import { areaDoCaminho, areasPermitidas, funcaoAtiva } from "../navegacao";
import { link, navegar } from "../rota";
import { aplicarTema, modoVisivel, preferenciaAtual } from "../tema";
import { Avatar } from "./Avatar";
import { Notificacoes } from "./Notificacoes";
import { useFecharAoClicarFora } from "./useFecharAoClicarFora";

interface Props {
  usuario: Usuario;
  caminho: string;
  aoSair: () => void;
  aoMudarUsuario: (u: Usuario) => void;
  children: ReactNode;
}

export function Layout({ usuario, caminho, aoSair, aoMudarUsuario, children }: Props) {
  const areas = areasPermitidas(usuario.permissoes);
  const area = areaDoCaminho(caminho, areas);
  const emConfiguracoes = caminho.startsWith("/configuracoes");
  // Fora de uma área (ex.: configurações), o menu lateral mostra a Visão geral.
  const funcoes = (area ?? areas[0])?.funcoes ?? [];

  const [menuAberto, setMenuAberto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useFecharAoClicarFora(menuRef, menuAberto, () => setMenuAberto(false));
  const [, forcar] = useState(0);

  async function alternarTema() {
    const novo = modoVisivel() === "escuro" ? "claro" : "escuro";
    aplicarTema({ ...preferenciaAtual(), modo: novo });
    forcar((x) => x + 1);
    try {
      const r = await api<{ usuario: Usuario }>("/conta/perfil", { metodo: "PATCH", corpo: { tema: novo } });
      aoMudarUsuario(r.usuario);
    } catch {
      // o tema já foi aplicado na tela
    }
  }

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
      <aside className="rail" aria-label="Funções">
        <a className="rail-logo" {...link("/")} aria-label="Início">
          <Sparkle strokeWidth={2.2} />
        </a>
        <nav className="rail-nav">
          {funcoes.map((f) => {
            const Icone = f.icone;
            const ativo = funcaoAtiva(caminho, f);
            return (
              <a key={f.caminho} className={`rail-item ${ativo ? "ativo" : ""}`} aria-label={f.rotulo} aria-current={ativo ? "page" : undefined} {...link(f.caminho)}>
                <Icone aria-hidden="true" />
                <span className="dica">{f.rotulo}</span>
              </a>
            );
          })}
          <span className="rail-separador" style={{ marginTop: "auto" }} />
          <a className={`rail-item ${emConfiguracoes ? "ativo" : ""}`} aria-label="Configurações" {...link("/configuracoes")}>
            <Settings aria-hidden="true" />
            <span className="dica">Configurações</span>
          </a>
        </nav>
      </aside>

      <div className="principal">
        <header className="topo">
          <div className="topo-esq">
            <span className="marca-nome">Montzion</span>
          </div>

          <nav className="abas" aria-label="Áreas">
            {areas.map((a) => {
              const Icone = a.icone;
              return (
                <a key={a.chave} className={`aba ${area?.chave === a.chave ? "ativa" : ""}`} {...link(a.funcoes[0].caminho)}>
                  <Icone aria-hidden="true" />
                  <span>{a.rotulo}</span>
                </a>
              );
            })}
          </nav>

          <div className="topo-dir">
            <button className="botao-topo" onClick={alternarTema} aria-label="Alternar tema claro/escuro" title="Tema claro/escuro">
              {modoVisivel() === "escuro" ? <Sun /> : <Moon />}
            </button>
            <Notificacoes />
            <a className="botao-topo esconder-celular" {...link("/configuracoes")} aria-label="Configurações">
              <Settings />
            </a>
            <div className="ancora" ref={menuRef}>
              <button className="botao-avatar" onClick={() => setMenuAberto((v) => !v)} aria-label="Menu da conta" aria-expanded={menuAberto}>
                <Avatar nome={usuario.nome} cor={usuario.cor} foto={usuario.foto} />
              </button>
              {menuAberto && (
                <div className="menu-flutuante menu-usuario">
                  <div className="menu-usuario-cabecalho">
                    <Avatar nome={usuario.nome} cor={usuario.cor} foto={usuario.foto} />
                    <div>
                      <strong>{usuario.nome}</strong>
                      <span>{usuario.cargo || usuario.email}</span>
                    </div>
                  </div>
                  <a className="item-menu" {...link("/configuracoes")} onClick={(e) => { setMenuAberto(false); link("/configuracoes").onClick(e); }}>
                    <UserRound /> Meu perfil
                  </a>
                  <a className="item-menu" {...link("/configuracoes/aparencia")} onClick={(e) => { setMenuAberto(false); link("/configuracoes/aparencia").onClick(e); }}>
                    <Settings /> Configurações
                  </a>
                  <button className="item-menu" onClick={sair}>
                    <LogOut /> Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="conteudo">{children}</main>
      </div>
    </div>
  );
}
