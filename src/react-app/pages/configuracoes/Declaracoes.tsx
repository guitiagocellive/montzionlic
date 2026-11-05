import { ChevronDown, ChevronUp, FileCheck2, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { Declaracao } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Alerta, Campo } from "../../components/Formulario";
import { avisar, CampoArea, CampoSelect, Carregando, Interruptor, Modal } from "../../components/Ui";

/** Biblioteca de declarações e condições que entram nas propostas. */
export function DeclaracoesConfig() {
  const [lista, setLista] = useState<Declaracao[] | null>(null);
  const [editando, setEditando] = useState<Declaracao | "nova" | null>(null);

  async function carregar() {
    try {
      setLista((await api<{ declaracoes: Declaracao[] }>("/propostas/declaracoes")).declaracoes);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }
  useEffect(() => {
    carregar();
  }, []);

  async function mudar(d: Declaracao, corpo: Partial<Declaracao>) {
    try {
      await api(`/propostas/declaracoes/${d.id}`, { metodo: "PATCH", corpo });
      await carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  async function mover(grupo: Declaracao[], i: number, passo: -1 | 1) {
    const outra = grupo[i + passo];
    if (!outra) return;
    const atual = grupo[i];
    // troca as posições (ordem) das duas
    await Promise.all([
      api(`/propostas/declaracoes/${atual.id}`, { metodo: "PATCH", corpo: { ordem: outra.ordem } }),
      api(`/propostas/declaracoes/${outra.id}`, { metodo: "PATCH", corpo: { ordem: atual.ordem === outra.ordem ? atual.ordem + passo : atual.ordem } }),
    ]).catch((err) => avisar(mensagemDeErro(err), "erro"));
    carregar();
  }

  async function excluir(d: Declaracao) {
    if (!confirm(`Excluir "${d.titulo}"?`)) return;
    try {
      await api(`/propostas/declaracoes/${d.id}`, { metodo: "DELETE" });
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  if (!lista) return <Carregando />;
  const condicoes = lista.filter((d) => d.tipo === "condicao");
  const declaracoes = lista.filter((d) => d.tipo === "declaracao");

  const grupo = (titulo: string, icone: React.ReactNode, itens: Declaracao[]) => (
    <>
      <h3 className="subtitulo-form">
        {icone} {titulo} <span className="texto-fraco pequeno">({itens.length})</span>
      </h3>
      <div className="lista-declaracoes">
        {itens.map((d, i) => (
          <article key={d.id} className={`linha-declaracao ${d.padrao ? "" : "desligada"}`}>
            <div className="declaracao-ordem">
              <button className="botao-icone" onClick={() => mover(itens, i, -1)} disabled={i === 0} aria-label="Subir">
                <ChevronUp />
              </button>
              <button className="botao-icone" onClick={() => mover(itens, i, 1)} disabled={i === itens.length - 1} aria-label="Descer">
                <ChevronDown />
              </button>
            </div>
            <div className="declaracao-texto">
              <strong>{d.titulo}</strong>
              <span className="texto-fraco pequeno">{d.texto}</span>
            </div>
            <div className="linha-botoes">
              <Interruptor ligado={!!d.padrao} aoMudar={(v) => mudar(d, { padrao: v ? 1 : 0 })} rotulo="Marcada" />
              <button className="botao-icone" onClick={() => setEditando(d)} aria-label="Editar">
                <Pencil />
              </button>
              <button className="botao-icone perigo" onClick={() => excluir(d)} aria-label="Excluir">
                <Trash2 />
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );

  return (
    <section className="cartao">
      <div className="cartao-titulo">
        <h2>Declarações e condições da proposta</h2>
        <button className="botao pequeno" onClick={() => setEditando("nova")}>
          <Plus /> Nova
        </button>
      </div>
      <p className="descricao">
        As <strong>marcadas</strong> já vêm selecionadas em toda proposta nova. Em cada licitação dá para desmarcar alguma ou
        acrescentar uma declaração só daquela licitação.
      </p>
      {grupo("Condições (lista com marcadores)", <ListChecks size={16} />, condicoes)}
      {grupo("Declarações", <FileCheck2 size={16} />, declaracoes)}
      {editando && (
        <ModalDeclaracao
          declaracao={editando === "nova" ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            carregar();
          }}
        />
      )}
    </section>
  );
}

function ModalDeclaracao({ declaracao, aoFechar, aoSalvar }: { declaracao: Declaracao | null; aoFechar: () => void; aoSalvar: () => void }) {
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [padrao, setPadrao] = useState(declaracao ? !!declaracao.padrao : true);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const corpo = { ...Object.fromEntries(new FormData(e.currentTarget)), padrao };
    setErro("");
    setEnviando(true);
    try {
      if (declaracao) await api(`/propostas/declaracoes/${declaracao.id}`, { metodo: "PATCH", corpo });
      else await api("/propostas/declaracoes", { corpo });
      avisar("Salvo.");
      aoSalvar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={declaracao ? "Editar" : "Nova declaração ou condição"} aoFechar={aoFechar} largo>
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <div className="grade-2">
          <CampoSelect
            rotulo="Tipo"
            name="tipo"
            defaultValue={declaracao?.tipo ?? "declaracao"}
            opcoes={[
              { valor: "declaracao", texto: "Declaração (título + texto)" },
              { valor: "condicao", texto: "Condição (item da lista)" },
            ]}
          />
          <Campo rotulo="Título" name="titulo" defaultValue={declaracao?.titulo ?? ""} placeholder="Ex.: DECLARAÇÃO DE ..." required />
        </div>
        <CampoArea rotulo="Texto" name="texto" rows={8} defaultValue={declaracao?.texto ?? ""} required />
        <Interruptor ligado={padrao} aoMudar={setPadrao} rotulo="Já vem marcada nas propostas novas" />
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
