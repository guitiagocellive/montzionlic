import { useCallback, useEffect, useState } from "react";
import type { Usuario } from "../shared/tipos";
import { api } from "./api";
import { FundoAnimado } from "./components/Fundo";
import { Layout } from "./components/Layout";
import { Equipe } from "./pages/Equipe";
import { Login } from "./pages/Login";
import { MinhaConta } from "./pages/MinhaConta";
import { Painel } from "./pages/Painel";
import { PrimeiroAcesso } from "./pages/PrimeiroAcesso";
import { TrocarSenhaObrigatoria } from "./pages/TrocarSenhaObrigatoria";
import { useCaminho } from "./rota";

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
    </>
  );
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

  let pagina;
  if (caminho === "/equipe" && usuario.papel === "admin") {
    pagina = <Equipe usuarioAtual={usuario} />;
  } else if (caminho === "/conta") {
    pagina = <MinhaConta usuario={usuario} />;
  } else {
    pagina = <Painel usuario={usuario} />;
  }

  return (
    <Layout usuario={usuario} caminho={caminho} aoSair={() => setEstado({ tipo: "deslogado" })}>
      {pagina}
    </Layout>
  );
}
