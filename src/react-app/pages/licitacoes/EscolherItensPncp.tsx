import { CheckSquare, Loader2, Plus, RefreshCw, Search, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../components/Ui";
import { type ItemPncp, listarItens, type ResultadoPncp, semAcento } from "../../pncp";
import { reais } from "./DetalhePncp";

/** Antes de adicionar ao quadro: escolher os itens de que a empresa vai participar. */
export function EscolherItensPncp({
  resultado: r,
  aoConfirmar,
  aoFechar,
}: {
  resultado: ResultadoPncp;
  aoConfirmar: (itens: ItemPncp[]) => void;
  aoFechar: () => void;
}) {
  const [itens, setItens] = useState<ItemPncp[] | null>(null);
  const [erro, setErro] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState("");

  function carregar() {
    setErro("");
    setItens(null);
    listarItens(r).then(setItens, (e) => setErro(e instanceof Error ? e.message : "Falha ao buscar os itens."));
  }
  useEffect(carregar, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const visiveis = useMemo(() => {
    const t = semAcento(filtro.trim());
    if (!itens || !t) return itens ?? [];
    return itens.filter((i) => semAcento(`${i.numero} ${i.descricao}`).includes(t));
  }, [itens, filtro]);

  const escolhidos = (itens ?? []).filter((i) => marcados.has(i.numero));
  const totalEscolhido = escolhidos.reduce((s, i) => s + (i.valorTotal ?? 0), 0);
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((i) => marcados.has(i.numero));

  const alternar = (n: string) =>
    setMarcados((m) => {
      const novo = new Set(m);
      if (novo.has(n)) novo.delete(n);
      else novo.add(n);
      return novo;
    });
  const marcarVisiveis = (sim: boolean) =>
    setMarcados((m) => {
      const novo = new Set(m);
      for (const i of visiveis) {
        if (sim) novo.add(i.numero);
        else novo.delete(i.numero);
      }
      return novo;
    });

  return (
    <Modal titulo="De quais itens vocês vão participar?" aoFechar={aoFechar} largo>
      <div className="escolher-itens">
        <p className="texto-suave pequeno escolher-itens-sub">
          {r.modalidade} nº {r.numero}/{r.ano} · {r.orgao}
        </p>

        {erro ? (
          <div className="alerta erro">
            {erro}{" "}
            <button className="botao link pequeno" onClick={carregar}>
              <RefreshCw size={13} /> Tentar de novo
            </button>
          </div>
        ) : !itens ? (
          <p className="texto-fraco carregando-linha">
            <Loader2 className="girando" /> Buscando os itens no PNCP…
          </p>
        ) : itens.length === 0 ? (
          <p className="texto-fraco">O órgão ainda não publicou os itens no PNCP. Você pode adicionar a licitação e lançar os itens depois na ficha.</p>
        ) : (
          <>
            <div className="escolher-itens-barra">
              {itens.length > 8 && (
                <div className="entrada com-icone pequena-entrada largo">
                  <Search />
                  <input placeholder="Procurar item (nº ou descrição)" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Procurar item" />
                </div>
              )}
              <button type="button" className="botao secundario pequeno" onClick={() => marcarVisiveis(true)} disabled={todosVisiveisMarcados}>
                <CheckSquare /> Selecionar todos{filtro.trim() ? " os mostrados" : ""}
              </button>
              <button type="button" className="botao secundario pequeno" onClick={() => marcarVisiveis(false)} disabled={!visiveis.some((i) => marcados.has(i.numero))}>
                <Square /> Desmarcar todos{filtro.trim() ? " os mostrados" : ""}
              </button>
            </div>

            <ul className="lista-escolher-itens">
              {visiveis.map((i) => (
                <li key={i.numero}>
                  <label className={marcados.has(i.numero) ? "marcado" : ""}>
                    <input type="checkbox" checked={marcados.has(i.numero)} onChange={() => alternar(i.numero)} />
                    <span className="escolher-item-num">{i.numero}</span>
                    <span className="escolher-item-desc">
                      {i.descricao}
                      <small>
                        {i.quantidade != null && `${i.quantidade.toLocaleString("pt-BR")} ${i.unidade ?? ""}`}
                        {i.valorUnitario != null && ` · ${reais(i.valorUnitario)} cada`}
                        {i.beneficio && ` · ${i.beneficio}`}
                      </small>
                    </span>
                    <span className="escolher-item-total">{reais(i.valorTotal)}</span>
                  </label>
                </li>
              ))}
              {visiveis.length === 0 && <li className="texto-fraco pequeno">Nenhum item com esse texto.</li>}
            </ul>
          </>
        )}

        <div className="escolher-itens-rodape">
          <span className="texto-suave pequeno">
            {itens && itens.length > 0 && (
              <>
                <strong>{escolhidos.length}</strong> de {itens.length} item(ns) selecionado(s)
                {totalEscolhido > 0 && <> · referência {reais(totalEscolhido)}</>}
              </>
            )}
          </span>
          <button className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao acento" disabled={!itens || (itens.length > 0 && escolhidos.length === 0)} onClick={() => aoConfirmar(escolhidos)}>
            <Plus /> {itens && itens.length === 0 ? "Adicionar sem itens" : `Adicionar ao quadro${escolhidos.length ? ` com ${escolhidos.length} item(ns)` : ""}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
