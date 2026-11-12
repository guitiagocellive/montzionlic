import { BellRing, ClipboardCopy, FilePlus2, Eye, Download, ExternalLink, LogIn, MessageSquare, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AvisoAcomp, avisosDe, type CompraAcomp, dataDe, montarCompras, type PainelAcompanhamento, ROTULO_CHANCE } from "../../../shared/acompanhamento";
import { mensagemDeErro } from "../../api";
import { avisar, Modal } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import { link } from "../../rota";
import { CadastroProposta, NovaProposta } from "./CadastroProposta";
import { COR_CHANCE, ItemCompras } from "./ItemCompras";
import { noAplicativo, ponte, temPonte } from "../../robo/ponte";

// Aba Acompanhamento: as participações no Compras.gov.br (em andamento e finalizadas), com a colocação de
// cada item, a chance de ser chamado, os avisos do pregoeiro e a conversa com ele. Quem lê é o aplicativo do
// Windows, com a sessão que você abriu no gov.br; nada disso entra no quadro de licitações.


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
  const [aba, setAba] = useState<Filtro>("andamento");
  const [aberta, setAberta] = useState<string | null>(() => new URLSearchParams(window.location.search).get("compra"));
  const [agora, setAgora] = useState(Date.now());
  const pedida = useRef<string | null>(aberta); // compra que veio pelo link: ler já
  const versao = useRef(0);
  const [novaProposta, setNovaProposta] = useState(false);
  const [cadastro, setCadastro] = useState<string | null>(null);

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
        const p = await ponte.acompanhamento(compra, false, versao.current);
        if (!vivo) return;
        if (p.igual) {
          // Nada mudou: só atualiza o "lendo…" e a hora, sem montar a lista de novo.
          setPainel((atual) =>
            atual && (atual.buscando !== p.buscando || atual.em !== p.em || atual.fase !== p.fase || atual.problema !== p.problema || atual.conectado !== p.conectado)
              ? { ...atual, buscando: p.buscando, em: p.em, fase: p.fase, problema: p.problema, conectado: p.conectado }
              : atual,
          );
        } else {
          versao.current = p.versao ?? 0;
          setPainel(p);
        }
      } catch (e) {
        if (/desconhecido/i.test(mensagemDeErro(e))) setAntigo(true);
      }
      if (vivo) setAgora(Date.now());
    };
    ler();
    const t = setInterval(ler, 2000);
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

  function abrir(chave: string | null) {
    const nova = chave;
    setAberta(nova);
    if (nova) {
      pedida.current = nova;
      ponte.acompanhamento(nova).catch(() => {});
    }
  }

  async function atualizar() {
    try {
      versao.current = 0;
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
  // Já tem a última leitura guardada no computador: mostra a lista na hora e atualiza por trás.
  const temGuardado = (painel?.andamento?.length ?? 0) + (painel?.finalizadas?.length ?? 0) > 0;
  const lista = aba === "finalizadas" ? finalizadas : aba === "andamento" ? andamento : andamento.filter((c) => FILTROS[aba].fases.includes(c.faseCodigo));
  const compraAberta = [...andamento, ...finalizadas].find((c) => c.chave === aberta) ?? null;
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
            <button className="botao acento" onClick={() => setNovaProposta(true)}>
              <FilePlus2 /> Cadastrar proposta
            </button>
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
      ) : !temGuardado && (!painel.conectado || fase === "sem-login" || fase === "aguardando-login") ? (
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
      ) : !temGuardado && (fase === "entrando" || (!painel.em && !painel.andamento)) ? (
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
          {(painel.deCache || !painel.conectado) && (
            <div className="alerta aviso linha-erro-item">
              <span>
                Mostrando a última leitura{painel.em ? ` (${new Date(painel.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })})` : ""}.{" "}
                {painel.conectado ? "Atualizando com o Compras.gov.br…" : "Entre no Compras.gov.br para atualizar."}
              </span>
              {!painel.conectado && (
                <button className="botao acento pequeno" onClick={() => ponte.entrar(fase === "aguardando-login").catch((e) => avisar(mensagemDeErro(e), "erro"))}>
                  <LogIn /> {fase === "aguardando-login" ? "Mostrar a janela de login" : "Entrar com gov.br"}
                </button>
              )}
            </div>
          )}
          {(painel.andamento?.length ?? 0) > andamento.length && (
            <p className="alerta aviso">
              O Compras.gov.br devolveu {painel.andamento?.length} participações, mas {painel.andamento!.length - andamento.length} vieram num formato que eu ainda não reconheço.{" "}
              <button className="botao-link sem-margem" onClick={copiarDiagnostico}>
                Copiar diagnóstico
              </button>{" "}
              e mande para o suporte.
            </p>
          )}

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

          {avisos.length > 0 && <Avisos avisos={avisos} compras={andamento} aoAbrir={(k) => abrir(k)} />}

          <div className="lista-compras-topo">
            <span className="texto-fraco pequeno">
              Exibindo {lista.length} registro(s) · {painel.buscando ? "lendo o Compras.gov.br…" : `atualizado ${ha(painel.em, agora)}`}
            </span>
            <select value={aba} onChange={(e) => setAba(e.target.value as Filtro)} aria-label="Filtrar participações">
              {(Object.keys(FILTROS) as Filtro[]).map((f) => (
                <option key={f} value={f}>
                  {FILTROS[f].rotulo} ({f === "finalizadas" ? finalizadas.length : f === "andamento" ? andamento.length : andamento.filter((c) => FILTROS[f].fases.includes(c.faseCodigo)).length})
                </option>
              ))}
            </select>
          </div>

          {lista.length === 0 ? (
            <p className="texto-fraco vazio-acomp">
              {aba === "finalizadas" ? "Nenhuma participação finalizada recente." : "Nenhuma participação aqui."} Se no Compras.gov.br aparecem participações, clique em
              Atualizar; se continuar vazio, use o Copiar diagnóstico abaixo.
            </p>
          ) : (
            <div className="lista-compras">
              {lista.map((c) => (
                <LinhaCompra key={c.chave} compra={c} cnpj={painel.cnpj ?? ""} aoAbrir={() => abrir(c.chave)} />
              ))}
            </div>
          )}
          {novaProposta && (
            <NovaProposta
              aoFechar={() => setNovaProposta(false)}
              aoEscolher={(k) => {
                setNovaProposta(false);
                setCadastro(k);
              }}
            />
          )}
          {cadastro && <CadastroProposta chave={cadastro} cnpj={painel.cnpj ?? ""} aoFechar={() => setCadastro(null)} />}
          {compraAberta && !cadastro && <JanelaCompra compra={compraAberta} cnpj={painel.cnpj ?? ""} agora={agora} aoFechar={() => abrir(null)} aoCadastrar={() => setCadastro(compraAberta.chave)} />}
          <p className="texto-fraco pequeno nota-acomp">
            O aplicativo relê a lista a cada 3 minutos e a compra que você abre na hora. A chance é uma estimativa pela colocação: o pregoeiro analisa a 1ª colocada e,
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

type Filtro = "andamento" | "propostas" | "disputa" | "selecao" | "finalizadas";
const FILTROS: Record<Filtro, { rotulo: string; fases: string[] }> = {
  andamento: { rotulo: "Em andamento", fases: [] },
  propostas: { rotulo: "Propostas", fases: ["1", "2", "6"] },
  disputa: { rotulo: "Disputa", fases: ["3", "99"] },
  selecao: { rotulo: "Seleção de fornecedores", fases: ["4"] },
  finalizadas: { rotulo: "Finalizadas", fases: [] },
};

const NOME_MODALIDADE: Record<string, string> = { Pregão: "Pregão eletrônico", Dispensa: "Dispensa eletrônica", Concorrência: "Concorrência eletrônica", Cotação: "Cotação eletrônica" };
const nomeCompra = (c: CompraAcomp) => `${NOME_MODALIDADE[c.modalidade] ?? c.modalidade} Nº ${c.numero}`;

/** Etiquetas da compra: melhor chance entre os itens, convocação e se o pregoeiro falou com você. */
function etiquetas(c: CompraAcomp, cnpj: string) {
  const ordem = ["ganhou", "alta", "media", "baixa", "aguardando", "fora", "encerrado"];
  const melhor = [...c.itens].sort((a, b) => ordem.indexOf(a.chance) - ordem.indexOf(b.chance) || (a.colocacao ?? 99) - (b.colocacao ?? 99))[0];
  const convocado = c.itens.some((i) => i.pendencias.length || i.chatAberto);
  const falou = c.mensagens.some((m) => m.quem === "pregoeiro" && (m.destinatario === cnpj || (!!cnpj && m.texto.replace(/\D/g, "").includes(cnpj))));
  const doPregoeiro = c.mensagens.filter((m) => m.quem === "pregoeiro").length;
  return { melhor, convocado, falou, doPregoeiro };
}

function LinhaCompra({ compra: c, cnpj, aoAbrir }: { compra: CompraAcomp; cnpj: string; aoAbrir: () => void }) {
  const { melhor, convocado, falou, doPregoeiro } = etiquetas(c, cnpj);
  return (
    <button className={`linha-compra ${convocado ? "com-chamado" : ""}`} onClick={aoAbrir}>
      <span className="titulo-linha-compra">
        <strong>{nomeCompra(c).toUpperCase()}</strong>
        <span>
          {c.uasg} - {c.orgao || "Órgão"}
        </span>
        {c.objeto && <span className="objeto-acomp texto-fraco">{c.objeto}</span>}
      </span>
      <span className="etapa-linha-compra">
        <small>Etapa</small> {c.fase || "—"}
      </span>
      <span className="etiquetas-compra">
        {convocado && <span className="chip vermelho">Convocado</span>}
        {falou && <span className="chip azul">Pregoeiro falou com você</span>}
        {melhor && melhor.colocacao != null && (
          <span className={`chip ${COR_CHANCE[melhor.chance]}`} title={melhor.explicacao}>
            {ROTULO_CHANCE[melhor.chance]} · {melhor.colocacao}º
          </span>
        )}
        {melhor && melhor.colocacao == null && melhor.chance !== "aguardando" && <span className={`chip ${COR_CHANCE[melhor.chance]}`}>{ROTULO_CHANCE[melhor.chance]}</span>}
        {!c.lidaEm && <span className="chip cinza">Lendo itens…</span>}
        {doPregoeiro > 0 && !falou && (
          <span className="chip cinza">
            <MessageSquare size={12} /> {doPregoeiro}
          </span>
        )}
      </span>
    </button>
  );
}

const PASSOS = ["Propostas", "Disputa", "Seleção de fornecedores", "Remanescentes"];
const passoDa = (c: CompraAcomp) => (["1", "2", "6"].includes(c.faseCodigo) ? 0 : ["3", "99"].includes(c.faseCodigo) ? 1 : c.faseCodigo === "4" ? 2 : c.encerrada ? 3 : -1);

/** Janela da compra (como "Acompanhamento seleção de fornecedores"): itens com colocação e o "Ver item". */
function JanelaCompra({ compra: c, cnpj, agora, aoFechar, aoCadastrar }: { compra: CompraAcomp; cnpj: string; agora: number; aoFechar: () => void; aoCadastrar: () => void }) {
  const [itemAberto, setItemAberto] = useState<number | null>(null);
  const passo = passoDa(c);
  const indice = c.itens.findIndex((i) => i.numero === itemAberto);
  const item = indice >= 0 ? c.itens[indice] : null;
  return (
    <Modal titulo={item ? `${nomeCompra(c)} · Item ${item.numero}` : nomeCompra(c)} aoFechar={aoFechar} largo>
      <style>{".modal.largo:has(.janela-compra){max-width:1100px}"}</style>
      <div className="janela-compra">
        <div className="cabeca-janela-compra">
          <div>
            <strong>{nomeCompra(c)}</strong>
            <span>
              UASG {c.uasg} - {c.orgao}
            </span>
            {c.abertura && <span className="texto-fraco pequeno">Abertura: {dataHora(c.abertura)}</span>}
          </div>
          <ol className="passos-compra">
            {PASSOS.map((p, i) => (
              <li key={p} className={i === passo ? "atual" : i < passo ? "feito" : ""}>
                <span>{p}</span>
                <i />
              </li>
            ))}
          </ol>
        </div>

        {item ? (
          <>
            <button className="botao-link sem-margem voltar-itens" onClick={() => setItemAberto(null)}>
              ← Todos os itens
            </button>
            <ItemCompras
              key={item.numero}
              compra={c}
              item={item}
              cnpj={cnpj}
              anterior={indice > 0 ? () => setItemAberto(c.itens[indice - 1].numero) : undefined}
              proximo={indice < c.itens.length - 1 ? () => setItemAberto(c.itens[indice + 1].numero) : undefined}
            />
          </>
        ) : (
          <>
            {["1", "2", "6"].includes(c.faseCodigo) && (
              <div className="alerta aviso linha-erro-item">
                <span>Esta compra está na fase de propostas: dá para cadastrar ou alterar a proposta daqui.</span>
                <button className="botao acento pequeno" onClick={aoCadastrar}>
                  <FilePlus2 /> Cadastrar / alterar proposta
                </button>
              </div>
            )}
            <div className="lista-compras-topo">
              <span className="texto-fraco pequeno">{c.lidaEm ? `Exibindo ${c.itens.length} item(ns) · lidos ${ha(c.lidaEm, agora)}` : "Lendo os itens no Compras.gov.br…"}</span>
              {c.linkPncp && (
                <a className="botao-link sem-margem" href={c.linkPncp} target="_blank" rel="noreferrer">
                  Edital no PNCP <ExternalLink size={12} />
                </a>
              )}
            </div>
            {!c.lidaEm ? (
              <p className="texto-suave carregando-marcas">
                <RefreshCw className="girando" size={16} /> Lendo os itens e as mensagens desta compra…
              </p>
            ) : c.itens.length === 0 ? (
              c.erros.length ? (
                <p className="texto-fraco">
                  Não consegui ler os itens desta compra agora ({c.erros.join(" · ")}). O aplicativo tenta de novo
                  sozinho; se continuar, use “Copiar diagnóstico” no fim da lista.
                </p>
              ) : (
                <p className="texto-fraco">Nenhum item com proposta sua nesta compra.</p>
              )
            ) : (
              <ul className="itens-compra">
                {c.itens.map((it) => (
                  <li key={it.numero} className={`item-compra chance-${it.chance}`}>
                    <div className="desc-item-compra">
                      <strong>
                        {it.numero} &nbsp;{it.descricao.toUpperCase()}
                      </strong>
                      <span className="etapa-item-compras">{it.etapa || it.situacao || "—"}</span>
                    </div>
                    <dl>
                      <dt>Qtde solicitada</dt>
                      <dd>{it.quantidade ?? "—"}</dd>
                      <dt>Sua proposta</dt>
                      <dd>{formatarMoeda(it.meuValor)}</dd>
                    </dl>
                    <div className="colocacao-item-compra">
                      <strong>{ordinal(it.colocacao)}</strong>
                      <span className="texto-fraco pequeno">{it.participantes ? `de ${it.participantes}` : "colocação"}</span>
                    </div>
                    <div className="etiquetas-item">
                      <span className={`chip ${COR_CHANCE[it.chance]}`} title={it.explicacao}>
                        {ROTULO_CHANCE[it.chance]}
                      </span>
                      {it.pendencias.map((p) => (
                        <span key={p.tipo} className="chip vermelho">
                          {p.rotulo}
                        </span>
                      ))}
                      {it.situacao && it.chance !== "fora" && <span className="chip verde">{it.situacao}</span>}
                    </div>
                    <button className="botao acento pequeno" onClick={() => setItemAberto(it.numero)}>
                      <Eye /> Ver item
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {c.lidaEm && (
              <details className="mensagens-compra">
                <summary>
                  <MessageSquare size={14} /> Mensagens da compra ({c.mensagens.length})
                </summary>
                <Conversa compra={c} />
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
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
