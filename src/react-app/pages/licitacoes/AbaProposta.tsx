import { Building2, ListChecks, CalendarDays, Check, ChevronRight, RotateCcw, Download, Eye, FileCheck2, FileText, FileType, Pencil, PenLine, Plus, Settings, ShieldCheck, Trash2, Upload } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { cotacaoDaProposta } from "../../../shared/negocio";
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
import { avisar, CampoArea, CampoSelect, Carregando, Modal, SeloAssinado, Vazio } from "../../components/Ui";
import { type Conteudo, montarConteudo, Visor } from "../../components/PreviaArquivo";
import { EscolherModeloPdf } from "../../proposta/EscolherModelo";
import { ehCorPdf, ehModeloPdf, MODELOS_PDF } from "../../../shared/proposta";
import { formatarData, formatarMoeda, formatarNumero, paraNumero } from "../../formato";
import { enviarProposta, montarPdf, montarWord, type RespostaDados } from "../../proposta/gerar";
import { link } from "../../rota";

const ModalAssinar = lazy(() => import("../../assinatura/ModalAssinar").then((m) => ({ default: m.ModalAssinar })));

type Assinatura = { titulo: string; nome: string; carregar: () => Promise<Uint8Array> };
type Linha = RascunhoProposta["itens"][string];

/** O que a proposta puxa sozinha de um item, e de onde veio. */
interface Automatico {
  marca: string;
  valor: string;
  descricao: string;
  deOndeValor: "lance" | "cotacao" | "";
  deOndeDescricao: "descritivo" | "produto" | "edital";
}

/**
 * Junta o que já está na proposta com o que a plataforma puxa agora.
 * - Campo vazio ou ainda igual ao que foi puxado da última vez: atualiza (a pessoa não mexeu).
 * - Campo que a pessoa digitou: fica como está.
 * - Valor: o lance final manda. Quando o lance registrado no Resultado muda, ele entra na proposta
 *   mesmo que o valor tenha sido digitado antes.
 */
export function juntarLinha(salva: Linha | undefined, auto: Automatico, descricaoEdital: string): Linha {
  const novo = { marca: auto.marca, valor: auto.valor, descricao: auto.descricao };
  if (!salva) return { incluir: true, ...novo, auto: novo };
  // Rascunhos antigos não guardavam o que foi puxado: a descrição do edital conta como automática,
  // e o valor dá lugar ao lance final se ele existir.
  const antes = salva.auto ?? { marca: "\u0000", valor: "\u0000", descricao: descricaoEdital };
  const campo = (k: "marca" | "valor" | "descricao") => {
    const atual = salva[k] ?? "";
    if (k === "valor" && auto.deOndeValor === "lance" && antes.valor !== auto.valor) return auto.valor;
    return atual.trim() === "" || atual === antes[k] ? novo[k] : atual;
  };
  return { ...salva, marca: campo("marca"), valor: campo("valor"), descricao: campo("descricao"), auto: novo };
}

/** Seção da proposta que abre e fecha. Lembra o que ficou aberto neste navegador. */
function Secao({
  id,
  titulo,
  icone,
  resumo,
  extra,
  children,
}: {
  id: string;
  titulo: string;
  icone?: React.ReactNode;
  resumo?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const chave = `montzion:proposta:${id}`;
  const [aberta, setAberta] = useState(() => {
    try {
      return localStorage.getItem(chave) === "1";
    } catch {
      return false;
    }
  });
  function alternar() {
    setAberta((a) => {
      try {
        localStorage.setItem(chave, a ? "0" : "1");
      } catch {
        /* sem armazenamento: só não lembra */
      }
      return !a;
    });
  }
  return (
    <section className={`cartao secao-recolhivel ${aberta ? "aberta" : ""}`}>
      <div className="secao-topo">
        <button type="button" className="secao-alternar" onClick={alternar} aria-expanded={aberta}>
          <ChevronRight className="secao-seta" aria-hidden="true" />
          <h2>
            {icone} {titulo}
          </h2>
          {!aberta && resumo && <span className="secao-resumo">{resumo}</span>}
        </button>
        {extra && <div className="secao-extra">{extra}</div>}
      </div>
      {aberta && <div className="secao-corpo">{children}</div>}
    </section>
  );
}

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
  aoEditarDados,
}: {
  licitacao: Licitacao;
  itens: ItemLicitacao[];
  cotacoes: Cotacao[];
  arquivos: Arquivo[];
  usuario: Usuario;
  aoMudar: () => Promise<void> | void;
  /** Abre a janela de edição dos dados da licitação. */
  aoEditarDados?: () => void;
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
  const [gerando, setGerando] = useState<"" | "docx" | "pdf" | "assinado" | "previa">("");
  const [previa, setPrevia] = useState<{ conteudo: Conteudo; urls: string[] } | null>(null);
  const [assinando, setAssinando] = useState<Assinatura | null>(null);
  const entradaPdf = useRef<HTMLInputElement>(null);
  const carregado = useRef(false);

  // O que cada item puxa sozinho: descritivo e marca do produto cotado (o marcado "usar na proposta",
  // ou o mais barato) e o valor do lance final do Resultado (sem lance, o preço de venda da cotação).
  const automaticos = useMemo(() => {
    const mapa = new Map<number, Automatico>();
    for (const item of participando) {
      const escolhida = cotacaoDaProposta(cotacoes, item, licitacao.imposto_percentual, licitacao.lucro_percentual);
      const c = escolhida?.cotacao;
      const descritivo = (c?.descricao ?? "").trim();
      const descricaoProduto = descritivo || (c?.produto ?? "").trim();
      const lance = item.nosso_lance;
      mapa.set(item.id, {
        marca: (c?.marca ?? "").trim(),
        valor: lance != null ? lance.toFixed(2) : escolhida ? escolhida.calculo.precoVenda.toFixed(2) : "",
        descricao: descricaoProduto || item.descricao || "",
        deOndeValor: lance != null ? "lance" : escolhida ? "cotacao" : "",
        deOndeDescricao: descritivo ? "descritivo" : descricaoProduto ? "produto" : "edital",
      });
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, cotacoes, licitacao.imposto_percentual, licitacao.lucro_percentual]);

  const automaticoDe = (i: ItemLicitacao): Automatico =>
    automaticos.get(i.id) ?? { marca: "", valor: "", descricao: i.descricao ?? "", deOndeValor: "", deOndeDescricao: "edital" };

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
        for (const i of participando) itensRascunho[i.id] = juntarLinha(base.itens?.[i.id], automaticoDe(i), i.descricao ?? "");
        setR({ ...base, data: rasc.rascunho?.data || hojeIso(), itens: itensRascunho });
      },
      (err) => avisar(mensagemDeErro(err), "erro"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licitacao.id]);

  // Cotação ou resultado mudaram com a proposta aberta: atualiza o que não foi digitado à mão.
  useEffect(() => {
    setR((atual) => {
      if (!atual) return atual;
      let mudou = false;
      const novos = { ...atual.itens };
      for (const i of participando) {
        const junto = juntarLinha(atual.itens[i.id], automaticoDe(i), i.descricao ?? "");
        if (JSON.stringify(junto) !== JSON.stringify(atual.itens[i.id])) {
          novos[i.id] = junto;
          mudou = true;
        }
      }
      return mudou ? { ...atual, itens: novos } : atual;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automaticos]);

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
  // Modelo e cor do PDF: o escolhido nesta proposta ou o padrão da empresa.
  const modeloPdf = ehModeloPdf(r.modelo_pdf) ? r.modelo_pdf : ehModeloPdf(empresaAtual?.modelo_pdf) ? empresaAtual!.modelo_pdf : "classico";
  const corPdf = ehCorPdf(r.cor_pdf) ? r.cor_pdf : ehCorPdf(empresaAtual?.cor_pdf) ? empresaAtual!.cor_pdf : "#1f3b8a";

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

  async function pedirDados(tipo: "docx" | "pdf" | "assinado" | "previa", visual: { modelo: string; cor: string } = { modelo: modeloPdf, cor: corPdf }) {
    return api<RespostaDados>(`/licitacoes/${licitacao.id}/proposta`, {
      corpo: {
        empresa_id: r!.empresa_id,
        modelo_id: tipo === "docx" ? r!.modelo_id : null,
        conta_id: r!.conta_id,
        modelo_pdf: visual.modelo,
        cor_pdf: visual.cor,
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

  async function gerar(tipo: "docx" | "pdf" | "assinado" | "previa") {
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
      } else if (tipo === "previa") {
        await mostrarPrevia();
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

  /** Monta o PDF só para ver (não salva). Também usado ao trocar modelo/cor dentro da prévia. */
  async function mostrarPrevia(visual: { modelo: string; cor: string } = { modelo: modeloPdf, cor: corPdf }) {
    const dados = await pedirDados("previa", visual);
    const bytes = await montarPdf(dados);
    const urls: string[] = [];
    const conteudo = montarConteudo(`${dados.nome}.pdf`, bytes, urls);
    setPrevia((antiga) => {
      antiga?.urls.forEach((u) => URL.revokeObjectURL(u));
      return { conteudo, urls };
    });
  }

  async function trocarVisualNaPrevia(n: { modelo?: string; cor?: string }) {
    const visual = { modelo: n.modelo ?? modeloPdf, cor: n.cor ?? corPdf };
    mudar({ modelo_pdf: visual.modelo, cor_pdf: visual.cor });
    setGerando("previa");
    try {
      await mostrarPrevia(visual);
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

  const dadosLicitacao: [string, string | null][] = [
    ["Órgão", licitacao.orgao],
    ["UASG", licitacao.uasg],
    ["Nº da licitação", licitacao.numero],
    ["Modalidade", licitacao.modalidade],
    ["Sessão", licitacao.data_sessao ? `${formatarData(licitacao.data_sessao)}${licitacao.horario ? ` às ${licitacao.horario}` : ""}` : null],
    ["Portal", licitacao.portal],
  ];
  const faltando = dadosLicitacao.filter(([, v]) => !v).length + (licitacao.objeto ? 0 : 1);

  return (
    <>
      {/* 0. Dados da licitação que entram na proposta */}
      <Secao
        id="licitacao"
        titulo="Dados da licitação na proposta"
        icone={<FileText size={17} />}
        resumo={faltando > 0 ? <span className="texto-amarelo">{faltando} dado(s) sem preencher</span> : [licitacao.orgao, licitacao.numero && `Nº ${licitacao.numero}`].filter(Boolean).join(" · ")}
        extra={
          aoEditarDados && (
            <button className="botao secundario pequeno" onClick={aoEditarDados}>
              <Pencil /> Editar dados
            </button>
          )
        }
      >
        <div className="dados-proposta">
          {dadosLicitacao.map(([rotulo, valor]) => (
            <div key={rotulo}>
              <small>{rotulo}</small>
              <span className={valor ? "" : "falta"}>{valor || "Falta preencher"}</span>
            </div>
          ))}
          <div className="largo">
            <small>Objeto</small>
            <span className={licitacao.objeto ? "" : "falta"}>{licitacao.objeto || "Falta preencher"}</span>
          </div>
        </div>
        {faltando > 0 && (
          <p className="texto-amarelo pequeno" style={{ margin: "10px 0 0" }}>
            {faltando} dado(s) sem preencher: ficam em branco na proposta.
          </p>
        )}
      </Secao>

      {/* 1. Empresa e pagamento */}
      <Secao
        id="empresa"
        titulo="Empresa e pagamento"
        icone={<Building2 size={17} />}
        resumo={
          empresaAtual
            ? [empresaAtual.nome, contas.find((c) => c.id === r.conta_id)?.banco].filter(Boolean).join(" · ")
            : <span className="texto-amarelo">Escolha a empresa</span>
        }
        extra={
          <span className={`salvo-rascunho ${salvo}`}>
            {salvo === "salvando" ? "Salvando…" : salvo === "salvo" ? (
              <>
                <Check size={13} /> Rascunho salvo
              </>
            ) : null}
          </span>
        }
      >
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
      </Secao>

      {/* 2. Dados da proposta */}
      <Secao
        id="dados"
        titulo="Dados da proposta"
        icone={<CalendarDays size={17} />}
        resumo={[r.numero && `Nº ${r.numero}`, r.validade_dias && `validade ${r.validade_dias} dias`, r.prazo_entrega && `entrega ${r.prazo_entrega}`].filter(Boolean).join(" · ")}
      >
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
      </Secao>

      {/* 3. Itens */}
      <Secao
        id="itens"
        titulo="Itens da proposta"
        icone={<ListChecks size={17} />}
        resumo={
          semPreco.length > 0 ? (
            <span className="texto-amarelo">
              {escolhidos.length} item(ns) · falta valor em {semPreco.length}
            </span>
          ) : (
            `${escolhidos.length} item(ns) · ${formatarMoeda(total)}`
          )
        }
      >
        <p className="texto-fraco pequeno" style={{ margin: "0 0 10px" }}>
          A descrição e a marca vêm do produto cotado (o marcado "Usar na proposta" no Orçamento, ou o mais barato). O valor
          vem do lance final registrado no Resultado; sem lance, do preço de venda da cotação. O que você digitar aqui fica.
        </p>
        {participando.length === 0 ? (
          <Vazio icone={<FileText />} titulo="Nenhum item para participar" />
        ) : (
          <div className="lista-proposta">
            {participando.map((i) => {
              const l = r.itens[i.id];
              if (!l) return null;
              const valor = paraNumero(l.valor) ?? 0;
              const auto = automaticoDe(i);
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
                      {" · "}
                      {l.descricao === auto.descricao ? (
                        { descritivo: "descritivo do produto cotado", produto: "nome do produto cotado (preencha o descritivo no Orçamento)", edital: "descrição do edital (nenhum produto cotado)" }[auto.deOndeDescricao]
                      ) : (
                        <>
                          descrição editada
                          {auto.descricao && (
                            <button type="button" className="botao-link" onClick={() => mudarItem(i.id, { descricao: auto.descricao })}>
                              <RotateCcw size={11} /> {auto.deOndeDescricao === "edital" ? "usar a do edital" : "usar a do produto cotado"}
                            </button>
                          )}
                        </>
                      )}
                    </small>
                  </span>
                  <div className="entrada">
                    <input value={l.marca} onChange={(e) => mudarItem(i.id, { marca: e.target.value })} placeholder="Marca" aria-label="Marca" />
                  </div>
                  <div className="valor-proposta">
                    <div className="entrada">
                      <input type="number" step="0.01" min="0" value={l.valor} onChange={(e) => mudarItem(i.id, { valor: e.target.value })} placeholder="Valor unit." aria-label="Valor unitário" />
                    </div>
                    {auto.valor && l.valor !== auto.valor ? (
                      <button type="button" className="botao-link" onClick={() => mudarItem(i.id, { valor: auto.valor })} title={auto.deOndeValor === "lance" ? "Usar o lance final registrado no Resultado" : "Usar o preço de venda da cotação"}>
                        <RotateCcw size={11} /> {auto.deOndeValor === "lance" ? "lance final" : "cotação"}: {formatarMoeda(Number(auto.valor))}
                      </button>
                    ) : (
                      auto.deOndeValor && <small className="texto-fraco">{auto.deOndeValor === "lance" ? "lance final" : "preço de venda da cotação"}</small>
                    )}
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
      </Secao>

      {/* 4. Declarações */}
      <Secao
        id="declaracoes"
        titulo="Declarações e condições"
        icone={<FileCheck2 size={17} />}
        resumo={`${r.declaracoes.filter((id) => declaracoes.some((d) => d.id === id)).length + r.extras.length} na proposta${r.extras.length ? ` (${r.extras.length} só desta licitação)` : ""}`}
      >
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
      </Secao>

      {/* 5. Gerar */}
      <section className="cartao">
        <h2>Gerar a proposta</h2>
        <p className="texto-fraco pequeno" style={{ margin: "0 0 4px" }}>
          O PDF sai completo, com logo, dados da empresa, banco, representante, itens, condições, declarações e a data. Escolha o
          modelo e a cor; use "Pré-visualizar" para ver antes de salvar.
        </p>
        <EscolherModeloPdf modelo={modeloPdf} cor={corPdf} aoMudar={(n) => mudar({ ...(n.modelo ? { modelo_pdf: n.modelo } : {}), ...(n.cor ? { cor_pdf: n.cor } : {}) })} />
        <div className="botoes-proposta">
          <button className="botao secundario" onClick={() => gerar("previa")} disabled={!!gerando || !prontoParaGerar}>
            <Eye /> {gerando === "previa" ? "Montando…" : "Pré-visualizar"}
          </button>
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

      {previa && (
        <Modal
          titulo={`Pré-visualização · modelo ${MODELOS_PDF.find((m) => m.chave === modeloPdf)?.nome ?? ""}`}
          aoFechar={() => {
            previa.urls.forEach((u) => URL.revokeObjectURL(u));
            setPrevia(null);
          }}
          largo
        >
          <div className="previa-proposta">
            <EscolherModeloPdf modelo={modeloPdf} cor={corPdf} aoMudar={trocarVisualNaPrevia} />
            {gerando === "previa" ? (
              <p className="texto-fraco carregando-linha">Montando o PDF…</p>
            ) : (
              <Visor conteudo={previa.conteudo} />
            )}
            <p className="texto-fraco pequeno">
              Esta é só uma prévia (não foi salva). Para salvar, feche e clique em PDF ou PDF assinado.
            </p>
          </div>
        </Modal>
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
        <Secao id="geradas" titulo="Propostas geradas" icone={<Download size={17} />} resumo={`${anteriores.length} arquivo(s)${anteriores.some((a) => a.assinado_em) ? ` · ${anteriores.filter((a) => a.assinado_em).length} assinada(s)` : ""}`}>
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
        </Secao>
      )}
    </>
  );
}
