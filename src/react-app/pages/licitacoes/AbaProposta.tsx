import { Download, Eye, FileText, FileType, PenLine, Settings, ShieldCheck, Upload } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { calcularPreco } from "../../../shared/negocio";
import { podeEditar } from "../../../shared/permissoes";
import type { Arquivo, CertificadoInfo, Configuracoes, ContaBancaria, Cotacao, ItemLicitacao, Licitacao, ModeloProposta, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Campo } from "../../components/Formulario";
import { avisar, CampoArea, CampoSelect, Carregando, SeloAssinado, Vazio } from "../../components/Ui";
import { formatarData, formatarMoeda, formatarNumero, paraNumero } from "../../formato";
import { link } from "../../rota";
import { enviarProposta, montarPdf, montarWord, type RespostaDados } from "../../proposta/gerar";

const ModalAssinar = lazy(() => import("../../assinatura/ModalAssinar").then((m) => ({ default: m.ModalAssinar })));

type Assinatura = { titulo: string; nome: string; carregar: () => Promise<Uint8Array> };

type Linha = { incluir: boolean; marca: string; valor: string };

export function AbaProposta({
  licitacao,
  itens,
  cotacoes,
  arquivos,
  usuario,
  aoMudar,
}: {
  licitacao: Licitacao;
  itens: ItemLicitacao[];
  cotacoes: Cotacao[];
  arquivos: Arquivo[];
  usuario: Usuario;
  aoMudar: () => Promise<void> | void;
}) {
  const [modelos, setModelos] = useState<ModeloProposta[] | null>(null);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [modeloId, setModeloId] = useState("");
  const [contaId, setContaId] = useState("");
  const [validade, setValidade] = useState("60");
  const [prazo, setPrazo] = useState("");
  const [garantia, setGarantia] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [gerando, setGerando] = useState<"" | "docx" | "pdf" | "assinado">("");
  const [certificado, setCertificado] = useState<CertificadoInfo | null>(null);
  const podeAssinar = podeEditar(usuario.permissoes, "assinatura");
  const [assinando, setAssinando] = useState<Assinatura | null>(null);
  const [cidade, setCidade] = useState("");
  const entradaPdf = useRef<HTMLInputElement>(null);
  const participando = itens.filter((i) => i.participar);

  // Sugestão por item: a cotação mais barata (marca e preço de venda).
  const sugestoes = useMemo(() => {
    const mapa = new Map<number, { marca: string; valor: number }>();
    for (const item of participando) {
      const opcoes = cotacoes
        .filter((c) => c.item_id === item.id)
        .map((c) => ({
          c,
          preco: calcularPreco({
            custoUnitario: c.custo_unitario ?? 0,
            frete: c.frete ?? 0,
            quantidade: item.quantidade ?? 1,
            impostoPercentual: licitacao.imposto_percentual,
            lucroPercentual: licitacao.lucro_percentual,
          }).precoVenda,
        }));
      if (opcoes.length === 0) continue;
      const melhor = opcoes.reduce((a, b) => (b.preco < a.preco ? b : a));
      mapa.set(item.id, { marca: [melhor.c.marca, melhor.c.produto].filter(Boolean).join(" — "), valor: melhor.preco });
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, cotacoes, licitacao.imposto_percentual, licitacao.lucro_percentual]);

  const [linhas, setLinhas] = useState<Record<number, Linha>>({});
  useEffect(() => {
    setLinhas(
      Object.fromEntries(
        participando.map((i) => {
          const s = sugestoes.get(i.id);
          return [i.id, { incluir: true, marca: s?.marca ?? "", valor: s ? s.valor.toFixed(2) : "" }];
        }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugestoes]);

  useEffect(() => {
    Promise.all([
      api<{ modelos: ModeloProposta[] }>("/propostas/modelos"),
      api<{ contas: ContaBancaria[] }>("/propostas/contas"),
      api<{ configuracoes: Configuracoes }>("/configuracoes"),
      api<{ certificado: CertificadoInfo }>("/certificado").catch(() => ({ certificado: null })),
    ]).then(
      ([m, c, cfg, cert]) => {
        setCertificado(cert.certificado);
        setModelos(m.modelos);
        setContas(c.contas);
        setModeloId(String(m.modelos.find((x) => x.padrao)?.id ?? m.modelos[0]?.id ?? ""));
        setContaId(String(c.contas.find((x) => x.padrao)?.id ?? c.contas[0]?.id ?? ""));
        setValidade(String(cfg.configuracoes.validade_proposta_padrao ?? 60));
        setCidade(cfg.configuracoes.empresa_cidade ?? "");
      },
      (err) => avisar(mensagemDeErro(err), "erro"),
    );
  }, []);

  const mudar = (id: number, novo: Partial<Linha>) => setLinhas((l) => ({ ...l, [id]: { ...l[id], ...novo } }));
  const escolhidos = participando.filter((i) => linhas[i.id]?.incluir);
  const total = escolhidos.reduce((s, i) => s + (paraNumero(linhas[i.id].valor) ?? 0) * (i.quantidade ?? 0), 0);
  const semPreco = escolhidos.filter((i) => paraNumero(linhas[i.id].valor) == null);
  const anteriores = arquivos.filter((a) => a.categoria === "Proposta");
  const prontoParaGerar = escolhidos.length > 0 && semPreco.length === 0;

  const certificadoPronto = !!certificado?.configurado && certificado.segredo_configurado && (certificado.dias_restantes ?? 0) >= 0;
  const motivoSemAssinatura = !podeAssinar
    ? "Você não tem permissão para assinar com o certificado da empresa."
    : !certificado?.configurado
      ? "Nenhum certificado digital cadastrado (Configurações → Certificado digital)."
      : !certificado.segredo_configurado
        ? "A assinatura ainda não foi ativada no servidor."
        : (certificado.dias_restantes ?? 0) < 0
          ? "O certificado da empresa venceu."
          : "";

  async function pedirDados(tipo: "docx" | "pdf" | "assinado") {
    return api<RespostaDados>(`/licitacoes/${licitacao.id}/proposta`, {
      corpo: {
        modelo_id: tipo === "docx" ? Number(modeloId) : null,
        conta_id: contaId ? Number(contaId) : null,
        validade_dias: Number(validade),
        prazo_entrega: prazo,
        garantia,
        observacoes,
        itens: escolhidos.map((i) => ({ item_id: i.id, marca: linhas[i.id].marca, valor_unitario: paraNumero(linhas[i.id].valor) })),
      },
    });
  }

  async function gerar(tipo: "docx" | "pdf" | "assinado") {
    setGerando(tipo);
    try {
      const r = await pedirDados(tipo);
      if (tipo === "docx") {
        const bytes = await montarWord(r);
        const { arquivo } = await enviarProposta(licitacao.id, bytes, "docx", { nome: r.nome, modelo: r.modelo?.nome });
        window.location.href = `/api/arquivos/${arquivo.id}?baixar=1`;
        avisar("Proposta em Word gerada e salva nos arquivos da licitação.");
        await aoMudar();
      } else if (tipo === "pdf") {
        const bytes = await montarPdf(r);
        const { arquivo } = await enviarProposta(licitacao.id, bytes, "pdf", { nome: r.nome });
        window.open(`/api/arquivos/${arquivo.id}`, "_blank", "noopener");
        avisar("Proposta em PDF gerada e salva nos arquivos da licitação.");
        await aoMudar();
      } else {
        const bytes = await montarPdf(r);
        setAssinando({ titulo: "Assinar a proposta", nome: r.nome, carregar: async () => bytes });
      }
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setGerando("");
    }
  }

  function escolherPdfPronto(arquivo: File) {
    if (arquivo.type !== "application/pdf" && !/\.pdf$/i.test(arquivo.name)) {
      avisar("Escolha um arquivo PDF.", "erro");
      return;
    }
    const nome = arquivo.name.replace(/\.pdf$/i, "").slice(0, 110);
    setAssinando({ titulo: `Assinar "${arquivo.name}"`, nome, carregar: async () => new Uint8Array(await arquivo.arrayBuffer()) });
  }

  async function aoAssinado(pdf: Uint8Array, pedido: string) {
    if (!assinando) return;
    const { arquivo } = await enviarProposta(licitacao.id, pdf, "pdf", { nome: assinando.nome, pedido });
    setAssinando(null);
    window.open(`/api/arquivos/${arquivo.id}`, "_blank", "noopener");
    avisar("Proposta assinada digitalmente e salva nos arquivos.");
    await aoMudar();
  }

  if (modelos === null) return <Carregando />;

  return (
    <>
      <section className="cartao">
        <div className="cartao-titulo">
          <h2>
            <FileText size={17} /> Proposta comercial
          </h2>
          {usuario.papel === "admin" && (
            <a className="link-suave pequeno" {...link("/configuracoes/propostas")}>
              <Settings size={14} /> Modelos e contas
            </a>
          )}
        </div>
        <div className="grade-3">
          <CampoSelect
            rotulo="Modelo do Word"
            value={modeloId}
            onChange={(e) => setModeloId(e.target.value)}
            vazio={modelos.length ? undefined : "Nenhum (só PDF)"}
            opcoes={modelos.map((m) => ({ valor: String(m.id), texto: m.nome }))}
          />
          <CampoSelect
            rotulo="Banco para pagamento"
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
            vazio={contas.length ? "Nenhum" : "Cadastre em Configurações"}
            opcoes={contas.map((c) => ({ valor: String(c.id), texto: `${c.apelido} · ${c.banco}${c.agencia ? ` ag. ${c.agencia}` : ""}` }))}
          />
          <Campo rotulo="Validade da proposta (dias)" name="validade" type="number" min="1" max="365" value={validade} onChange={(e) => setValidade(e.target.value)} />
        </div>
        <div className="grade-2" style={{ marginTop: 14 }}>
          <Campo rotulo="Prazo de entrega" name="prazo" placeholder="Ex.: 15 dias corridos após o empenho" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          <Campo rotulo="Garantia" name="garantia" placeholder="Ex.: 12 meses" value={garantia} onChange={(e) => setGarantia(e.target.value)} />
        </div>
        <div style={{ marginTop: 14 }}>
          <CampoArea rotulo="Observações" rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
        </div>
      </section>

      <section className="cartao">
        <div className="cartao-titulo">
          <h2>Itens da proposta</h2>
          <span className="texto-fraco pequeno">Preço sugerido = preço de venda da cotação mais barata</span>
        </div>
        {participando.length === 0 ? (
          <Vazio icone={<FileText />} titulo="Nenhum item para participar" />
        ) : (
          <div className="lista-proposta">
            {participando.map((i) => {
              const l = linhas[i.id];
              if (!l) return null;
              const valor = paraNumero(l.valor) ?? 0;
              return (
                <div key={i.id} className={`linha-proposta ${l.incluir ? "" : "fora"}`}>
                  <input type="checkbox" checked={l.incluir} onChange={(e) => mudar(i.id, { incluir: e.target.checked })} aria-label={`Incluir item ${i.numero}`} />
                  <span className="numero-item">{i.numero || "—"}</span>
                  <span className="linha-proposta-descricao">
                    {i.descricao || "Sem descrição"}
                    <small className="texto-fraco">
                      {formatarNumero(i.quantidade)} {i.unidade}
                    </small>
                  </span>
                  <div className="entrada">
                    <input value={l.marca} onChange={(e) => mudar(i.id, { marca: e.target.value })} placeholder="Marca / modelo" aria-label="Marca" />
                  </div>
                  <div className="entrada">
                    <input type="number" step="0.01" min="0" value={l.valor} onChange={(e) => mudar(i.id, { valor: e.target.value })} placeholder="Valor unit." aria-label="Valor unitário" />
                  </div>
                  <strong className="linha-proposta-total">{formatarMoeda(valor * (i.quantidade ?? 0))}</strong>
                </div>
              );
            })}
          </div>
        )}
        <div className="total-proposta">
          <span>
            {escolhidos.length} item(ns) · Valor global
          </span>
          <strong>{formatarMoeda(total)}</strong>
        </div>
        {semPreco.length > 0 && (
          <p className="texto-amarelo pequeno" style={{ margin: "10px 0 0" }}>
            Falta o valor de {semPreco.length} item(ns): {semPreco.map((i) => i.numero).join(", ")}.
          </p>
        )}
        <div className="botoes-proposta">
          <button className="botao secundario" onClick={() => gerar("docx")} disabled={!!gerando || !modeloId || !prontoParaGerar} title={modeloId ? "" : "Cadastre um modelo do Word em Configurações → Propostas"}>
            <FileType /> {gerando === "docx" ? "Gerando…" : "Word (.docx)"}
          </button>
          <button className="botao secundario" onClick={() => gerar("pdf")} disabled={!!gerando || !prontoParaGerar}>
            <FileText /> {gerando === "pdf" ? "Gerando…" : "PDF"}
          </button>
          <button
            className="botao acento"
            onClick={() => gerar("assinado")}
            disabled={!!gerando || !prontoParaGerar || !certificadoPronto || !podeAssinar}
            title={motivoSemAssinatura}
          >
            <PenLine /> {gerando === "assinado" ? "Assinando…" : "PDF assinado"}
          </button>
        </div>
        <p className="texto-fraco pequeno nota-proposta">
          {certificadoPronto && podeAssinar ? (
            <>
              <ShieldCheck size={14} /> O PDF assinado usa o certificado A1 de <strong>{certificado?.titular}</strong>
              {certificado?.documento ? ` (${certificado.documento})` : ""}.
            </>
          ) : (
            motivoSemAssinatura
          )}
          {modelos.length === 0 && (
            <>
              {" "}
              {usuario.papel === "admin" ? (
                <>
                  Para gerar em Word, envie seus modelos em{" "}
                  <a className="link-suave" {...link("/configuracoes/propostas")}>
                    Configurações → Propostas
                  </a>
                  .
                </>
              ) : (
                "Para gerar em Word, peça a um administrador para cadastrar os modelos."
              )}
            </>
          )}
        </p>
      </section>

      {podeAssinar && certificadoPronto && (
        <section className="cartao cartao-pdf-pronto">
          <div>
            <h2>
              <ShieldCheck size={17} /> Já tem a proposta pronta em PDF?
            </h2>
            <p className="texto-fraco pequeno" style={{ margin: "4px 0 0" }}>
              Gere em Word, ajuste e converta para PDF do seu jeito. Depois envie aqui: você escolhe onde fica o carimbo e a
              plataforma assina com o certificado da empresa.
            </p>
          </div>
          <button className="botao acento" onClick={() => entradaPdf.current?.click()}>
            <Upload /> Enviar PDF e assinar
          </button>
          <input
            ref={entradaPdf}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) escolherPdfPronto(f);
              e.target.value = "";
            }}
          />
        </section>
      )}

      {assinando && (
        <Suspense fallback={null}>
          <ModalAssinar
            titulo={assinando.titulo}
            carregar={assinando.carregar}
            opcoes={{ motivo: "Proposta comercial", local: cidade || "Brasil" }}
            aoAssinado={aoAssinado}
            aoFechar={() => setAssinando(null)}
          />
        </Suspense>
      )}

      {anteriores.length > 0 && (
        <section className="cartao">
          <h2>Propostas geradas</h2>
          <div className="lista-arquivos">
            {anteriores.map((a) => (
              <div key={a.id} className="linha-arquivo">
                <span className={`icone-redondo ${a.assinado_em ? "verde" : ""}`}>
                  {a.assinado_em ? <ShieldCheck /> : <FileText />}
                </span>
                <div className="arquivo-texto">
                  <strong className="arquivo-nome">{a.nome}</strong>
                  <span className="texto-fraco pequeno">
                    {formatarData(a.criado_em)}
                    {a.enviado_por_nome && ` · ${a.enviado_por_nome}`}
                  </span>
                  {a.assinado_em ? <SeloAssinado arquivo={a} /> : null}
                </div>
                {a.tipo_mime === "application/pdf" && (
                  <a className="botao secundario pequeno" href={`/api/arquivos/${a.id}`} target="_blank" rel="noopener">
                    <Eye /> Ver
                  </a>
                )}
                <a className="botao secundario pequeno" href={`/api/arquivos/${a.id}?baixar=1`}>
                  <Download /> Baixar
                </a>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
