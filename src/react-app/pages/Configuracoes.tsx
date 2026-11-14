import {
  BellRing,
  Building2,
  Camera,
  Check,
  Copy,
  Download,
  FileText,
  Landmark,
  MonitorDown,
  Percent,
  Plus,
  Star,
  Upload,
  KeyRound,
  Link2,
  Palette,
  Pencil,
  Shield,
  ShieldCheck,
  ShieldAlert,
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
  type CertificadoInfo,
  type Configuracoes as Config,
  type Convite,
  type Papel,
  type Tema,
  TEMAS_CLAROS,
  TEMAS_ESCUROS,
  type Usuario,
} from "../../shared/tipos";
import { api, enviarArquivo, mensagemDeErro } from "../api";
import type { ContaBancaria, Empresa, ModeloProposta } from "../../shared/tipos";
import { Avatar } from "../components/Avatar";
import { Alerta, Campo } from "../components/Formulario";
import { FormTrocarSenha } from "../components/FormTrocarSenha";
import { avisar, CampoSelect, Carregando, Interruptor, Modal } from "../components/Ui";
import { formatarData } from "../formato";
import { link } from "../rota";
import { aplicarTema } from "../tema";
import { DeclaracoesConfig } from "./configuracoes/Declaracoes";
import { AplicativoConfig } from "./configuracoes/Aplicativo";
import { EmpresasConfig } from "./configuracoes/Empresas";
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
    { chave: "aplicativo", rotulo: "Aplicativo", icone: MonitorDown },
    ...(admin
      ? [
          { chave: "empresas", rotulo: "Empresas", icone: Building2 },
          { chave: "empresa", rotulo: "Margens e prazos", icone: Percent },
          { chave: "propostas", rotulo: "Propostas", icone: FileText },
          { chave: "certificado", rotulo: "Certificado digital", icone: ShieldCheck },
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
          {atual === "aplicativo" && <AplicativoConfig />}
          {atual === "empresas" && <EmpresasConfig />}
          {atual === "propostas" && (
            <>
              <DeclaracoesConfig />
              <PropostasConfig />
            </>
          )}
          {atual === "certificado" && <CertificadoConfig />}
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

  const CartaoTema = ({ t, ativo, aoEscolher }: { t: { chave: string; nome: string; descricao: string; cores: readonly string[]; fundo: string }; ativo: boolean; aoEscolher: () => void }) => (
    <button className={`tema-opcao ${ativo ? "ativo" : ""}`} onClick={aoEscolher}>
      <span
        className="tema-previa"
        style={{ background: `radial-gradient(circle at 15% 20%, ${t.cores[0]}, transparent 60%), radial-gradient(circle at 90% 10%, ${t.cores[1]}, transparent 55%), ${t.fundo}` }}
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
          margem_padrao: Number(f.get("margem_padrao")),
          imposto_padrao: Number(f.get("imposto_padrao")),
          validade_proposta_padrao: Number(f.get("validade_proposta_padrao")),
        });
      }}
    >
      <section className="cartao">
        <h2>Pré-definições do orçamento e da proposta</h2>
        <p className="descricao">
          Usadas em toda licitação nova. Cada licitação ainda pode ter os seus próprios valores. Os dados das empresas ficam em{" "}
          <a className="link-suave" {...link("/configuracoes/empresas")}>
            Empresas
          </a>
          .
        </p>
        <div className="grade-3">
          <Campo rotulo="Margem de lucro padrão (%)" name="margem_padrao" type="number" step="0.1" min="0" max="95" defaultValue={config.margem_padrao} />
          <Campo rotulo="Impostos sobre a venda (%)" name="imposto_padrao" type="number" step="0.01" min="0" max="95" defaultValue={config.imposto_padrao} />
          <Campo rotulo="Validade padrão da proposta (dias)" name="validade_proposta_padrao" type="number" min="1" max="365" defaultValue={config.validade_proposta_padrao} />
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
          alerta_documento_dias: Number(f.get("alerta_documento_dias")),
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
        <div className="grade-3" style={{ marginTop: 14 }}>
          <Campo rotulo="Vencimento de documentos (dias)" name="alerta_documento_dias" type="number" min="0" max="180" defaultValue={config.alerta_documento_dias} />
        </div>
        <div>
          <button className="botao">Salvar</button>
        </div>
      </section>
    </form>
  );
}

// ---------------- Certificado digital A1 (admin) ----------------

function CertificadoConfig() {
  const [info, setInfo] = useState<CertificadoInfo | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const formulario = useRef<HTMLFormElement>(null);

  async function carregar() {
    try {
      const r = await api<{ certificado: CertificadoInfo }>("/certificado");
      setInfo(r.certificado);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }
  useEffect(() => {
    carregar();
  }, []);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!arquivo) return;
    const senha = String(new FormData(e.currentTarget).get("senha") ?? "");
    setEnviando(true);
    try {
      // O .pfx é aberto aqui no navegador: a senha não é enviada a lugar nenhum.
      const { lerCertificadoA1 } = await import("../assinatura/certificado");
      const lido = lerCertificadoA1(await arquivo.arrayBuffer(), senha);
      const b64 = (bytes: Uint8Array) => {
        let t = "";
        for (const x of bytes) t += String.fromCharCode(x);
        return btoa(t);
      };
      await api("/certificado", {
        corpo: {
          chave_pkcs8: b64(lido.chavePkcs8),
          certificado: b64(lido.certificado),
          cadeia: lido.cadeia.map(b64),
          titular: lido.titular,
          documento: lido.documento,
          emissor: lido.emissor,
        },
      });
      formulario.current?.reset();
      setArquivo(null);
      setTrocando(false);
      avisar("Certificado cadastrado. As propostas já podem sair assinadas.");
      await carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setEnviando(false);
    }
  }

  async function remover() {
    if (!confirm("Remover o certificado da plataforma? Ninguém conseguirá assinar até cadastrar outro.")) return;
    try {
      await api("/certificado", { metodo: "DELETE" });
      await carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  if (!info) return <Carregando />;
  const dias = info.dias_restantes ?? 0;
  const vencido = info.configurado && dias < 0;
  const vencendo = info.configurado && dias >= 0 && dias <= 30;

  return (
    <>
      {!info.segredo_configurado && (
        <Alerta tipo="erro">
          A assinatura ainda não foi ativada no servidor. Crie o segredo <code>CHAVE_CERTIFICADO</code> no Worker da Cloudflare
          (Settings → Variables and Secrets → tipo Secret) com um texto longo e aleatório. Veja o passo a passo no README.
        </Alerta>
      )}

      {info.configurado && (
        <section className={`cartao certificado-status ${vencido ? "vencido" : vencendo ? "vencendo" : ""}`}>
          <div className="certificado-cabeca">
            <span className="certificado-icone">{vencido || vencendo ? <ShieldAlert /> : <ShieldCheck />}</span>
            <div>
              <span className="sobretitulo">Certificado A1 da empresa</span>
              <h2>{info.titular}</h2>
              <span className="texto-fraco pequeno">{info.documento ? `CNPJ/CPF ${info.documento}` : "Documento não identificado"}</span>
            </div>
            <span className={`etiqueta ${vencido ? "vermelha" : vencendo ? "amarela" : "verde"}`}>
              {vencido ? "Vencido" : vencendo ? `Vence em ${dias} dia(s)` : "Ativo"}
            </span>
          </div>
          <dl className="certificado-dados">
            <div>
              <dt>Validade</dt>
              <dd>
                {formatarData(info.valido_de)} até {formatarData(info.valido_ate)}
              </dd>
            </div>
            <div>
              <dt>Emissor</dt>
              <dd>{info.emissor || "—"}</dd>
            </div>
            <div>
              <dt>Cadastrado</dt>
              <dd>
                {formatarData(info.criado_em)}
                {info.enviado_por_nome && ` por ${info.enviado_por_nome}`}
              </dd>
            </div>
          </dl>
          <div className="linha-botoes">
            <button type="button" className="botao secundario" onClick={() => setTrocando((t) => !t)}>
              <Upload /> Trocar certificado
            </button>
            <button type="button" className="botao secundario perigo" onClick={remover}>
              <Trash2 /> Remover
            </button>
          </div>
        </section>
      )}

      {(!info.configurado || trocando) && (
        <section className="cartao">
          <h2>{info.configurado ? "Cadastrar o novo certificado" : "Cadastrar o certificado A1"}</h2>
          <p className="descricao">
            Envie o arquivo do certificado A1 (.pfx ou .p12) e a senha dele. Depois disso, quem tiver permissão de
            <strong> Assinatura digital</strong> consegue gerar propostas e PDFs já assinados.
          </p>
          <form ref={formulario} className="formulario" onSubmit={enviar}>
            <div className="grade-2">
              <label className="campo">
                <span>Arquivo do certificado</span>
                <input type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} required />
              </label>
              <Campo rotulo="Senha do certificado" name="senha" type="password" autoComplete="off" required />
            </div>
            <div>
              <button className="botao acento" disabled={enviando || !arquivo || !info.segredo_configurado}>
                <ShieldCheck /> {enviando ? "Conferindo…" : "Cadastrar certificado"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="cartao">
        <h2>Como a plataforma protege o certificado</h2>
        <ul className="lista-seguranca">
          <li>A senha é usada só no seu navegador para abrir o arquivo: ela <strong>não é enviada nem guardada</strong>.</li>
          <li>A chave do certificado fica criptografada (AES-256) com um segredo que só existe no servidor da Cloudflare, e nunca volta para o navegador: o servidor só assina o resumo do PDF.</li>
          <li>Só administradores cadastram ou trocam o certificado; só quem tem permissão de <strong>Assinatura digital → Editar</strong> assina.</li>
          <li>Toda assinatura fica registrada no histórico da licitação, com quem assinou e quando.</li>
          <li>A assinatura segue o padrão ICP-Brasil (PAdES) e pode ser conferida em validar.iti.gov.br.</li>
        </ul>
      </section>
    </>
  );
}

// ---------------- Propostas: contas bancárias e modelos (admin) ----------------

function PropostasConfig() {
  const [contas, setContas] = useState<ContaBancaria[] | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [modelos, setModelos] = useState<ModeloProposta[]>([]);
  const [campos, setCampos] = useState<{ campos: [string, string][]; camposItem: [string, string][] } | null>(null);
  const [editandoConta, setEditandoConta] = useState<ContaBancaria | "nova" | null>(null);
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  async function carregar() {
    try {
      const [c, m, e] = await Promise.all([
        api<{ contas: ContaBancaria[] }>("/propostas/contas"),
        api<{ modelos: ModeloProposta[] }>("/propostas/modelos"),
        api<{ empresas: Empresa[] }>("/empresas"),
      ]);
      setContas(c.contas);
      setEmpresas(e.empresas);
      setModelos(m.modelos);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  useEffect(() => {
    carregar();
    api<{ campos: [string, string][]; camposItem: [string, string][] }>("/propostas/campos").then(setCampos, () => {});
  }, []);

  async function enviarModelo(arquivo: File | Blob, nome: string) {
    setEnviando(true);
    try {
      // Confere os campos do modelo aqui no navegador antes de enviar.
      const { validarModelo } = await import("../proposta/word");
      const problema = validarModelo(await arquivo.arrayBuffer());
      if (problema) throw new Error(problema);
      const dados = new FormData();
      dados.set("arquivo", arquivo, arquivo instanceof File ? arquivo.name : "modelo-proposta.docx");
      dados.set("nome", nome);
      await enviarArquivo("/propostas/modelos", dados);
      avisar("Modelo adicionado.");
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setEnviando(false);
    }
  }

  async function usarExemplo() {
    const r = await fetch("/modelos/modelo-proposta.docx");
    await enviarModelo(await r.blob(), "Modelo padrão Montzion");
  }

  async function acao(caminho: string, metodo: string, corpo?: unknown) {
    try {
      await api(caminho, { metodo, corpo });
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  return (
    <>
      <section className="cartao">
        <div className="cartao-titulo">
          <h2>
            <FileText size={17} /> Modelos de proposta (Word)
          </h2>
          <div className="linha-acoes">
            <a className="botao link" href="/modelos/modelo-proposta.docx" download>
              <Download size={14} /> Baixar exemplo
            </a>
            <button className="botao" onClick={() => entrada.current?.click()} disabled={enviando}>
              <Upload /> {enviando ? "Enviando…" : "Enviar modelo"}
            </button>
          </div>
          <input
            ref={entrada}
            type="file"
            accept=".docx"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) enviarModelo(f, f.name.replace(/\.docx$/i, ""));
              e.target.value = "";
            }}
          />
        </div>
        <p className="descricao">
          Use os seus próprios modelos do Word. Onde quiser que a plataforma preencha, escreva o campo entre chaves, como{" "}
          <code>{"{orgao}"}</code>. Na tabela de itens, comece a linha com <code>{"{#itens}"}</code> e termine com <code>{"{/itens}"}</code>.
        </p>
        {modelos.length === 0 ? (
          <div className="vazio-bloco">
            <strong>Nenhum modelo ainda</strong>
            <div className="texto-suave pequeno">Envie um modelo seu ou comece com o modelo de exemplo.</div>
            <button className="botao secundario" onClick={usarExemplo} disabled={enviando}>
              <Plus /> Usar o modelo de exemplo
            </button>
          </div>
        ) : (
          <div className="lista-membros">
            {modelos.map((m) => (
              <div key={m.id} className="membro">
                <span className="icone-redondo info">
                  <FileText />
                </span>
                <div className="membro-texto">
                  <strong>
                    {m.nome}
                    {m.padrao === 1 && <span className="etiqueta">padrão</span>}
                  </strong>
                  <span>{m.arquivo_nome} · {formatarData(m.criado_em)}</span>
                </div>
                <div className="membro-acoes">
                  {m.padrao !== 1 && (
                    <button className="botao link" onClick={() => acao(`/propostas/modelos/${m.id}`, "PATCH", { padrao: true })}>
                      <Star size={14} /> Tornar padrão
                    </button>
                  )}
                  <a className="botao-icone" href={`/api/propostas/modelos/${m.id}/arquivo`} aria-label="Baixar modelo">
                    <Download />
                  </a>
                  <button className="botao-icone perigo" onClick={() => confirm(`Excluir o modelo "${m.nome}"?`) && acao(`/propostas/modelos/${m.id}`, "DELETE")} aria-label="Excluir modelo">
                    <Trash2 />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {campos && (
          <details className="campos-modelo">
            <summary>Ver todos os campos que dá para usar no modelo</summary>
            <div className="lista-campos">
              {campos.campos.map(([chave, nome]) => (
                <span key={chave}>
                  <code>{`{${chave}}`}</code> {nome}
                </span>
              ))}
            </div>
            <p className="texto-fraco pequeno">Dentro da tabela de itens (entre {"{#itens}"} e {"{/itens}"}):</p>
            <div className="lista-campos">
              {campos.camposItem.map(([chave, nome]) => (
                <span key={chave}>
                  <code>{`{${chave}}`}</code> {nome}
                </span>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="cartao">
        <div className="cartao-titulo">
          <h2>
            <Landmark size={17} /> Contas bancárias para pagamento
          </h2>
          <button className="botao secundario" onClick={() => setEditandoConta("nova")}>
            <Plus /> Nova conta
          </button>
        </div>
        {contas === null ? (
          <Carregando />
        ) : contas.length === 0 ? (
          <p className="texto-fraco pequeno">Cadastre as contas que aparecem nas propostas para o órgão pagar.</p>
        ) : (
          <div className="lista-membros">
            {contas.map((c) => (
              <div key={c.id} className="membro">
                <span className="icone-redondo">
                  <Landmark />
                </span>
                <div className="membro-texto">
                  <strong>
                    {c.apelido}
                    {c.padrao === 1 && <span className="etiqueta">padrão</span>}
                  </strong>
                  <span>
                    {[
                      c.banco,
                      c.agencia && `ag. ${c.agencia}`,
                      c.conta && `${c.tipo ?? "conta"} ${c.conta}`,
                      c.pix && `PIX ${c.pix}`,
                      c.empresa_id && empresas.find((e) => e.id === c.empresa_id)?.nome,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="membro-acoes">
                  {c.padrao !== 1 && (
                    <button className="botao link" onClick={() => acao(`/propostas/contas/${c.id}`, "PATCH", { padrao: true })}>
                      <Star size={14} /> Tornar padrão
                    </button>
                  )}
                  <button className="botao-icone" onClick={() => setEditandoConta(c)} aria-label="Editar conta">
                    <Pencil />
                  </button>
                  <button className="botao-icone perigo" onClick={() => confirm(`Excluir a conta "${c.apelido}"?`) && acao(`/propostas/contas/${c.id}`, "DELETE")} aria-label="Excluir conta">
                    <Trash2 />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {editandoConta && (
        <ModalConta
          conta={editandoConta === "nova" ? null : editandoConta}
          empresas={empresas}
          aoFechar={() => setEditandoConta(null)}
          aoSalvar={() => {
            setEditandoConta(null);
            carregar();
          }}
        />
      )}
    </>
  );
}

function ModalConta({
  conta,
  empresas,
  aoFechar,
  aoSalvar,
}: {
  conta: ContaBancaria | null;
  empresas: Empresa[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const corpo = Object.fromEntries(new FormData(e.currentTarget));
    setErro("");
    setEnviando(true);
    try {
      if (conta) await api(`/propostas/contas/${conta.id}`, { metodo: "PATCH", corpo });
      else await api("/propostas/contas", { corpo });
      avisar("Conta salva.");
      aoSalvar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }
  return (
    <Modal titulo={conta ? conta.apelido : "Nova conta bancária"} aoFechar={aoFechar}>
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <div className="grade-2">
          <Campo rotulo="Apelido" name="apelido" defaultValue={conta?.apelido ?? ""} placeholder="Ex.: Conta principal" required autoFocus />
          <Campo rotulo="Banco" name="banco" defaultValue={conta?.banco ?? ""} placeholder="Ex.: Banco do Brasil" required />
        </div>
        <div className="grade-3">
          <Campo rotulo="Código do banco" name="codigo_banco" defaultValue={conta?.codigo_banco ?? ""} placeholder="001" />
          <Campo rotulo="Agência" name="agencia" defaultValue={conta?.agencia ?? ""} />
          <Campo rotulo="Conta" name="conta" defaultValue={conta?.conta ?? ""} />
        </div>
        {empresas.length > 0 && (
          <CampoSelect
            rotulo="Empresa"
            name="empresa_id"
            defaultValue={conta?.empresa_id ? String(conta.empresa_id) : ""}
            vazio="Qualquer empresa"
            opcoes={empresas.map((e) => ({ valor: String(e.id), texto: e.nome }))}
          />
        )}
        <div className="grade-3">
          <CampoSelect rotulo="Tipo" name="tipo" defaultValue={conta?.tipo ?? "Corrente"} opcoes={["Corrente", "Poupança", "Pagamento"]} />
          <Campo rotulo="Chave PIX" name="pix" defaultValue={conta?.pix ?? ""} />
          <Campo rotulo="Titular" name="titular" defaultValue={conta?.titular ?? ""} />
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
  financeiro: "nenhum",
  assinatura: "nenhum",
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
