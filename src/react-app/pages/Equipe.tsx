import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { type Papel, SENHA_MINIMA, type Usuario } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { Alerta, Campo } from "../components/Formulario";

/** Senha provisória fácil de ditar (sem letras parecidas como l/1, O/0). */
function gerarSenhaProvisoria(): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => letras[b % letras.length]).join("");
}

type Modal = { tipo: "novo" } | { tipo: "senha"; usuario: Usuario } | null;

export function Equipe({ usuarioAtual }: { usuarioAtual: Usuario }) {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [modal, setModal] = useState<Modal>(null);

  async function carregar() {
    try {
      const { usuarios } = await api<{ usuarios: Usuario[] }>("/usuarios");
      setUsuarios(usuarios);
    } catch (err) {
      setErro(mensagemDeErro(err));
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function alterar(usuario: Usuario, mudancas: Partial<{ papel: Papel; ativo: boolean }>) {
    setErro("");
    setAviso("");
    try {
      await api(`/usuarios/${usuario.id}`, { metodo: "PATCH", corpo: mudancas });
      await carregar();
    } catch (err) {
      setErro(mensagemDeErro(err));
    }
  }

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Equipe</h1>
          <p className="texto-suave">Quem tem acesso à plataforma.</p>
        </div>
        <button className="botao" onClick={() => setModal({ tipo: "novo" })}>
          Adicionar pessoa
        </button>
      </div>

      <Alerta>{erro}</Alerta>
      <Alerta tipo="sucesso">{aviso}</Alerta>

      <section className="cartao sem-padding">
        {usuarios === null ? (
          <p className="texto-suave padding">Carregando…</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Perfil</th>
                  <th>Status</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => {
                  const ehVoce = u.id === usuarioAtual.id;
                  return (
                    <tr key={u.id} className={u.ativo ? "" : "inativo"}>
                      <td>
                        <div className="lateral-nome">
                          {u.nome} {ehVoce && <span className="etiqueta">você</span>}
                        </div>
                        <div className="texto-suave pequeno">{u.email}</div>
                      </td>
                      <td>
                        <select
                          value={u.papel}
                          disabled={ehVoce}
                          aria-label={`Perfil de ${u.nome}`}
                          onChange={(e) => alterar(u, { papel: e.target.value as Papel })}
                        >
                          <option value="membro">Membro</option>
                          <option value="admin">Administrador</option>
                        </select>
                      </td>
                      <td>
                        <span className={`selo ${u.ativo ? "verde" : "cinza"}`}>
                          {u.ativo ? (u.trocarSenha ? "Aguardando 1º acesso" : "Ativo") : "Inativo"}
                        </span>
                      </td>
                      <td className="acoes">
                        <button
                          className="botao link"
                          onClick={() => setModal({ tipo: "senha", usuario: u })}
                        >
                          Redefinir senha
                        </button>
                        {!ehVoce && (
                          <button
                            className="botao link"
                            onClick={() => alterar(u, { ativo: !u.ativo })}
                          >
                            {u.ativo ? "Desativar" : "Reativar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal?.tipo === "novo" && (
        <ModalNovoUsuario
          aoFechar={() => setModal(null)}
          aoCriar={(u, senha) => {
            setModal(null);
            setAviso(
              `${u.nome} foi adicionado(a). Envie a senha provisória: ${senha} — será pedido para trocar no primeiro acesso.`,
            );
            carregar();
          }}
        />
      )}

      {modal?.tipo === "senha" && (
        <ModalRedefinirSenha
          usuario={modal.usuario}
          ehVoce={modal.usuario.id === usuarioAtual.id}
          aoFechar={() => setModal(null)}
          aoSalvar={(senha) => {
            const u = modal.usuario;
            setModal(null);
            setAviso(
              u.id === usuarioAtual.id
                ? "Sua senha foi alterada."
                : `Nova senha provisória de ${u.nome}: ${senha}`,
            );
            carregar();
          }}
        />
      )}
    </>
  );
}

function ModalBase({
  titulo,
  aoFechar,
  children,
}: {
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <h2>{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

function ModalNovoUsuario({
  aoFechar,
  aoCriar,
}: {
  aoFechar: () => void;
  aoCriar: (u: Usuario, senha: string) => void;
}) {
  const [senha, setSenha] = useState(gerarSenhaProvisoria);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    setErro("");
    setEnviando(true);
    try {
      const { usuario } = await api<{ usuario: Usuario }>("/usuarios", {
        corpo: {
          nome: dados.get("nome"),
          email: dados.get("email"),
          papel: dados.get("papel"),
          senha,
        },
      });
      aoCriar(usuario, senha);
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <ModalBase titulo="Adicionar pessoa" aoFechar={aoFechar}>
      <form onSubmit={enviar} className="formulario">
        <Alerta>{erro}</Alerta>
        <Campo rotulo="Nome" name="nome" required autoFocus />
        <Campo rotulo="E-mail" name="email" type="email" required />
        <label className="campo">
          <span>Perfil</span>
          <select name="papel" defaultValue="membro">
            <option value="membro">Membro</option>
            <option value="admin">Administrador (gerencia a equipe)</option>
          </select>
        </label>
        <div className="campo">
          <span>Senha provisória</span>
          <div className="linha">
            <input
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              minLength={SENHA_MINIMA}
              required
              aria-label="Senha provisória"
            />
            <button
              type="button"
              className="botao secundario"
              onClick={() => setSenha(gerarSenhaProvisoria())}
            >
              Gerar outra
            </button>
          </div>
          <small className="texto-suave">A pessoa vai trocar no primeiro acesso.</small>
        </div>
        <div className="botoes-modal">
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao" disabled={enviando}>
            {enviando ? "Salvando…" : "Adicionar"}
          </button>
        </div>
      </form>
    </ModalBase>
  );
}

function ModalRedefinirSenha({
  usuario,
  ehVoce,
  aoFechar,
  aoSalvar,
}: {
  usuario: Usuario;
  ehVoce: boolean;
  aoFechar: () => void;
  aoSalvar: (senha: string) => void;
}) {
  const [senha, setSenha] = useState(ehVoce ? "" : gerarSenhaProvisoria());
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      await api(`/usuarios/${usuario.id}`, { metodo: "PATCH", corpo: { novaSenha: senha } });
      aoSalvar(senha);
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <ModalBase titulo={`Redefinir senha de ${usuario.nome}`} aoFechar={aoFechar}>
      <form onSubmit={enviar} className="formulario">
        <Alerta>{erro}</Alerta>
        {!ehVoce && (
          <p className="texto-suave pequeno">
            A pessoa será desconectada e precisará criar uma senha nova no próximo acesso.
          </p>
        )}
        <Campo
          rotulo={ehVoce ? "Nova senha" : "Senha provisória"}
          name="senha"
          type={ehVoce ? "password" : "text"}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          minLength={SENHA_MINIMA}
          required
          autoFocus
        />
        <div className="botoes-modal">
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </ModalBase>
  );
}
