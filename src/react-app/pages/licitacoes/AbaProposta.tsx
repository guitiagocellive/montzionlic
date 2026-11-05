import { Building2, Check, Download, Eye, FileCheck2, FileText, FileType, PenLine, Plus, Settings, ShieldCheck, Trash2, Upload } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { calcularPreco } from "../../../shared/negocio";
import { podeEditar } from "../../../shared/permissoes";
import type {
  Arquivo,
  CertificadoInfo,
  Configuracoes,
  ContaBancaria,
  Cotacao,
  Declaracao,
  Empresa,
  ItemLicitacao,
  Licitacao,
  ModeloProposta,
  RascunhoProposta,
  Usuario,
} from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Campo } from "../../components/Formulario";
import { avisar, CampoArea, CampoSelect, Carregando, SeloAssinado, Vazio } from "../../components/Ui";
import { formatarData, formatarMoeda, formatarNumero, paraNumero } from "../../formato";
import { enviarProposta, montarPdf, montarWord, type RespostaDados } from "../../proposta/gerar";
import { link } from "../../rota";

const ModalAssinar = lazy(() => import("../../assinatura/ModalAssinar").then((m) => ({ default: m.ModalAssinar })));

type Assinatura = { titulo: string; nome: string; carregar: () => Promise<Uint8Array> };
type Linha = RascunhoProposta["itens"][string];

const hojeIso = () => {
  const d = new Date(Date.now() - 3 * 3600_000);
  return d.toISOString().slice(0, 10);
};

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
  const admin = usuario.papel === "admin";
  const podeAssinar = podeEditar(usuario.permissoes, "assinatura");
  const participando = itens.filter((i) => i.participar);

  const [listas, setListas] = useState<{
    empresas: Empresa[];
    contas: ContaBancaria[];
    modelos: ModeloProposta[];
    declaracoes: Declaracao[];
    certificado: CertificadoInfo | null;
  } | null>(null);
  const [r, setR] = useState<RascunhoProposta | null>(null);
  const [salvo, setSalvo] = useState<"" | "salvando" | "salvo">("");
  const [gerando, setGerando] = useState<"" | "docx" | "pdf" | "assinado">("");
  const [assinando, setAssinando] = useState<Assinatura | null>(null);
  const entradaPdf = useRef<HTMLInputElement>(null);
  const carregado = useRef(false);

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
      mapa.set(item.id, { marca: melhor.c.marca || melhor.c.produto || "", valor: melhor.preco });
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, cotacoes, licitacao.imposto_percentual, licitacao.lucro_percentual]);

  const linhaPadrao = (i: ItemLicitacao): Linha => {
    const s = sugestoes.get(i.id);
    return { incluir: true, marca: s?.marca ?? "", valor: s ? s.valor.toFixed(2) : "", descricao: i.descricao ?? "" };
  };

  // Carrega tudo e o rascunho salvo desta licitação (ou monta um novo com os padrões).
  useEffect(() => {
    Promise.all([
      api<{ empresas: Empresa[] }>("/empresas"),
      api<{ contas: ContaBancaria[] }>("/propostas/contas"),
      api<{ modelos: ModeloProposta[] }>("/propostas/modelos"),
      api<{ declaracoes: Declaracao[] }>("/propostas/declaracoes"),
      api<{ configuracoes: Configuracoes }>("/configuracoes"),
      api<{ certificado: CertificadoInfo }>("/certificado").catch(() => ({ certificado: null })),
      api<{ rascunho: RascunhoProposta | null; sugestao_numero: string }>(`/licitacoes/${licitacao.id}/proposta/rascunho`),
    ]).then(
      ([e, c, m, d, cfg, cert, rasc]) => {
        setListas({ empresas: e.empresas, contas: c.contas, modelos: m.modelos, declaracoes: d.declaracoes, certificado: cert.certificado });
        const empresa = e.empresas.find((x) => x.padrao) ?? e.empresas[0];
        const contasEmpresa = c.contas.filter((x) => !x.empresa_id || x.empresa_id === empresa?.id);
        const novo: RascunhoProposta = {
          empresa_id: empresa?.id ?? null,
          conta_id: (contasEmpresa.find((x) => x.padrao) ?? contasEmpresa[0])?.id ?? null,
          modelo_id: (m.modelos.find((x) => x.padrao) ?? m.modelos[0])?.id ?? null,
          contratacao: licitacao.numero ?? "",
          numero: rasc.sugestao_numero,
          data: hojeIso(),
          validade_dias: String(cfg.configuracoes.validade_proposta_padrao ?? 60),
          prazo_entrega: "",
          garantia: "",
          observacoes: "",
          declaracoes: d.declaracoes.filter((x) => x.padrao).map((x) => x.id),
          extras: [],
          itens: {},
        };
        const base = rasc.rascunho ? { ...novo, ...rasc.rascunho } : novo;
        // Itens: mantém o que foi digitado e completa os que entraram depois.
        const itensRascunho: RascunhoProposta["itens"] = {};
        for (const i of participando) itensRascunho[i.id] = base.itens?.[i.id] ? { ...linhaPadrao(i), ...base.itens[i.id] } : linhaPadrao(i);
        setR({ ...base, data: rasc.rascunho?.data || hojeIso(), itens: itensRascunho });
      },
      (err) => avisar(mensagemDeErro(err), "erro"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licitacao.id]);

  // Salva o rascunho sozinho, um instante depois de cada mudança.
  useEffect(() => {
    if (!r) return;
    if (!carregado.current) {
      carregado.current = true;
      return;
    }
    setSalvo("salvando");
    const t = setTimeout(() => {
      api(`/licitacoes/${licitacao.id}/proposta/rascunho`, { metodo: "PUT", corpo: { rascunho: r } }).then(
        () => setSalvo("salvo"),
        () => setSalvo(""),
      );
    }, 900);
    return () => clearTimeout(t);
  }, [r, licitacao.id]);

  if (!listas || !r) return <Carregando />;

  const mudar = (novo: Partial<RascunhoProposta>) => setR((atual) => (atual ? { ...atual, ...novo } : atual));
  const mudarItem = (id: number, novo: Partial<Linha>) => setR((atual) => (atual ? { ...atual, itens: { ...atual.itens, [id]: { ...atual.itens[id], ...novo } } } : atual));

  const { empresas, contas, modelos, declaracoes, certificado } = listas;
  const contasEmpresa = contas.filter((c) => !c.empresa_id || c.empresa_id === r.empresa_id);
  const escolhidos = participando.filter((i) => r.itens[i.id]?.incluir);
  const total = escolhidos.reduce((s, i) => s + (paraNumero(r.itens[i.id].valor) ?? 0) * (i.quantidade ?? 0), 0);
  const semPreco = escolhidos.filter((i) => paraNumero(r.itens[i.id].valor) == null);
  const anteriores = arquivos.filter((a) => a.categoria === "Proposta");
  const empresaAtual = empresas.find((e) => e.id === r.empresa_id);
  const prontoParaGerar = !!empresaAtual && escolhidos.length > 0 && semPreco.length === 0;
  const condicoes = declaracoes.filter((d) => d.tipo === "condicao");
  const declaracoesLista = declaracoes.filter((d) => d.tipo === "declaracao");
  const marcadas = new Set(r.declaracoes);

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

  function alternarDeclaracao(id: number, ligar: boolean) {
    mudar({ declaracoes: ligar ? [...r!.declaracoes.filter((x) => x !== id), id] : r!.declaracoes.filter((x) => x !== id) });
  }

  function trocarEmpresa(id: number | null) {
    const permitidas = contas.filter((c) => !c.empresa_id || c.empresa_id === id);
    const contaOk = permitidas.some((c) => c.id === r!.conta_id);
    mudar({ empresa_id: id, conta_id: contaOk ? r!.conta_id : ((permitidas.find((c) => c.padrao) ?? permitidas[0])?.id ?? null) });
  }

  async function pedirDados(tipo: "docx" | "pdf" | "assinado") {
    return api<RespostaDados>(`/licitacoes/${licitacao.id}/proposta`, {
      corpo: {
        empresa_id: r!.empresa_id,
        modelo_id: tipo === "docx" ? r!.modelo_id : null,
        conta_id: r!.conta_id,
        contratacao: r!.contratacao,
        numero: r!.numero,
        data: r!.data,
        validade_dias: Number(r!.validade_dias),
        prazo_entrega: r!.prazo_entrega,
        garantia: r!.garantia,
        observacoes: r!.observacoes,
        declaracoes: r!.declaracoes,
        extras: r!.extras,
        itens: escolhidos.map((i) => ({
          item_id: i.id,
          marca: r!.itens[i.id].marca,
          descricao: r!.itens[i.id].descricao,
          valor_unitario: paraNumero(r!.itens[i.id].valor),
        })),
      },
    });
  }

  async function gerar(tipo: "docx" | "pdf" | "assinado") {
    setGerando(tipo);
    try {
      const dados = await pedirDados(tipo);
      if (tipo === "docx") {
        const bytes = await montarWord(dados);
        const { arquivo } = await enviarProposta(licitacao.id, bytes, "docx", { nome: dados.nome, modelo: dados.modelo?.nome });
        window.location.href = `/api/arquivos/${arquivo.id}?baixar=1`;
        avisar("Proposta em Word gerada e salva nos arquivos da licitação.");
        await aoMudar();
      } else if (tipo === "pdf") {
        const bytes = await montarPdf(dados);
        const { arquivo } = await enviarProposta(licitacao.id, bytes, "pdf", { nome: dados.nome });
        window.open(`/api/arquivos/${arquivo.id}`, "_blank", "noopener");
        avisar("Proposta em PDF gerada e salva nos arquivos da licitação.");
        await aoMudar();
      } else {
        const bytes = await montarPdf(dados);
        setAssinando({ titulo: "Assinar a proposta", nome: dados.nome, carregar: async () => bytes });
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

  return (
    <>
      {/* 1. Empresa e pagamento */}
      <section className="cartao">
        <div className="cartao-titulo">
          <h2>
            <Building2 size={17} /> Empresa e pagamento
          </h2>
          <span className={`salvo-rascunho ${salvo}`}>
            {salvo === "salvando" ? "Salvando…" : salvo === "salvo" ? (
              <>
                <Check size={13} /> Rascunho salvo
              </>
            ) : null}
          </span>
        </div>
        {empresas.length === 0 ? (
          <Vazio icone={<Building2 />} titulo="Nenhuma empresa cadastrada">
            {admin ? (
              <>
                Cadastre em{" "}
                <a className="link-suave" {...link("/configuracoes/empresas")}>
                  Configurações → Empresas
                </a>
                .
              </>
            ) : (
              "Peça a um administrador para cadastrar a empresa."
            )}
          </Vazio>
        ) : (
          <div className="grade-3">
            <CampoSelect
              rotulo="Empresa participante"
              value={String(r.empresa_id ?? "")}
              onChange={(e) => trocarEmpresa(e.target.value ? Number(e.target.value) : null)}
              opcoes={empresas.map((e) => ({ valor: String(e.id), texto: e.nome }))}
            />
            <CampoSelect
              rotulo="Banco para pagamento"
              value={String(r.conta_id ?? "")}
              onChange={(e) => mudar({ conta_id: e.target.value ? Number(e.target.value) : null })}
              vazio={contasEmpresa.length ? "Nenhum" : "Cadastre em Configurações"}
              opcoes={contasEmpresa.map((c) => ({ valor: String(c.id), texto: `${c.apelido} · ${c.banco}${c.agencia ? ` ag. ${c.agencia}` : ""}` }))}
            />
            <CampoSelect
              rotulo="Modelo do Word (opcional)"
              value={String(r.modelo_id ?? "")}
              onChange={(e) => mudar({ modelo_id: e.target.value ? Number(e.target.value) : null })}
              vazio={modelos.length ? "Nenhum" : "Nenhum (só PDF)"}
              opcoes={modelos.map((m) => ({ valor: String(m.id), texto: m.nome }))}
            />
          </div>
        )}
        {admin && (
          <a className="link-suave pequeno" style={{ display: "inline-flex", gap: 6, marginTop: 10 }} {...link("/configuracoes/empresas")}>
            <Settings size={14} /> Empresas, bancos e declarações
          </a>
        )}
      </section>

      {/* 2. Dados da proposta */}
      <section className="cartao">
        <h2>Dados da proposta</h2>
        <div className="grade-3">
          <Campo rotulo="Nº da contratação" name="contratacao" value={r.contratacao} onChange={(e) => mudar({ contratacao: e.target.value })} />
          <Campo rotulo="Nº da proposta" name="numero" value={r.numero} onChange={(e) => mudar({ numero: e.target.value })} placeholder="Ex.: 065/2026" />
          <Campo rotulo="Data da proposta" name="data" type="date" value={r.data} onChange={(e) => mudar({ data: e.target.value })} />
        </div>
        <div className="grade-3" style={{ marginTop: 14 }}>
          <Campo rotulo="Validade (dias)" name="validade" type="number" min="1" max="365" value={r.validade_dias} onChange={(e) => mudar({ validade_dias: e.target.value })} />
          <Campo rotulo="Prazo de entrega" name="prazo" placeholder="Ex.: 30 (trinta) dias" value={r.prazo_entrega} onChange={(e) => mudar({ prazo_entrega: e.target.value })} />
          <Campo rotulo="Garantia" name="garantia" placeholder="Ex.: 12 meses" value={r.garantia} onChange={(e) => mudar({ garantia: e.target.value })} />
        </div>
        <div style={{ marginTop: 14 }}>
          <CampoArea rotulo="Observações" rows={2} value={r.observacoes} onChange={(e) => mudar({ observacoes: e.target.value })} />
        </div>
      </section>

      {/* 3. Itens */}
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
              const l = r.itens[i.id];
              if (!l) return null;
              const valor = paraNumero(l.valor) ?? 0;
              return (
                <div key={i.id} className={`linha-proposta ${l.incluir ? "" : "fora"}`}>
                  <input type="checkbox" checked={l.incluir} onChange={(e) => mudarItem(i.id, { incluir: e.target.checked })} aria-label={`Incluir item ${i.numero}`} />
                  <span className="numero-item">{i.numero || "—"}</span>
                  <span className="linha-proposta-descricao">
                    <textarea
                      className="descricao-item"
                      rows={2}
                      value={l.descricao}
                      onChange={(e) => mudarItem(i.id, { descricao: e.target.value })}
                      placeholder="Produto ofertado"
                      aria-label="Descrição do produto ofertado"
                    />
                    <small className="texto-fraco">
                      {formatarNumero(i.quantidade)} {i.unidade}
                    </small>
                  </span>
                  <div className="entrada">
                    <input value={l.marca} onChange={(e) => mudarItem(i.id, { marca: e.target.value })} placeholder="Marca" aria-label="Marca" />
                  </div>
                  <div className="entrada">
                    <input type="number" step="0.01" min="0" value={l.valor} onChange={(e) => mudarItem(i.id, { valor: e.target.value })} placeholder="Valor unit." aria-label="Valor unitário" />
                  </div>
                  <strong className="linha-proposta-total">{formatarMoeda(valor * (i.quantidade ?? 0))}</strong>
                </div>
              );
            })}
          </div>
        )}
        <div className="total-proposta">
          <span>{escolhidos.length} item(ns) · Valor global</span>
          <strong>{formatarMoeda(total)}</strong>
        </div>
        {semPreco.length > 0 && (
          <p className="texto-amarelo pequeno" style={{ margin: "10px 0 0" }}>
            Falta o valor de {semPreco.length} item(ns): {semPreco.map((i) => i.numero).join(", ")}.
          </p>
        )}
      </section>

      {/* 4. Declarações */}
      <section className="cartao">
        <div className="cartao-titulo">
          <h2>
            <FileCheck2 size={17} /> Declarações e condições
          </h2>
          <span className="texto-fraco pequeno">
            {r.declaracoes.filter((id) => declaracoes.some((d) => d.id === id)).length + r.extras.length} na proposta
          </span>
        </div>
        {[
          { titulo: "Condições", itens: condicoes },
          { titulo: "Declarações", itens: declaracoesLista },
        ].map((g) =>
          g.itens.length ? (
            <div key={g.titulo} className="grupo-declaracoes">
              <div className="grupo-declaracoes-topo">
                <strong className="pequeno">{g.titulo}</strong>
                <button className="botao link pequeno" onClick={() => mudar({ declaracoes: [...new Set([...r.declaracoes, ...g.itens.map((d) => d.id)])] })}>
                  Marcar todas
                </button>
                <button className="botao link pequeno" onClick={() => mudar({ declaracoes: r.declaracoes.filter((id) => !g.itens.some((d) => d.id === id)) })}>
                  Desmarcar
                </button>
              </div>
              {g.itens.map((d) => (
                <label key={d.id} className={`opcao-declaracao ${marcadas.has(d.id) ? "marcada" : ""}`} title={d.texto}>
                  <input type="checkbox" checked={marcadas.has(d.id)} onChange={(e) => alternarDeclaracao(d.id, e.target.checked)} />
                  <span>{d.titulo}</span>
                </label>
              ))}
            </div>
          ) : null,
        )}

        <div className="grupo-declaracoes">
          <div className="grupo-declaracoes-topo">
            <strong className="pequeno">Só desta licitação</strong>
          </div>
          {r.extras.map((x, idx) => (
            <div key={idx} className="declaracao-extra">
              <div className="declaracao-extra-topo">
                <input
                  className="titulo-extra"
                  value={x.titulo}
                  onChange={(e) => mudar({ extras: r.extras.map((y, j) => (j === idx ? { ...y, titulo: e.target.value } : y)) })}
                  placeholder="Título (ex.: DECLARAÇÃO DE ...)"
                  aria-label="Título da declaração"
                />
                <button className="botao-icone perigo" onClick={() => mudar({ extras: r.extras.filter((_, j) => j !== idx) })} aria-label="Remover declaração">
                  <Trash2 />
                </button>
              </div>
              <textarea
                rows={3}
                value={x.texto}
                onChange={(e) => mudar({ extras: r.extras.map((y, j) => (j === idx ? { ...y, texto: e.target.value } : y)) })}
                placeholder="Texto da declaração"
                aria-label="Texto da declaração"
              />
            </div>
          ))}
          <button className="botao secundario pequeno" onClick={() => mudar({ extras: [...r.extras, { titulo: "", texto: "" }] })}>
            <Plus /> Declaração só desta licitação
          </button>
        </div>
      </section>

      {/* 5. Gerar */}
      <section className="cartao">
        <h2>Gerar a proposta</h2>
        <p className="texto-fraco pequeno" style={{ margin: "0 0 4px" }}>
          O PDF sai completo, com logo, dados da empresa, banco, representante, itens, condições, declarações e a data. Para imprimir
          ou salvar, é só abrir o PDF.
        </p>
        <div className="botoes-proposta">
          <button
            className="botao secundario"
            onClick={() => gerar("docx")}
            disabled={!!gerando || !r.modelo_id || !prontoParaGerar}
            title={r.modelo_id ? "" : "Escolha um modelo do Word acima"}
          >
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
            <PenLine /> {gerando === "assinado" ? "Preparando…" : "PDF assinado"}
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
            opcoes={{ motivo: "Proposta comercial", local: empresaAtual?.cidade || undefined }}
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
                <span className={`icone-redondo ${a.assinado_em ? "verde" : ""}`}>{a.assinado_em ? <ShieldCheck /> : <FileText />}</span>
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
