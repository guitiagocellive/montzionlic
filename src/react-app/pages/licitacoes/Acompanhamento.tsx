import { BellRing, ChevronDown, ClipboardCopy, Download, ExternalLink, LogIn, MessageSquare, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AvisoAcomp, avisosDe, type Chance, type CompraAcomp, dataDe, type ItemAcomp, montarCompras, type PainelAcompanhamento, ROTULO_CHANCE } from "../../../shared/acompanhamento";
import { mensagemDeErro } from "../../api";
import { avisar } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import { link } from "../../rota";
import { noAplicativo, ponte, temPonte } from "../../robo/ponte";

// Aba Acompanhamento: as participações no Compras.gov.br (em andamento e finalizadas), com a colocação de
// cada item, a chance de ser chamado, os avisos do pregoeiro e a conversa com ele. Quem lê é o aplicativo do
// Windows, com a sessão que você abriu no gov.br; nada disso entra no quadro de licitações.

const COR_CHANCE: Record<Chance, string> = {
  ganhou: "verde",
  alta: "verde",
  media: "amarelo",
  baixa: "vermelho",
  fora: "cinza",
  aguardando: "azul",
  encerrado: "cinza",
};

function ha(ms: number | null, agora: number) {
  if (!ms) return "";
  const min = Math.round((agora - ms) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}

function dataHora(s: string | null) {
  const t = dataDe(s ?? "");
  if (!t) return "";
  return new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ordinal = (n: number | null) => (n == null ? "—" : `${n}º`);

export function Acompanhamento() {
  const [ligada, setLigada] = useState(temPonte());
  const [antigo, setAntigo] = useState(false);
  const [painel, setPainel] = useState<PainelAcompanhamento | null>(null);
  const [aba, setAba] = useState<"andamento" | "finalizadas">("andamento");
  const [aberta, setAberta] = useState<string | null>(() => new URLSearchParams(window.location.search).get("compra"));
  const [agora, setAgora] = useState(Date.now());
  const pedida = useRef<string | null>(null);

  useEffect(() => {
    if (ligada) return;
    const t = setInterval(() => temPonte() && setLigada(true), 1000);
    return () => clearInterval(t);
  }, [ligada]);

  // O aplicativo guarda a última leitura; aqui só perguntamos a ele (no próprio computador) a cada 3 s.
  useEffect(() => {
    if (!ligada) return;
    let vivo = true;
    const ler = async () => {
      try {
        const compra = pedida.current ?? "";
        pedida.current = null;
        const p = await ponte.acompanhamento(compra);
        if (vivo) setPainel(p);
      } catch (e) {
        if (/desconhecido/i.test(mensagemDeErro(e))) setAntigo(true);
      }
      if (vivo) setAgora(Date.now());
    };
    ler();
    const t = setInterval(ler, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [ligada]);

  const andamento = useMemo(() => montarCompras(painel?.andamento ?? null, painel?.detalhes ?? null), [painel]);
  const finalizadas = useMemo(() => {
    const emAndamento = new Set(andamento.map((c) => c.chave));
    return montarCompras(painel?.finalizadas ?? null, painel?.detalhes ?? null).filter((c) => !emAndamento.has(c.chave));
  }, [painel, andamento]);
  const avisos = useMemo(() => avisosDe(andamento, painel?.agora ?? Date.now()), [andamento, painel?.agora]);

  // Se a compra veio por link (?compra=), abre na aba certa.
  useEffect(() => {
    if (aberta && finalizadas.some((c) => c.chave === aberta) && !andamento.some((c) => c.chave === aberta)) setAba("finalizadas");
  }, [aberta, andamento, finalizadas]);

  function abrir(chave: string) {
    const nova = aberta === chave ? null : chave;
    setAberta(nova);
    if (nova) {
      pedida.current = nova;
      ponte.acompanhamento(nova).catch(() => {});
    }
  }

  async function atualizar() {
    try {
      setPainel(await ponte.acompanhamento(aberta ?? "", true));
      avisar("Lendo as participações no Compras.gov.br…");
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    }
  }

  async function copiarDiagnostico() {
    try {
      const { texto } = await ponte.diagnostico();
      await navigator.clipboard.writeText(texto);
      avisar("Diagnóstico copiado. Cole na conversa com o suporte (não tem senhas, chaves nem CPF).");
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    }
  }

  const fase = painel?.fase ?? "";
  const lista = aba === "andamento" ? andamento : finalizadas;
  const emPrimeiro = andamento.reduce((s, c) => s + c.itens.filter((i) => i.colocacao === 1 && i.chance !== "fora").length, 0);
  const convocacoes = andamento.reduce((s, c) => s + c.itens.filter((i) => i.pendencias.length).length, 0);

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Acompanhamento</h1>
          <p className="texto-suave">
            Suas participações no Compras.gov.br: colocação em cada item, chance de ser chamado, avisos e mensagens do pregoeiro.
          </p>
        </div>
        {ligada && painel?.conectado && (
          <div className="cabecalho-acoes">
            <span className="texto-fraco pequeno">{painel.buscando ? "Lendo…" : painel.em ? `Atualizado ${ha(painel.em, agora)}` : ""}</span>
            <button className="botao secundario" onClick={atualizar} disabled={painel.buscando}>
              <RefreshCw className={painel.buscando ? "girando" : ""} /> Atualizar
            </button>
          </div>
        )}
      </div>

      {!ligada && noAplicativo() ? (
        <section className="cartao disputas-aviso entrar">
          <RefreshCw className="girando" />
          <div>
            <h2>Ligando o aplicativo…</h2>
            <p className="texto-suave">Em alguns segundos o acompanhamento aparece aqui.</p>
          </div>
        </section>
      ) : !ligada || antigo ? (
        <section className="cartao disputas-aviso entrar">
          <Download />
          <div>
            <h2>{antigo ? "Atualize o aplicativo Montzion" : "O acompanhamento funciona pelo aplicativo do Windows"}</h2>
            <p className="texto-suave">
              {antigo
                ? "Esta versão do aplicativo ainda não lê as participações. Vá em Configurações → Aplicativo e clique em Verificar atualização."
                : "É o aplicativo que lê as suas participações com a sessão que você abre no gov.br. Sua senha e seu certificado não passam pela plataforma."}
            </p>
            <a className="botao acento" {...link("/configuracoes/aplicativo")}>
              <Download /> {antigo ? "Atualizar o aplicativo" : "Baixar o aplicativo"}
            </a>
          </div>
        </section>
      ) : !painel ? (
        <section className="cartao disputas-aviso entrar">
          <RefreshCw className="girando" />
          <div>
            <h2>Carregando…</h2>
          </div>
        </section>
      ) : !painel.conectado || fase === "sem-login" || fase === "aguardando-login" ? (
        <section className="cartao disputas-aviso entrar">
          <LogIn />
          <div>
            <h2>{fase === "aguardando-login" ? "Entre com a sua conta gov.br na janela que abriu" : "Entre na sua conta do Compras.gov.br"}</h2>
            <p className="texto-suave">Depois de entrar uma vez, o aplicativo acompanha as participações sozinho e avisa no sino quando o pregoeiro chamar.</p>
            <button className="botao acento" onClick={() => ponte.entrar(fase === "aguardando-login").catch((e) => avisar(mensagemDeErro(e), "erro"))}>
              <LogIn /> {fase === "aguardando-login" ? "Mostrar a janela de login" : "Entrar com gov.br"}
            </button>
          </div>
        </section>
      ) : fase === "entrando" || (!painel.em && !painel.andamento) ? (
        <section className="cartao disputas-aviso entrar">
          {painel.problema ? <TriangleAlert /> : <RefreshCw className="girando" />}
          <div>
            <h2>{painel.problema ? "Não consegui ler as participações" : fase === "entrando" ? "Entrando no Compras.gov.br…" : "Lendo as suas participações…"}</h2>
            <p className={painel.problema ? "alerta erro" : "texto-suave"}>
              {painel.problema || "A primeira leitura leva até 1 minuto. Se o Compras.gov.br pedir para confirmar que você não é um robô, a janela dele aparece para você resolver."}
            </p>
            {painel.problema && (
              <div className="linha-acoes">
                <button className="botao acento" onClick={atualizar}>
                  <RefreshCw /> Tentar de novo
                </button>
                <button className="botao secundario" onClick={copiarDiagnostico}>
                  <ClipboardCopy /> Copiar diagnóstico
                </button>
              </div>
            )}
          </div>
        </section>
      ) : (
        <>
          {painel.problema && <p className="alerta erro">{painel.problema}</p>}

          <div className="resumo-acomp entrar">
            <div>
              <span>Em andamento</span>
              <strong>{andamento.length}</strong>
            </div>
            <div>
              <span>Itens em 1º lugar</span>
              <strong>{emPrimeiro}</strong>
            </div>
            <div className={convocacoes ? "destaque-acomp" : ""}>
              <span>Convocações abertas</span>
              <strong>{convocacoes}</strong>
            </div>
            <div>
              <span>Finalizadas</span>
              <strong>{finalizadas.length}</strong>
            </div>
          </div>

          {avisos.length > 0 && <Avisos avisos={avisos} compras={andamento} aoAbrir={(k) => (setAba("andamento"), aberta !== k && abrir(k))} />}

          <div className="disputas-topo">
            <div className="segmentado pequeno">
              <button className={aba === "andamento" ? "ativo" : ""} onClick={() => setAba("andamento")}>
                Em andamento ({andamento.length})
              </button>
              <button className={aba === "finalizadas" ? "ativo" : ""} onClick={() => setAba("finalizadas")}>
                Finalizadas ({finalizadas.length})
              </button>
            </div>
          </div>

          {lista.length === 0 ? (
            <p className="texto-fraco vazio-acomp">{aba === "andamento" ? "Nenhuma participação em andamento no Compras.gov.br." : "Nenhuma participação finalizada recente."}</p>
          ) : (
            <div className="lista-acomp">
              {lista.map((c) => (
                <CartaoCompra key={c.chave} compra={c} aberta={aberta === c.chave} aoAbrir={() => abrir(c.chave)} agora={agora} />
              ))}
            </div>
          )}
          <p className="texto-fraco pequeno nota-acomp">
            O aplicativo lê de novo a cada 8 minutos enquanto estiver aberto. A chance é uma estimativa pela colocação: o pregoeiro analisa a 1ª colocada e,
            se ela for recusada ou inabilitada, chama a próxima. Algo diferente do Compras.gov.br?{" "}
            <button className="botao-link sem-margem" onClick={copiarDiagnostico}>
              Copiar diagnóstico
            </button>
          </p>
        </>
      )}
    </>
  );
}

function Avisos({ avisos, compras, aoAbrir }: { avisos: AvisoAcomp[]; compras: CompraAcomp[]; aoAbrir: (chave: string) => void }) {
  const [todos, setTodos] = useState(false);
  const mostrar = todos ? avisos : avisos.slice(0, 5);
  return (
    <section className="cartao avisos-acomp entrar">
      <h2>
        <BellRing size={16} /> Avisos
      </h2>
      <ul>
        {mostrar.map((a) => {
          const c = compras.find((x) => x.chave === a.compra);
          return (
            <li key={a.chave} className={a.urgente ? "urgente" : ""}>
              <button onClick={() => aoAbrir(a.compra)}>
                <strong>{a.titulo}</strong>
                <span className="texto-suave">{a.mensagem}</span>
                {c?.orgao && <span className="texto-fraco pequeno">{c.orgao}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {avisos.length > 5 && (
        <button className="botao-link" onClick={() => setTodos((v) => !v)}>
          {todos ? "Mostrar menos" : `Ver todos os ${avisos.length} avisos`}
        </button>
      )}
    </section>
  );
}

function CartaoCompra({ compra: c, aberta, aoAbrir, agora }: { compra: CompraAcomp; aberta: boolean; aoAbrir: () => void; agora: number }) {
  const emPrimeiro = c.itens.filter((i) => i.colocacao === 1 && i.chance !== "fora").length;
  const chamados = c.itens.filter((i) => i.pendencias.length).length;
  const ganhos = c.itens.filter((i) => i.chance === "ganhou").length;
  const doPregoeiro = c.mensagens.filter((m) => m.quem === "pregoeiro").length;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (aberta) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [aberta]);
  return (
    <article ref={ref} className={`cartao compra-acomp ${aberta ? "aberta" : ""} ${chamados ? "com-chamado" : ""}`}>
      <button className="cabeca-acomp" onClick={aoAbrir} aria-expanded={aberta}>
        <div className="titulo-acomp">
          <span className="nome-acomp">
            {c.modalidade} {c.numero}
            <span className="texto-fraco"> · UASG {c.uasg}</span>
          </span>
          {c.orgao && <span className="orgao-acomp">{c.orgao}</span>}
          {c.objeto && <span className="objeto-acomp texto-suave">{c.objeto}</span>}
        </div>
        <div className="chips-acomp">
          {c.fase && <span className="chip">{c.fase}</span>}
          {chamados > 0 && <span className="chip vermelho">{chamados === 1 ? "1 convocação" : `${chamados} convocações`}</span>}
          {ganhos > 0 && <span className="chip verde">{ganhos === 1 ? "1 item ganho" : `${ganhos} itens ganhos`}</span>}
          {emPrimeiro > 0 && <span className="chip verde">{emPrimeiro === 1 ? "1 item em 1º" : `${emPrimeiro} itens em 1º`}</span>}
          {doPregoeiro > 0 && (
            <span className="chip azul">
              <MessageSquare size={12} /> {doPregoeiro}
            </span>
          )}
          <ChevronDown className="seta-acomp" size={18} />
        </div>
      </button>
      {aberta && <DetalheCompra compra={c} agora={agora} />}
    </article>
  );
}

function DetalheCompra({ compra: c, agora }: { compra: CompraAcomp; agora: number }) {
  return (
    <div className="corpo-acomp">
      <div className="info-acomp texto-fraco pequeno">
        {c.abertura && <span>Abertura: {dataHora(c.abertura)}</span>}
        <span>{c.lidaEm ? `Itens lidos ${ha(c.lidaEm, agora)}` : "Lendo os itens…"}</span>
        {c.linkPncp && (
          <a href={c.linkPncp} target="_blank" rel="noreferrer">
            Edital no PNCP <ExternalLink size={12} />
          </a>
        )}
      </div>
      {c.erros.length > 0 && !c.itens.length && <p className="alerta erro">O Compras.gov.br não devolveu tudo desta compra agora: {c.erros.join(" · ")}</p>}
      {!c.lidaEm ? (
        <p className="texto-suave carregando-marcas">
          <RefreshCw className="girando" size={16} /> Lendo os itens e as mensagens desta compra…
        </p>
      ) : c.itens.length === 0 ? (
        <p className="texto-fraco">Nenhum item com proposta sua nesta compra.</p>
      ) : (
        <ul className="itens-acomp">
          {c.itens.map((it) => (
            <LinhaItem key={it.numero} item={it} />
          ))}
        </ul>
      )}
      {c.lidaEm && <Conversa compra={c} />}
    </div>
  );
}

function LinhaItem({ item: it }: { item: ItemAcomp }) {
  const diferenca = it.meuValor != null && it.melhorValor != null && it.melhorValor > 0 && it.meuValor > it.melhorValor ? (it.meuValor / it.melhorValor - 1) * 100 : null;
  return (
    <li className={`item-acomp chance-${it.chance}`}>
      <span className="numero-acomp">{it.numero}</span>
      <div className="desc-acomp">
        <span className="texto-desc-acomp">{it.descricao}</span>
        <span className="texto-fraco pequeno">
          {[it.marca && `Marca ${it.marca}`, it.modelo, it.fase, it.situacao].filter(Boolean).join(" · ")}
        </span>
        {it.pendencias.map((p) => (
          <span key={p.tipo} className="pendencia-acomp">
            <BellRing size={12} /> {p.rotulo}: responda no Compras.gov.br
          </span>
        ))}
        {it.motivo && <span className="motivo-acomp">Motivo: {it.motivo}</span>}
      </div>
      <div className="colocacao-acomp">
        <strong>{ordinal(it.colocacao)}</strong>
        <span className="texto-fraco pequeno">{it.participantes ? `de ${it.participantes}` : "colocação"}</span>
      </div>
      <div className="valores-acomp">
        <span>{formatarMoeda(it.meuValor)}</span>
        <span className="texto-fraco pequeno">
          {it.melhorValor != null ? `melhor ${formatarMoeda(it.melhorValor)}` : ""}
          {diferenca != null ? ` (+${diferenca.toFixed(1).replace(".", ",")}%)` : ""}
        </span>
      </div>
      <div className="chance-acomp">
        <span className={`chip ${COR_CHANCE[it.chance]}`} title={it.explicacao}>
          {ROTULO_CHANCE[it.chance]}
        </span>
        <span className="texto-fraco pequeno">{it.explicacao}</span>
      </div>
    </li>
  );
}

function Conversa({ compra: c }: { compra: CompraAcomp }) {
  const [texto, setTexto] = useState("");
  const [item, setItem] = useState(() => c.itens.find((i) => i.pendencias.length || i.chatAberto)?.numero ?? 0);
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const ultimas = c.mensagens.slice(-40);
  useEffect(() => {
    const caixa = fim.current?.parentElement;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [ultimas.length]);

  async function enviar() {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await ponte.mensagem(c.chave, item, texto.trim());
      setTexto("");
      avisar("Mensagem enviada ao pregoeiro.");
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="conversa-acomp">
      <h3>
        <MessageSquare size={15} /> Mensagens
      </h3>
      <div className="mensagens-acomp">
        {ultimas.length === 0 ? (
          <p className="texto-fraco pequeno">Nenhuma mensagem nesta compra.</p>
        ) : (
          ultimas.map((m) => (
            <div key={m.id} className={`msg-acomp ${m.quem}`}>
              <span className="quem-acomp">
                {m.quem === "pregoeiro" ? "Pregoeiro" : m.quem === "voce" ? "Você" : "Sistema"}
                {m.item ? ` · item ${m.item}` : ""}
                <span className="texto-fraco"> {dataHora(m.dataHora)}</span>
              </span>
              <span>{m.texto}</span>
            </div>
          ))
        )}
        <div ref={fim} />
      </div>
      <div className="enviar-acomp">
        <select value={item} onChange={(e) => setItem(Number(e.target.value))} aria-label="Sobre qual item">
          <option value={0}>Sobre a compra</option>
          {c.itens.map((i) => (
            <option key={i.numero} value={i.numero}>
              Item {i.numero}
            </option>
          ))}
        </select>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escreva para o pregoeiro…"
          rows={2}
          maxLength={2000}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar();
          }}
        />
        <button className="botao acento" onClick={enviar} disabled={enviando || !texto.trim()}>
          <Send /> Enviar
        </button>
      </div>
      <p className="texto-fraco pequeno">O Compras.gov.br só aceita mensagem do fornecedor quando o pregoeiro abre a conversa para você (por exemplo, numa convocação).</p>
    </section>
  );
}
