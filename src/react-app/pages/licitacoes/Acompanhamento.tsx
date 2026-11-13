import { Bell, BellRing, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Gauge, Mail, Plus, ClipboardCopy, FilePlus2, Download, ExternalLink, LogIn, MessageSquare, Pencil, RefreshCw, Search, Send, Star, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AvisoAcomp, avisosDe, idEmpresa, type CompraAcomp, dataDe, montarCompras, type PainelAcompanhamento, ROTULO_CHANCE } from "../../../shared/acompanhamento";
import { api, mensagemDeErro } from "../../api";
import { avisar, Modal } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import { link } from "../../rota";
import { CadastroProposta, NovaProposta } from "./CadastroProposta";
import { chavePropostas, conversaDoItem, COR_CHANCE, estadoDoItem, ItemCompras, jaLido, lerCodigoSolicitada, preCarregarPropostas, type PropostasDoItem } from "./ItemCompras";
import { noAplicativo, ponte, type ResultadoTesteLeitura, temPonte } from "../../robo/ponte";
import { BotaoRecarregarGovBr } from "../../robo/ErroCompras";

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


export function Acompanhamento() {
  const [ligada, setLigada] = useState(temPonte());
  const [antigo, setAntigo] = useState(false);
  const [painel, setPainel] = useState<PainelAcompanhamento | null>(null);
  const [aba, setAba] = useState<Filtro>("andamento");
  const [aberta, setAberta] = useState<string | null>(() => new URLSearchParams(window.location.search).get("compra"));
  const [agora, setAgora] = useState(Date.now());
  const pedida = useRef<string | null>(aberta); // compra que veio pelo link: ler já
  const versao = useRef(0);
  const rapido = useRef(false);
  const deCache = useRef(false);
  const [novaProposta, setNovaProposta] = useState(false);
  const [cadastro, setCadastro] = useState<string | null>(null);
  const [verAvisos, setVerAvisos] = useState(false);
  const [testeLeitura, setTesteLeitura] = useState(false);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [marcas, setMarcas] = useState<Record<string, { favorito: boolean; apelido: string }>>({});
  const [apelidando, setApelidando] = useState<CompraAcomp | null>(null);

  // Favoritos e apelidos (da equipe toda), guardados na plataforma.
  useEffect(() => {
    api<{ marcas: Record<string, { favorito: boolean; apelido: string }> }>("/acompanhamento/marcas").then((r) => setMarcas(r.marcas), () => {});
  }, []);
  async function marcar(chave: string, novo: Partial<{ favorito: boolean; apelido: string }>) {
    const antes = marcas[chave] ?? { favorito: false, apelido: "" };
    const depois = { ...antes, ...novo };
    setMarcas((m) => ({ ...m, [chave]: depois }));
    try {
      await api(`/acompanhamento/marcas/${chave}`, { metodo: "PUT", corpo: novo });
    } catch (e) {
      setMarcas((m) => ({ ...m, [chave]: antes }));
      avisar(mensagemDeErro(e), "erro");
    }
  }

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
        if (!p.igual) deCache.current = !!p.deCache;
        rapido.current = !!p.conectado && (!!p.buscando || deCache.current);
        if (p.igual) {
          // Nada mudou: só atualiza o "lendo…" e a hora, sem montar a lista de novo.
          setPainel((atual) =>
            atual &&
            (atual.buscando !== p.buscando ||
              atual.em !== p.em ||
              atual.fase !== p.fase ||
              atual.problema !== p.problema ||
              atual.conectado !== p.conectado ||
              (p.cnpj && atual.cnpj !== p.cnpj) ||
              JSON.stringify(atual.lendo ?? []) !== JSON.stringify(p.lendo ?? []) ||
              atual.lendoMais !== p.lendoMais)
              ? { ...atual, buscando: p.buscando, em: p.em, fase: p.fase, problema: p.problema, conectado: p.conectado, cnpj: p.cnpj || atual.cnpj, lendo: p.lendo, lendoMais: p.lendoMais }
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
    // Enquanto a tela mostra a leitura guardada (ou está lendo), pergunta ao aplicativo bem mais rápido: a lista
    // nova aparece assim que chega. Depois, a cada 2 s.
    let t = 0;
    const volta = async () => {
      await ler();
      if (!vivo) return;
      t = window.setTimeout(volta, rapido.current ? 400 : 2000);
    };
    volta();
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [ligada]);

  // Código oficial de "SOLICITADA" (convocação para anexos etc.): lido uma vez, refaz as compras com ele.
  const [codigos, setCodigos] = useState(0);
  const conectadoAgora = !!painel?.conectado;
  useEffect(() => {
    if (!conectadoAgora) return;
    lerCodigoSolicitada().then((ok) => ok && setCodigos((n) => n + 1));
  }, [conectadoAgora]);
  const andamento = useMemo(() => montarCompras(painel?.andamento ?? null, painel?.detalhes ?? null), [painel, codigos]);
  const finalizadas = useMemo(() => {
    const emAndamento = new Set(andamento.map((c) => c.chave));
    return montarCompras(painel?.finalizadas ?? null, painel?.detalhes ?? null).filter((c) => !emAndamento.has(c.chave));
  }, [painel, andamento, codigos]);
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

  useEffect(() => setPagina(1), [aba, busca]);
  const fase = painel?.fase ?? "";
  // Já tem a última leitura guardada no computador: mostra a lista na hora e atualiza por trás.
  const temGuardado = (painel?.andamento?.length ?? 0) + (painel?.finalizadas?.length ?? 0) > 0;
  const base =
    aba === "finalizadas"
      ? finalizadas
      : aba === "favoritas"
        ? [...andamento, ...finalizadas].filter((c) => marcas[c.chave]?.favorito)
        : aba === "andamento"
          ? andamento
          : andamento.filter((c) => FILTROS[aba].fases.includes(c.faseCodigo));
  const termo = busca.trim().toLowerCase();
  const lista = base
    .filter((c) => !termo || [c.numero, c.uasg, c.orgao, c.objeto, marcas[c.chave]?.apelido ?? "", nomeCompra(c)].some((t) => t.toLowerCase().includes(termo)))
    .sort((a, b) => Number(!!marcas[b.chave]?.favorito) - Number(!!marcas[a.chave]?.favorito));
  const totalFinalizadas = Math.max(painel?.totalFinalizadas ?? 0, finalizadas.length);
  // Páginas de 10, como no Compras.gov.br. Nas finalizadas, a página escolhida é lida na hora se ainda não veio.
  const totalRegistros = aba === "finalizadas" && !termo ? totalFinalizadas : lista.length;
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const daPagina = lista.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);
  const faltaLer = aba === "finalizadas" && !termo && daPagina.length < Math.min(POR_PAGINA, totalRegistros - (paginaAtual - 1) * POR_PAGINA);
  const lendoMais = !!painel?.lendoMais;
  useEffect(() => {
    if (faltaLer && !lendoMais) ponte.acompanhamento("", false, 0, false, paginaAtual * POR_PAGINA).catch(() => {});
  }, [faltaLer, lendoMais, paginaAtual]);
  const totalAndamento = Math.max(painel?.totalAndamento ?? 0, andamento.length);
  const urgentes = avisos.filter((a) => a.urgente).length;
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
            <button className={`botao-sino-acomp ${urgentes ? "urgente" : ""}`} onClick={() => setVerAvisos(true)} aria-label={`Avisos (${avisos.length})`} title="Avisos das suas participações">
              {urgentes ? <BellRing /> : <Bell />}
              {avisos.length > 0 && <span className="contador-sino">{avisos.length > 99 ? "99+" : avisos.length}</span>}
            </button>
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
            <div className="linha-acoes">
              <button className="botao acento" onClick={() => ponte.entrar(fase === "aguardando-login").catch((e) => avisar(mensagemDeErro(e), "erro"))}>
                <LogIn /> {fase === "aguardando-login" ? "Mostrar a janela de login" : "Entrar com gov.br"}
              </button>
              {fase === "aguardando-login" && <BotaoRecarregarGovBr />}
            </div>
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
              {!painel.conectado && fase === "aguardando-login" && (
                <BotaoRecarregarGovBr />
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
              <strong>{totalAndamento}</strong>
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
              <strong>{totalFinalizadas}</strong>
            </div>
          </div>


          <div className="barra-acomp">
            <div className="entrada com-icone busca-acomp">
              <Search aria-hidden="true" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por número, órgão, objeto ou apelido" aria-label="Buscar participações" />
            </div>
            <select value={aba} onChange={(e) => setAba(e.target.value as Filtro)} aria-label="Filtrar participações">
              {(Object.keys(FILTROS) as Filtro[]).map((f) => (
                <option key={f} value={f}>
                  {FILTROS[f].rotulo} (
                  {f === "finalizadas"
                    ? totalFinalizadas
                    : f === "favoritas"
                      ? [...andamento, ...finalizadas].filter((c) => marcas[c.chave]?.favorito).length
                      : f === "andamento"
                        ? totalAndamento
                        : andamento.filter((c) => FILTROS[f].fases.includes(c.faseCodigo)).length}
                  )
                </option>
              ))}
            </select>
          </div>
          <span className="texto-fraco pequeno linha-contagem-acomp">
            {totalRegistros > 0
              ? `Exibindo ${(paginaAtual - 1) * POR_PAGINA + 1}–${Math.min(paginaAtual * POR_PAGINA, totalRegistros)} de ${totalRegistros} registro(s)`
              : "Exibindo 0 registro(s)"}{" "}
            · {painel.buscando ? "lendo o Compras.gov.br…" : `atualizado ${ha(painel.em, agora)}`}
          </span>

          {lista.length === 0 && !faltaLer ? (
            <p className="texto-fraco vazio-acomp">
              {aba === "finalizadas" ? "Nenhuma participação finalizada recente." : "Nenhuma participação aqui."} Se no Compras.gov.br aparecem participações, clique em
              Atualizar; se continuar vazio, use o Copiar diagnóstico abaixo.
            </p>
          ) : (
            <div className="lista-compras">
              {daPagina.map((c) => (
                <LinhaCompra
                  key={c.chave}
                  compra={c}
                  cnpj={painel.cnpj ?? ""}
                  marca={marcas[c.chave]}
                  lendo={!!painel.lendo?.[c.chave]}
                  aoAbrir={() => abrir(c.chave)}
                  aoFavoritar={() => marcar(c.chave, { favorito: !marcas[c.chave]?.favorito })}
                  aoApelidar={() => setApelidando(c)}
                />
              ))}
            </div>
          )}
          {faltaLer && (
            <p className="texto-suave carregando-marcas">
              <RefreshCw className="girando" size={16} /> Buscando a página {paginaAtual} no Compras.gov.br…
            </p>
          )}
          {totalPaginas > 1 && <Paginacao pagina={paginaAtual} total={totalPaginas} aoMudar={(n) => { setPagina(n); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
          {verAvisos && (
            <Modal titulo={`Avisos (${avisos.length})`} aoFechar={() => setVerAvisos(false)}>
              {avisos.length ? (
                <Avisos
                  avisos={avisos}
                  compras={andamento}
                  aoAbrir={(k) => {
                    setVerAvisos(false);
                    abrir(k);
                  }}
                />
              ) : (
                <p className="texto-fraco">Nenhum aviso agora. As convocações e mensagens do pregoeiro aparecem aqui (e no sino da plataforma).</p>
              )}
            </Modal>
          )}
          {apelidando && (
            <JanelaApelido
              compra={apelidando}
              atual={marcas[apelidando.chave]?.apelido ?? ""}
              aoSalvar={(apelido) => {
                marcar(apelidando.chave, { apelido });
                setApelidando(null);
              }}
              aoFechar={() => setApelidando(null)}
            />
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
          {compraAberta && !cadastro && <JanelaCompra compra={compraAberta} cnpj={compraAberta.meuCnpj || idEmpresa(painel.cnpj)} conectado={!!painel.conectado} agora={agora} aoFechar={() => abrir(null)} aoCadastrar={() => setCadastro(compraAberta.chave)} />}
          <p className="texto-fraco pequeno nota-acomp">
            O aplicativo relê a lista a cada 3 minutos e a compra que você abre na hora. A chance é uma estimativa pela colocação: o pregoeiro analisa a 1ª colocada e,
            se ela for recusada ou inabilitada, chama a próxima. Algo diferente do Compras.gov.br?{" "}
            <button className="botao-link sem-margem" onClick={copiarDiagnostico}>
              Copiar diagnóstico
            </button>
            {" · "}
            <button className="botao-link sem-margem botao-testar-leitura" onClick={() => setTesteLeitura(true)}>
              <Gauge size={13} /> Testar leitura do Compras
            </button>
          </p>
          {testeLeitura && <JanelaTesteLeitura aoFechar={() => setTesteLeitura(false)} />}
        </>
      )}
    </>
  );
}

function Avisos({ avisos, compras, aoAbrir }: { avisos: AvisoAcomp[]; compras: CompraAcomp[]; aoAbrir: (chave: string) => void }) {
  return (
    <section className="avisos-acomp janela-avisos">
      <ul>
        {avisos.map((a) => {
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
    </section>
  );
}

const segundos = (ms: number) => (ms < 1000 ? `${ms} ms` : ms >= 10_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`);

/** Mede a leitura das participações com páginas de 10, 25, 50 e 100 (na conta da pessoa) e mostra o que vale mais a pena. */
function JanelaTesteLeitura({ aoFechar }: { aoFechar: () => void }) {
  const [rodando, setRodando] = useState(false);
  const [res, setRes] = useState<ResultadoTesteLeitura | null>(null);
  const [erro, setErro] = useState("");
  async function rodar() {
    setRodando(true);
    setErro("");
    try {
      const r = await ponte.testarLeitura();
      if (r.erro) setErro(r.erro);
      else setRes(r);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setRodando(false);
    }
  }
  const listas = res?.medidas.filter((m) => m.tamanho) ?? [];
  const abrir = res?.medidas.find((m) => !m.tamanho);
  return (
    <Modal titulo="Testar leitura do Compras.gov.br" aoFechar={aoFechar} largo>
      <div className="teste-leitura">
        <p className="texto-suave">
          O Compras.gov.br mostra as participações de 10 em 10. Este teste pede a 1ª página das suas finalizadas com 10, 25, 50 e 100 por página (um pedido de cada,
          com pausa entre eles) e abre uma licitação em andamento, para medir o tempo. Usa a sua sessão e leva uns 10 segundos.
        </p>
        {!res && (
          <button className="botao acento" onClick={rodar} disabled={rodando}>
            {rodando ? <RefreshCw size={15} className="girando" /> : <Gauge size={15} />} {rodando ? "Testando…" : "Rodar o teste"}
          </button>
        )}
        {erro && <p className="alerta erro">{erro}</p>}
        {res && (
          <>
            <table className="tabela-lances-compras tabela-teste-leitura">
              <thead>
                <tr>
                  <th>Teste</th>
                  <th>Por página</th>
                  <th>Veio</th>
                  <th>Tempo</th>
                  <th>Tamanho</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {listas.map((m) => (
                  <tr key={m.teste + m.tamanho} className={m.teste === "Finalizadas" && m.tamanho === res.usar ? "escolhido" : ""}>
                    <td>{m.teste}</td>
                    <td>{m.tamanho}</td>
                    <td>
                      {m.veio} de {m.total}
                    </td>
                    <td>{segundos(m.ms)}</td>
                    <td>{m.kb} KB</td>
                    <td>{m.erro ? <span className="texto-erro">{m.erro}</span> : m.aceitou ? "Aceitou" : m.veio ? `Limitou a ${m.veio}` : "Recusou (veio vazio)"}</td>
                  </tr>
                ))}
                {abrir && (
                  <tr>
                    <td>{abrir.teste}</td>
                    <td>—</td>
                    <td>{abrir.veio} itens</td>
                    <td>{segundos(abrir.ms)}</td>
                    <td>—</td>
                    <td>{abrir.erro ? <span className="texto-erro">{abrir.erro}</span> : "Ok"}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="resumo-teste-leitura">
              <p>
                <strong>Todas as {res.total} finalizadas:</strong> com 10 por página seriam {res.antes.pedidos} pedidos (~{segundos(res.antes.ms)}).
                {res.usar > 10 ? (
                  <>
                    {" "}
                    Com {res.usar} por página, {res.depois.pedidos} pedidos (~{segundos(res.depois.ms)}).
                  </>
                ) : null}
              </p>
              <p className="texto-suave">
                {res.usar > 10
                  ? `A partir de agora o aplicativo lê ${res.usar} participações por pedido.`
                  : "O Compras não aceitou páginas maiores: o aplicativo continua lendo de 10 em 10, como o site."}
              </p>
            </div>
            <div className="linha-acoes">
              <button
                className="botao secundario"
                onClick={() =>
                  navigator.clipboard
                    .writeText(res.diagnostico)
                    .then(() => avisar("Resultado copiado. Cole na conversa para a gente decidir os próximos passos."))
                    .catch(() => avisar("Não consegui copiar.", "erro"))
                }
              >
                <ClipboardCopy size={15} /> Copiar resultado
              </button>
              <button className="botao secundario" onClick={rodar} disabled={rodando}>
                <RefreshCw size={15} className={rodando ? "girando" : ""} /> Rodar de novo
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function JanelaApelido({ compra, atual, aoSalvar, aoFechar }: { compra: CompraAcomp; atual: string; aoSalvar: (apelido: string) => void; aoFechar: () => void }) {
  const [texto, setTexto] = useState(atual);
  return (
    <Modal titulo="Apelido da licitação" aoFechar={aoFechar}>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          aoSalvar(texto.trim());
        }}
      >
        <p className="texto-suave">
          {nomeCompra(compra)} · {compra.orgao}
        </p>
        <div className="campo">
          <label htmlFor="apelido-acomp">
            <span className="texto-suave pequeno">Apelido (a equipe toda vê)</span>
          </label>
          <div className="entrada">
            <input id="apelido-acomp" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={80} placeholder="Ex.: Notebooks Justiça GO" autoFocus />
          </div>
        </div>
        <div className="linha-acoes">
          {atual && (
            <button type="button" className="botao secundario" onClick={() => aoSalvar("")}>
              Tirar apelido
            </button>
          )}
          <button className="botao acento">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}

type Filtro = "andamento" | "favoritas" | "propostas" | "disputa" | "selecao" | "finalizadas";
const FILTROS: Record<Filtro, { rotulo: string; fases: string[] }> = {
  andamento: { rotulo: "Em andamento", fases: [] },
  favoritas: { rotulo: "Favoritas", fases: [] },
  propostas: { rotulo: "Propostas", fases: ["1", "2", "6"] },
  disputa: { rotulo: "Disputa", fases: ["3", "99"] },
  selecao: { rotulo: "Seleção de fornecedores", fases: ["4"] },
  finalizadas: { rotulo: "Finalizadas", fases: [] },
};

const POR_PAGINA = 10;

/** Páginas como no Compras.gov.br: primeira, anterior, os números perto da atual, próxima e última. */
function Paginacao({ pagina, total, aoMudar }: { pagina: number; total: number; aoMudar: (n: number) => void }) {
  const numeros: (number | "…")[] = [];
  const de = Math.max(1, Math.min(pagina - 2, total - 4));
  const ate = Math.min(total, de + 4);
  if (de > 1) numeros.push(1, ...(de > 2 ? (["…"] as const) : []));
  for (let n = de; n <= ate; n++) numeros.push(n);
  if (ate < total) numeros.push(...(ate < total - 1 ? (["…"] as const) : []), total);
  return (
    <nav className="paginacao-acomp" aria-label="Páginas">
      <button className="cn-icone" onClick={() => aoMudar(1)} disabled={pagina === 1} aria-label="Primeira página" title="Primeira página">
        <ChevronsLeft size={16} />
      </button>
      <button className="cn-icone" onClick={() => aoMudar(pagina - 1)} disabled={pagina === 1} aria-label="Página anterior" title="Página anterior">
        <ChevronLeft size={16} />
      </button>
      {numeros.map((n, i) =>
        n === "…" ? (
          <span key={`r${i}`} className="reticencias-paginas">
            …
          </span>
        ) : (
          <button key={n} className={`numero-pagina ${n === pagina ? "atual" : ""}`} onClick={() => aoMudar(n)} aria-current={n === pagina ? "page" : undefined}>
            {n}
          </button>
        ),
      )}
      <button className="cn-icone" onClick={() => aoMudar(pagina + 1)} disabled={pagina === total} aria-label="Próxima página" title="Próxima página">
        <ChevronRight size={16} />
      </button>
      <button className="cn-icone" onClick={() => aoMudar(total)} disabled={pagina === total} aria-label="Última página" title="Última página">
        <ChevronsRight size={16} />
      </button>
    </nav>
  );
}

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

function LinhaCompra({
  compra: c,
  cnpj,
  marca,
  lendo,
  aoAbrir,
  aoFavoritar,
  aoApelidar,
}: {
  compra: CompraAcomp;
  cnpj: string;
  marca?: { favorito: boolean; apelido: string };
  lendo: boolean;
  aoAbrir: () => void;
  aoFavoritar: () => void;
  aoApelidar: () => void;
}) {
  const { melhor, convocado, falou, doPregoeiro } = etiquetas(c, c.meuCnpj || idEmpresa(cnpj));
  const chamado = convocado || c.diligencia || c.convocacaoRemanescentes;
  const parar = (e: React.MouseEvent | React.KeyboardEvent, f: () => void) => {
    e.stopPropagation();
    f();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className={`linha-compra ${chamado ? "com-chamado" : ""} ${marca?.favorito ? "favorita" : ""}`}
      onClick={aoAbrir}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), aoAbrir())}
    >
      <span className="marcas-linha-compra">
        <button className={`botao-favorito ${marca?.favorito ? "ativo" : ""}`} onClick={(e) => parar(e, aoFavoritar)} aria-label={marca?.favorito ? "Tirar dos favoritos" : "Favoritar"} title={marca?.favorito ? "Tirar dos favoritos" : "Favoritar"}>
          <Star size={16} />
        </button>
      </span>
      <span className="titulo-linha-compra">
        {marca?.apelido && <span className="apelido-compra">{marca.apelido}</span>}
        <strong>
          {nomeCompra(c).toUpperCase()}
          <button className="botao-apelido" onClick={(e) => parar(e, aoApelidar)} aria-label="Dar um apelido" title={marca?.apelido ? "Mudar o apelido" : "Dar um apelido"}>
            <Pencil size={12} />
          </button>
        </strong>
        <span>
          {c.uasg} - {c.orgao || "Órgão"}
        </span>
        {c.objeto && <span className="objeto-acomp texto-fraco">{c.objeto}</span>}
      </span>
      <span className="etapa-linha-compra">
        <small>Etapa</small> {c.fase || "—"}
      </span>
      <span className="etiquetas-compra">
        {(convocado || c.convocacaoRemanescentes) && <span className="chip vermelho">Convocado</span>}
        {c.diligencia && <span className="chip vermelho">Diligência</span>}
        {falou && <span className="chip azul">Pregoeiro falou com você</span>}
        {melhor && melhor.colocacao != null && (
          <span className={`chip ${COR_CHANCE[melhor.chance]}`} title={melhor.explicacao}>
            {ROTULO_CHANCE[melhor.chance]} · {melhor.colocacao}º
          </span>
        )}
        {melhor && melhor.colocacao == null && melhor.chance !== "aguardando" && <span className={`chip ${COR_CHANCE[melhor.chance]}`}>{ROTULO_CHANCE[melhor.chance]}</span>}
        {lendo && <span className="chip cinza">Lendo…</span>}
        {doPregoeiro > 0 && !falou && (
          <span className="chip cinza">
            <MessageSquare size={12} /> {doPregoeiro}
          </span>
        )}
      </span>
    </div>
  );
}

const PASSOS = ["Propostas", "Disputa", "Seleção de fornecedores", "Remanescentes"];
const passoDa = (c: CompraAcomp) => (["1", "2", "6"].includes(c.faseCodigo) ? 0 : ["3", "99"].includes(c.faseCodigo) ? 1 : c.faseCodigo === "4" ? 2 : c.encerrada ? 3 : -1);

type FiltroItens = "participo" | "todos" | "convocados" | "chance" | "pregoeiro" | "fora";

/**
 * Janela da licitação no mesmo desenho do "Acompanhamento seleção de fornecedores" do Compras.gov.br:
 * cabeçalho com as etapas, "Exibindo N registro(s)" com o seletor de itens, uma linha por item e, ao abrir,
 * a página do item (Minha proposta / Todas as propostas) com anterior, próximo e voltar.
 */
function JanelaCompra({
  compra: c,
  cnpj,
  conectado,
  agora,
  aoFechar,
  aoCadastrar,
}: {
  compra: CompraAcomp;
  cnpj: string;
  conectado: boolean;
  agora: number;
  aoFechar: () => void;
  aoCadastrar: () => void;
}) {
  const [aberto, setAberto] = useState<number | null>(null);
  const [resumo, setResumo] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<FiltroItens>("participo");
  const [verMensagens, setVerMensagens] = useState(false);
  const [, setLidas] = useState(0);
  const passo = passoDa(c);
  const lidos = !!c.lidaEm;

  // Assim que os itens chegam, lê as propostas de cada item por trás (2 de cada vez): as linhas mostram a
  // colocação e a situação, e o item abre na hora. Só nas fases em que já existem propostas para comparar.
  const numeros = c.itens.map((i) => i.numero).join(",");
  useEffect(() => {
    if (!lidos || !numeros || !conectado || ["1", "2", "6"].includes(c.faseCodigo)) return;
    let parar = false;
    preCarregarPropostas(c, numeros.split(",").map(Number).slice(0, 30), cnpj, () => !parar && setLidas((n) => n + 1), () => parar);
    return () => {
      parar = true;
    };
  }, [c.chave, lidos, c.lidaEm, numeros, cnpj, conectado]);

  const todosOsItens = [...c.itens, ...c.outrosItens].sort((a, b) => a.numero - b.numero);
  const info = todosOsItens.map((it) => {
    const conversa = conversaDoItem(c.mensagens, it.numero, cnpj);
    const dados = jaLido<PropostasDoItem>(chavePropostas(c, it.numero));
    const estado = estadoDoItem(it, dados, cnpj);
    const minha = dados?.minha ?? null;
    const convocado = it.pendencias.length > 0 || it.chatAberto || !!minha?.pendencias.length;
    return { it, conversa, estado, minha, convocado, boa: it.participa && ["ganhou", "alta"].includes(estado.chance), fora: it.participa && estado.chance === "fora" };
  });
  const conta = {
    participo: info.filter((x) => x.it.participa).length,
    todos: info.length,
    convocados: info.filter((x) => x.convocado).length,
    chance: info.filter((x) => x.boa).length,
    pregoeiro: info.filter((x) => x.conversa.paraVoce > 0).length,
    fora: info.filter((x) => x.fora).length,
  };
  const opcoes: [FiltroItens, string][] = [
    ["participo", "Itens que participo"],
    ...(c.outrosItens.length ? ([["todos", "Todos os itens"]] as [FiltroItens, string][]) : []),
    ["convocados", "Com convocação aberta"],
    ["chance", "Com chance boa"],
    ["pregoeiro", "O pregoeiro falou comigo"],
    ["fora", "Desclassificados"],
  ];
  const visiveis = info.filter((x) =>
    filtro === "todos"
      ? true
      : filtro === "convocados"
        ? x.convocado
        : filtro === "chance"
          ? x.boa
          : filtro === "pregoeiro"
            ? x.conversa.paraVoce > 0
            : filtro === "fora"
              ? x.fora
              : x.it.participa,
  );
  const indice = visiveis.findIndex((x) => x.it.numero === aberto);
  const itemAberto = indice >= 0 ? visiveis[indice].it : (todosOsItens.find((i) => i.numero === aberto) ?? null);
  const doPregoeiro = c.mensagens.filter((m) => m.quem === "pregoeiro").length;

  return (
    <Modal titulo="Acompanhar licitação" aoFechar={aoFechar} largo>
      <style>{".modal.largo:has(.janela-compra){max-width:1180px}"}</style>
      <div className="janela-compra cn-compra">
        <header className="cn-cabeca">
          <div className="cn-titulo">
            <strong>{nomeCompra(c)}</strong>
            <span>
              UASG {c.uasg} - {c.orgao}
            </span>
            {c.objeto && <span className="texto-suave objeto-janela">{c.objeto}</span>}
            <span className="texto-fraco pequeno">
              {[c.abertura && `Abertura ${dataHora(c.abertura)}`, c.lidaEm ? `Lida ${ha(c.lidaEm, agora)}` : "Lendo no Compras.gov.br…"].filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="cn-cabeca-direita">
            <div className="cn-acoes-compra">
              <button className="cn-icone" onClick={() => setVerMensagens(true)} title="Mensagens da licitação" aria-label="Mensagens da licitação">
                <Mail size={15} />
                {doPregoeiro > 0 && <i className="cn-contador">{doPregoeiro}</i>}
              </button>
              {c.linkPncp && (
                <a className="cn-icone" href={c.linkPncp} target="_blank" rel="noreferrer" title="Edital no PNCP" aria-label="Edital no PNCP">
                  <ExternalLink size={15} />
                </a>
              )}
              {["1", "2", "6"].includes(c.faseCodigo) && (
                <button className="botao acento pequeno" onClick={aoCadastrar}>
                  <FilePlus2 size={14} /> Cadastrar / alterar proposta
                </button>
              )}
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
        </header>

        {!lidos ? (
          <div className="carregando-compra">
            <RefreshCw className="girando" size={18} />
            <span>Lendo os itens, a sua participação e as mensagens desta licitação…</span>
          </div>
        ) : itemAberto ? (
          <ItemCompras
            key={itemAberto.numero}
            compra={c}
            item={itemAberto}
            cnpj={cnpj}
            participa={itemAberto.participa}
            anterior={indice > 0 ? () => setAberto(visiveis[indice - 1].it.numero) : undefined}
            proximo={indice >= 0 && indice < visiveis.length - 1 ? () => setAberto(visiveis[indice + 1].it.numero) : undefined}
            aoVoltar={() => setAberto(null)}
          />
        ) : todosOsItens.length === 0 ? (
          c.erros.length ? (
            <p className="alerta aviso">
              Não consegui ler os itens desta compra agora ({c.erros.join(" · ")}). O aplicativo tenta de novo sozinho; se continuar, use “Copiar diagnóstico” no fim da
              lista.
            </p>
          ) : (
            <p className="texto-fraco">Nenhum item com proposta sua nesta compra.</p>
          )
        ) : (
          <section className="cn-lista">
            <div className="cn-lista-topo">
              <span className="texto-fraco pequeno">Exibindo {visiveis.length} registro(s)</span>
              <select className="cn-seletor" value={filtro} onChange={(e) => setFiltro(e.target.value as FiltroItens)} aria-label="Quais itens mostrar">
                {opcoes.map(([v, rotulo]) => (
                  <option key={v} value={v} disabled={v !== "participo" && v !== "todos" && !conta[v]}>
                    {rotulo} ({conta[v]})
                  </option>
                ))}
              </select>
            </div>
            {visiveis.length === 0 && <p className="texto-fraco pequeno">Nenhum item neste filtro.</p>}
            <ul className="cn-itens">
              {visiveis.map(({ it, conversa, estado, minha, convocado }) => {
                const vendoResumo = resumo === it.numero;
                const meuValor = minha ? (minha.valorNegociado ?? minha.valorOfertado ?? minha.valor) : it.meuValor;
                return (
                  <li key={it.numero} className={`cn-linha-item chance-${estado.chance} ${convocado ? "convocado" : ""} ${it.participa ? "" : "nao-participa"} ${vendoResumo ? "com-resumo" : ""}`}>
                    <div className="cn-linha">
                      <button className="cn-item-desc" onClick={() => setAberto(it.numero)} title="Abrir o item">
                        <strong>
                          {it.numero} &nbsp;{it.descricao.toUpperCase()}
                        </strong>
                        <span className="cn-status">{(it.participa ? estado.momento : "") || it.etapa || it.situacao || "—"}</span>
                        <span className="cn-etiquetas">
                          {it.participa ? (
                            <span className={`chip ${COR_CHANCE[estado.chance]}`} title={estado.explicacao}>
                              {ROTULO_CHANCE[estado.chance]}
                              {estado.colocacao != null ? ` · ${estado.colocacao}º` : ""}
                            </span>
                          ) : (
                            <span className="chip cinza">Sem proposta sua</span>
                          )}
                          {!estado.momento.startsWith("Convocada") &&
                            it.pendencias.map((p) => (
                              <span key={p.tipo} className="chip vermelho">
                                {p.rotulo}
                              </span>
                            ))}
                          {conversa.paraVoce > 0 && (
                            <span className="chip azul">
                              <MessageSquare size={11} /> Pregoeiro falou com você
                            </span>
                          )}
                        </span>
                      </button>
                      <dl className="cn-item-qtd">
                        <dt>Qtde solicitada</dt>
                        <dd>{it.quantidade ?? "—"}</dd>
                        <dt>Valor estimado (unitário)</dt>
                        <dd>{it.valorEstimado != null ? formatarMoeda(it.valorEstimado) : "Não informado"}</dd>
                      </dl>
                      <div className="cn-item-acoes">
                        <button className="cn-icone cn-abrir" onClick={() => setAberto(it.numero)} title="Abrir o item" aria-label={`Abrir o item ${it.numero}`}>
                          <Plus size={15} />
                        </button>
                        <button
                          className="cn-icone"
                          onClick={() => setResumo(vendoResumo ? null : it.numero)}
                          title={vendoResumo ? "Esconder o resumo" : "Ver o resumo"}
                          aria-label={vendoResumo ? "Esconder o resumo" : "Ver o resumo"}
                          aria-expanded={vendoResumo}
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    </div>
                    {vendoResumo && (
                      <dl className="cn-linha-resumo">
                        <div>
                          <dt>Classificação</dt>
                          <dd>{estado.colocacao != null ? `${estado.colocacao}º${estado.total ? ` de ${estado.total}` : ""}` : "—"}</dd>
                        </div>
                        <div>
                          <dt>Sua proposta</dt>
                          <dd>{it.participa && meuValor != null ? formatarMoeda(meuValor) : "—"}</dd>
                        </div>
                        <div>
                          <dt>Melhor valor</dt>
                          <dd>{it.melhorValor != null ? formatarMoeda(it.melhorValor) : "—"}</dd>
                        </div>
                        <div className="largo">
                          <dt>Situação</dt>
                          <dd>
                            {[
                              estado.momento || it.etapa,
                              estado.analise?.souPrimeira
                                ? "você é a 1ª válida"
                                : estado.analise && estado.analise.aFrenteValidas > 0
                                  ? `${estado.analise.aFrenteValidas} válida${estado.analise.aFrenteValidas > 1 ? "s" : ""} à sua frente`
                                  : "",
                              estado.analise?.desclassificadas ? `${estado.analise.desclassificadas} desclassificada${estado.analise.desclassificadas > 1 ? "s" : ""}` : "",
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
      {verMensagens && (
        <Modal titulo={`Mensagens da licitação (${c.mensagens.length})`} aoFechar={() => setVerMensagens(false)} largo>
          <Conversa compra={c} cnpj={cnpj} />
        </Modal>
      )}
    </Modal>
  );
}

function Conversa({ compra: c, cnpj }: { compra: CompraAcomp; cnpj: string }) {
  const [texto, setTexto] = useState("");
  const [item, setItem] = useState(() => c.itens.find((i) => i.pendencias.length || i.chatAberto)?.numero ?? 0);
  const [so, setSo] = useState<"todas" | "voce">("todas");
  const [enviando, setEnviando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const paraVoce = (m: CompraAcomp["mensagens"][number]) => m.quem === "pregoeiro" && !!cnpj && (m.destinatario === cnpj || m.texto.replace(/\D/g, "").includes(cnpj));
  const lista = [...c.mensagens].sort((a, b) => dataDe(a.dataHora) - dataDe(b.dataHora)).filter((m) => so === "todas" || paraVoce(m) || m.quem === "voce");
  const ultimas = lista.slice(-80);
  useEffect(() => {
    if (caixa.current) caixa.current.scrollTop = caixa.current.scrollHeight;
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

  let dia = "";
  return (
    <section className="conversa-acomp">
      <div className="filtro-conversa">
        <button className={so === "todas" ? "ativo" : ""} onClick={() => setSo("todas")}>
          Todas
        </button>
        <button className={so === "voce" ? "ativo" : ""} onClick={() => setSo("voce")}>
          Só comigo
        </button>
      </div>
      <div className="chat-compras" ref={caixa}>
        {ultimas.length === 0 ? (
          <p className="texto-fraco pequeno">Nenhuma mensagem.</p>
        ) : (
          ultimas.map((m) => {
            const d = m.dataHora ? new Date(dataDe(m.dataHora)).toLocaleDateString("pt-BR") : "";
            const mostrarDia = d && d !== dia;
            dia = d || dia;
            const lado = m.quem === "pregoeiro" ? "pregoeiro" : m.quem === "voce" && m.remetente && cnpj && m.remetente !== cnpj ? "outra" : m.quem;
            return (
              <div key={m.id} className="linha-chat">
                {mostrarDia && <span className="dia-chat">{d}</span>}
                <div className={`msg-compras ${lado} ${paraVoce(m) ? "para-voce" : ""}`}>
                  <span className="quem-acomp">
                    {m.quem === "pregoeiro" ? (paraVoce(m) ? "Pregoeiro → você" : "Pregoeiro") : m.quem === "voce" ? (lado === "outra" ? "Outra empresa" : "Você") : "Sistema"}
                    {m.item ? ` · item ${m.item}` : ""}
                  </span>
                  <span>{m.texto}</span>
                  <span className="hora-chat">{m.dataHora ? new Date(dataDe(m.dataHora)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                </div>
              </div>
            );
          })
        )}
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
