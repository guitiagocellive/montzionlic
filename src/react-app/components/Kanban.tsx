import { Plus } from "lucide-react";
import { type DragEvent, type ReactNode, useRef, useState } from "react";
import type { Etapa } from "../../shared/negocio";

interface CardBase {
  id: number;
  etapa: string;
  posicao: number;
}

interface Props<T extends CardBase> {
  etapas: Etapa[];
  cards: T[];
  renderCard: (card: T) => ReactNode;
  aoAbrir: (card: T) => void;
  aoMover: (card: T, etapa: string, posicao: number) => void;
  aoNovo?: (etapa: string) => void;
  rodapeColuna?: (etapa: string, cards: T[]) => ReactNode;
}

/** Quadro em colunas com arrastar e soltar (estilo ClickUp). */
export function Kanban<T extends CardBase>({
  etapas,
  cards,
  renderCard,
  aoAbrir,
  aoMover,
  aoNovo,
  rodapeColuna,
}: Props<T>) {
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [alvo, setAlvo] = useState<{ etapa: string; indice: number } | null>(null);
  const listas = useRef<Record<string, HTMLDivElement | null>>({});

  const porEtapa = (etapa: string) =>
    cards.filter((c) => c.etapa === etapa).sort((a, b) => a.posicao - b.posicao);

  function indiceNaColuna(etapa: string, y: number): number {
    const lista = listas.current[etapa];
    if (!lista) return 0;
    const elementos = Array.from(lista.querySelectorAll<HTMLElement>("[data-card]")).filter(
      (el) => Number(el.dataset.card) !== arrastando,
    );
    const i = elementos.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? elementos.length : i;
  }

  function aoPassar(e: DragEvent, etapa: string) {
    if (arrastando == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const indice = indiceNaColuna(etapa, e.clientY);
    if (alvo?.etapa !== etapa || alvo.indice !== indice) setAlvo({ etapa, indice });
  }

  function aoSoltar(e: DragEvent, etapa: string) {
    e.preventDefault();
    const card = cards.find((c) => c.id === arrastando);
    setArrastando(null);
    setAlvo(null);
    if (!card) return;

    const destino = porEtapa(etapa).filter((c) => c.id !== card.id);
    const indice = indiceNaColuna(etapa, e.clientY);
    const antes = destino[indice - 1]?.posicao;
    const depois = destino[indice]?.posicao;
    let posicao: number;
    if (antes == null && depois == null) posicao = 1;
    else if (antes == null) posicao = depois! - 1;
    else if (depois == null) posicao = antes + 1;
    else posicao = (antes + depois) / 2;

    if (card.etapa === etapa && card.posicao === posicao) return;
    aoMover(card, etapa, posicao);
  }

  return (
    <div className="kanban">
      {etapas.map((etapa) => {
        const lista = porEtapa(etapa.chave);
        return (
          <section
            key={etapa.chave}
            className={`coluna ${alvo?.etapa === etapa.chave ? "alvo" : ""}`}
            style={{ ["--cor-etapa" as string]: etapa.cor }}
            onDragOver={(e) => aoPassar(e, etapa.chave)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setAlvo(null);
            }}
            onDrop={(e) => aoSoltar(e, etapa.chave)}
          >
            <header className="coluna-topo">
              <span className="coluna-ponto" />
              <h3>{etapa.nome}</h3>
              <span className="coluna-total">{lista.length}</span>
              {aoNovo && (
                <button
                  className="botao-icone pequeno"
                  onClick={() => aoNovo(etapa.chave)}
                  aria-label={`Adicionar em ${etapa.nome}`}
                >
                  <Plus />
                </button>
              )}
            </header>
            <div className="coluna-lista" ref={(el) => void (listas.current[etapa.chave] = el)}>
              {lista.map((card, i) => (
                <div key={card.id}>
                  {alvo?.etapa === etapa.chave && alvo.indice === i && <div className="marcador-soltar" />}
                  <article
                    data-card={card.id}
                    className={`card-kanban ${arrastando === card.id ? "arrastando" : ""}`}
                    draggable
                    tabIndex={0}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(card.id));
                      setArrastando(card.id);
                    }}
                    onDragEnd={() => {
                      setArrastando(null);
                      setAlvo(null);
                    }}
                    onClick={() => aoAbrir(card)}
                    onKeyDown={(e) => e.key === "Enter" && aoAbrir(card)}
                  >
                    {renderCard(card)}
                  </article>
                </div>
              ))}
              {alvo?.etapa === etapa.chave && alvo.indice >= lista.filter((c) => c.id !== arrastando).length && (
                <div className="marcador-soltar" />
              )}
              {lista.length === 0 && !alvo && <div className="coluna-vazia">Arraste um card para cá</div>}
            </div>
            {rodapeColuna?.(etapa.chave, lista)}
          </section>
        );
      })}
    </div>
  );
}
