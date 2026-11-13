import { Download, Eye, FileArchive, FileCheck2, FolderLock, Pencil, Plus, RefreshCw, Search, Trash2, UploadCloud } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIAS_DOCUMENTO, diasAte, HABILITACOES, habilitacaoDaCategoria } from "../../shared/negocio";
import { podeEditar } from "../../shared/permissoes";
import type { Documento, Empresa, Usuario } from "../../shared/tipos";
import { baixarZip } from "../documentos/zip";
import { zipDaHabilitacao } from "../documentos/habilitacao";
import { api, enviarArquivo, mensagemDeErro } from "../api";
import { Alerta, Campo } from "../components/Formulario";
import { avisar, CampoArea, CampoSelect, Carregando, Modal, Vazio } from "../components/Ui";
import { formatarData, formatarTamanho, hojeIso } from "../formato";

type Situacao = "vencido" | "vencendo" | "valido" | "sem-validade";

function situacao(d: Documento, hoje: string): { tipo: Situacao; dias: number | null } {
  if (!d.validade) return { tipo: "sem-validade", dias: null };
  const dias = diasAte(d.validade, hoje);
  if (dias < 0) return { tipo: "vencido", dias };
  if (dias <= 15) return { tipo: "vencendo", dias };
  return { tipo: "valido", dias };
}

const NOMES: Record<Situacao, string> = {
  vencido: "Vencidos",
  vencendo: "Vencem em até 15 dias",
  valido: "Válidos",
  "sem-validade": "Sem validade",
};

export function Documentacao({ usuario }: { usuario: Usuario }) {
  const editar = podeEditar(usuario.permissoes, "documentacao");
  const [docs, setDocs] = useState<Documento[] | null>(null);
  const [filtro, setFiltro] = useState<"todos" | Situacao>("todos");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Documento | { categoria: string } | "novo" | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaFiltro, setEmpresaFiltro] = useState<number | "todas">("todas");
  const [zipando, setZipando] = useState<string>("");
  const [vendo, setVendo] = useState<Documento | null>(null);
  const hoje = hojeIso();

  async function carregar() {
    try {
      const [d, e] = await Promise.all([
        api<{ documentos: Documento[] }>("/documentos"),
        api<{ empresas: Empresa[] }>("/empresas").catch(() => ({ empresas: [] as Empresa[] })),
      ]);
      setDocs(d.documentos);
      setEmpresas(e.empresas);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const lista = useMemo(
    () => (docs ?? []).filter((d) => empresaFiltro === "todas" || d.empresa_id === empresaFiltro).map((d) => ({ d, s: situacao(d, hoje) })),
    [docs, hoje, empresaFiltro],
  );
  const conta = (t: Situacao) => lista.filter((x) => x.s.tipo === t).length;
  const filtrados = lista.filter(({ d, s }) => {
    if (filtro !== "todos" && s.tipo !== filtro) return false;
    const t = busca.trim().toLowerCase();
    return !t || [d.nome, d.categoria, d.observacoes].filter(Boolean).some((v) => v!.toLowerCase().includes(t));
  });

  const nomeEmpresa = (id: number | null) => empresas.find((e) => e.id === id)?.nome;

  /** Baixa num .zip os arquivos dos documentos, com uma pasta por habilitação. */
  async function zipar(chave: string, itens: Documento[]) {
    const { nome, arquivos, vencidos } = zipDaHabilitacao(itens, empresas, hoje, { empresaId: empresaFiltro, habilitacao: chave !== "tudo" ? chave : undefined });
    if (arquivos.length === 0) {
      avisar("Nenhum documento com arquivo para baixar.", "erro");
      return;
    }
    setZipando(chave);
    try {
      await baixarZip(nome, arquivos);
      avisar(vencidos ? `Zip baixado. Atenção: ${vencidos} documento(s) vencido(s) foram incluídos e marcados.` : "Zip baixado.", vencidos ? "erro" : "sucesso");
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setZipando("");
    }
  }

  async function excluir(d: Documento) {
    if (!confirm(`Excluir "${d.nome}" e o arquivo dele?`)) return;
    try {
      await api(`/documentos/${d.id}`, { metodo: "DELETE" });
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Documentação</span>
          <h1>Documentos de habilitação</h1>
          <p className="texto-suave">Separados como na Lei 14.133/2021, com aviso antes de vencer e download em zip.</p>
        </div>
        <div className="linha-botoes">
          <button className="botao secundario" onClick={() => zipar("tudo", filtrados.map((x) => x.d))} disabled={!!zipando}>
            <FileArchive /> {zipando === "tudo" ? "Juntando…" : "Baixar tudo (zip)"}
          </button>
          {editar && (
            <button className="botao" onClick={() => setEditando("novo")}>
              <Plus /> Novo documento
            </button>
          )}
        </div>
      </div>

      {empresas.length > 1 && (
        <div className="pilulas entrar" style={{ marginTop: 14 }}>
          <button className={`pilula ${empresaFiltro === "todas" ? "ativa" : ""}`} onClick={() => setEmpresaFiltro("todas")}>
            Todas as empresas
          </button>
          {empresas.map((e) => (
            <button key={e.id} className={`pilula ${empresaFiltro === e.id ? "ativa" : ""}`} onClick={() => setEmpresaFiltro(e.id)}>
              {e.nome}
            </button>
          ))}
        </div>
      )}

      <div className="resumo-linha entrar" style={{ marginTop: 18, ["--i" as string]: 1 }}>
        <div className="mini-indicador">
          <span>Documentos</span>
          <strong>{docs?.length ?? "…"}</strong>
        </div>
        <div className="mini-indicador">
          <span>Vencidos</span>
          <strong className={conta("vencido") ? "texto-vermelho" : ""}>{conta("vencido")}</strong>
        </div>
        <div className="mini-indicador">
          <span>Vencem em 15 dias</span>
          <strong className={conta("vencendo") ? "texto-amarelo" : ""}>{conta("vencendo")}</strong>
        </div>
        <div className="mini-indicador">
          <span>Válidos</span>
          <strong className="texto-verde">{conta("valido")}</strong>
        </div>
      </div>

      <div className="barra-filtros entrar" style={{ ["--i" as string]: 2, marginTop: 0 }}>
        <div className="entrada com-icone busca">
          <Search />
          <input placeholder="Buscar documento…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar documento" />
        </div>
      </div>
      <div className="pilulas entrar" style={{ ["--i" as string]: 2 }}>
        <button className={`pilula ${filtro === "todos" ? "ativa" : ""}`} onClick={() => setFiltro("todos")}>
          Todos <span>{docs?.length ?? 0}</span>
        </button>
        {(Object.keys(NOMES) as Situacao[]).map((t) => (
          <button key={t} className={`pilula ${filtro === t ? "ativa" : ""}`} onClick={() => setFiltro(t)}>
            {NOMES[t]} <span>{conta(t)}</span>
          </button>
        ))}
      </div>

      {docs === null ? (
        <Carregando />
      ) : filtrados.length === 0 ? (
        <section className="cartao">
          <Vazio icone={<FolderLock />} titulo={docs.length ? "Nenhum documento encontrado" : "Nenhum documento cadastrado"}>
            {!docs.length && "Cadastre as certidões com a data de validade: o sistema avisa antes de vencerem."}
          </Vazio>
        </section>
      ) : (
        <div className="secoes-habilitacao">
          {HABILITACOES.map((h, hi) => {
            const doGrupo = filtrados.filter(({ d }) => habilitacaoDaCategoria(d.categoria).chave === h.chave);
            if (doGrupo.length === 0 && (filtro !== "todos" || busca.trim())) return null;
            const vencidos = doGrupo.filter((x) => x.s.tipo === "vencido").length;
            return (
              <section key={h.chave} className="secao-habilitacao entrar" style={{ ["--i" as string]: Math.min(hi + 2, 8) }}>
                <div className="secao-habilitacao-topo">
                  <span className="numero-habilitacao">{hi + 1}</span>
                  <div>
                    <h2>{h.nome}</h2>
                    <span className="texto-fraco pequeno">
                      {doGrupo.length} documento(s){h.lei ? ` · Lei 14.133/2021, ${h.lei}` : ""}
                      {vencidos ? <span className="texto-vermelho"> · {vencidos} vencido(s)</span> : null}
                    </span>
                  </div>
                  <div className="linha-botoes">
                    {doGrupo.length > 0 && (
                      <button className="botao secundario pequeno" onClick={() => zipar(h.chave, doGrupo.map((x) => x.d))} disabled={!!zipando}>
                        <FileArchive /> {zipando === h.chave ? "Juntando…" : "Baixar (zip)"}
                      </button>
                    )}
                    {editar && (
                      <button className="botao secundario pequeno" onClick={() => setEditando({ categoria: h.categorias[0] })} aria-label={`Adicionar em ${h.nome}`}>
                        <Plus /> Adicionar
                      </button>
                    )}
                  </div>
                </div>
                {doGrupo.length === 0 ? (
                  <p className="texto-fraco pequeno secao-vazia">Nenhum documento. Ex.: {h.categorias.slice(0, 3).join(", ")}.</p>
                ) : (
                  <div className="grade-cartoes">
                    {doGrupo.map(({ d, s }, i) => (
                      <article key={d.id} className={`cartao documento ${s.tipo} entrar`} style={{ ["--i" as string]: Math.min(i, 8) }}>
                <div className="fornecedor-topo">
                  <span className={`icone-redondo ${s.tipo === "vencido" ? "urgente" : s.tipo === "vencendo" ? "atencao" : "info"}`}>
                    <FileCheck2 />
                  </span>
                  <div>
                    <h3>{d.nome}</h3>
                    <span className="chip">{d.categoria}</span>
                    {empresas.length > 1 && empresaFiltro === "todas" && d.empresa_id && <span className="chip">{nomeEmpresa(d.empresa_id)}</span>}
                  </div>
                </div>
                <div className="documento-validade">
                  <div>
                    <small>Validade</small>
                    <strong>{d.validade ? formatarData(d.validade) : "Sem validade"}</strong>
                  </div>
                  <span className={`selo ${s.tipo === "vencido" ? "vermelho" : s.tipo === "vencendo" ? "amarelo" : s.tipo === "valido" ? "verde" : ""}`}>
                    {s.dias == null ? "Não vence" : s.dias < 0 ? `Vencido há ${-s.dias} dia(s)` : s.dias === 0 ? "Vence hoje" : `${s.dias} dia(s)`}
                  </span>
                </div>
                {d.observacoes && <p className="fornecedor-obs">{d.observacoes}</p>}
                <span className="texto-fraco pequeno">
                  {d.arquivo_nome ? `${d.arquivo_nome}${d.arquivo_tamanho ? ` · ${formatarTamanho(d.arquivo_tamanho)}` : ""}` : "Sem arquivo anexado"}
                  {d.emissao && ` · emitido em ${formatarData(d.emissao)}`}
                </span>
                <div className="fornecedor-links">
                  {d.arquivo_nome && (
                    <>
                      {d.arquivo_tipo && ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(d.arquivo_tipo) && (
                        <button className="botao secundario" onClick={() => setVendo(d)}>
                          <Eye /> Ver
                        </button>
                      )}
                      <a className="botao secundario" href={`/api/documentos/${d.id}/arquivo?baixar=1`}>
                        <Download /> Baixar
                      </a>
                    </>
                  )}
                  {editar && (
                    <>
                      <button className="botao secundario" onClick={() => setEditando(d)}>
                        {s.tipo === "vencido" || s.tipo === "vencendo" ? <RefreshCw /> : <Pencil />}
                        {s.tipo === "vencido" || s.tipo === "vencendo" ? "Renovar" : "Editar"}
                      </button>
                      <button className="botao-icone perigo" onClick={() => excluir(d)} aria-label="Excluir documento">
                        <Trash2 />
                      </button>
                    </>
                  )}
                </div>
              </article>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {editando && (
        <ModalDocumento
          documento={editando === "novo" || !("id" in editando) ? null : editando}
          categoriaInicial={editando !== "novo" && !("id" in editando) ? editando.categoria : undefined}
          empresas={empresas}
          empresaInicial={empresaFiltro !== "todas" ? empresaFiltro : (empresas.find((e) => e.padrao)?.id ?? null)}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            carregar();
          }}
        />
      )}
      {vendo && (
        <Modal titulo={vendo.nome} aoFechar={() => setVendo(null)} largo>
          <div className="visualizador">
            {vendo.arquivo_tipo?.startsWith("image/") ? (
              <img src={`/api/documentos/${vendo.id}/arquivo`} alt={vendo.nome} />
            ) : (
              <iframe src={`/api/documentos/${vendo.id}/arquivo`} title={vendo.nome} />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function ModalDocumento({
  documento: d,
  categoriaInicial,
  empresas,
  empresaInicial,
  aoFechar,
  aoSalvar,
}: {
  documento: Documento | null;
  categoriaInicial?: string;
  empresas: Empresa[];
  empresaInicial: number | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    if (arquivo) dados.set("arquivo", arquivo);
    setErro("");
    setEnviando(true);
    try {
      await enviarArquivo(d ? `/documentos/${d.id}` : "/documentos", dados);
      avisar(d ? "Documento atualizado." : "Documento cadastrado.");
      aoSalvar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={d ? `Atualizar: ${d.nome}` : "Novo documento"} aoFechar={aoFechar} largo>
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <div className="grade-2">
          <Campo rotulo="Nome" name="nome" defaultValue={d?.nome ?? ""} placeholder="Ex.: CND Federal" required autoFocus />
          <label className="campo">
            <span className="texto-suave pequeno">Tipo de documento</span>
            <select name="categoria" defaultValue={d?.categoria ?? categoriaInicial ?? CATEGORIAS_DOCUMENTO[0]}>
              {HABILITACOES.map((h) => (
                <optgroup key={h.chave} label={h.nome}>
                  {h.categorias.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        {empresas.length > 0 && (
          <CampoSelect
            rotulo="Empresa"
            name="empresa_id"
            defaultValue={String(d ? (d.empresa_id ?? "") : (empresaInicial ?? ""))}
            vazio="—"
            opcoes={empresas.map((e) => ({ valor: String(e.id), texto: e.nome }))}
          />
        )}
        <div className="grade-2">
          <Campo rotulo="Data de emissão" name="emissao" type="date" defaultValue={d?.emissao ?? ""} />
          <Campo rotulo="Validade" name="validade" type="date" defaultValue={d?.validade ?? ""} ajuda="Deixe vazio se o documento não vence." />
        </div>
        <CampoArea rotulo="Observações" name="observacoes" rows={2} defaultValue={d?.observacoes ?? ""} />
        <div
          className="zona-envio"
          role="button"
          tabIndex={0}
          onClick={() => entrada.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && entrada.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) setArquivo(e.dataTransfer.files[0]);
          }}
        >
          <UploadCloud />
          <strong>{arquivo ? arquivo.name : d?.arquivo_nome ? "Trocar o arquivo (opcional)" : "Anexar o arquivo (PDF ou imagem)"}</strong>
          <span className="texto-fraco pequeno">{d?.arquivo_nome && !arquivo ? `Atual: ${d.arquivo_nome}` : "Clique ou arraste aqui · até 30 MB"}</span>
          <input ref={entrada} type="file" hidden onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
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
