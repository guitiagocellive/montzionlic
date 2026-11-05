import { History, MessageSquare, Send, Trash2, X } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Atividade as Registro, Usuario } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { Avatar } from "./Avatar";
import { avisar } from "./Ui";

function quando(ms: number) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

interface Props {
  alvo: { licitacao_id: number } | { execucao_id: number };
  usuario: Usuario;
  aberto: boolean;
  aoFechar: () => void;
  aoContar?: (n: number) => void;
}

/** Painel lateral com comentários (com @menção) e o histórico do card. */
export function PainelAtividade({ alvo, usuario, aberto, aoFechar, aoContar }: Props) {
  const [lista, setLista] = useState<Registro[] | null>(null);
  const [filtro, setFiltro] = useState<"tudo" | "comentarios">("tudo");
  const [texto, setTexto] = useState("");
  const [mencoes, setMencoes] = useState<{ id: number; nome: string }[]>([]);
  const [equipe, setEquipe] = useState<{ id: number; nome: string }[]>([]);
  const [busca, setBusca] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const consulta = "licitacao_id" in alvo ? `licitacao_id=${alvo.licitacao_id}` : `execucao_id=${alvo.execucao_id}`;

  const carregar = useCallback(async () => {
    try {
      const r = await api<{ atividades: Registro[] }>(`/atividades?${consulta}`);
      setLista(r.atividades);
      aoContar?.(r.atividades.filter((a) => a.tipo === "comentario").length);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }, [consulta, aoContar]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (!aberto) return;
    carregar();
    api<{ equipe: { id: number; nome: string }[] }>("/equipe").then((r) => setEquipe(r.equipe), () => {});
    const aoTeclar = (e: globalThis.KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", aoTeclar);
    setTimeout(() => campo.current?.focus(), 200);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, carregar, aoFechar]);

  const sugestoes = useMemo(() => {
    if (busca === null) return [];
    const t = busca.toLowerCase();
    return equipe.filter((p) => p.id !== usuario.id && p.nome.toLowerCase().includes(t)).slice(0, 5);
  }, [busca, equipe, usuario.id]);

  function aoDigitar(valor: string) {
    setTexto(valor);
    const m = valor.slice(0, campo.current?.selectionStart ?? valor.length).match(/@([\p{L} ]{0,30})$/u);
    setBusca(m ? m[1] : null);
  }

  function mencionar(p: { id: number; nome: string }) {
    const pos = campo.current?.selectionStart ?? texto.length;
    const antes = texto.slice(0, pos).replace(/@([\p{L} ]{0,30})$/u, `@${p.nome} `);
    setTexto(antes + texto.slice(pos));
    setMencoes((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]));
    setBusca(null);
    campo.current?.focus();
  }

  async function enviar() {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await api("/atividades", {
        corpo: { ...alvo, texto, mencoes: mencoes.filter((m) => texto.includes(`@${m.nome}`)).map((m) => m.id) },
      });
      setTexto("");
      setMencoes([]);
      await carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setEnviando(false);
    }
  }

  async function apagar(id: number) {
    if (!confirm("Apagar este comentário?")) return;
    try {
      await api(`/atividades/${id}`, { metodo: "DELETE" });
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  function aoTeclarCampo(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (sugestoes.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      mencionar(sugestoes[0]);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      enviar();
    }
  }

  const visiveis = (lista ?? []).filter((a) => filtro === "tudo" || a.tipo === "comentario");

  // Destaca as menções no texto.
  const formatar = (t: string) =>
    t.split(/(@[\p{L}]+(?: [\p{L}]+)?)/u).map((parte, i) =>
      parte.startsWith("@") ? (
        <span key={i} className="mencao">
          {parte}
        </span>
      ) : (
        parte
      ),
    );

  return createPortal(
    <>
      {aberto && <div className="gaveta-fundo" onClick={aoFechar} />}
      <aside className={`gaveta ${aberto ? "aberta" : ""}`} aria-hidden={!aberto} aria-label="Comentários e histórico">
        <div className="gaveta-topo">
          <h2>Atividade</h2>
          <div className="segmentado">
            <button className={filtro === "tudo" ? "ativo" : ""} onClick={() => setFiltro("tudo")}>
              Tudo
            </button>
            <button className={filtro === "comentarios" ? "ativo" : ""} onClick={() => setFiltro("comentarios")}>
              Comentários
            </button>
          </div>
          <button className="botao-icone" onClick={aoFechar} aria-label="Fechar">
            <X />
          </button>
        </div>

        <div className="gaveta-lista">
          {lista === null ? (
            <p className="texto-fraco pequeno">Carregando…</p>
          ) : visiveis.length === 0 ? (
            <p className="texto-fraco pequeno centralizado" style={{ padding: "30px 0" }}>
              {filtro === "comentarios" ? "Nenhum comentário ainda." : "Nada por aqui ainda."}
            </p>
          ) : (
            visiveis.map((a) =>
              a.tipo === "comentario" ? (
                <div key={a.id} className="comentario">
                  <Avatar nome={a.usuario_nome ?? "?"} cor={a.usuario_cor} foto={a.usuario_foto} pequeno />
                  <div className="comentario-corpo">
                    <div className="comentario-topo">
                      <strong>{a.usuario_nome ?? "Pessoa removida"}</strong>
                      <small>{quando(a.criado_em)}</small>
                      {(a.usuario_id === usuario.id || usuario.papel === "admin") && (
                        <button className="botao-icone pequeno perigo" onClick={() => apagar(a.id)} aria-label="Apagar comentário">
                          <Trash2 />
                        </button>
                      )}
                    </div>
                    <p>{formatar(a.texto)}</p>
                  </div>
                </div>
              ) : (
                <div key={a.id} className="evento">
                  <History aria-hidden="true" />
                  <span>
                    <strong>{a.usuario_nome ?? "Sistema"}</strong> {a.texto}
                    <small> · {quando(a.criado_em)}</small>
                  </span>
                </div>
              ),
            )
          )}
        </div>

        <div className="gaveta-rodape">
          {sugestoes.length > 0 && (
            <div className="sugestoes">
              {sugestoes.map((p) => (
                <button key={p.id} onMouseDown={(e) => { e.preventDefault(); mencionar(p); }}>
                  <Avatar nome={p.nome} pequeno /> {p.nome}
                </button>
              ))}
            </div>
          )}
          <div className="caixa-comentario">
            <MessageSquare aria-hidden="true" />
            <textarea
              ref={campo}
              rows={2}
              value={texto}
              onChange={(e) => aoDigitar(e.target.value)}
              onKeyDown={aoTeclarCampo}
              placeholder="Escreva um comentário… use @ para mencionar"
              aria-label="Comentário"
            />
            <button className="botao pequeno" onClick={enviar} disabled={enviando || !texto.trim()} aria-label="Enviar comentário">
              <Send />
            </button>
          </div>
          <small className="texto-fraco">Ctrl + Enter para enviar. Quem for mencionado recebe uma notificação.</small>
        </div>
      </aside>
    </>,
    document.body,
  );
}
