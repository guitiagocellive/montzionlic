import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { ItemLicitacao } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Alerta, Campo } from "../../components/Formulario";
import { avisar, CampoArea, Interruptor, Modal, Vazio } from "../../components/Ui";
import { formatarMoeda, formatarNumero, paraNumero } from "../../formato";

export function AbaItens({
  licitacaoId,
  itens,
  aoMudar,
}: {
  licitacaoId: number;
  itens: ItemLicitacao[];
  aoMudar: () => Promise<void> | void;
}) {
  const [editando, setEditando] = useState<ItemLicitacao | "novo" | null>(null);
  const [soParticipar, setSoParticipar] = useState(false);

  const lista = soParticipar ? itens.filter((i) => i.participar) : itens;
  const participando = itens.filter((i) => i.participar);
  const totalReferencia = participando.reduce(
    (s, i) => s + (i.valor_referencia ?? 0) * (i.quantidade ?? 0),
    0,
  );

  async function alternar(item: ItemLicitacao, participar: boolean) {
    try {
      await api(`/licitacoes/itens/${item.id}`, { metodo: "PATCH", corpo: { participar } });
      await aoMudar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  async function excluir(item: ItemLicitacao) {
    if (!confirm(`Excluir o item ${item.numero ?? ""}? As cotações dele também serão apagadas.`)) return;
    try {
      await api(`/licitacoes/itens/${item.id}`, { metodo: "DELETE" });
      await aoMudar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  return (
    <>
      <div className="resumo-linha">
        <div className="mini-indicador">
          <span>Itens no edital</span>
          <strong>{itens.length}</strong>
        </div>
        <div className="mini-indicador">
          <span>Vamos participar</span>
          <strong className="texto-gradiente">{participando.length}</strong>
        </div>
        <div className="mini-indicador">
          <span>Valor de referência (participando)</span>
          <strong>{formatarMoeda(totalReferencia)}</strong>
        </div>
      </div>

      <section className="cartao">
        <div className="cartao-titulo">
          <h2>
            <ListChecks size={18} color="#f0abfc" aria-hidden="true" /> Itens da licitação
          </h2>
          <div className="linha-acoes">
            <Interruptor rotulo="Só os que vamos participar" ligado={soParticipar} aoMudar={setSoParticipar} />
            <button className="botao" onClick={() => setEditando("novo")}>
              <Plus aria-hidden="true" /> Adicionar item
            </button>
          </div>
        </div>

        {lista.length === 0 ? (
          <Vazio icone={<ListChecks />} titulo="Nenhum item ainda">
            Adicione os itens manualmente ou envie o edital na etapa "Arquivos e IA" para a IA importar.
          </Vazio>
        ) : (
          <div className="lista-itens">
            {lista.map((item) => (
              <article key={item.id} className={`linha-item ${item.participar ? "" : "fora"}`}>
                <span className="numero-item">{item.numero || "—"}</span>
                <div className="linha-item-texto">
                  <p>{item.descricao || "Sem descrição"}</p>
                  <div className="linha-item-meta">
                    <span>
                      Qtd: <strong>{formatarNumero(item.quantidade)}</strong> {item.unidade}
                    </span>
                    <span>
                      Ref. unitária: <strong>{formatarMoeda(item.valor_referencia)}</strong>
                    </span>
                  </div>
                </div>
                <div className="linha-item-acoes">
                  <Interruptor rotulo="Participar" ligado={item.participar === 1} aoMudar={(v) => alternar(item, v)} />
                  <button className="botao-icone" onClick={() => setEditando(item)} aria-label="Editar item">
                    <Pencil />
                  </button>
                  <button className="botao-icone perigo" onClick={() => excluir(item)} aria-label="Excluir item">
                    <Trash2 />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {editando && (
        <ModalItem
          licitacaoId={licitacaoId}
          item={editando === "novo" ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={async () => {
            setEditando(null);
            await aoMudar();
          }}
        />
      )}
    </>
  );
}

function ModalItem({
  licitacaoId,
  item,
  aoFechar,
  aoSalvar,
}: {
  licitacaoId: number;
  item: ItemLicitacao | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [participar, setParticipar] = useState(item ? item.participar === 1 : true);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const corpo = {
      numero: f.get("numero"),
      descricao: f.get("descricao"),
      unidade: f.get("unidade"),
      quantidade: paraNumero(String(f.get("quantidade") ?? "")),
      valor_referencia: paraNumero(String(f.get("valor_referencia") ?? "")),
      participar,
    };
    setErro("");
    setEnviando(true);
    try {
      if (item) await api(`/licitacoes/itens/${item.id}`, { metodo: "PATCH", corpo });
      else await api(`/licitacoes/${licitacaoId}/itens`, { corpo });
      avisar(item ? "Item atualizado." : "Item adicionado.");
      aoSalvar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={item ? `Item ${item.numero ?? ""}` : "Adicionar item"} aoFechar={aoFechar} largo>
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <div className="grade-4">
          <Campo rotulo="Nº do item" name="numero" defaultValue={item?.numero ?? ""} placeholder="15" autoFocus />
          <Campo rotulo="Quantidade" name="quantidade" type="number" step="any" min="0" defaultValue={item?.quantidade ?? ""} />
          <Campo rotulo="Unidade" name="unidade" defaultValue={item?.unidade ?? ""} placeholder="UN, CX, KG…" />
          <Campo
            rotulo="Valor ref. unitário (R$)"
            name="valor_referencia"
            type="number"
            step="0.01"
            min="0"
            defaultValue={item?.valor_referencia ?? ""}
          />
        </div>
        <CampoArea
          rotulo="Descritivo / requisitos do produto"
          name="descricao"
          rows={7}
          defaultValue={item?.descricao ?? ""}
          placeholder="Cole aqui o descritivo do edital"
        />
        <Interruptor rotulo="Vamos participar deste item" ligado={participar} aoMudar={setParticipar} />
        <div className="botoes-modal">
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar item"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
