import {
  BellRing,
  Building2,
  Camera,
  Check,
  Copy,
  KeyRound,
  Link2,
  Palette,
  Pencil,
  Shield,
  Trash2,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  ACESSO_TOTAL,
  CORES_EQUIPE,
  MODULOS,
  type Nivel,
  type Permissoes,
} from "../../shared/permissoes";
import {
  type Configuracoes as Config,
  type Convite,
  type Papel,
  type Tema,
  TEMAS_CLAROS,
  TEMAS_ESCUROS,
  type Usuario,
} from "../../shared/tipos";
import { api, enviarArquivo, mensagemDeErro } from "../api";
import { Avatar } from "../components/Avatar";
import { Alerta, Campo } from "../components/Formulario";
import { FormTrocarSenha } from "../components/FormTrocarSenha";
import { avisar, CampoSelect, Carregando, Interruptor, Modal } from "../components/Ui";
import { formatarData } from "../formato";
import { link } from "../rota";
import { aplicarTema } from "../tema";
import { Moon, MonitorSmartphone, Sun } from "lucide-react";

interface Props {
  usuario: Usuario;
  secao: string;
  aoMudarUsuario: (u: Usuario) => void;
}

export function Configuracoes({ usuario, secao, aoMudarUsuario }: Props) {
  const admin = usuario.papel === "admin";
  const menu = [
    { chave: "", rotulo: "Meu perfil", icone: UserRound },
    { chave: "aparencia", rotulo: "Aparência", icone: Palette },
    { chave: "seguranca", rotulo: "Segurança", icone: KeyRound },
    ...(admin
      ? [
          { chave: "empresa", rotulo: "Empresa e margens", icone: Building2 },
          { chave: "alertas", rotulo: "Alertas", icone: BellRing },
          { chave: "equipe", rotulo: "Equipe e acessos", icone: Users },
        ]
      : []),
  ];
  const atual = menu.some((m) => m.chave === secao) ? secao : "";

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Configurações</span>
          <h1>{menu.find((m) => m.chave === atual)?.rotulo}</h1>
        </div>
      </div>

      <div className="config-layout">
        <nav className="config-menu entrar" aria-label="Seções das configurações">
          {menu.map((m) => {
            const Icone = m.icone;
            const destino = m.chave ? `/configuracoes/${m.chave}` : "/configuracoes";
            return (
              <a key={m.chave} className={atual === m.chave ? "ativo" : ""} {...link(destino)}>
                <Icone /> {m.rotulo}
              </a>
            );
          })}
        </nav>

        <div className="config-conteudo entrar" key={atual} style={{ ["--i" as string]: 1 }}>
          {atual === "" && <Perfil usuario={usuario} aoMudarUsuario={aoMudarUsuario} />}
          {atual === "aparencia" && <Aparencia usuario={usuario} aoMudarUsuario={aoMudarUsuario} />}
          {atual === "seguranca" && (
            <section className="cartao">
              <h2>Alterar senha</h2>
              <p className="descricao">Ao alterar a senha, você sai dos outros aparelhos.</p>
              <div style={{ maxWidth: 440 }}>
                <FormTrocarSenha />
              </div>
            </section>
          )}
          {atual === "empresa" && <Empresa />}
          {atual === "alertas" && <AlertasConfig />}
          {atual === "equipe" && <Equipe usuarioAtual={usuario} />}
        </div>
      </div>
    </>
  );
}

// ---------------- Perfil ----------------

function SeletorCor({ valor, aoMudar }: { valor: string; aoMudar: (c: string) => void }) {
  return (
    <div className="cores" role="radiogroup" aria-label="Cor">
      {CORES_EQUIPE.map((c) => (
        <button
          key={c}
          type="button"
          className={`cor-opcao ${valor === c ? "ativa" : ""}`}
          style={{ ["--cor" as string]: c }}
          onClick={() => aoMudar(c)}
          role="radio"
          aria-checked={valor === c}
          aria-label={c}
        />
      ))}
    </div>
  );
}

function Perfil({ usuario, aoMudarUsuario }: { usuario: Usuario; aoMudarUsuario: (u: Usuario) => void }) {
  const [nome, setNome] = useState(usuario.nome);
  const [cargo, setCargo] = useState(usuario.cargo ?? "");
  const [cor, setCor] = useState(usuario.cor);
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const mudou = nome !== usuario.nome || cargo !== (usuario.cargo ?? "") || cor !== usuario.cor;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      const r = await api<{ usuario: Usuario }>("/conta/perfil", { metodo: "PATCH", corpo: { nome, cargo, cor } });
      aoMudarUsuario(r.usuario);
      avisar("Perfil atualizado.");
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setSalvando(false);
    }
  }

  async function enviarFoto(arquivo: File) {
    setEnviandoFoto(true);
    try {
      const dados = new FormData();
      dados.set("foto", arquivo);
      const r = await enviarArquivo<{ usuario: Usuario }>("/conta/foto", dados);
      aoMudarUsuario(r.usuario);
      avisar("Foto atualizada.");
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function removerFoto() {
    try {
      const r = await api<{ usuario: Usuario }>("/conta/foto", { metodo: "DELETE" });
      aoMudarUsuario(r.usuario);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  return (
    <section className="cartao">
      <div className="perfil-foto">
        <Avatar nome={nome || usuario.nome} cor={cor} foto={usuario.foto} grande />
        <div>
          <strong>{usuario.nome}</strong>
          <span className="texto-fraco pequeno">
            {usuario.email} · {usuario.papel === "admin" ? "Administrador" : "Membro"}
          </span>
          <div className="linha-acoes">
            <button className="botao secundario pequeno" onClick={() => entrada.current?.click()} disabled={enviandoFoto}>
              <Camera /> {enviandoFoto ? "Enviando…" : usuario.foto ? "Trocar foto" : "Enviar foto"}
            </button>
            {usuario.foto && (
              <button className="botao link" onClick={removerFoto}>
                Remover
              </button>
            )}
          </div>
          <input
            ref={entrada}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) enviarFoto(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <form className="formulario" onSubmit={salvar} style={{ maxWidth: 560 }}>
        <div className="grade-2">
          <Campo rotulo="Nome" name="nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
          <Campo rotulo="Cargo" name="cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ex.: Analista de licitações" />
        </div>
        <div className="campo">
          <span>Sua cor no time</span>
          <SeletorCor valor={cor} aoMudar={setCor} />
          <small className="texto-fraco">Aparece no seu avatar e nos cards em que você é responsável.</small>
        </div>
        <div>
          <button className="botao" disabled={!mudou || salvando}>
            {salvando ? "Salvando…" : "Salvar perfil"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------------- Aparência ----------------

function Aparencia({ usuario, aoMudarUsuario }: { usuario: Usuario; aoMudarUsuario: (u: Usuario) => void }) {
  const modos: { valor: Tema; rotulo: string; icone: typeof Sun }[] = [
    { valor: "claro", rotulo: "Claro", icone: Sun },
    { valor: "escuro", rotulo: "Escuro", icone: Moon },
    { valor: "sistema", rotulo: "Automático", icone: MonitorSmartphone },
  ];

  async function salvar(mudanca: { tema?: Tema; tema_claro?: string; tema_escuro?: string }) {
    const pref = {
      modo: mudanca.tema ?? usuario.tema,
      claro: (mudanca.tema_claro ?? usuario.temaClaro) as Usuario["temaClaro"],
      escuro: (mudanca.tema_escuro ?? usuario.temaEscuro) as Usuario["temaEscuro"],
    };
    // Ao escolher um tema claro/escuro, já mostra ele na tela.
    if (mudanca.tema_claro && pref.modo !== "claro") pref.modo = "claro";
    if (mudanca.tema_escuro && pref.modo !== "escuro") pref.modo = "escuro";
    aplicarTema(pref);
    try {
      const r = await api<{ usuario: Usuario }>("/conta/perfil", {
        metodo: "PATCH",
        corpo: { tema: pref.modo, tema_claro: pref.claro, tema_escuro: pref.escuro },
      });
      aoMudarUsuario(r.usuario);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  const CartaoTema = ({ t, ativo, aoEscolher }: { t: { chave: string; nome: string; descricao: string; cores: readonly string[] }; ativo: boolean; aoEscolher: () => void }) => (
    <button className={`tema-opcao ${ativo ? "ativo" : ""}`} onClick={aoEscolher}>
      <span
        className="tema-previa"
        style={{ background: `radial-gradient(circle at 15% 20%, ${t.cores[0]}, transparent 60%), radial-gradient(circle at 90% 10%, ${t.cores[1]}, transparent 55%), ${t.chave === "grafite" ? "#0a0a0c" : t.chave === "oceano" ? "#04121a" : "#f6f7fb"}` }}
      >
        <i style={{ background: "rgb(255 255 255 / 30%)", backdropFilter: "blur(6px)" }} />
        <i style={{ background: "rgb(255 255 255 / 18%)" }} />
        <b className="tema-ponto" style={{ background: t.cores[2] }} />
      </span>
      <span className="tema-texto">
        <strong>
          {t.nome} {ativo && <Check size={15} />}
        </strong>
        <small>{t.descricao}</small>
      </span>
    </button>
  );

  return (
    <>
      <section className="cartao">
        <h2>Modo</h2>
        <p className="descricao">O botão de sol/lua no topo também alterna entre claro e escuro.</p>
        <div className="segmentado grande">
          {modos.map((m) => {
            const Icone = m.icone;
            return (
              <button key={m.valor} className={usuario.tema === m.valor ? "ativo" : ""} onClick={() => salvar({ tema: m.valor })}>
                <Icone size={15} /> {m.rotulo}
              </button>
            );
          })}
        </div>
      </section>

      <section className="cartao">
        <h2>Tema claro</h2>
        <p className="descricao">Usado quando o modo claro estiver ativo.</p>
        <div className="temas">
          {TEMAS_CLAROS.map((t) => (
            <CartaoTema key={t.chave} t={t} ativo={usuario.temaClaro === t.chave} aoEscolher={() => salvar({ tema_claro: t.chave })} />
          ))}
        </div>
      </section>

      <section className="cartao">
        <h2>Tema escuro</h2>
        <p className="descricao">Usado quando o modo escuro estiver ativo.</p>
        <div className="temas">
          {TEMAS_ESCUROS.map((t) => (
            <CartaoTema key={t.chave} t={t} ativo={usuario.temaEscuro === t.chave} aoEscolher={() => salvar({ tema_escuro: t.chave })} />
          ))}
        </div>
      </section>
    </>
  );
}

// ---------------- Empresa e alertas (admin) ----------------

function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    api<{ configuracoes: Config }>("/configuracoes").then(
      (r) => setConfig(r.configuracoes),
      (err) => avisar(mensagemDeErro(err), "erro"),
    );
  }, []);
  async function salvar(dados: Partial<Config>) {
    try {
      const r = await api<{ configuracoes: Config }>("/configuracoes", { metodo: "PATCH", corpo: dados });
      setConfig(r.configuracoes);
      avisar("Configurações salvas.");
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }
  return { config, salvar };
}

function Empresa() {
  const { config, salvar } = useConfig();
  if (!config) return <Carregando />;
  return (
    <form
      className="formulario"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        salvar({
          empresa_nome: String(f.get("empresa_nome")),
          empresa_cnpj: String(f.get("empresa_cnpj")),
          margem_padrao: Number(f.get("margem_padrao")),
          imposto_padrao: Number(f.get("imposto_padrao")),
        });
      }}
    >
      <section className="cartao">
        <h2>Dados da empresa</h2>
        <p className="descricao">Aparecem nos convites e, no futuro, nos documentos gerados.</p>
        <div className="grade-2">
          <Campo rotulo="Nome da empresa" name="empresa_nome" defaultValue={config.empresa_nome} />
          <Campo rotulo="CNPJ" name="empresa_cnpj" defaultValue={config.empresa_cnpj} />
        </div>
      </section>
      <section className="cartao">
        <h2>Pré-definições do orçamento</h2>
        <p className="descricao">Usadas em toda licitação nova. Cada licitação ainda pode ter os seus próprios valores.</p>
        <div className="grade-2">
          <Campo rotulo="Margem de lucro padrão (%)" name="margem_padrao" type="number" step="0.1" min="0" max="95" defaultValue={config.margem_padrao} />
          <Campo rotulo="Impostos sobre a venda (%)" name="imposto_padrao" type="number" step="0.01" min="0" max="95" defaultValue={config.imposto_padrao} />
        </div>
        <div>
          <button className="botao">Salvar</button>
        </div>
      </section>
    </form>
  );
}

function AlertasConfig() {
  const { config, salvar } = useConfig();
  if (!config) return <Carregando />;
  return (
    <form
      className="formulario"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        salvar({
          alerta_sessao_dias: Number(f.get("alerta_sessao_dias")),
          alerta_entrega_dias: Number(f.get("alerta_entrega_dias")),
          alerta_ata_dias: Number(f.get("alerta_ata_dias")),
        });
      }}
    >
      <section className="cartao">
        <h2>Com quantos dias de antecedência avisar</h2>
        <p className="descricao">
          O sistema confere de hora em hora e avisa no sino de quem tem acesso à área. Quem ativar, recebe também no navegador.
        </p>
        <div className="grade-3">
          <Campo rotulo="Sessões de licitação (dias)" name="alerta_sessao_dias" type="number" min="0" max="60" defaultValue={config.alerta_sessao_dias} />
          <Campo rotulo="Prazos de entrega (dias)" name="alerta_entrega_dias" type="number" min="0" max="60" defaultValue={config.alerta_entrega_dias} />
          <Campo rotulo="Vencimento de atas (dias)" name="alerta_ata_dias" type="number" min="0" max="365" defaultValue={config.alerta_ata_dias} />
        </div>
        <div>
          <button className="botao">Salvar</button>
        </div>
      </section>
    </form>
  );
}

// ---------------- Equipe, acessos e convites (admin) ----------------

const NOMES_NIVEL: Record<Nivel, string> = { nenhum: "Sem acesso", ver: "Ver", editar: "Editar" };

function EditorPermissoes({
  valor,
  aoMudar,
  bloqueado,
}: {
  valor: Permissoes;
  aoMudar: (p: Permissoes) => void;
  bloqueado?: boolean;
}) {
  return (
    <div className="tabela-permissoes">
      {MODULOS.map((m) => (
        <div key={m.chave} className="linha-permissao">
          <div>
            <strong>{m.nome}</strong>
            <small>{m.descricao}</small>
          </div>
          <div className="segmentado" role="radiogroup" aria-label={m.nome}>
            {(["nenhum", "ver", "editar"] as Nivel[]).map((n) => (
              <button
                key={n}
                type="button"
                className={valor[m.chave] === n ? "ativo" : ""}
                disabled={bloqueado}
                onClick={() => aoMudar({ ...valor, [m.chave]: n })}
                role="radio"
                aria-checked={valor[m.chave] === n}
              >
                {NOMES_NIVEL[n]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function resumoAcessos(u: { papel: Papel; permissoes: Permissoes }) {
  if (u.papel === "admin") return ["Acesso total"];
  const lista = MODULOS.filter((m) => u.permissoes[m.chave] !== "nenhum").map(
    (m) => `${m.nome}${u.permissoes[m.chave] === "ver" ? " (ver)" : ""}`,
  );
  return lista.length ? lista : ["Sem acesso"];
}

function Equipe({ usuarioAtual }: { usuarioAtual: Usuario }) {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [convites, setConvites] = useState<Convite[]>([]);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [convidando, setConvidando] = useState(false);

  async function carregar() {
    try {
      const [u, c] = await Promise.all([
        api<{ usuarios: Usuario[] }>("/usuarios"),
        api<{ convites: Convite[] }>("/convites"),
      ]);
      setUsuarios(u.usuarios);
      setConvites(c.convites);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function revogar(c: Convite) {
    try {
      await api(`/convites/${c.id}`, { metodo: "DELETE" });
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  const pendentes = convites.filter((c) => !c.usado_em && c.expira_em > Date.now());

  return (
    <>
      <section className="cartao">
        <div className="cartao-titulo">
          <h2>
            <Users size={17} /> Pessoas do time
          </h2>
          <button className="botao" onClick={() => setConvidando(true)}>
            <UserPlus /> Convidar pessoa
          </button>
        </div>
        {usuarios === null ? (
          <Carregando />
        ) : (
          <div className="lista-membros">
            {usuarios.map((u) => (
              <div key={u.id} className={`membro ${u.ativo ? "" : "inativo"}`}>
                <Avatar nome={u.nome} cor={u.cor} foto={u.foto} />
                <div className="membro-texto">
                  <strong>
                    {u.nome}
                    {u.id === usuarioAtual.id && <span className="etiqueta">você</span>}
                  </strong>
                  <span>
                    {[u.cargo, u.email].filter(Boolean).join(" · ")}
                    {!u.ativo && " · Desativado"}
                    {u.ativo && u.trocarSenha && " · Aguardando 1º acesso"}
                  </span>
                </div>
                <div className="membro-acessos">
                  {resumoAcessos(u).map((r) => (
                    <span key={r} className={`chip ${u.papel === "admin" ? "destaque" : ""}`}>
                      {r}
                    </span>
                  ))}
                </div>
                <div className="membro-acoes">
                  <button className="botao-icone" onClick={() => setEditando(u)} aria-label={`Editar ${u.nome}`}>
                    <Pencil />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {pendentes.length > 0 && (
        <section className="cartao">
          <h2>
            <Link2 size={17} style={{ verticalAlign: -3, marginRight: 6 }} />
            Convites pendentes
          </h2>
          <div className="lista-membros">
            {pendentes.map((c) => (
              <div key={c.id} className="membro">
                <span className="icone-redondo">
                  <Link2 />
                </span>
                <div className="membro-texto">
                  <strong>{c.email ?? "Qualquer e-mail"}</strong>
                  <span>
                    {c.cargo ? `${c.cargo} · ` : ""}Vale até {formatarData(new Date(c.expira_em).toISOString())}
                  </span>
                </div>
                <div className="membro-acessos">
                  {resumoAcessos(c).map((r) => (
                    <span key={r} className="chip">
                      {r}
                    </span>
                  ))}
                </div>
                <button className="botao-icone perigo" onClick={() => revogar(c)} aria-label="Cancelar convite" title="Cancelar convite">
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {editando && (
        <ModalMembro
          membro={editando}
          ehVoce={editando.id === usuarioAtual.id}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            carregar();
          }}
        />
      )}
      {convidando && (
        <ModalConvite
          aoFechar={() => {
            setConvidando(false);
            carregar();
          }}
        />
      )}
    </>
  );
}

const ACESSO_PADRAO_MEMBRO: Permissoes = {
  licitacoes: "editar",
  orcamento: "editar",
  fornecedores: "editar",
  posganho: "ver",
  atas: "ver",
  documentacao: "ver",
};

function ModalConvite({ aoFechar }: { aoFechar: () => void }) {
  const [papel, setPapel] = useState<Papel>("membro");
  const [permissoes, setPermissoes] = useState<Permissoes>(ACESSO_PADRAO_MEMBRO);
  const [cor, setCor] = useState(CORES_EQUIPE[1]);
  const [link, setLink] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function gerar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErro("");
    setEnviando(true);
    try {
      const r = await api<{ link: string }>("/convites", {
        corpo: {
          papel,
          permissoes,
          cor,
          cargo: f.get("cargo"),
          email: f.get("email") || null,
          validade_dias: Number(f.get("validade_dias")),
        },
      });
      setLink(r.link);
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setEnviando(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      avisar("Não foi possível copiar. Selecione o link e copie manualmente.", "erro");
    }
  }

  if (link) {
    const mensagem = encodeURIComponent(`Olá! Este é o seu convite para entrar na nossa plataforma de licitações: ${link}`);
    return (
      <Modal titulo="Convite criado" aoFechar={aoFechar}>
        <div className="formulario">
          <p className="texto-suave" style={{ margin: 0 }}>
            Envie este link para a pessoa. Ele só funciona uma vez e expira na data escolhida. Por segurança, ele não aparece de novo.
          </p>
          <div className="link-convite">
            <code>{link}</code>
            <button className="botao pequeno" onClick={copiar}>
              {copiado ? <Check /> : <Copy />} {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
          <div className="botoes-modal">
            <a className="botao secundario" href={`https://wa.me/?text=${mensagem}`} target="_blank" rel="noreferrer noopener">
              Enviar pelo WhatsApp
            </a>
            <button className="botao" onClick={aoFechar}>
              Concluir
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo="Convidar pessoa" aoFechar={aoFechar} largo>
      <form className="formulario" onSubmit={gerar}>
        <Alerta>{erro}</Alerta>
        <div className="grade-3">
          <Campo rotulo="E-mail (opcional)" name="email" type="email" placeholder="Deixe vazio para qualquer e-mail" />
          <Campo rotulo="Cargo" name="cargo" placeholder="Ex.: Analista de licitações" />
          <CampoSelect
            rotulo="Validade do link"
            name="validade_dias"
            defaultValue="7"
            opcoes={[
              { valor: "1", texto: "1 dia" },
              { valor: "3", texto: "3 dias" },
              { valor: "7", texto: "7 dias" },
              { valor: "30", texto: "30 dias" },
            ]}
          />
        </div>
        <div className="campo">
          <span>Cor da pessoa</span>
          <SeletorCor valor={cor} aoMudar={setCor} />
        </div>
        <div className="campo">
          <span>Perfil</span>
          <div className="segmentado" style={{ alignSelf: "flex-start" }}>
            <button type="button" className={papel === "membro" ? "ativo" : ""} onClick={() => setPapel("membro")}>
              Membro
            </button>
            <button type="button" className={papel === "admin" ? "ativo" : ""} onClick={() => setPapel("admin")}>
              Administrador
            </button>
          </div>
          <small className="texto-fraco">
            {papel === "admin" ? "Administradores acessam tudo e gerenciam a equipe e as configurações." : "Escolha abaixo o que a pessoa pode ver e editar."}
          </small>
        </div>
        <EditorPermissoes valor={papel === "admin" ? ACESSO_TOTAL : permissoes} aoMudar={setPermissoes} bloqueado={papel === "admin"} />
        <div className="botoes-modal">
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao" disabled={enviando}>
            <Link2 /> {enviando ? "Gerando…" : "Gerar link de convite"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ModalMembro({
  membro,
  ehVoce,
  aoFechar,
  aoSalvar,
}: {
  membro: Usuario;
  ehVoce: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [papel, setPapel] = useState<Papel>(membro.papel);
  const [permissoes, setPermissoes] = useState<Permissoes>(membro.permissoes);
  const [cor, setCor] = useState(membro.cor);
  const [cargo, setCargo] = useState(membro.cargo ?? "");
  const [ativo, setAtivo] = useState(membro.ativo);
  const [novaSenha, setNovaSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const corpo: Record<string, unknown> = { cargo, cor };
    if (!ehVoce) {
      corpo.papel = papel;
      corpo.ativo = ativo;
    }
    if (papel === "membro") corpo.permissoes = permissoes;
    if (novaSenha) corpo.novaSenha = novaSenha;
    setErro("");
    setEnviando(true);
    try {
      await api(`/usuarios/${membro.id}`, { metodo: "PATCH", corpo });
      avisar(novaSenha && !ehVoce ? `Dados salvos. Nova senha provisória: ${novaSenha}` : "Dados salvos.");
      aoSalvar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={membro.nome} aoFechar={aoFechar} largo>
      <form className="formulario" onSubmit={salvar}>
        <Alerta>{erro}</Alerta>
        <div className="grade-2">
          <Campo rotulo="Cargo" name="cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} />
          <Campo
            rotulo={ehVoce ? "Nova senha (opcional)" : "Redefinir senha (provisória)"}
            name="novaSenha"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            placeholder="Deixe vazio para manter"
            minLength={8}
          />
        </div>
        <div className="campo">
          <span>Cor</span>
          <SeletorCor valor={cor} aoMudar={setCor} />
        </div>
        {!ehVoce && (
          <div className="linha-acoes">
            <div className="segmentado">
              <button type="button" className={papel === "membro" ? "ativo" : ""} onClick={() => setPapel("membro")}>
                Membro
              </button>
              <button type="button" className={papel === "admin" ? "ativo" : ""} onClick={() => setPapel("admin")}>
                Administrador
              </button>
            </div>
            <Interruptor rotulo="Conta ativa" ligado={ativo} aoMudar={setAtivo} />
          </div>
        )}
        <div className="campo">
          <span>
            <Shield size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
            Acessos
          </span>
          <EditorPermissoes valor={papel === "admin" ? ACESSO_TOTAL : permissoes} aoMudar={setPermissoes} bloqueado={papel === "admin"} />
        </div>
        <div className="botoes-modal">
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
