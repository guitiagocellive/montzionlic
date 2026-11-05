import { Bell, BellRing, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Notificacao } from "../../shared/tipos";
import { api } from "../api";
import { navegar } from "../rota";
import { useFecharAoClicarFora } from "./useFecharAoClicarFora";

const INTERVALO = 2 * 60 * 1000;

function tempo(ms: number) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

/** Sino do topo: lista os avisos e mostra notificação do navegador para os novos. */
export function Notificacoes() {
  const [lista, setLista] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [permissao, setPermissao] = useState(() =>
    typeof Notification === "undefined" ? "denied" : Notification.permission,
  );
  const ancora = useRef<HTMLDivElement>(null);
  useFecharAoClicarFora(ancora, aberto, () => setAberto(false));

  const carregar = useCallback(async () => {
    try {
      const r = await api<{ notificacoes: Notificacao[]; naoLidas: number }>("/notificacoes");
      setLista(r.notificacoes);
      setNaoLidas(r.naoLidas);
      avisarNoNavegador(r.notificacoes);
    } catch {
      // sem conexão: tenta de novo no próximo ciclo
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, INTERVALO);
    const aoVoltar = () => document.visibilityState === "visible" && carregar();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [carregar]);

  async function abrir(n: Notificacao) {
    setAberto(false);
    if (!n.lida) {
      setLista((l) => l.map((x) => (x.id === n.id ? { ...x, lida: true } : x)));
      setNaoLidas((v) => Math.max(0, v - 1));
      api("/notificacoes/lidas", { corpo: { ids: [n.id] } }).catch(() => {});
    }
    if (n.link) navegar(n.link);
  }

  async function lerTodas() {
    setLista((l) => l.map((x) => ({ ...x, lida: true })));
    setNaoLidas(0);
    await api("/notificacoes/lidas", { corpo: { todas: true } }).catch(() => {});
  }

  async function ativarNavegador() {
    if (typeof Notification === "undefined") return;
    setPermissao(await Notification.requestPermission());
  }

  return (
    <div className="ancora" ref={ancora}>
      <button
        className={`botao-topo ${aberto ? "aberto" : ""}`}
        onClick={() => setAberto((v) => !v)}
        aria-label={`Notificações${naoLidas ? ` (${naoLidas} novas)` : ""}`}
        aria-expanded={aberto}
      >
        <Bell />
        {naoLidas > 0 && <span className="contador">{naoLidas > 99 ? "99+" : naoLidas}</span>}
      </button>

      {aberto && (
        <div className="menu-flutuante painel-notificacoes" role="dialog" aria-label="Notificações">
          <div className="notificacoes-topo">
            <h3>Notificações</h3>
            {naoLidas > 0 && (
              <button className="botao link" onClick={lerTodas}>
                <CheckCheck size={15} /> Marcar como lidas
              </button>
            )}
          </div>
          <div className="notificacoes-lista">
            {lista.length === 0 ? (
              <p className="texto-fraco pequeno centralizado" style={{ padding: "28px 12px" }}>
                Nenhuma notificação por enquanto.
              </p>
            ) : (
              lista.map((n) => (
                <button key={n.id} className={`notificacao ${n.lida ? "lida" : ""}`} onClick={() => abrir(n)}>
                  <span className="ponto-nao-lida" />
                  <span>
                    <strong>{n.titulo}</strong>
                    {n.mensagem && <span className="mensagem">{n.mensagem}</span>}
                    <small>{tempo(n.criadoEm)}</small>
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="notificacoes-rodape">
            <button
              className="botao secundario pequeno"
              onClick={() => {
                setAberto(false);
                navegar("/alertas");
              }}
            >
              <BellRing /> Ver alertas
            </button>
            {permissao === "default" && (
              <button className="botao pequeno" onClick={ativarNavegador}>
                Avisar no navegador
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Mostra notificação do sistema para avisos novos (se a pessoa permitiu).
function avisarNoNavegador(lista: Notificacao[]) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  let ultimo = 0;
  try {
    ultimo = Number(localStorage.getItem("ultima-notificacao") ?? 0);
  } catch {
    return;
  }
  const novas = lista.filter((n) => !n.lida && n.id > ultimo);
  if (novas.length === 0) return;
  try {
    localStorage.setItem("ultima-notificacao", String(Math.max(...lista.map((n) => n.id))));
  } catch {
    // ignora
  }
  // Na primeira vez, só registra (não dispara uma enxurrada de avisos antigos).
  if (ultimo === 0) return;
  for (const n of novas.slice(0, 3)) {
    const aviso = new Notification(n.titulo, { body: n.mensagem ?? undefined, tag: `montzion-${n.id}` });
    aviso.onclick = () => {
      window.focus();
      if (n.link) navegar(n.link);
    };
  }
}
