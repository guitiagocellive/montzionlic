import { Ban, Bot, Calculator, Check, Eye, EyeOff, FileText, ListChecks, Medal, PackageCheck, Save, ThumbsDown, ThumbsUp, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { SITUACOES_DISPUTA } from "../../../shared/negocio";
import type { Licitacao } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { avisar } from "../../components/Ui";
import { SeletorData } from "../../components/Calendario";
import { link } from "../../rota";

interface Props {
  licitacao: Licitacao;
  semCotacao: number;
  participando: number;
  execucoes: { id: number; numero_empenho: string | null }[];
  podeEditar: boolean;
  aoMudarEtapa: (etapa: string, extra?: Record<string, unknown>) => Promise<void>;
  /** Abre a janela "Quais itens ganhamos?" */
  aoGanhar: () => void;
  aoIrPara: (aba: string) => void;
  aoSalvar: () => Promise<void> | void;
}

/** Resumo da licitação e o "próximo passo" de acordo com a etapa. */
export function PainelEtapa({ licitacao: l, semCotacao, participando, execucoes, podeEditar, aoMudarEtapa, aoGanhar, aoIrPara, aoSalvar }: Props) {
  const acao = (rotulo: string, icone: React.ReactNode, onClick: () => void, classe = "secundario") => (
    <button className={`botao ${classe}`} onClick={onClick} disabled={!podeEditar && classe !== "link"}>
      {icone} {rotulo}
    </button>
  );

  async function perdemos() {
    const motivo = prompt("Motivo da perda (opcional): ex.: Preço, Inabilitação, Desistência");
    if (motivo === null) return;
    await aoMudarEtapa("perdida", motivo.trim() ? { motivo_perda: motivo.trim().slice(0, 200) } : undefined);
  }

  let titulo = "";
  let texto = "";
  let botoes: React.ReactNode = null;
  switch (l.etapa) {
    case "estudar":
      titulo = "Estudar o edital";
      texto = "Leia o edital (a IA ajuda a resumir) e decida se vale participar.";
      botoes = (
        <>
          {acao("Analisar edital com IA", <Bot />, () => aoIrPara("arquivos"), "link")}
          {acao("Não vamos participar", <Ban />, () => aoMudarEtapa("perdida", { motivo_perda: "Desistência" }))}
          {acao("Vamos participar", <ThumbsUp />, () => aoMudarEtapa("fazer"), "acento")}
        </>
      );
      break;
    case "fazer":
      titulo = "Preparar a participação";
      texto = `Confira os itens (${participando} para participar) e cote os produtos com os fornecedores.`;
      botoes = (
        <>
          {acao("Itens", <ListChecks />, () => aoIrPara("itens"), "link")}
          {acao("Cotar produtos", <Calculator />, () => aoIrPara("orcamento"), "link")}
          {acao("Pronto, ir para Orçamento", <Check />, () => aoMudarEtapa("orcamento"), "acento")}
        </>
      );
      break;
    case "orcamento":
      titulo = "Fechar preço e enviar a proposta";
      texto = semCotacao ? `Ainda há ${semCotacao} item(ns) sem produto cotado.` : "Todos os itens têm cotação. Gere a proposta e envie antes da sessão.";
      botoes = (
        <>
          {acao("Gerar proposta", <FileText />, () => aoIrPara("proposta"), "link")}
          {acao("Perdemos", <ThumbsDown />, perdemos)}
          {acao("Ganhamos itens", <Trophy />, aoGanhar)}
          {acao("Sessão feita: ficamos bem colocados", <Medal />, () => aoMudarEtapa("boa_colocacao"), "acento")}
        </>
      );
      break;
    case "boa_colocacao":
      titulo = "Acompanhar a disputa";
      texto = "Registre a colocação, a situação e quando a sessão vai reabrir. O sistema avisa antes da reabertura.";
      botoes = (
        <>
          {acao("Perdemos", <ThumbsDown />, perdemos)}
          {acao("Ganhamos (escolher itens)", <Trophy />, aoGanhar, "acento")}
        </>
      );
      break;
    case "ganha":
      titulo = "Licitação ganha";
      texto = "O empenho já está no Pós-ganho, só com os itens ganhos. Itens em acompanhamento continuam na aba Resultado.";
      botoes = (
        <>
          {acao("Resultado por item", <Trophy />, () => aoIrPara("resultado"), "link")}
          {execucoes.map((e) => (
            <a key={e.id} className="botao acento" {...link(`/pos-ganho/${e.id}`)}>
              <PackageCheck /> {e.numero_empenho ? `Empenho ${e.numero_empenho}` : "Abrir empenho"}
            </a>
          ))}
        </>
      );
      break;
    case "perdida":
      titulo = "Licitação perdida";
      texto = l.motivo_perda ? `Motivo: ${l.motivo_perda}.` : "Registre o motivo e o vencedor de cada item para aprender com a disputa.";
      botoes = acao("Registrar resultado", <Trophy />, () => aoIrPara("resultado"), "link");
      break;
  }

  return (
    <section className={`painel-etapa entrar etapa-${l.etapa}`}>
      <div className="proximo-passo">
        <div className="proximo-passo-texto">
          <span className="sobretitulo">Próximo passo</span>
          <strong>{titulo}</strong>
          <span className="texto-suave pequeno">{texto}</span>
        </div>
        <div className="linha-botoes proximo-passo-botoes">{botoes}</div>
      </div>

      {l.etapa === "boa_colocacao" && <Acompanhamento licitacao={l} podeEditar={podeEditar} aoSalvar={aoSalvar} />}
    </section>
  );
}

function Acompanhamento({ licitacao: l, podeEditar, aoSalvar }: { licitacao: Licitacao; podeEditar: boolean; aoSalvar: () => Promise<void> | void }) {
  const inicial = () => ({
    acompanhar: l.acompanhar !== 0,
    colocacao: l.colocacao == null ? "" : String(l.colocacao),
    situacao_disputa: l.situacao_disputa ?? "",
    data_reabertura: l.data_reabertura ?? "",
    hora_reabertura: l.hora_reabertura ?? "",
  });
  const [v, setV] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setV(inicial()), [l]); // eslint-disable-line react-hooks/exhaustive-deps
  const sujo = JSON.stringify(v) !== JSON.stringify(inicial());

  async function salvar(extra?: Partial<typeof v>) {
    const novo = { ...v, ...extra };
    setSalvando(true);
    try {
      await api(`/licitacoes/${l.id}`, {
        metodo: "PATCH",
        corpo: {
          acompanhar: novo.acompanhar,
          colocacao: novo.colocacao ? Math.max(1, Math.round(Number(novo.colocacao))) : null,
          situacao_disputa: novo.situacao_disputa || null,
          data_reabertura: novo.data_reabertura || null,
          hora_reabertura: novo.hora_reabertura || null,
        },
      });
      avisar("Acompanhamento salvo.");
      await aoSalvar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="acompanhamento">
      <div className="segmentado">
        <button className={v.acompanhar ? "ativo" : ""} onClick={() => salvar({ acompanhar: true })} disabled={!podeEditar || salvando}>
          <Eye size={15} /> Acompanhar
        </button>
        <button className={!v.acompanhar ? "ativo" : ""} onClick={() => salvar({ acompanhar: false })} disabled={!podeEditar || salvando}>
          <EyeOff size={15} /> Não acompanhar
        </button>
      </div>
      <label className="campo campo-curto">
        <span className="texto-suave pequeno">Colocação</span>
        <div className="entrada">
          <input type="number" min="1" placeholder="Ex.: 2" value={v.colocacao} onChange={(e) => setV({ ...v, colocacao: e.target.value })} disabled={!podeEditar} />
        </div>
      </label>
      <label className="campo">
        <span className="texto-suave pequeno">Situação</span>
        <select value={v.situacao_disputa} onChange={(e) => setV({ ...v, situacao_disputa: e.target.value })} disabled={!podeEditar}>
          <option value="">Selecione</option>
          {SITUACOES_DISPUTA.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="campo">
        <span className="texto-suave pequeno">Reabertura da sessão</span>
        <SeletorData valor={v.data_reabertura} aoMudar={(d) => setV({ ...v, data_reabertura: d })} desabilitado={!podeEditar} rotulo="Reabertura da sessão" />
      </label>
      <label className="campo campo-curto">
        <span className="texto-suave pequeno">Horário</span>
        <div className="entrada">
          <input type="time" value={v.hora_reabertura} onChange={(e) => setV({ ...v, hora_reabertura: e.target.value })} disabled={!podeEditar} />
        </div>
      </label>
      <button className="botao" onClick={() => salvar()} disabled={!podeEditar || !sujo || salvando}>
        <Save /> {salvando ? "Salvando…" : "Salvar"}
      </button>
    </div>
  );
}
