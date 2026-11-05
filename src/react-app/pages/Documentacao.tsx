import { Download, Eye, FileCheck2, FolderLock, Pencil, Plus, RefreshCw, Search, Trash2, UploadCloud } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIAS_DOCUMENTO, diasAte } from "../../shared/negocio";
import { podeEditar } from "../../shared/permissoes";
import type { Documento, Usuario } from "../../shared/tipos";
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
  const [editando, setEditando] = useState<Documento | "novo" | null>(null);
  const [vendo, setVendo] = useState<Documento | null>(null);
  const hoje = hojeIso();

  async function carregar() {
    try {
      setDocs((await api<{ documentos: Documento[] }>("/documentos")).documentos);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const lista = useMemo(() => (docs ?? []).map((d) => ({ d, s: situacao(d, hoje) })), [docs, hoje]);
  const conta = (t: Situacao) => lista.filter((x) => x.s.tipo === t).length;
  const filtrados = lista.filter(({ d, s }) => {
    if (filtro !== "todos" && s.tipo !== filtro) return false;
    const t = busca.trim().toLowerCase();
    return !t || [d.nome, d.categoria, d.observacoes].filter(Boolean).some((v) => v!.toLowerCase().includes(t));
  });

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
          <h1>Documentos da empresa</h1>
          <p className="texto-suave">Certidões, contrato social, balanço e atestados, com aviso antes de vencer.</p>
        </div>
        {editar && (
          <button className="botao" onClick={() => setEditando("novo")}>
            <Plus /> Novo documento
          </button>
        )}
      </div>

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
        <div className="grade-cartoes">
          {filtrados.map(({ d, s }, i) => (
            <article key={d.id} className={`cartao documento ${s.tipo} entrar`} style={{ ["--i" as string]: Math.min(i, 8) }}>
              <div className="fornecedor-topo">
                <span className={`icone-redondo ${s.tipo === "vencido" ? "urgente" : s.tipo === "vencendo" ? "atencao" : "info"}`}>
                  <FileCheck2 />
                </span>
                <div>
                  <h3>{d.nome}</h3>
                  <span className="chip">{d.categoria}</span>
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

      {editando && (
        <ModalDocumento
          documento={editando === "novo" ? null : editando}
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

function ModalDocumento({ documento: d, aoFechar, aoSalvar }: { documento: Documento | null; aoFechar: () => void; aoSalvar: () => void }) {
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
          <CampoSelect rotulo="Categoria" name="categoria" defaultValue={d?.categoria ?? CATEGORIAS_DOCUMENTO[0]} opcoes={CATEGORIAS_DOCUMENTO} />
        </div>
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
