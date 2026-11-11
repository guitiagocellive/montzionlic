import { useCallback, useEffect, useState } from "react";
import { podeVer } from "../shared/permissoes";
import type { Usuario } from "../shared/tipos";
import { api } from "./api";
import { Layout } from "./components/Layout";
import { Avisos } from "./components/Ui";
import { Alertas } from "./pages/Alertas";
import { Calendario } from "./pages/Calendario";
import { Configuracoes } from "./pages/Configuracoes";
import { Convite } from "./pages/Convite";
import { Documentacao } from "./pages/Documentacao";
import { AssinarDocumentos } from "./pages/AssinarDocumentos";
import { CriarDocumento } from "./pages/CriarDocumento";
import { Disputas } from "./pages/Disputas";
import { Financeiro } from "./pages/Financeiro";
import { PainelLicitacoes, PainelPosGanho } from "./pages/PaineisArea";
import { BuscarLicitacoes } from "./pages/licitacoes/BuscarLicitacoes";
import { Empresas } from "./pages/licitacoes/Empresas";
import { Mercado } from "./pages/licitacoes/Mercado";
import { DetalheLicitacao } from "./pages/licitacoes/Detalhe";
import { Fornecedores } from "./pages/licitacoes/Fornecedores";
import { QuadroLicitacoes } from "./pages/licitacoes/Quadro";
import { Login } from "./pages/Login";
import { Painel } from "./pages/Painel";
import { Relatorios } from "./pages/Relatorios";
import { Atas } from "./pages/posganho/Atas";
import { DetalheExecucao } from "./pages/posganho/Detalhe";
import { QuadroExecucao } from "./pages/posganho/Quadro";
import { PrimeiroAcesso } from "./pages/PrimeiroAcesso";
import { TrocarSenhaObrigatoria } from "./pages/TrocarSenhaObrigatoria";
import { combinar, useCaminho } from "./rota";
import { aplicarTema } from "./tema";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "configurar" }
  | { tipo: "deslogado" }
  | { tipo: "logado"; usuario: Usuario };

export function App() {
  return (
    <>
      <Conteudo />
      <Avisos />
    </>
  );
}

function SemAcesso() {
  return (
    <section className="cartao">
      <div className="em-breve">
        <h2 style={{ margin: 0 }}>Sem acesso</h2>
        <p className="texto-suave">Você não tem acesso a esta área. Peça a um administrador.</p>
      </div>
    </section>
  );
}

function Pagina({ caminho, usuario, aoMudarUsuario }: { caminho: string; usuario: Usuario; aoMudarUsuario: (u: Usuario) => void }) {
  const p = usuario.permissoes;
  let m: Record<string, string> | null;
  const limpo = caminho.replace(/\/+$/, "");
  if (limpo === "/licitacoes/buscar") return podeVer(p, "licitacoes") ? <BuscarLicitacoes usuario={usuario} /> : <SemAcesso />;
  if (limpo === "/licitacoes/empresas") return podeVer(p, "licitacoes") ? <Empresas /> : <SemAcesso />;
  if (limpo === "/licitacoes/mercado") return podeVer(p, "licitacoes") ? <Mercado /> : <SemAcesso />;
  if (limpo === "/licitacoes/painel") return podeVer(p, "licitacoes") ? <PainelLicitacoes /> : <SemAcesso />;
  if (limpo === "/pos-ganho/painel") return podeVer(p, "posganho") ? <PainelPosGanho /> : <SemAcesso />;
  if ((m = combinar(caminho, "/licitacoes/:id")))
    return podeVer(p, "licitacoes") ? <DetalheLicitacao key={m.id} id={Number(m.id)} usuario={usuario} /> : <SemAcesso />;
  if ((m = combinar(caminho, "/pos-ganho/:id")))
    return podeVer(p, "posganho") ? <DetalheExecucao key={m.id} id={Number(m.id)} usuario={usuario} /> : <SemAcesso />;
  if (caminho.startsWith("/configuracoes")) {
    const secao = caminho.split("/")[2] ?? "";
    return <Configuracoes usuario={usuario} secao={secao} aoMudarUsuario={aoMudarUsuario} />;
  }

  switch (caminho.replace(/\/+$/, "") || "/") {
    case "/calendario":
      return <Calendario />;
    case "/alertas":
      return <Alertas usuario={usuario} />;
    case "/relatorios":
      return podeVer(p, "licitacoes") ? <Relatorios /> : <SemAcesso />;
    case "/licitacoes":
      return podeVer(p, "licitacoes") ? <QuadroLicitacoes usuario={usuario} /> : <SemAcesso />;
    case "/fornecedores":
      return podeVer(p, "fornecedores") ? <Fornecedores usuario={usuario} /> : <SemAcesso />;
    case "/pos-ganho":
      return podeVer(p, "posganho") ? <QuadroExecucao usuario={usuario} /> : <SemAcesso />;
    case "/atas":
      return podeVer(p, "atas") ? <Atas usuario={usuario} /> : <SemAcesso />;
    case "/financeiro":
      return podeVer(p, "financeiro") ? <Financeiro /> : <SemAcesso />;
    case "/documentacao":
      return podeVer(p, "documentacao") ? <Documentacao usuario={usuario} /> : <SemAcesso />;
    case "/assinar":
      return podeVer(p, "assinatura") ? <AssinarDocumentos usuario={usuario} /> : <SemAcesso />;
    case "/disputas":
      return podeVer(p, "licitacoes") ? <Disputas usuario={usuario} /> : <SemAcesso />;
    case "/criar-documento":
      return podeVer(p, "documentacao") ? <CriarDocumento usuario={usuario} /> : <SemAcesso />;
    default:
      return <Painel usuario={usuario} />;
  }
}

function Conteudo() {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const caminho = useCaminho();

  const entrar = useCallback((usuario: Usuario) => {
    aplicarTema({ modo: usuario.tema, claro: usuario.temaClaro, escuro: usuario.temaEscuro });
    setEstado({ tipo: "logado", usuario });
  }, []);

  const carregar = useCallback(async () => {
    try {
      const { usuario } = await api<{ usuario: Usuario }>("/auth/eu");
      entrar(usuario);
    } catch {
      try {
        const { precisaConfigurar } = await api<{ precisaConfigurar: boolean }>("/auth/setup");
        setEstado({ tipo: precisaConfigurar ? "configurar" : "deslogado" });
      } catch {
        setEstado({ tipo: "deslogado" });
      }
    }
  }, [entrar]);

  useEffect(() => {
    carregar();
    const aoExpirar = () => setEstado({ tipo: "deslogado" });
    window.addEventListener("sessao-expirada", aoExpirar);
    return () => window.removeEventListener("sessao-expirada", aoExpirar);
  }, [carregar]);

  // Link de convite funciona mesmo sem login.
  const convite = combinar(caminho, "/convite/:token");
  if (convite && estado.tipo !== "logado") return <Convite token={convite.token} aoEntrar={carregar} />;

  if (estado.tipo === "carregando") {
    return (
      <div className="tela-central">
        <div className="carregando">
          <div className="anel" />
        </div>
      </div>
    );
  }
  if (estado.tipo === "configurar") return <PrimeiroAcesso aoConcluir={carregar} />;
  if (estado.tipo === "deslogado") return <Login aoEntrar={carregar} />;

  const { usuario } = estado;
  if (usuario.trocarSenha) {
    return <TrocarSenhaObrigatoria usuario={usuario} aoConcluir={carregar} />;
  }

  return (
    <Layout usuario={usuario} caminho={caminho} aoSair={() => setEstado({ tipo: "deslogado" })} aoMudarUsuario={entrar}>
      <Pagina caminho={caminho} usuario={usuario} aoMudarUsuario={entrar} />
    </Layout>
  );
}
