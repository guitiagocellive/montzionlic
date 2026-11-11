import { ChevronDown, Download, LogIn, Play, RefreshCw, Square, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { podeEditar, podeVer } from "../../shared/permissoes";
import {
  type CompraDisputa,
  type ConfigItemRobo,
  decidir,
  FASES,
  ITEM_ROBO_PADRAO,
  type ItemDisputa,
  lerCompra,
  lerItemDisputa,
  listaDe,
  SEGUNDOS_FINAIS,
} from "../../shared/robo";
import type { Usuario } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { avisar, Vazio } from "../components/Ui";
import { paraNumero } from "../formato";
import { link } from "../rota";
import { type EstadoPonte, noAplicativo, ponte, temPonte } from "../robo/ponte";

const EM_DISPUTA = new Set(["LA", "AL", "LF", "DM", "DF"]);
const ENCERRADAS = new Set(["E", "FE", "JE", "HE", "AE", "AR", "AC", "PE", "PR", "JR", "D1", "D2", "JT", "B3"]);
const abaDoItem = (fase: string) => (EM_DISPUTA.has(fase) ? "disputa" : ENCERRADAS.has(fase) ? "encerrados" : "aguardando");

interface LeituraCompra {
  itens: ItemDisputa[];
  lidoEm: number; // Date.now() da leitura
  erro?: string;
}

const moeda = (v: number | null, quatro: boolean) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: quatro ? 4 : 2, maximumFractionDigits: quatro ? 4 : 2 });

const relogio = (seg: number) => {
  const s = Math.max(0, Math.floor(seg));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

const FOLGA_MS = 600; // tempo mínimo entre duas consultas ao Compras.gov.br

const textoNumero = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

export function Disputas({ usuario }: { usuario: Usuario }) {
  const pode = podeVer(usuario.permissoes, "orcamento") && podeEditar(usuario.permissoes, "licitacoes");
  const [ligada, setLigada] = useState(temPonte());
  const [estado, setEstado] = useState<EstadoPonte | null>(null);
  const [compras, setCompras] = useState<CompraDisputa[] | null>(null);
  const [carregandoCompras, setCarregandoCompras] = useState(false);
  const [aba, setAba] = useState<"pregao" | "dispensa">("dispensa");
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [abaItens, setAbaItens] = useState<Record<string, string>>({});
  const [leituras, setLeituras] = useState<Record<string, LeituraCompra>>({});
  const [config, setConfig] = useState<Record<string, ConfigItemRobo>>({});
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [mensagens, setMensagens] = useState<Record<string, { texto: string; erro?: boolean }>>({});
  const [agora, setAgora] = useState(Date.now());
  const [descartadas, setDescartadas] = useState(0);

  // Estado que o laço do robô lê sem recriar o intervalo.
  const ref = useRef({ leituras, config, compras, abertas });
  ref.current = { leituras, config, compras, abertas };
  // ultimaLeitura marca quando a leitura começou (evita pedir duas vezes a mesma compra).
  const lendo = useRef(new Set<string>());
  const enviandoAte = useRef(new Map<string, number>());
  const ultimaLeitura = useRef(new Map<string, number>());
  const mexidas = useRef(new Set<string>()); // compras que a pessoa abriu/fechou (não abrimos/fechamos sozinhos)
  const esperarAte = useRef(new Map<string, number>()); // compra -> quando pode consultar de novo (depois de 429)
  const pausaGeral = useRef(0);
  const ultimoPedido = useRef(0);

  // A ponte pode aparecer um pouco depois da página carregar.
  useEffect(() => {
    if (ligada) return;
    const t = setInterval(() => temPonte() && setLigada(true), 1000);
    return () => clearInterval(t);
  }, [ligada]);

  const carregarCompras = useCallback(async (atualizar: boolean) => {
    setCarregandoCompras(true);
    try {
      const r = await ponte.compras(atualizar);
      const todas = listaDe(r.compras)
        .map(lerCompra)
        .filter((x): x is CompraDisputa => !!x);
      // Fora: revogadas, anuladas, desertas, fracassadas e as que já passaram da disputa (pela situação/fase da compra).
      const lista = todas.filter((c) => !c.encerrada);
      setDescartadas(todas.length - lista.length);
      setCompras(lista);
      if (lista.length) {
        const cfg = await api<{ itens: Record<string, ConfigItemRobo> }>(`/robo/itens?compras=${encodeURIComponent(lista.map((c) => c.chave).join(","))}`);
        setConfig((atual) => ({ ...cfg.itens, ...atual }));
        setTextos((t) => {
          const novo = { ...t };
          for (const [k, c] of Object.entries(cfg.itens)) {
            novo[`${k}:minimo`] ??= textoNumero(c.minimo);
            novo[`${k}:desconto`] ??= textoNumero(c.desconto);
          }
          return novo;
        });
        if (!lista.some((c) => c.modalidade === aba) && lista.some((c) => c.modalidade !== aba)) setAba(lista.some((c) => c.modalidade === "dispensa") ? "dispensa" : "pregao");
      }
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setCarregandoCompras(false);
    }
  }, [aba]);

  // Situação da ponte (logado ou não no Compras.gov.br).
  useEffect(() => {
    if (!ligada) return;
    let vivo = true;
    const ver = async () => {
      try {
        const e = await ponte.estado();
        if (!vivo) return;
        setEstado((antes) => {
          if (e.conectado && !antes?.conectado) carregarCompras(false);
          return e;
        });
      } catch {
        if (vivo) setEstado({ conectado: false, janela: false });
      }
    };
    ver();
    const t = setInterval(ver, 4000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [ligada]); // eslint-disable-line react-hooks/exhaustive-deps

  async function lerCompraAgora(chave: string) {
    if (lendo.current.has(chave)) return;
    lendo.current.add(chave);
    ultimaLeitura.current.set(chave, Date.now());
    try {
      const bruto = await ponte.itens(chave);
      const itens = listaDe(bruto).map(lerItemDisputa).filter((i) => i.numero > 0);
      const leitura = { itens, lidoEm: Date.now() };
      ultimaLeitura.current.set(chave, leitura.lidoEm);
      setLeituras((l) => ({ ...l, [chave]: leitura }));
      // Como o Siga Pregão: compra com disputa acontecendo já abre sozinha (a não ser que a pessoa tenha fechado).
      if (itens.length > 0 && !mexidas.current.has(chave)) setAbertas((s) => (s.has(chave) ? s : new Set(s).add(chave)));
      await agir(chave, leitura);
    } catch (e) {
      const msg = mensagemDeErro(e);
      if (/devagar|429/i.test(msg)) {
        // O Compras.gov.br limitou: espera antes de consultar de novo. Com o robô ligado a espera é curta
        // (não dá para perder os segundos finais); nas outras compras, 15 s e uma pausa geral de 5 s.
        const roboLigado = Object.entries(ref.current.config).some(([k, v]) => v.ligado && k.startsWith(`${chave}:`));
        esperarAte.current.set(chave, Date.now() + (roboLigado ? 1500 : 15000));
        if (!roboLigado) pausaGeral.current = Date.now() + 5000;
      }
      setLeituras((l) => ({ ...l, [chave]: { ...(l[chave] ?? { itens: [], lidoEm: 0 }), erro: msg } }));
    } finally {
      lendo.current.delete(chave);
    }
  }

  // O robô: para cada item ligado, decide e, se for o caso, envia o lance.
  async function agir(chave: string, leitura: LeituraCompra) {
    for (const item of leitura.itens) {
      const k = `${chave}:${item.numero}`;
      const cfg = ref.current.config[k];
      if (!cfg?.ligado) continue;
      const decisao = decidir(item, cfg);
      if (decisao.acao === "aguardar") {
        setMensagens((m) => (m[k]?.texto === decisao.motivo ? m : { ...m, [k]: { texto: decisao.motivo } }));
        continue;
      }
      // Um lance por vez por item: espera a próxima leitura mostrar o resultado.
      if ((enviandoAte.current.get(k) ?? 0) > Date.now()) continue;
      enviandoAte.current.set(k, Date.now() + 2500);
      const valor = decisao.valor!;
      setMensagens((m) => ({ ...m, [k]: { texto: `Enviando ${moeda(valor, cfg.quatroCasas)}…` } }));
      try {
        const r = await ponte.lance(chave, item.numero, valor, item.fase);
        const texto = r.ok ? `Lance de ${moeda(valor, cfg.quatroCasas)} enviado` : `Lance recusado: ${r.mensagem || `erro ${r.status}`}`;
        setMensagens((m) => ({ ...m, [k]: { texto, erro: !r.ok } }));
        api("/robo/lances", { corpo: { compra: chave, item: item.numero, valor, ok: r.ok, mensagem: r.mensagem ?? "" } }).catch(() => {});
      } catch (e) {
        setMensagens((m) => ({ ...m, [k]: { texto: `Falha ao enviar: ${mensagemDeErro(e)}`, erro: true } }));
      }
      // Lê de novo logo em seguida para ver o resultado (e responder rápido se o concorrente cobrir).
      enviandoAte.current.set(k, Date.now() + 700);
      setTimeout(() => lerCompraAgora(chave), 300);
    }
  }

  // Laço: consulta o Compras.gov.br com calma para não ser bloqueado (erro 429). Um pedido por vez, com
  // folga entre eles; robô ligado nos segundos finais a cada 0,6 s, robô ligado a cada 3 s, compra em disputa aberta
  // na tela a cada 5 s, fechada a cada 15 s, e compra sem disputa agora a cada 2 min.
  useEffect(() => {
    if (!estado?.conectado) return;
    const t = setInterval(() => {
      const agoraMs = Date.now();
      setAgora(agoraMs);
      const { compras: lista, config: cfg, abertas: ab, leituras: ls } = ref.current;
      if (agoraMs < pausaGeral.current || agoraMs - ultimoPedido.current < FOLGA_MS) return;
      let melhor: { chave: string; atraso: number; prioridade: number } | null = null;
      for (const c of lista ?? []) {
        if ((esperarAte.current.get(c.chave) ?? 0) > agoraMs || lendo.current.has(c.chave)) continue;
        const ligado = Object.entries(cfg).some(([k, v]) => v.ligado && k.startsWith(`${c.chave}:`));
        const l = ls[c.chave];
        const emDisputa = !!l && l.itens.length > 0;
        const pertoDoFim =
          ligado && !!l?.itens.some((i) => i.fase === "AL" || (i.restanteSeg != null && i.restanteSeg - (agoraMs - l.lidoEm) / 1000 <= SEGUNDOS_FINAIS + 5));
        const [intervalo, prioridade] = pertoDoFim ? [600, 4] : ligado ? [3000, 3] : !l ? [0, 2] : emDisputa ? (ab.has(c.chave) ? [5000, 1] : [15000, 1]) : [120000, 0];
        const atraso = agoraMs - (ultimaLeitura.current.get(c.chave) ?? 0) - intervalo;
        if (atraso < 0) continue;
        if (!melhor || prioridade > melhor.prioridade || (prioridade === melhor.prioridade && atraso > melhor.atraso)) melhor = { chave: c.chave, atraso, prioridade };
      }
      if (melhor) {
        ultimoPedido.current = agoraMs;
        lerCompraAgora(melhor.chave);
      }
    }, 200);
    return () => clearInterval(t);
  }, [estado?.conectado]); // eslint-disable-line react-hooks/exhaustive-deps

  // Salva a configuração de um item (um instante depois da última mudança).
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function mudarItem(k: string, novo: Partial<ConfigItemRobo>) {
    setConfig((c) => {
      const item = { ...(c[k] ?? ITEM_ROBO_PADRAO), ...novo };
      clearTimeout(timers.current.get(k));
      timers.current.set(
        k,
        setTimeout(() => api(`/robo/itens/${encodeURIComponent(k)}`, { metodo: "PUT", corpo: { item } }).catch((e) => avisar(mensagemDeErro(e), "erro")), 500),
      );
      return { ...c, [k]: item };
    });
  }

  function alternarRobo(k: string, item: ItemDisputa) {
    const cfg = config[k] ?? ITEM_ROBO_PADRAO;
    if (!cfg.ligado && !(cfg.minimo && cfg.minimo > 0)) return avisar("Informe o lance mínimo antes de ligar o robô.", "erro");
    if (!cfg.ligado && item.nossoLance != null && cfg.minimo! > item.nossoLance) avisar("O lance mínimo está acima do seu lance atual: o robô não vai baixar.", "erro");
    mudarItem(k, { ligado: !cfg.ligado });
    setMensagens((m) => ({ ...m, [k]: { texto: cfg.ligado ? "Robô parado" : "Robô ligado" } }));
  }

  const visiveis = useMemo(() => (compras ?? []).filter((c) => (aba === "pregao" ? c.modalidade !== "dispensa" : c.modalidade === "dispensa")), [compras, aba]);
  // "Em disputa agora" = a sala de disputa devolveu itens em disputa; sem itens = nada acontecendo nesta compra agora.
  const ativas = visiveis.filter((c) => !leituras[c.chave] || leituras[c.chave].itens.length > 0 || (!!leituras[c.chave].erro && !leituras[c.chave].lidoEm));
  const semDisputa = visiveis.filter((c) => !ativas.includes(c));

  const cartaoCompra = (c: CompraDisputa) => {
    const aberta = abertas.has(c.chave);
    const leitura = leituras[c.chave];
    const itens = leitura?.itens ?? [];
    const robo = Object.entries(config).some(([k, v]) => v.ligado && k.startsWith(`${c.chave}:`));
    const emLances = itens.some((i) => EM_DISPUTA.has(i.fase));
    const abaAtual = abaItens[c.chave] ?? (emLances ? "disputa" : itens.some((i) => abaDoItem(i.fase) === "aguardando") ? "aguardando" : "disputa");
    const conta = (a: string) => itens.filter((i) => abaDoItem(i.fase) === a).length;
    return (
      <article key={c.chave} className={`compra-disputa ${aberta ? "aberta" : ""}`}>
        <button
          className="compra-disputa-topo"
          onClick={() =>
            setAbertas((s) => {
              mexidas.current.add(c.chave);
              const n = new Set(s);
              if (n.has(c.chave)) n.delete(c.chave);
              else {
                n.add(c.chave);
                lerCompraAgora(c.chave);
              }
              return n;
            })
          }
          aria-expanded={aberta}
        >
          <span>
            <strong>
              {c.titulo}
              {c.uasg && ` | UASG ${c.uasg}`}
              {c.orgao && ` - ${c.orgao}`}
            </strong>
            <span className="chips-compra">
              {c.modoDisputa && <span className="chip">{c.modoDisputa}</span>}
              {!leitura && <span className="chip">Verificando…</span>}
              {emLances && <span className="chip azul">Itens em fase de lances</span>}
              {robo && <span className="chip verde">Robô ligado</span>}
            </span>
          </span>
          <ChevronDown className="seta" />
        </button>

        {aberta && (
          <div className="compra-disputa-corpo">
            <div className="segmentado pequeno abas-itens-disputa">
              {[
                ["aguardando", "Aguardando disputa"],
                ["disputa", "Em disputa"],
                ["encerrados", "Encerrados"],
              ].map(([a, nome]) => (
                <button key={a} className={abaAtual === a ? "ativo" : ""} onClick={() => setAbaItens((s) => ({ ...s, [c.chave]: a }))}>
                  {nome} ({conta(a)})
                </button>
              ))}
            </div>
            {leitura?.erro && <p className="alerta erro">{leitura.erro}</p>}
            {!leitura && (
              <p className="texto-fraco carregando-linha">
                <RefreshCw className="girando" /> Lendo os itens…
              </p>
            )}
            {itens
              .filter((i) => abaDoItem(i.fase) === abaAtual)
              .map((i) => {
                const k = `${c.chave}:${i.numero}`;
                const cfg = config[k] ?? ITEM_ROBO_PADRAO;
                const restante = i.restanteSeg == null ? null : i.restanteSeg - (agora - (leitura?.lidoEm ?? agora)) / 1000;
                const situacao = i.situacao === "G" ? "ganhando" : i.situacao === "E" ? "empatado" : i.situacao === "P" ? "perdendo" : "";
                const nosso = i.melhorLance != null && i.nossoLance != null && i.melhorLance >= i.nossoLance;
                const msg = mensagens[k];
                return (
                  <div key={k} className={`item-disputa ${situacao} ${cfg.ligado ? "robo-ligado" : ""}`}>
                    <div className="item-disputa-titulo">
                      <strong>
                        ITEM {i.numero}
                        {i.descricao && ` - ${i.descricao}`}
                      </strong>
                      {situacao && <span className={`selo-situacao ${situacao}`}>{situacao.toUpperCase()}</span>}
                    </div>
                    <div className="item-disputa-grade">
                      <label className="campo">
                        <span>lance mínimo (R$)</span>
                        <span className="entrada">
                          <input
                            inputMode="decimal"
                            value={textos[`${k}:minimo`] ?? textoNumero(cfg.minimo)}
                            onChange={(e) => {
                              setTextos((t) => ({ ...t, [`${k}:minimo`]: e.target.value }));
                              mudarItem(k, { minimo: paraNumero(e.target.value) });
                            }}
                            aria-label={`Lance mínimo do item ${i.numero}`}
                          />
                        </span>
                      </label>
                      <label className="campo">
                        <span>desconto (%)</span>
                        <span className="entrada">
                          <input
                            inputMode="decimal"
                            value={textos[`${k}:desconto`] ?? textoNumero(cfg.desconto)}
                            onChange={(e) => {
                              setTextos((t) => ({ ...t, [`${k}:desconto`]: e.target.value }));
                              const n = paraNumero(e.target.value);
                              if (n != null && n >= 0 && n <= 50) mudarItem(k, { desconto: n });
                            }}
                            aria-label={`Desconto do item ${i.numero}`}
                          />
                        </span>
                      </label>
                      <div className="valor-disputa">
                        <span>Melhor lance</span>
                        <strong className={nosso ? "texto-verde" : "texto-perigo"}>
                          {moeda(i.melhorLance, cfg.quatroCasas)} <em className={`selo-quem ${nosso ? "voce" : ""}`}>{nosso ? "VOCÊ" : "CONCORRENTE"}</em>
                        </strong>
                      </div>
                      <div className="valor-disputa">
                        <span>Meu lance</span>
                        <strong className={nosso ? "texto-verde" : "texto-perigo"}>{moeda(i.nossoLance, cfg.quatroCasas)}</strong>
                      </div>
                      <div className={`cronometro-disputa ${restante != null && restante <= SEGUNDOS_FINAIS ? "final" : ""}`}>
                        {i.fase === "AL" ? "aleatório" : restante != null ? relogio(restante) : "—"}
                      </div>
                      <button
                        className={`botao-robo ${cfg.ligado ? "ligado" : ""}`}
                        onClick={() => alternarRobo(k, i)}
                        aria-label={cfg.ligado ? `Parar o robô no item ${i.numero}` : `Ligar o robô no item ${i.numero}`}
                        title={cfg.ligado ? "Parar o robô" : "Ligar o robô"}
                      >
                        {cfg.ligado ? <Square /> : <Play />}
                      </button>
                    </div>
                    <div className="item-disputa-opcoes">
                      <label>
                        <input type="checkbox" checked={cfg.quatroCasas} onChange={(e) => mudarItem(k, { quatroCasas: e.target.checked })} /> Permitir lances com 4 casas decimais
                      </label>
                      <label>
                        <input type="checkbox" checked={cfg.naoAguardar} onChange={(e) => mudarItem(k, { naoAguardar: e.target.checked })} /> Não aguardar os segundos finais para
                        enviar lances
                      </label>
                    </div>
                    <div className="item-disputa-rodape">
                      <span className="texto-fraco pequeno">{FASES[i.fase] ?? i.fase}</span>
                      <span className={`mensagem-robo ${msg?.erro ? "erro" : ""}`}>{msg?.texto ?? (cfg.ligado ? "Robô ligado" : "Robô parado")}</span>
                    </div>
                  </div>
                );
              })}
            {leitura && itens.filter((i) => abaDoItem(i.fase) === abaAtual).length === 0 && <p className="texto-fraco pequeno">Nenhum item aqui.</p>}
          </div>
        )}
      </article>
    );
  };

  if (!pode)
    return (
      <section className="cartao">
        <Vazio icone={<TriangleAlert />} titulo="Sem permissão">
          Para usar o robô de lances é preciso ver o orçamento e editar licitações.
        </Vazio>
      </section>
    );

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Disputas</h1>
          <p className="texto-suave">
            Robô de lances do Compras.gov.br: espera os últimos {SEGUNDOS_FINAIS} segundos e só então dá o lance, até o seu lance mínimo.
          </p>
        </div>
      </div>

      {!ligada && noAplicativo() ? (
        <section className="cartao disputas-aviso entrar">
          <RefreshCw className="girando" />
          <div>
            <h2>Ligando o robô de lances…</h2>
            <p className="texto-suave">
              Você já está no aplicativo Montzion (versão {window.montzionApp?.versao}). O robô liga sozinho em alguns segundos. Se esta mensagem
              continuar por mais de 1 minuto, feche o Montzion e abra de novo pelo atalho.
            </p>
          </div>
        </section>
      ) : !ligada ? (
        <section className="cartao disputas-aviso entrar">
          <Download />
          <div>
            <h2>O robô funciona pelo aplicativo do Windows</h2>
            <p className="texto-suave">
              Abra a plataforma pelo aplicativo Montzion. Ele abre uma janela do Compras.gov.br onde você entra com a sua conta gov.br (certificado ou senha) e é por
              ela que o robô vê as disputas e envia os lances. Sua senha e seu certificado não passam pela plataforma.
            </p>
            <p className="texto-suave">
              <strong>Já está no aplicativo e vê esta mensagem?</strong> Ele está desatualizado: baixe o instalador abaixo e abra (ele atualiza sozinho, sem perder nada).
            </p>
            <a className="botao acento" {...link("/configuracoes/aplicativo")}>
              <Download /> Baixar o aplicativo
            </a>
          </div>
        </section>
      ) : !estado?.conectado ? (
        <section className="cartao disputas-aviso entrar">
          <LogIn />
          <div>
            <h2>{estado?.portal ? "Abrindo a sala de disputa…" : "Entre na sua conta do Compras.gov.br"}</h2>
            {estado?.portal && (
              <p className="texto-suave">
                Você já entrou na Área de Trabalho do Fornecedor. O Montzion está abrindo a sala de disputa sozinho. Se não abrir em alguns segundos, na janela do
                Compras.gov.br clique em <strong>Compras</strong> e abra a sala de disputa (pregões e dispensas).
              </p>
            )}
            <ol className="texto-suave passos-entrar">
              <li>Clique abaixo: abre a janela de login do Compras.gov.br.</li>
              <li>
                Escolha <strong>Fornecedor Brasileiro</strong> e entre com o gov.br (certificado ou senha).
              </li>
              <li>
                Se o Compras.gov.br não abrir sozinho a área do fornecedor, abra a <strong>sala de disputa</strong> por lá. O Montzion
                acha a sessão em qualquer janela ou aba do Compras.gov.br.
              </li>
              <li>Pronto: assim que o login termina, a janela do Compras.gov.br some sozinha e o robô continua trabalhando escondido. As disputas aparecem aqui.</li>
            </ol>
            <button className="botao acento" onClick={() => ponte.entrar().catch((e) => avisar(mensagemDeErro(e), "erro"))}>
              <LogIn /> {estado?.janela ? "Mostrar a janela do Compras.gov.br" : "Entrar no Compras.gov.br"}
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="disputas-topo">
            <div className="segmentado pequeno">
              <button className={aba === "pregao" ? "ativo" : ""} onClick={() => setAba("pregao")}>
                Pregões eletrônicos
              </button>
              <button className={aba === "dispensa" ? "ativo" : ""} onClick={() => setAba("dispensa")}>
                Dispensas eletrônicas
              </button>
            </div>
            <span className="texto-fraco pequeno">
              {new Date(agora).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (horário de Brasília)
            </span>
            <button className="botao-icone" onClick={() => carregarCompras(true)} disabled={carregandoCompras} aria-label="Atualizar disputas" title="Atualizar disputas">
              <RefreshCw className={carregandoCompras ? "girando" : ""} />
            </button>
          </div>

          {compras === null ? (
            <p className="texto-fraco carregando-linha">
              <RefreshCw className="girando" /> Buscando suas disputas no Compras.gov.br…
            </p>
          ) : ativas.length === 0 ? (
            <section className="cartao">
              <Vazio icone={<TriangleAlert />} titulo={`Nenhuma ${aba === "pregao" ? "disputa de pregão" : "dispensa"} acontecendo agora`}>
                Quando uma disputa sua começar no Compras.gov.br, ela aparece aqui sozinha (o robô confere de tempos em tempos).
                {descartadas > 0 && ` ${descartadas} compra(s) já encerrada(s), revogada(s) ou deserta(s) ficaram de fora.`}
              </Vazio>
            </section>
          ) : (
            <div className="lista-disputas">
              {ativas.map(cartaoCompra)}
            </div>
          )}
          {compras !== null && semDisputa.length > 0 && (
            <details className="sem-disputa">
              <summary>
                <ChevronDown className="seta" /> Sem disputa agora ({semDisputa.length})
                <span className="texto-fraco pequeno"> · o robô confere de novo a cada 2 minutos</span>
              </summary>
              <div className="lista-disputas">{semDisputa.map(cartaoCompra)}</div>
            </details>
          )}
        </>
      )}
    </>
  );
}
