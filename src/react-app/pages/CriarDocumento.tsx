import { BookText, Download, Eye, FilePlus2, Landmark, PenLine, RotateCcw, Save, Settings } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIAS_ARQUIVO } from "../../shared/negocio";
import { podeEditar, podeVer } from "../../shared/permissoes";
import { ehCorPdf, ehModeloPdf } from "../../shared/proposta";
import type { CertificadoInfo, Declaracao, Empresa, LicitacaoResumo, Usuario } from "../../shared/tipos";
import { api, enviarArquivo, mensagemDeErro } from "../api";
import { type Conteudo, montarConteudo, Visor } from "../components/PreviaArquivo";
import { avisar, Carregando, Interruptor, Modal, Vazio } from "../components/Ui";
import { SeletorData } from "../components/Calendario";
import { EscolherModeloPdf } from "../proposta/EscolherModelo";
import { link } from "../rota";

/** Nome do arquivo baixado sem acentos (alguns navegadores trocam nomes acentuados por "download"). */
const semAcento = (nome: string) => nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const ModalAssinar = lazy(() => import("../assinatura/ModalAssinar").then((m) => ({ default: m.ModalAssinar })));

const CHAVE_RASCUNHO = "montzion:documento-rascunho";
const LOCAL_PADRAO = "Brasília/DF";

interface Rascunho {
  empresa_id: number | null;
  licitacao_id: number | null;
  titulo: string;
  texto: string;
  modelo: string;
  cor: string;
  com_local_data: boolean;
  local: string;
  data: string;
  com_assinatura: boolean;
  assinante_nome: string;
  assinante_cpf: string;
  assinante_cargo: string;
  guardar_na_licitacao: boolean;
  categoria: string;
}

const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function lerRascunho(): Partial<Rascunho> | null {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) ?? "null");
  } catch {
    return null;
  }
}

/** Campos que podem ser colocados no texto e trocados pelos dados na hora de gerar. */
const CAMPOS: { chave: string; rotulo: string; licitacao?: boolean }[] = [
  { chave: "empresa", rotulo: "Empresa" },
  { chave: "cnpj", rotulo: "CNPJ" },
  { chave: "endereco", rotulo: "Endereço" },
  { chave: "cidade", rotulo: "Cidade" },
  { chave: "representante", rotulo: "Responsável" },
  { chave: "cpf", rotulo: "CPF" },
  { chave: "rg", rotulo: "RG" },
  { chave: "cargo", rotulo: "Cargo" },
  { chave: "orgao", rotulo: "Órgão", licitacao: true },
  { chave: "licitacao", rotulo: "Nº da licitação", licitacao: true },
  { chave: "modalidade", rotulo: "Modalidade", licitacao: true },
  { chave: "objeto", rotulo: "Objeto", licitacao: true },
  { chave: "uasg", rotulo: "UASG", licitacao: true },
];

const nomeArquivo = (titulo: string) => `${(titulo.trim() || "Documento").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 110)}.pdf`;

export function CriarDocumento({ usuario }: { usuario: Usuario }) {
  const podeAssinar = podeEditar(usuario.permissoes, "assinatura");
  const verLicitacoes = podeVer(usuario.permissoes, "licitacoes");
  const salvarLicitacao = podeEditar(usuario.permissoes, "licitacoes");
  const admin = usuario.papel === "admin";

  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [licitacoes, setLicitacoes] = useState<LicitacaoResumo[]>([]);
  const [biblioteca, setBiblioteca] = useState<Declaracao[]>([]);
  const [certificado, setCertificado] = useState<CertificadoInfo | null>(null);
  const [r, setR] = useState<Rascunho | null>(null);
  const [previa, setPrevia] = useState<{ conteudo: Conteudo; urls: string[] } | null>(null);
  const [ocupado, setOcupado] = useState<"" | "previa" | "baixar" | "assinar" | "salvar">("");
  const [assinando, setAssinando] = useState<Uint8Array | null>(null);
  const textoRef = useRef<HTMLTextAreaElement>(null);

  // Começa do rascunho salvo neste navegador, completando com os dados da empresa.
  useEffect(() => {
    Promise.all([
      api<{ empresas: Empresa[] }>("/empresas"),
      api<{ declaracoes: Declaracao[] }>("/propostas/declaracoes").catch(() => ({ declaracoes: [] as Declaracao[] })),
      api<{ certificado: CertificadoInfo }>("/certificado").catch(() => ({ certificado: null })),
      verLicitacoes ? api<{ licitacoes: LicitacaoResumo[] }>("/licitacoes").catch(() => ({ licitacoes: [] as LicitacaoResumo[] })) : Promise.resolve({ licitacoes: [] as LicitacaoResumo[] }),
    ]).then(
      ([e, d, c, l]) => {
        setEmpresas(e.empresas);
        setBiblioteca(d.declaracoes.filter((x) => x.tipo === "declaracao"));
        setCertificado(c.certificado);
        setLicitacoes(l.licitacoes);
        const salvo = lerRascunho();
        const empresa = e.empresas.find((x) => x.id === salvo?.empresa_id) ?? e.empresas.find((x) => x.padrao) ?? e.empresas[0];
        setR({
          ...padraoDaEmpresa(empresa),
          licitacao_id: null,
          titulo: "",
          texto: "",
          com_local_data: true,
          local: LOCAL_PADRAO,
          com_assinatura: true,
          guardar_na_licitacao: true,
          categoria: "Outro",
          ...(salvo ?? {}),
          empresa_id: empresa?.id ?? null,
          data: hojeIso(), // a data sempre começa em hoje
        } as Rascunho);
      },
      (err) => avisar(mensagemDeErro(err), "erro"),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Guarda o rascunho neste navegador (para não perder o texto).
  useEffect(() => {
    if (!r) return;
    try {
      localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(r));
    } catch {
      /* sem armazenamento */
    }
  }, [r]);

  const empresa = empresas?.find((x) => x.id === r?.empresa_id) ?? null;
  const licitacao = licitacoes.find((x) => x.id === r?.licitacao_id) ?? null;

  const valores = useMemo<Record<string, string>>(
    () => ({
      empresa: empresa?.nome ?? "",
      cnpj: empresa?.cnpj ?? "",
      endereco: empresa?.endereco ?? "",
      cidade: empresa?.cidade ?? "",
      representante: r?.assinante_nome || empresa?.representante_nome || "",
      cpf: r?.assinante_cpf || empresa?.representante_cpf || "",
      rg: empresa?.representante_rg ?? "",
      cargo: r?.assinante_cargo || empresa?.representante_cargo || "",
      orgao: licitacao?.orgao ?? "",
      licitacao: licitacao?.numero ?? "",
      modalidade: licitacao?.modalidade ?? "",
      objeto: licitacao?.objeto ?? "",
      uasg: licitacao?.uasg ?? "",
    }),
    [empresa, licitacao, r?.assinante_nome, r?.assinante_cpf, r?.assinante_cargo],
  );

  if (!empresas || !r) return <Carregando />;

  const mudar = (novo: Partial<Rascunho>) => setR((a) => (a ? { ...a, ...novo } : a));
  const certificadoPronto = !!certificado?.configurado && certificado.segredo_configurado && (certificado.dias_restantes ?? 0) >= 0;
  const pronto = !!empresa && !!r.titulo.trim() && !!r.texto.trim();
  const camposFaltando = Array.from(new Set(Array.from(r.texto.matchAll(/\{(\w+)\}/g)).map((m) => m[1]))).filter((k) => k in valores && !valores[k]);

  function padraoDaEmpresa(e: Empresa | undefined) {
    return {
      empresa_id: e?.id ?? null,
      modelo: ehModeloPdf(e?.modelo_pdf) ? e!.modelo_pdf : "classico",
      cor: ehCorPdf(e?.cor_pdf) ? e!.cor_pdf : "#1f3b8a",
      assinante_nome: e?.representante_nome ?? "",
      assinante_cpf: e?.representante_cpf ?? "",
      assinante_cargo: e?.representante_cargo ?? "",
    };
  }

  function trocarEmpresa(id: number) {
    mudar(padraoDaEmpresa(empresas!.find((x) => x.id === id)));
  }

  function inserirCampo(chave: string) {
    const el = textoRef.current;
    const marcador = `{${chave}}`;
    if (!el) return mudar({ texto: `${r!.texto}${marcador}` });
    const inicio = el.selectionStart ?? r!.texto.length;
    const fim = el.selectionEnd ?? inicio;
    const novo = r!.texto.slice(0, inicio) + marcador + r!.texto.slice(fim);
    mudar({ texto: novo });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inicio + marcador.length, inicio + marcador.length);
    });
  }

  function usarDaBiblioteca(id: number) {
    const d = biblioteca.find((x) => x.id === id);
    if (!d) return;
    if (r!.texto.trim() && !window.confirm("Trocar o título e o texto atuais pelo da biblioteca?")) return;
    mudar({ titulo: d.titulo || r!.titulo, texto: d.texto });
  }

  function novoDocumento() {
    if ((r!.titulo || r!.texto) && !window.confirm("Começar um documento novo? O título e o texto atuais serão apagados.")) return;
    mudar({ titulo: "", texto: "", licitacao_id: null, local: r!.local || LOCAL_PADRAO, data: hojeIso() });
  }

  async function montar(visual: { modelo: string; cor: string } = { modelo: r!.modelo, cor: r!.cor }): Promise<Uint8Array> {
    if (!empresa) throw new Error("Cadastre a empresa em Configurações → Empresas.");
    const [{ gerarDocumentoPdf }, logo] = await Promise.all([
      import("../proposta/documento"),
      empresa.tem_logo
        ? fetch(`/api/empresas/${empresa.id}/logo`, { credentials: "same-origin" })
            .then(async (x) => (x.ok ? { bytes: new Uint8Array(await x.arrayBuffer()), tipo: x.headers.get("content-type") ?? "image/png" } : null))
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    const trocar = (t: string) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in valores ? valores[k] : m));
    return gerarDocumentoPdf(
      {
        empresa: {
          nome: empresa.nome,
          cnpj: empresa.cnpj ?? "",
          ie: empresa.ie ?? "",
          endereco: empresa.endereco ?? "",
          cidade: empresa.cidade ?? "",
          telefone: empresa.telefone ?? "",
          email: empresa.email ?? "",
        },
        titulo: trocar(r!.titulo),
        texto: trocar(r!.texto),
        destinatario: licitacao
          ? {
              orgao: `${licitacao.orgao ?? ""}${licitacao.uasg ? `  (UASG ${licitacao.uasg})` : ""}`,
              referencia: `${licitacao.modalidade || "Licitação"} nº ${licitacao.numero ?? ""}`,
            }
          : null,
        localData: r!.com_local_data ? { local: r!.local, data: r!.data || hojeIso() } : null,
        assinatura: r!.com_assinatura ? { nome: r!.assinante_nome, cpf: r!.assinante_cpf, cargo: r!.assinante_cargo } : null,
      },
      { logo, marcaDagua: !!empresa.marca_dagua, modelo: ehModeloPdf(visual.modelo) ? visual.modelo : "classico", cor: visual.cor },
    );
  }

  async function executar(acao: typeof ocupado, tarefa: () => Promise<void>) {
    setOcupado(acao);
    try {
      await tarefa();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setOcupado("");
    }
  }

  const mostrarPrevia = (visual?: { modelo: string; cor: string }) =>
    executar("previa", async () => {
      const bytes = await montar(visual);
      const urls: string[] = [];
      const conteudo = montarConteudo(nomeArquivo(r!.titulo), bytes, urls);
      setPrevia((antiga) => {
        antiga?.urls.forEach((u) => URL.revokeObjectURL(u));
        return { conteudo, urls };
      });
    });

  const baixar = () =>
    executar("baixar", async () => {
      const bytes = await montar();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = semAcento(nomeArquivo(r!.titulo));
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

  const vaiParaLicitacao = !!licitacao && salvarLicitacao && r.guardar_na_licitacao;

  const salvarNaLicitacao = () =>
    executar("salvar", async () => {
      if (!licitacao) return;
      const bytes = await montar();
      const dados = new FormData();
      dados.set("arquivo", new Blob([bytes as BlobPart], { type: "application/pdf" }), nomeArquivo(r!.titulo));
      dados.set("licitacao_id", String(licitacao.id));
      dados.set("categoria", r!.categoria);
      await enviarArquivo("/arquivos", dados);
      avisar(`Documento guardado na licitação ${licitacao.numero ?? ""}.`);
    });

  const prepararAssinatura = () =>
    executar("assinar", async () => {
      setAssinando(await montar());
    });

  async function aoAssinado(pdf: Uint8Array, pedido: string) {
    const nome = nomeArquivo(r!.titulo).replace(/\.pdf$/, " (assinado).pdf");
    const dados = new FormData();
    dados.set("arquivo", new Blob([pdf as BlobPart], { type: "application/pdf" }), nome);
    dados.set("pedido_assinatura", pedido);
    if (vaiParaLicitacao) {
      dados.set("licitacao_id", String(licitacao!.id));
      dados.set("categoria", r!.categoria);
      await enviarArquivo("/arquivos", dados);
    } else {
      dados.set("nome", nome);
      await enviarArquivo("/assinaturas", dados);
    }
    const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = semAcento(nome);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setAssinando(null);
    avisar(vaiParaLicitacao ? `Assinado e guardado na licitação ${licitacao!.numero ?? ""}.` : 'Assinado. Ele fica em "Assinar documentos".');
  }

  if (!empresas.length)
    return (
      <section className="cartao">
        <Vazio icone={<FilePlus2 />} titulo="Cadastre a empresa primeiro">
          Os documentos usam o logo, o CNPJ e o responsável legal da empresa.{" "}
          {admin && (
            <a className="link-suave" {...link("/configuracoes/empresas")}>
              Ir para Configurações → Empresas
            </a>
          )}
        </Vazio>
      </section>
    );

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Documentação</span>
          <h1>Criar documentos</h1>
          <p className="texto-suave">Declarações, ofícios e cartas em PDF com o logo, os dados da empresa, o local, a data e a assinatura do responsável.</p>
        </div>
        <div className="linha-botoes">
          <button className="botao secundario" onClick={novoDocumento}>
            <RotateCcw /> Novo documento
          </button>
        </div>
      </div>

      <div className="criar-doc">
        <section className="cartao criar-doc-principal">
          <div className="grade-2">
            <label className="campo">
              <span>Empresa</span>
              <select value={String(r.empresa_id ?? "")} onChange={(e) => trocarEmpresa(Number(e.target.value))} aria-label="Empresa">
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </label>
            {biblioteca.length > 0 && (
              <label className="campo">
                <span>
                  <BookText size={13} /> Começar de uma declaração pronta
                </span>
                <select value="" onChange={(e) => e.target.value && usarDaBiblioteca(Number(e.target.value))} aria-label="Declaração da biblioteca">
                  <option value="">Escolha na biblioteca…</option>
                  {biblioteca.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.titulo || d.texto.slice(0, 70)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="campo">
            <span>Título</span>
            <span className="entrada"><input value={r.titulo} onChange={(e) => mudar({ titulo: e.target.value })} placeholder="Ex.: Declaração de inexistência de fato impeditivo" aria-label="Título" /></span>
          </label>

          <label className="campo">
            <span>Texto</span>
            <textarea
              ref={textoRef}
              rows={12}
              value={r.texto}
              onChange={(e) => mudar({ texto: e.target.value })}
              placeholder={"Ex.: A empresa {empresa}, inscrita no CNPJ sob o nº {cnpj}, por intermédio de seu representante legal, {representante}, portador do CPF nº {cpf}, DECLARA, para os devidos fins, que…"}
              aria-label="Texto"
            />
          </label>
          <div className="campos-documento">
            <span className="texto-fraco pequeno">Colocar no texto:</span>
            {CAMPOS.filter((c) => !c.licitacao || licitacao).map((c) => (
              <button key={c.chave} type="button" className="chip-filtro" onClick={() => inserirCampo(c.chave)} title={valores[c.chave] || "Sem dado cadastrado"}>
                {c.rotulo}
              </button>
            ))}
          </div>
          <p className="texto-fraco pequeno" style={{ margin: 0 }}>
            Os campos entre chaves, como {"{empresa}"} e {"{cnpj}"}, viram os dados da empresa no PDF.
            {camposFaltando.length > 0 && <strong className="aviso-campos"> Sem dado para: {camposFaltando.map((k) => `{${k}}`).join(", ")}.</strong>}
          </p>
        </section>

        <aside className="criar-doc-lateral">
          {verLicitacoes && (
            <section className="cartao">
              <h2>
                <Landmark size={16} /> Para uma licitação? <small className="texto-fraco">(opcional)</small>
              </h2>
              <label className="campo">
                <span>Licitação</span>
                <select value={String(r.licitacao_id ?? "")} onChange={(e) => mudar({ licitacao_id: e.target.value ? Number(e.target.value) : null })} aria-label="Licitação">
                  <option value="">Nenhuma</option>
                  {licitacoes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.numero ?? "s/ nº"} · {(l.orgao ?? "").slice(0, 50)}
                    </option>
                  ))}
                </select>
              </label>
              {licitacao && (
                <>
                  <p className="texto-fraco pequeno" style={{ margin: "8px 0 0" }}>
                    O PDF sai com "Ao(À): {licitacao.orgao}" e "Referente: {licitacao.modalidade || "Licitação"} nº {licitacao.numero}".
                  </p>
                  {salvarLicitacao && (
                    <div className="opcoes-licitacao-doc">
                      <Interruptor ligado={r.guardar_na_licitacao} aoMudar={(v) => mudar({ guardar_na_licitacao: v })} rotulo="Guardar o assinado nos arquivos da licitação" />
                      <label className="campo">
                        <span>Categoria</span>
                        <select value={r.categoria} onChange={(e) => mudar({ categoria: e.target.value })} aria-label="Categoria">
                          {CATEGORIAS_ARQUIVO.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <section className="cartao">
            <h2>Local, data e assinatura</h2>
            <Interruptor ligado={r.com_local_data} aoMudar={(v) => mudar({ com_local_data: v })} rotulo="Colocar local e data" />
            {r.com_local_data && (
              <div className="grade-2">
                <label className="campo">
                  <span>Local</span>
                  <span className="entrada"><input value={r.local} onChange={(e) => mudar({ local: e.target.value })} placeholder={LOCAL_PADRAO} aria-label="Local" /></span>
                </label>
                <div className="campo">
                  <span>Data</span>
                  <SeletorData valor={r.data} aoMudar={(v) => mudar({ data: v })} rotulo="Data" />
                </div>
              </div>
            )}
            <Interruptor ligado={r.com_assinatura} aoMudar={(v) => mudar({ com_assinatura: v })} rotulo="Colocar o campo de assinatura do responsável" />
            {r.com_assinatura && (
              <div className="campos-assinante">
                <label className="campo">
                  <span>Responsável legal</span>
                  <span className="entrada"><input value={r.assinante_nome} onChange={(e) => mudar({ assinante_nome: e.target.value })} aria-label="Nome do responsável" /></span>
                </label>
                <div className="grade-2">
                  <label className="campo">
                    <span>CPF</span>
                    <span className="entrada"><input value={r.assinante_cpf} onChange={(e) => mudar({ assinante_cpf: e.target.value })} aria-label="CPF do responsável" /></span>
                  </label>
                  <label className="campo">
                    <span>Cargo</span>
                    <span className="entrada"><input value={r.assinante_cargo} onChange={(e) => mudar({ assinante_cargo: e.target.value })} aria-label="Cargo do responsável" /></span>
                  </label>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>

      <section className="cartao">
        <h2>Visual e gerar</h2>
        <EscolherModeloPdf modelo={r.modelo} cor={r.cor} aoMudar={(n) => mudar({ ...(n.modelo ? { modelo: n.modelo } : {}), ...(n.cor ? { cor: n.cor } : {}) })} />
        <div className="botoes-proposta">
          <button className="botao secundario" onClick={() => mostrarPrevia()} disabled={!pronto || !!ocupado}>
            <Eye /> {ocupado === "previa" ? "Montando…" : "Pré-visualizar"}
          </button>
          <button className="botao secundario" onClick={baixar} disabled={!pronto || !!ocupado}>
            <Download /> {ocupado === "baixar" ? "Montando…" : "Baixar PDF"}
          </button>
          {licitacao && salvarLicitacao && (
            <button className="botao secundario" onClick={salvarNaLicitacao} disabled={!pronto || !!ocupado}>
              <Save /> {ocupado === "salvar" ? "Guardando…" : "Guardar na licitação (sem assinar)"}
            </button>
          )}
          <button
            className="botao acento"
            onClick={prepararAssinatura}
            disabled={!pronto || !!ocupado || !podeAssinar || !certificadoPronto}
            title={!podeAssinar ? "Você não tem permissão para assinar." : !certificadoPronto ? "Certificado digital indisponível." : ""}
          >
            <PenLine /> {ocupado === "assinar" ? "Preparando…" : "Assinar com o certificado"}
          </button>
        </div>
        {!pronto && <p className="texto-fraco pequeno nota-proposta">Preencha o título e o texto para gerar.</p>}
        {pronto && podeAssinar && !certificadoPronto && (
          <p className="texto-fraco pequeno nota-proposta">
            Para assinar, cadastre o certificado digital.{" "}
            {admin && (
              <a className="link-suave" {...link("/configuracoes/certificado")}>
                <Settings size={12} /> Configurar
              </a>
            )}
          </p>
        )}
      </section>

      {previa && (
        <Modal
          titulo={`Pré-visualização · ${r.titulo || "Documento"}`}
          aoFechar={() => {
            previa.urls.forEach((u) => URL.revokeObjectURL(u));
            setPrevia(null);
          }}
          largo
        >
          <div className="previa-proposta">
            <EscolherModeloPdf
              modelo={r.modelo}
              cor={r.cor}
              aoMudar={(n) => {
                const visual = { modelo: n.modelo ?? r.modelo, cor: n.cor ?? r.cor };
                mudar(visual);
                mostrarPrevia(visual);
              }}
            />
            {ocupado === "previa" ? <p className="texto-fraco carregando-linha">Montando o PDF…</p> : <Visor conteudo={previa.conteudo} />}
          </div>
        </Modal>
      )}

      {assinando && (
        <Suspense fallback={null}>
          <ModalAssinar
            titulo={`Assinar "${r.titulo || "Documento"}"`}
            carregar={async () => assinando}
            opcoes={{ motivo: r.titulo || "Documento assinado digitalmente", local: r.local || undefined }}
            aoAssinado={aoAssinado}
            aoFechar={() => setAssinando(null)}
          />
        </Suspense>
      )}
    </>
  );
}
