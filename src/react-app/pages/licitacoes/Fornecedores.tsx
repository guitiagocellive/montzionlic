import { BookOpen, Building2, Globe, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Search, Trash2, Truck, UserRound } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { Fornecedor, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Alerta, Campo } from "../../components/Formulario";
import { avisar, CampoArea, Carregando, Modal, Vazio } from "../../components/Ui";

function urlSegura(valor: string | null): string | null {
  if (!valor) return null;
  const url = /^https?:\/\//i.test(valor) ? valor : `https://${valor}`;
  try {
    return new URL(url).protocol.startsWith("http") ? url : null;
  } catch {
    return null;
  }
}

function linkWhatsApp(telefone: string | null): string | null {
  const numeros = (telefone ?? "").replace(/\D/g, "");
  if (numeros.length < 10) return null;
  return `https://wa.me/${numeros.length <= 11 ? `55${numeros}` : numeros}`;
}

export function Fornecedores({ usuario }: { usuario: Usuario }) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[] | null>(null);
  const [busca, setBusca] = useState("");
  const [nicho, setNicho] = useState("");
  const [editando, setEditando] = useState<Fornecedor | "novo" | null>(null);

  async function carregar() {
    try {
      const { fornecedores } = await api<{ fornecedores: Fornecedor[] }>("/fornecedores");
      setFornecedores(fornecedores);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const nichos = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const f of fornecedores ?? []) {
      const n = f.nicho || "Sem nicho";
      contagem.set(n, (contagem.get(n) ?? 0) + 1);
    }
    return [...contagem.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [fornecedores]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (fornecedores ?? []).filter((f) => {
      if (nicho && (f.nicho || "Sem nicho") !== nicho) return false;
      if (!termo) return true;
      return [f.nome, f.vendedor, f.nicho, f.cidade, f.cnpj, f.email]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(termo));
    });
  }, [fornecedores, busca, nicho]);

  async function excluir(f: Fornecedor) {
    if (!confirm(`Excluir o fornecedor "${f.nome}"?`)) return;
    try {
      await api(`/fornecedores/${f.id}`, { metodo: "DELETE" });
      avisar("Fornecedor excluído.");
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Fornecedores</h1>
          <p className="texto-suave">Contatos, sites e catálogos organizados por nicho.</p>
        </div>
        <button className="botao" onClick={() => setEditando("novo")}>
          <Plus aria-hidden="true" /> Novo fornecedor
        </button>
      </div>

      <div className="barra-filtros entrar" style={{ ["--i" as string]: 1 }}>
        <div className="entrada com-icone busca">
          <Search aria-hidden="true" />
          <input
            placeholder="Buscar por nome, vendedor, cidade, CNPJ…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar fornecedores"
          />
        </div>
      </div>

      {nichos.length > 0 && (
        <div className="pilulas entrar" style={{ ["--i" as string]: 2 }}>
          <button className={`pilula ${nicho === "" ? "ativa" : ""}`} onClick={() => setNicho("")}>
            Todos <span>{fornecedores?.length}</span>
          </button>
          {nichos.map(([n, total]) => (
            <button key={n} className={`pilula ${nicho === n ? "ativa" : ""}`} onClick={() => setNicho(n)}>
              {n} <span>{total}</span>
            </button>
          ))}
        </div>
      )}

      {fornecedores === null ? (
        <Carregando />
      ) : filtrados.length === 0 ? (
        <section className="cartao">
          <Vazio icone={<Truck />} titulo={fornecedores.length ? "Nenhum fornecedor encontrado" : "Nenhum fornecedor cadastrado"}>
            {!fornecedores.length && "Cadastre seus fornecedores para usar nas cotações."}
          </Vazio>
        </section>
      ) : (
        <div className="grade-cartoes">
          {filtrados.map((f, i) => {
            const site = urlSegura(f.site);
            const catalogo = urlSegura(f.catalogo);
            const whats = linkWhatsApp(f.telefone);
            return (
              <article key={f.id} className="cartao fornecedor entrar" style={{ ["--i" as string]: Math.min(i, 8) }}>
                <div className="fornecedor-topo">
                  <span className="icone-brilho">
                    <Building2 />
                  </span>
                  <div>
                    <h3>{f.nome}</h3>
                    {f.nicho && <span className="chip">{f.nicho}</span>}
                  </div>
                  <div className="fornecedor-acoes">
                    <button className="botao-icone" onClick={() => setEditando(f)} aria-label="Editar">
                      <Pencil />
                    </button>
                    {usuario.papel === "admin" && (
                      <button className="botao-icone perigo" onClick={() => excluir(f)} aria-label="Excluir">
                        <Trash2 />
                      </button>
                    )}
                  </div>
                </div>
                <ul className="fornecedor-dados">
                  {f.vendedor && (
                    <li>
                      <UserRound /> {f.vendedor}
                    </li>
                  )}
                  {f.telefone && (
                    <li>
                      <Phone /> <a href={`tel:${f.telefone.replace(/[^\d+]/g, "")}`}>{f.telefone}</a>
                    </li>
                  )}
                  {f.email && (
                    <li>
                      <Mail /> <a href={`mailto:${f.email}`}>{f.email}</a>
                    </li>
                  )}
                  {(f.cidade || f.uf) && (
                    <li>
                      <MapPin /> {[f.cidade, f.uf].filter(Boolean).join(" / ")}
                    </li>
                  )}
                  {f.cnpj && <li className="texto-fraco">CNPJ {f.cnpj}</li>}
                </ul>
                {f.observacoes && <p className="fornecedor-obs">{f.observacoes}</p>}
                <div className="fornecedor-links">
                  {whats && (
                    <a className="botao secundario" href={whats} target="_blank" rel="noreferrer noopener">
                      <MessageCircle aria-hidden="true" /> WhatsApp
                    </a>
                  )}
                  {site && (
                    <a className="botao secundario" href={site} target="_blank" rel="noreferrer noopener">
                      <Globe aria-hidden="true" /> Site
                    </a>
                  )}
                  {catalogo && (
                    <a className="botao secundario" href={catalogo} target="_blank" rel="noreferrer noopener">
                      <BookOpen aria-hidden="true" /> Catálogo
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editando && (
        <ModalFornecedor
          fornecedor={editando === "novo" ? null : editando}
          nichos={nichos.map(([n]) => n).filter((n) => n !== "Sem nicho")}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            carregar();
          }}
        />
      )}
    </>
  );
}

function ModalFornecedor({
  fornecedor: f,
  nichos,
  aoFechar,
  aoSalvar,
}: {
  fornecedor: Fornecedor | null;
  nichos: string[];
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
      if (f) await api(`/fornecedores/${f.id}`, { metodo: "PATCH", corpo });
      else await api("/fornecedores", { corpo });
      avisar(f ? "Fornecedor atualizado." : "Fornecedor cadastrado.");
      aoSalvar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={f ? f.nome : "Novo fornecedor"} aoFechar={aoFechar} largo>
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <div className="grade-2">
          <Campo rotulo="Nome / empresa" name="nome" defaultValue={f?.nome ?? ""} required autoFocus />
          <div className="campo">
            <label htmlFor="nicho">
              <span className="texto-suave pequeno">Nicho</span>
            </label>
            <div className="entrada">
              <input id="nicho" name="nicho" list="lista-nichos" defaultValue={f?.nicho ?? ""} placeholder="Ex.: Informática" />
            </div>
            <datalist id="lista-nichos">
              {nichos.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="grade-3">
          <Campo rotulo="Vendedor" name="vendedor" defaultValue={f?.vendedor ?? ""} />
          <Campo rotulo="Telefone / WhatsApp" name="telefone" defaultValue={f?.telefone ?? ""} />
          <Campo rotulo="E-mail" name="email" type="email" defaultValue={f?.email ?? ""} />
        </div>
        <div className="grade-2">
          <Campo rotulo="Site" name="site" defaultValue={f?.site ?? ""} placeholder="www.fornecedor.com.br" />
          <Campo rotulo="Link do catálogo" name="catalogo" defaultValue={f?.catalogo ?? ""} />
        </div>
        <div className="grade-3">
          <Campo rotulo="CNPJ" name="cnpj" defaultValue={f?.cnpj ?? ""} />
          <Campo rotulo="Cidade" name="cidade" defaultValue={f?.cidade ?? ""} />
          <Campo rotulo="UF" name="uf" maxLength={2} defaultValue={f?.uf ?? ""} />
        </div>
        <CampoArea rotulo="Observações" name="observacoes" rows={3} defaultValue={f?.observacoes ?? ""} />
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
