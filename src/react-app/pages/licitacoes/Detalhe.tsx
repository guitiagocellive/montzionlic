import { ArrowLeft, Calculator, ClipboardList, ExternalLink, FileText, FolderOpen, ListChecks, MessageSquare, Trash2, Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ETAPAS_LICITACAO, ETAPAS_EXECUCAO, nomeEtapa } from "../../../shared/negocio";
import { podeEditar, podeVer } from "../../../shared/permissoes";
import type { Arquivo, Cotacao, ItemLicitacao, Licitacao, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { AbaArquivos } from "../../components/AbaArquivos";
import { PainelAtividade } from "../../components/Atividade";
import { Etapas } from "../../components/Etapas";
import { avisar, Carregando } from "../../components/Ui";
import { link, navegar } from "../../rota";
import { AbaDados } from "./AbaDados";
import { AbaItens } from "./AbaItens";
import { AbaOrcamento } from "./AbaOrcamento";
import { AbaProposta } from "./AbaProposta";
import { AbaResultado } from "./AbaResultado";

export interface FichaLicitacao {
  licitacao: Licitacao;
  itens: ItemLicitacao[];
  cotacoes: Cotacao[];
  arquivos: Arquivo[];
  execucoes: { id: number; etapa: string; numero_empenho: string | null }[];
}

export function DetalheLicitacao({ id, usuario }: { id: number; usuario: Usuario }) {
  const [ficha, setFicha] = useState<FichaLicitacao | null>(null);
  const [erro, setErro] = useState("");
  const abaInicial = new URLSearchParams(location.search).get("aba") ?? "dados";
  const [aba, setAba] = useState(abaInicial === "atividade" ? "dados" : abaInicial);
  const [atividadeAberta, setAtividadeAberta] = useState(abaInicial === "atividade");
  const [comentarios, setComentarios] = useState(0);

  const carregar = useCallback(async () => {
    try {
      setFicha(await api<FichaLicitacao>(`/licitacoes/${id}`));
    } catch (err) {
      setErro(mensagemDeErro(err));
    }
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function escolherAba(chave: string) {
    setAba(chave);
    history.replaceState(null, "", `/licitacoes/${id}?aba=${chave}`);
  }

  async function mudarEtapa(etapa: string) {
    try {
      const r = await api<{ execucaoCriada: number | null }>(`/licitacoes/${id}`, {
        metodo: "PATCH",
        corpo: { etapa },
      });
      avisar(
        r.execucaoCriada
          ? "Licitação ganha! O card também foi criado no Pós-ganho."
          : `Movida para "${nomeEtapa(ETAPAS_LICITACAO, etapa)}".`,
      );
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  async function excluir() {
    if (!confirm("Excluir esta licitação, seus itens, cotações, arquivos e empenhos? Isso não pode ser desfeito.")) return;
    try {
      await api(`/licitacoes/${id}`, { metodo: "DELETE" });
      avisar("Licitação excluída.");
      navegar("/licitacoes");
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  if (erro) return <div className="alerta erro">{erro}</div>;
  if (!ficha) return <Carregando />;

  const { licitacao: l, itens, cotacoes, arquivos } = ficha;
  const etapa = ETAPAS_LICITACAO.find((e) => e.chave === l.etapa);

  const passos = [
    {
      chave: "dados",
      titulo: "Dados",
      descricao: "Órgão, sessão e portal",
      icone: ClipboardList,
      completo: !!(l.numero && l.orgao && l.data_sessao),
    },
    {
      chave: "itens",
      titulo: "Itens",
      descricao: `${itens.filter((i) => i.participar).length} para participar`,
      icone: ListChecks,
      completo: itens.length > 0,
    },
    {
      chave: "arquivos",
      titulo: "Arquivos e IA",
      descricao: `${arquivos.length} arquivo(s)`,
      icone: FolderOpen,
      completo: arquivos.length > 0,
    },
    {
      chave: "orcamento",
      titulo: "Orçamento",
      descricao: `${cotacoes.length} produto(s) cotado(s)`,
      icone: Calculator,
      completo: cotacoes.length > 0,
    },
    {
      chave: "proposta",
      titulo: "Proposta",
      descricao: `${arquivos.filter((a) => a.categoria === "Proposta").length} gerada(s)`,
      icone: FileText,
      completo: arquivos.some((a) => a.categoria === "Proposta"),
    },
    {
      chave: "resultado",
      titulo: "Resultado",
      descricao: itens.some((i) => i.resultado) ? `${itens.filter((i) => i.resultado === "ganho").length} ganho(s)` : "Disputa",
      icone: Trophy,
      completo: itens.filter((i) => i.participar).length > 0 && itens.filter((i) => i.participar).every((i) => i.resultado),
    },
  ].filter((p) => !["orcamento", "proposta"].includes(p.chave) || podeVer(usuario.permissoes, "orcamento"));

  return (
    <>
      <a className="voltar" {...link("/licitacoes")}>
        <ArrowLeft aria-hidden="true" /> Quadro de licitações
      </a>

      <div className="cabecalho-ficha entrar">
        <div className="ficha-titulo">
          <div className="card-etiquetas">
            <span className="chip etapa-chip" style={{ ["--cor-etapa" as string]: etapa?.cor }}>
              {etapa?.nome}
            </span>
            {l.modalidade && <span className="chip">{l.modalidade}</span>}
            {l.registro_preco === 1 && <span className="chip destaque">Registro de preço</span>}
          </div>
          <h1>{l.numero ? `Licitação nº ${l.numero}` : "Licitação sem número"}</h1>
          <p className="texto-suave">
            {l.orgao || "Órgão não informado"}
            {l.uasg && ` · UASG ${l.uasg}`}
          </p>
        </div>
        <div className="ficha-acoes">
          <select
            value={l.etapa}
            onChange={(e) => mudarEtapa(e.target.value)}
            aria-label="Mover para etapa"
            disabled={!podeEditar(usuario.permissoes, "licitacoes")}
          >
            {ETAPAS_LICITACAO.map((e) => (
              <option key={e.chave} value={e.chave}>
                {e.nome}
              </option>
            ))}
          </select>
          <button className="botao secundario" onClick={() => setAtividadeAberta(true)}>
            <MessageSquare /> Atividade{comentarios > 0 && <span className="chip destaque">{comentarios}</span>}
          </button>
          {l.link && (
            <a className="botao secundario" href={l.link} target="_blank" rel="noreferrer noopener">
              <ExternalLink aria-hidden="true" /> Portal
            </a>
          )}
          {usuario.papel === "admin" && (
            <button className="botao-icone perigo" onClick={excluir} aria-label="Excluir licitação" title="Excluir">
              <Trash2 />
            </button>
          )}
        </div>
      </div>

      {ficha.execucoes.length > 0 && (
        <div className="faixa-ganha entrar">
          <Trophy aria-hidden="true" />
          <span>Esta licitação está no Pós-ganho:</span>
          {ficha.execucoes.map((e) => (
            <a key={e.id} {...link(`/pos-ganho/${e.id}`)}>
              {e.numero_empenho ? `Empenho ${e.numero_empenho}` : "Empenho sem número"} ·{" "}
              {nomeEtapa(ETAPAS_EXECUCAO, e.etapa)}
            </a>
          ))}
        </div>
      )}

      <Etapas passos={passos} atual={aba} aoEscolher={escolherAba} />

      <div key={aba} className="entrar">
        {aba === "dados" && <AbaDados licitacao={l} aoSalvar={carregar} />}
        {aba === "itens" && <AbaItens licitacaoId={l.id} itens={itens} aoMudar={carregar} />}
        {aba === "arquivos" && (
          <AbaArquivos
            arquivos={arquivos}
            destino={{ licitacao_id: l.id }}
            tipoAnalise="edital"
            aoMudar={carregar}
            aoAplicarDados={async (dados) => {
              await api(`/licitacoes/${l.id}`, { metodo: "PATCH", corpo: dados });
              await carregar();
            }}
            aoImportarItens={async (lista) => {
              await api(`/licitacoes/${l.id}/itens`, { corpo: { itens: lista } });
              await carregar();
            }}
          />
        )}
        {aba === "orcamento" && (
          <AbaOrcamento licitacao={l} itens={itens} cotacoes={cotacoes} aoMudar={carregar} />
        )}
        {aba === "proposta" && (
          <AbaProposta licitacao={l} itens={itens} cotacoes={cotacoes} arquivos={arquivos} usuario={usuario} aoMudar={carregar} />
        )}
        {aba === "resultado" && (
          <AbaResultado licitacao={l} itens={itens} podeEditar={podeEditar(usuario.permissoes, "licitacoes")} aoMudar={carregar} />
        )}
      </div>

      <PainelAtividade
        alvo={{ licitacao_id: l.id }}
        usuario={usuario}
        aberto={atividadeAberta}
        aoFechar={() => setAtividadeAberta(false)}
        aoContar={setComentarios}
      />
    </>
  );
}
