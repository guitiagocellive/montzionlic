import { useCallback, useEffect, useState } from "react";
import type { Usuario } from "../shared/tipos";
import { api } from "./api";
import { FundoAnimado } from "./components/Fundo";
import { Layout } from "./components/Layout";
import { Avisos } from "./components/Ui";
import { Calendario } from "./pages/Calendario";
import { Equipe } from "./pages/Equipe";
import { DetalheLicitacao } from "./pages/licitacoes/Detalhe";
import { Fornecedores } from "./pages/licitacoes/Fornecedores";
import { QuadroLicitacoes } from "./pages/licitacoes/Quadro";
import { Login } from "./pages/Login";
import { MinhaConta } from "./pages/MinhaConta";
import { Painel } from "./pages/Painel";
import { Atas } from "./pages/posganho/Atas";
import { DetalheExecucao } from "./pages/posganho/Detalhe";
import { QuadroExecucao } from "./pages/posganho/Quadro";
import { PrimeiroAcesso } from "./pages/PrimeiroAcesso";
import { TrocarSenhaObrigatoria } from "./pages/TrocarSenhaObrigatoria";
import { combinar, useCaminho } from "./rota";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "configurar" }
  | { tipo: "deslogado" }
  | { tipo: "logado"; usuario: Usuario };

export function App() {
  return (
    <>
      <FundoAnimado />
      <Conteudo />
      <Avisos />
    </>
  );
}

function Pagina({ caminho, usuario }: { caminho: string; usuario: Usuario }) {
  let p: Record<string, string> | null;
  if ((p = combinar(caminho, "/licitacoes/:id"))) return <DetalheLicitacao key={p.id} id={Number(p.id)} usuario={usuario} />;
  if ((p = combinar(caminho, "/pos-ganho/:id"))) return <DetalheExecucao key={p.id} id={Number(p.id)} usuario={usuario} />;

  switch (caminho.replace(/\/+$/, "") || "/") {
    case "/calendario":
      return <Calendario />;
    case "/licitacoes":
      return <QuadroLicitacoes />;
    case "/fornecedores":
      return <Fornecedores usuario={usuario} />;
    case "/pos-ganho":
      return <QuadroExecucao />;
    case "/atas":
      return <Atas usuario={usuario} />;
    case "/equipe":
      return usuario.papel === "admin" ? <Equipe usuarioAtual={usuario} /> : <Painel usuario={usuario} />;
    case "/conta":
      return <MinhaConta usuario={usuario} />;
    default:
      return <Painel usuario={usuario} />;
  }
}

function Conteudo() {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const caminho = useCaminho();

  const carregar = useCallback(async () => {
    try {
      const { usuario } = await api<{ usuario: Usuario }>("/auth/eu");
      setEstado({ tipo: "logado", usuario });
    } catch {
      try {
        const { precisaConfigurar } = await api<{ precisaConfigurar: boolean }>("/auth/setup");
        setEstado({ tipo: precisaConfigurar ? "configurar" : "deslogado" });
      } catch {
        setEstado({ tipo: "deslogado" });
      }
    }
  }, []);

  useEffect(() => {
    carregar();
    const aoExpirar = () => setEstado({ tipo: "deslogado" });
    window.addEventListener("sessao-expirada", aoExpirar);
    return () => window.removeEventListener("sessao-expirada", aoExpirar);
  }, [carregar]);

  if (estado.tipo === "carregando") {
    return (
      <div className="tela-central">
        <div className="carregando">
          <div className="anel" />
          Carregando…
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
    <Layout usuario={usuario} caminho={caminho} aoSair={() => setEstado({ tipo: "deslogado" })}>
      <Pagina caminho={caminho} usuario={usuario} />
    </Layout>
  );
}
