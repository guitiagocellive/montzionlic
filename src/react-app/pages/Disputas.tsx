import { Check, ChevronDown, ClipboardCopy, Download, ListOrdered, LogIn, Play, RefreshCw, Square, TriangleAlert, Volume2, VolumeX, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { podeEditar, podeVer } from "../../shared/permissoes";
import { type CompraDisputa, type ConfigItemRobo, FASES, ITEM_ROBO_PADRAO, type ItemDisputa, lerCompra, lerItemDisputa, SEGUNDOS_FINAIS } from "../../shared/robo";
import type { Usuario } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { avisar, Modal, Vazio } from "../components/Ui";
import { paraNumero } from "../formato";
import { link } from "../rota";
import { noAplicativo, type PainelRobo, ponte, temPonte } from "../robo/ponte";

// Página Disputas: o robô roda dentro do aplicativo (recebe os lances em tempo real e responde na hora).
// Aqui só mostramos o que ele vê, guardamos a configuração de cada item e registramos os lances.

const EM_DISPUTA = new Set(["LA", "AL", "LF", "DM", "DF"]);
const ENCERRADAS = new Set(["E", "FE", "JE", "HE", "AE", "AR", "AC", "PE", "PR", "JR", "D1", "D2", "JT", "B3"]);
const abaDoItem = (fase: string) => (EM_DISPUTA.has(fase) ? "disputa" : ENCERRADAS.has(fase) ? "encerrados" : "aguardando");

const moeda = (v: number | null, quatro: boolean) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: quatro ? 4 : 2, maximumFractionDigits: quatro ? 4 : 2 });

const relogio = (seg: number) => {
  const s = Math.max(0, Math.floor(seg));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

const textoNumero = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

interface CompraNaTela {
  compra: CompraDisputa;
  itens: ItemDisputa[];
  lida: boolean;
  emDisputa: boolean;
  erro: string;
}

export function Disputas({ usuario }: { usuario: Usuario }) {
  const pode = podeVer(usuario.permissoes, "orcamento") && podeEditar(usuario.permissoes, "licitacoes");
  const [ligada, setLigada] = useState(temPonte());
  const [antigo, setAntigo] = useState(false); // aplicativo sem o motor novo
  const [painel, setPainel] = useState<PainelRobo | null>(null);
  const [lidoEm, setLidoEm] = useState(Date.now());
  const [agora, setAgora] = useState(Date.now());
  const [aba, setAba] = useState<"pregao" | "dispensa">("dispensa");
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [abaItens, setAbaItens] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, ConfigItemRobo>>({});
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [entrando, setEntrando] = useState(false);
  const [entrandoDesde, setEntrandoDesde] = useState<number | null>(null);
  const [classificacao, setClassificacao] = useState<{ compra: string; item: number; titulo: string } | null>(null);
  const mexidas = useRef(new Set<string>());
  const configCarregada = useRef(new Set<string>());
  const lancesEnviados = useRef(new Set<number>());
  const configRef = useRef(config);
  configRef.current = config;
  const painelRef = useRef<PainelRobo | null>(null);
  const [som, setSom] = useState(() => {
    try {
      return localStorage.getItem("disputas-som") !== "0";
    } catch {
      return true;
    }
  });
  // Itens em que alguém acabou de dar lance (o melhor lance mudou): treme por um instante.
  const [tremendo, setTremendo] = useState<Map<string, number>>(new Map());
  const melhoresAntes = useRef(new Map<string, number>());
  const avisosDados = useRef(new Set<string>());
  // Resultado das disputas que acabaram: junta por alguns segundos (várias dispensas acabam às 14h) e mostra.
  const [resultadosNaTela, setResultadosNaTela] = useState<NonNullable<PainelRobo["resultados"]> | null>(null);
  const vistos = useRef<Set<string>>(
    (() => {
      try {
        return new Set<string>(JSON.parse(localStorage.getItem("disputas-resultados-vistos") || "[]"));
      } catch {
        return new Set<string>();
      }
    })(),
  );
  const juntando = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fechada, setFechada] = useState<Record<string, string>>({});
  const [enviandoFechada, setEnviandoFechada] = useState<string | null>(null);

  // A ponte pode aparecer um pouco depois da página carregar.
  useEffect(() => {
    if (ligada) return;
    const t = setInterval(() => temPonte() && setLigada(true), 1000);
    return () => clearInterval(t);
  }, [ligada]);

  // Painel do robô: pergunta ao aplicativo (no próprio computador, sem ir ao Compras.gov.br) várias vezes por segundo.
  useEffect(() => {
    if (!ligada) return;
    let vivo = true;
    let erros = 0;
    const ler = async () => {
      try {
        const p = await ponte.painel();
        if (!vivo) return;
        erros = 0;
        setPainel(p);
        painelRef.current = p;
        setLidoEm(Date.now());
      } catch (e) {
        if (/Pedido desconhecido|desconhecido/i.test(mensagemDeErro(e))) setAntigo(true);
        if (++erros > 3 && vivo) setPainel(null);
      }
    };
    ler();
    const t = setInterval(ler, 300);
    const r = setInterval(() => setAgora(Date.now()), 250);
    return () => {
      vivo = false;
      clearInterval(t);
      clearInterval(r);
    };
  }, [ligada]);

  const compras: CompraNaTela[] = useMemo(
    () =>
      (painel?.compras ?? [])
        .map((c) => {
          const compra = lerCompra({ chaveCompra: c.chave, ...c.info });
          return compra ? { compra, itens: c.itens.map(lerItemDisputa).filter((i) => i.numero > 0), lida: c.lida, emDisputa: c.emDisputa, erro: c.erro } : null;
        })
        .filter((x): x is CompraNaTela => !!x),
    [painel],
  );

  // Alguém deu lance: o melhor lance do item mudou e não é o nosso → treme o item.
  useEffect(() => {
    const novos: string[] = [];
    for (const c of compras)
      for (const i of c.itens) {
        const k = `${c.compra.chave}:${i.numero}`;
        if (i.melhorLance == null) continue;
        const antes = melhoresAntes.current.get(k);
        melhoresAntes.current.set(k, i.melhorLance);
        const nosso = i.nossoLance != null && i.melhorLance >= i.nossoLance - 1e-9;
        if (antes != null && Math.abs(antes - i.melhorLance) > 1e-9 && !nosso) novos.push(k);
      }
    if (!novos.length) return;
    const marca = Date.now();
    setTremendo((t) => new Map([...t, ...novos.map((k) => [k, marca] as [string, number])]));
    if (som) tocar("lance");
    setTimeout(() => setTremendo((t) => new Map([...t].filter(([, m]) => m !== marca))), 700);
  }, [compras]); // eslint-disable-line react-hooks/exhaustive-deps

  // Avisos sonoros do cronômetro: faltando 2 min, 1 min, 30 s e 10 s (cada um uma vez por item).
  useEffect(() => {
    if (!som) return;
    const atrasoSeg = (agora - lidoEm) / 1000;
    for (const c of compras)
      for (const i of c.itens) {
        if (i.restanteSeg == null || !EM_DISPUTA.has(i.fase)) continue;
        const r = i.restanteSeg - atrasoSeg;
        const k = `${c.compra.chave}:${i.numero}`;
        for (const limite of [120, 60, 30, 10]) {
          const chave = `${k}:${limite}`;
          if (r <= limite && r > limite - 4 && !avisosDados.current.has(chave)) {
            avisosDados.current.add(chave);
            tocar(limite <= 10 ? "final" : limite <= 30 ? "urgente" : "aviso");
          }
          if (r > limite + 5) avisosDados.current.delete(chave); // cronômetro reiniciou (prorrogação)
        }
      }
  }, [agora]); // eslint-disable-line react-hooks/exhaustive-deps

  // Disputas encerradas: abre a janela com a posição em cada item.
  useEffect(() => {
    const novos = (painel?.resultados ?? []).filter((r) => !vistos.current.has(`${r.compra}:${r.item}:${r.em}`));
    if (!novos.length || juntando.current) return;
    juntando.current = setTimeout(() => {
      juntando.current = null;
      const todos = (painelRef.current?.resultados ?? []).filter((r) => !vistos.current.has(`${r.compra}:${r.item}:${r.em}`));
      if (!todos.length) return;
      todos.forEach((r) => vistos.current.add(`${r.compra}:${r.item}:${r.em}`));
      try {
        localStorage.setItem("disputas-resultados-vistos", JSON.stringify([...vistos.current].slice(-300)));
      } catch {
        /* sem armazenamento */
      }
      setResultadosNaTela((atual) => [...(atual ?? []), ...todos]);
      if (som) tocar("aviso");
    }, 4000);
  }, [painel?.resultados]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pregões podem durar horas: se a ligação com o Compras.gov.br cair com robô ligado, avisa na hora (e toca).
  const roboLigado = Object.values(config).some((c) => c.ligado);
  const conexaoRuim =
    roboLigado && ligada && (!painel || agora - lidoEm > 4000 || (painel.fase !== "pronto" && painel.fase !== "erro-lista") || painel.conectado === false);
  const ultimoAlarme = useRef(0);
  useEffect(() => {
    if (!conexaoRuim || !som || Date.now() - ultimoAlarme.current < 15000) return;
    ultimoAlarme.current = Date.now();
    tocar("urgente");
  }, [conexaoRuim, agora]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enviarFechada(k: string, compra: string, item: ItemDisputa, quatro: boolean) {
    const valor = paraNumero(fechada[k] ?? "");
    if (!(valor && valor > 0)) return avisar("Informe o valor do lance fechado.", "erro");
    if (item.nossoLance != null && valor >= item.nossoLance) return avisar("O lance fechado precisa ser menor que o seu lance atual.", "erro");
    if (!window.confirm(`Enviar o lance ÚNICO da etapa fechada no item ${item.numero}?\n\n${moeda(valor, quatro)}\n\nDepois de enviado, não dá para mudar.`)) return;
    setEnviandoFechada(k);
    try {
      const r = await ponte.lance(compra, item.numero, valor, item.fase);
      if (!r.ok) throw new Error(r.mensagem || `O Compras.gov.br recusou (${r.status}).`);
      avisar(`Lance fechado de ${moeda(valor, quatro)} enviado.`);
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setEnviandoFechada(null);
    }
  }

  // Configuração dos itens: vem da plataforma (vale para a equipe) e vai para o robô do aplicativo.
  const chavesCompras = compras.map((c) => c.compra.chave).join(",");
  useEffect(() => {
    const faltam = chavesCompras.split(",").filter((k) => k && !configCarregada.current.has(k));
    if (!faltam.length) return;
    faltam.forEach((k) => configCarregada.current.add(k));
    api<{ itens: Record<string, ConfigItemRobo> }>(`/robo/itens?compras=${encodeURIComponent(faltam.join(","))}`)
      .then((r) => {
        setConfig((atual) => {
          const novo = { ...r.itens, ...atual };
          ponte.configurar(novo).catch(() => {});
          return novo;
        });
        setTextos((t) => {
          const novo = { ...t };
          for (const [k, c] of Object.entries(r.itens)) {
            novo[`${k}:minimo`] ??= textoNumero(c.minimo);
            novo[`${k}:desconto`] ??= textoNumero(c.desconto);
          }
          return novo;
        });
      })
      .catch((e) => {
        faltam.forEach((k) => configCarregada.current.delete(k));
        avisar(mensagemDeErro(e), "erro");
      });
  }, [chavesCompras]);

  // Lances que o robô deu: registra na plataforma e avisa o aplicativo que já registrou.
  useEffect(() => {
    const novos = (painel?.lances ?? []).filter((l) => !lancesEnviados.current.has(l.id));
    if (!novos.length) return;
    novos.forEach((l) => lancesEnviados.current.add(l.id));
    Promise.all(
      novos.map((l) => api("/robo/lances", { corpo: { compra: l.compra, item: l.item, valor: l.valor, ok: l.ok, mensagem: l.mensagem ?? "" } }).catch(() => {})),
    ).then(() => ponte.confirmar(novos.map((l) => l.id)).catch(() => {}));
  }, [painel?.lances]);

  // Como no Siga Pregão: compra com disputa acontecendo já aparece aberta.
  useEffect(() => {
    const abrir = compras.filter((c) => c.itens.some((i) => abaDoItem(i.fase) !== "encerrados") && !mexidas.current.has(c.compra.chave)).map((c) => c.compra.chave);
    if (abrir.some((k) => !abertas.has(k))) setAbertas((s) => new Set([...s, ...abrir]));
  }, [compras, abertas]);

  // Abre na aba (pregões ou dispensas) onde há disputa.
  const temDispensa = compras.some((c) => c.compra.modalidade === "dispensa");
  const temPregao = compras.some((c) => c.compra.modalidade !== "dispensa");
  useEffect(() => {
    if (aba === "dispensa" && !temDispensa && temPregao) setAba("pregao");
    if (aba === "pregao" && !temPregao && temDispensa) setAba("dispensa");
  }, [temDispensa, temPregao]); // eslint-disable-line react-hooks/exhaustive-deps

  // Salva a configuração de um item: no robô do aplicativo na hora, na plataforma um instante depois.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function mudarItem(k: string, novo: Partial<ConfigItemRobo>) {
    const item = { ...(configRef.current[k] ?? ITEM_ROBO_PADRAO), ...novo };
    const todos = { ...configRef.current, [k]: item };
    configRef.current = todos;
    setConfig(todos);
    ponte.configurar(todos).catch((e) => avisar(mensagemDeErro(e), "erro"));
    clearTimeout(timers.current.get(k));
    timers.current.set(
      k,
      setTimeout(() => api(`/robo/itens/${encodeURIComponent(k)}`, { metodo: "PUT", corpo: { item } }).catch((e) => avisar(mensagemDeErro(e), "erro")), 500),
    );
  }

  // Como no Siga Pregão: o mínimo e o desconto só mudam com o robô PARADO. Ao ligar, vale o que está digitado.
  // (Antes o robô usava o valor a cada tecla: digitando 290, no "2" ele já entendia mínimo 2 e dava lance.)
  function alternarRobo(k: string, item: ItemDisputa) {
    const cfg = config[k] ?? ITEM_ROBO_PADRAO;
    if (cfg.ligado) return mudarItem(k, { ligado: false });
    const minimo = paraNumero(textos[`${k}:minimo`] ?? "") ?? cfg.minimo;
    const textoDesconto = textos[`${k}:desconto`];
    const desconto = textoDesconto != null ? (paraNumero(textoDesconto) ?? 0) : cfg.desconto;
    if (!(minimo && minimo > 0)) return avisar("Informe o lance mínimo antes de ligar o robô.", "erro");
    if (!(desconto >= 0 && desconto <= 50)) return avisar("O desconto precisa ficar entre 0 e 50%.", "erro");
    if (item.nossoLance != null && minimo > item.nossoLance) avisar("O lance mínimo está acima do seu lance atual: o robô não vai baixar.", "erro");
    const ref = item.nossoLance ?? item.melhorLance;
    if (ref != null && minimo < ref * 0.6 && !window.confirm(`Confirma o lance mínimo de ${moeda(minimo, cfg.quatroCasas)}?\n\nEle está ${Math.round((1 - minimo / ref) * 100)}% abaixo de ${moeda(ref, cfg.quatroCasas)}.`)) return;
    mudarItem(k, { minimo, desconto, ligado: true });
  }

  // Quanto tempo está em "Entrando na sala de disputa" (depois de 20 s aparecem as ajudas).
  const faseAtual = painel?.fase ?? "sem-login";
  useEffect(() => {
    if (faseAtual !== "entrando") return setEntrandoDesde(null);
    setEntrandoDesde((d) => d ?? Date.now());
  }, [faseAtual]);

  async function copiarDiagnostico() {
    try {
      const { texto } = await ponte.diagnostico();
      await navigator.clipboard.writeText(texto);
      avisar("Diagnóstico copiado. Cole na conversa com o suporte (não tem senhas, chaves nem CPF).");
    } catch (e) {
      const msg = mensagemDeErro(e);
      avisar(/desconhecido/i.test(msg) ? "Atualize o aplicativo para copiar o diagnóstico." : msg, "erro");
    }
  }

  async function entrar(mostrar = false) {
    setEntrando(true);
    try {
      await ponte.entrar(mostrar);
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setTimeout(() => setEntrando(false), 1500);
    }
  }

  const visiveis = compras.filter((c) => (aba === "pregao" ? c.compra.modalidade !== "dispensa" : c.compra.modalidade === "dispensa"));
  // Em cima: compras com disputa acontecendo (ou ainda sendo verificadas). Embaixo, recolhidas: sem disputa agora.
  const ativas = visiveis.filter((c) => c.lida && c.emDisputa);
  const semDisputa = visiveis.filter((c) => c.lida && !c.emDisputa);
  const conferindo = visiveis.filter((c) => !c.lida).length;
  const ultimoLance = painel?.ultimoLance ?? null;

  const cartaoCompra = ({ compra: c, itens, lida, erro }: CompraNaTela) => {
    const aberta = abertas.has(c.chave);
    const robo = Object.entries(config).some(([k, v]) => v.ligado && k.startsWith(`${c.chave}:`));
    const emLances = itens.some((i) => EM_DISPUTA.has(i.fase));
    const abaAtual = abaItens[c.chave] ?? (emLances ? "disputa" : itens.some((i) => abaDoItem(i.fase) === "aguardando") ? "aguardando" : "disputa");
    const conta = (a: string) => itens.filter((i) => abaDoItem(i.fase) === a).length;
    const atraso = (agora - lidoEm) / 1000;
    return (
      <article key={c.chave} className={`compra-disputa ${aberta ? "aberta" : ""}`}>
        <button
          className="compra-disputa-topo"
          onClick={() => {
            mexidas.current.add(c.chave);
            setAbertas((s) => {
              const n = new Set(s);
              if (n.has(c.chave)) n.delete(c.chave);
              else n.add(c.chave);
              return n;
            });
          }}
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
              {!lida && <span className="chip">Verificando…</span>}
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
            {erro && <p className="alerta erro">{erro}</p>}
            {!lida && (
              <p className="texto-fraco carregando-linha">
                <RefreshCw className="girando" /> Lendo os itens…
              </p>
            )}
            {itens
              .filter((i) => abaDoItem(i.fase) === abaAtual)
              .map((i) => {
                const k = `${c.chave}:${i.numero}`;
                const cfg = config[k] ?? ITEM_ROBO_PADRAO;
                const restante = i.restanteSeg == null ? null : i.restanteSeg - atraso;
                const situacao = i.situacao === "G" ? "ganhando" : i.situacao === "E" ? "empatado" : i.situacao === "P" ? "perdendo" : "";
                const nosso = i.melhorLance != null && i.nossoLance != null && i.melhorLance >= i.nossoLance;
                const msg = painel?.mensagens[k];
                return (
                  <div key={k} className={`item-disputa ${situacao} ${cfg.ligado ? "robo-ligado" : ""} ${faixaTempo(i.fase, restante)} ${tremendo.has(k) ? "lance-novo" : ""}`}>
                    <div className="item-disputa-titulo">
                      <strong>
                        ITEM {i.numero}
                        {i.descricao && ` - ${i.descricao}`}
                      </strong>
                      {situacao && <span className={`selo-situacao ${situacao}`}>{situacao.toUpperCase()}</span>}
                      {i.colocacao && (
                        <span className="selo-colocacao" title="Pela última classificação lida">
                          {i.colocacao.posicao}º de {i.colocacao.total}
                        </span>
                      )}
                      <button className="botao secundario pequeno botao-classificacao" onClick={() => setClassificacao({ compra: c.chave, item: i.numero, titulo: `Item ${i.numero}${i.descricao ? ` - ${i.descricao}` : ""}` })}>
                        <ListOrdered size={14} /> Classificação
                      </button>
                    </div>
                    <div className="item-disputa-grade">
                      <label className="campo">
                        <span>lance mínimo (R$)</span>
                        <span className="entrada">
                          <input
                            inputMode="decimal"
                            value={textos[`${k}:minimo`] ?? textoNumero(cfg.minimo)}
                            onChange={(e) => setTextos((t) => ({ ...t, [`${k}:minimo`]: e.target.value }))}
                            onBlur={(e) => !cfg.ligado && mudarItem(k, { minimo: paraNumero(e.target.value) })}
                            disabled={cfg.ligado}
                            title={cfg.ligado ? "Pare o robô para alterar o lance mínimo" : ""}
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
                            onChange={(e) => setTextos((t) => ({ ...t, [`${k}:desconto`]: e.target.value }))}
                            onBlur={(e) => {
                              const n = paraNumero(e.target.value) ?? 0;
                              if (!cfg.ligado && n >= 0 && n <= 50) mudarItem(k, { desconto: n });
                            }}
                            disabled={cfg.ligado}
                            placeholder="0"
                            title={cfg.ligado ? "Pare o robô para alterar" : "0 = cobre pelo menor valor permitido (mais lucro)"}
                            aria-label={`Desconto do item ${i.numero}`}
                          />
                        </span>
                      </label>
                      <div className={`valor-disputa melhor-lance ${tremendo.has(k) ? "tremer" : ""}`} key={tremendo.has(k) ? `t${tremendo.get(k)}` : "parado"}>
                        <span>Melhor lance</span>
                        <strong className={nosso ? "texto-verde" : "texto-perigo"}>
                          {moeda(i.melhorLance, cfg.quatroCasas)} <em className={`selo-quem ${nosso ? "voce" : ""}`}>{nosso ? "VOCÊ" : "CONCORRENTE"}</em>
                        </strong>
                      </div>
                      <div className="valor-disputa">
                        <span>Meu lance</span>
                        <strong className={nosso ? "texto-verde" : "texto-perigo"}>{moeda(i.nossoLance, cfg.quatroCasas)}</strong>
                      </div>
                      <div className={`cronometro-disputa ${faixaTempo(i.fase, restante)}`} title="Tempo que falta para a etapa terminar">
                        <span>{i.fase === "AL" ? "aleatório" : restante != null ? relogio(restante) : "—"}</span>
                        {i.fase !== "AL" && restante != null && (
                          <small>
                            termina às{" "}
                            {new Date(i.fimEm ?? Date.now() + restante * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </small>
                        )}
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
                        <input type="checkbox" checked={cfg.quatroCasas} disabled={cfg.ligado} onChange={(e) => mudarItem(k, { quatroCasas: e.target.checked })} /> Permitir lances com 4 casas decimais
                      </label>
                      <label>
                        <input type="checkbox" checked={cfg.naoAguardar} disabled={cfg.ligado} onChange={(e) => mudarItem(k, { naoAguardar: e.target.checked })} /> Não esperar os últimos{" "}
                        {SEGUNDOS_FINAIS} segundos para cobrir
                      </label>
                    </div>
                    {i.fase === "LF" &&
                      (() => {
                        const nome = painel?.enumsRodada?.[i.situacaoRodada] ?? "";
                        const naoConvocado = /NAO_CONVOCADO/.test(nome);
                        const enviou = /ENVIOU_NOVO_LANCE_FASE_FECHADA|PARTICIPOU_FASE_FECHADA/.test(nome);
                        const ignorou = /IGNOROU/.test(nome);
                        if (naoConvocado) return <p className="etapa-fechada nao">Você não foi convocado para a etapa fechada deste item.</p>;
                        if (enviou) return <p className="etapa-fechada ok">Lance fechado enviado. Agora é aguardar o resultado.</p>;
                        if (ignorou) return <p className="etapa-fechada nao">A etapa fechada terminou sem o seu lance.</p>;
                        return (
                          <div className="etapa-fechada">
                            <div>
                              <strong>Etapa fechada{nome === "CONVOCADO" ? ": você foi convocado" : ""}</strong>
                              <span>Lance único e às cegas. Confira o valor e envie você mesmo (sugestão: o seu mínimo).</span>
                            </div>
                            <span className="entrada">
                              <input
                                inputMode="decimal"
                                value={fechada[k] ?? textoNumero(cfg.minimo)}
                                onChange={(e) => setFechada((f) => ({ ...f, [k]: e.target.value }))}
                                aria-label={`Lance fechado do item ${i.numero}`}
                                placeholder="0,00"
                              />
                            </span>
                            <button className="botao acento" disabled={enviandoFechada === k} onClick={() => enviarFechada(k, c.chave, i, cfg.quatroCasas)}>
                              Enviar lance fechado
                            </button>
                          </div>
                        );
                      })()}
                    {cfg.ligado && <p className="aviso-robo-travado">Robô ligado com mínimo de {moeda(cfg.minimo, cfg.quatroCasas)}. Para mudar o mínimo, pare o robô (■), altere e ligue de novo.</p>}
                    <div className="item-disputa-rodape">
                      <span className="texto-fraco pequeno">
                        {FASES[i.fase] ?? i.fase}
                        {i.variacaoMinima != null && i.variacaoMinima > 0 && (
                          <> · intervalo mínimo entre lances (edital): {i.tipoVariacao === "P" ? `${textoNumero(i.variacaoMinima)}%` : moeda(i.variacaoMinima, cfg.quatroCasas)}</>
                        )}
                      </span>
                      <span className={`mensagem-robo ${msg?.erro ? "erro" : ""}`}>{cfg.ligado ? (msg?.texto ?? "Robô ligado") : "Robô parado"}</span>
                    </div>
                    {(() => {
                      // Os 3 últimos lances do robô neste item: hora, valor e a colocação que cada um buscava.
                      const ultimo = painel?.ultimosPorItem?.[k] ?? [...(painel?.lances ?? [])].reverse().find((l) => l.compra === c.chave && l.item === i.numero);
                      const recentes = painel?.recentesPorItem?.[k] ?? (ultimo ? [ultimo] : []);
                      if (!recentes.length) return null;
                      return (
                        <ul className="lances-recentes" aria-label="Últimos lances do robô">
                          {recentes.map((l, n) => {
                            const p = (l as { posicao?: number }).posicao;
                            const tipo = (l as { tipo?: string }).tipo;
                            const objetivo = !l.ok
                              ? `recusado pelo Compras.gov.br${l.mensagem ? `: ${l.mensagem}` : ""}`
                              : tipo === "fechada"
                                ? "lance único da etapa fechada"
                                : p
                                  ? `lance para ficar em ${p}º lugar`
                                  : "aceito pelo Compras.gov.br";
                            return (
                              <li key={`${l.em}-${n}`} className={`${l.ok ? "ok" : "erro"} ${n === 0 ? "novo" : ""}`}>
                                <span className="hora">{new Date(l.em).toLocaleTimeString("pt-BR")}</span>
                                <b>{moeda(l.valor, cfg.quatroCasas)}</b>
                                <span>{objetivo}</span>
                              </li>
                            );
                          })}
                        </ul>
                      );
                    })()}
                  </div>
                );
              })}
            {lida && itens.filter((i) => abaDoItem(i.fase) === abaAtual).length === 0 && <p className="texto-fraco pequeno">Nenhum item aqui.</p>}
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

  const fase = painel?.fase ?? "sem-login";
  const passo = (feito: boolean, atual: boolean, texto: string) => (
    <li className={feito ? "feito" : atual ? "atual" : ""}>
      <span className="marca-passo">{feito ? <Check /> : atual ? <RefreshCw className="girando" /> : null}</span>
      {texto}
    </li>
  );

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Licitações</span>
          <h1>Disputas</h1>
          <p className="texto-suave">
            Robô de lances do Compras.gov.br: recebe cada lance na hora e cobre na mesma hora, até o seu lance mínimo, para ficar na melhor colocação.
          </p>
        </div>
      </div>

      {!ligada && noAplicativo() ? (
        <section className="cartao disputas-aviso entrar">
          <RefreshCw className="girando" />
          <div>
            <h2>Ligando o robô de lances…</h2>
            <p className="texto-suave">
              Você já está no aplicativo Montzion (versão {window.montzionApp?.versao}). O robô liga sozinho em alguns segundos. Se esta mensagem continuar por mais de 1
              minuto, feche o Montzion e abra de novo pelo atalho.
            </p>
          </div>
        </section>
      ) : !ligada || antigo ? (
        <section className="cartao disputas-aviso entrar">
          <Download />
          <div>
            <h2>{antigo ? "Atualize o aplicativo Montzion" : "O robô funciona pelo aplicativo do Windows"}</h2>
            <p className="texto-suave">
              {antigo
                ? "Esta versão do aplicativo ainda usa o robô antigo. Baixe o instalador e abra: ele atualiza sozinho, sem perder nada."
                : "Abra a plataforma pelo aplicativo Montzion: é nele que o robô roda, recebe os lances em tempo real e responde na hora. Sua senha e seu certificado não passam pela plataforma."}
            </p>
            <a className="botao acento" {...link("/configuracoes/aplicativo")}>
              <Download /> Baixar o aplicativo
            </a>
          </div>
        </section>
      ) : fase === "sem-login" || fase === "aguardando-login" ? (
        <section className="cartao disputas-aviso entrar">
          <LogIn />
          <div>
            <h2>{fase === "aguardando-login" ? "Entre com a sua conta gov.br na janela que abriu" : "Entre na sua conta do Compras.gov.br"}</h2>
            <p className="texto-suave">
              Abre a janela de login do gov.br (certificado ou senha). Quando você entrar, ela fecha sozinha e as suas disputas aparecem aqui, só as que estão
              acontecendo.
            </p>
            <button className="botao acento" onClick={() => entrar(fase === "aguardando-login")} disabled={entrando}>
              <LogIn /> {fase === "aguardando-login" ? "Mostrar a janela de login" : "Entrar com gov.br"}
            </button>
          </div>
        </section>
      ) : fase === "entrando" || fase === "buscando" || (fase === "erro-lista" && !compras.length) ? (
        <section className="cartao disputas-aviso entrar">
          {fase === "erro-lista" ? <TriangleAlert /> : <RefreshCw className="girando" />}
          <div>
            <h2>{fase === "erro-lista" ? "Não consegui buscar as disputas" : "Entrando no Compras.gov.br…"}</h2>
            <ol className="passos-login">
              {passo(true, false, "Login no gov.br")}
              {passo(fase !== "entrando", fase === "entrando", "Entrando na sala de disputa")}
              {passo(false, fase === "buscando", "Buscando as disputas que estão acontecendo")}
            </ol>
            {painel?.aviso && <p className={fase === "erro-lista" ? "alerta erro" : "texto-suave"}>{painel.aviso}</p>}
            {(fase === "erro-lista" || /janela/i.test(painel?.aviso ?? "") || (fase === "entrando" && entrandoDesde != null && agora - entrandoDesde > 20_000)) && (
              <div className="linha-acoes">
                {fase === "erro-lista" && (
                  <button className="botao acento" onClick={() => ponte.atualizar().catch((e) => avisar(mensagemDeErro(e), "erro"))}>
                    <RefreshCw /> Tentar de novo
                  </button>
                )}
                <button className="botao secundario" onClick={() => entrar(true)}>
                  Mostrar a janela do Compras.gov.br
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
          <div className="disputas-topo">
            <div className="segmentado pequeno">
              <button className={aba === "pregao" ? "ativo" : ""} onClick={() => setAba("pregao")}>
                Pregões eletrônicos
              </button>
              <button className={aba === "dispensa" ? "ativo" : ""} onClick={() => setAba("dispensa")}>
                Dispensas eletrônicas
              </button>
            </div>
            <span className={`chip ${painel?.tempoReal ? "verde" : "amarelo"}`} title={painel?.tempoReal ? "Recebendo cada lance na hora" : "Sem o canal em tempo real: consultando o Compras.gov.br"}>
              <Zap size={13} /> {painel?.tempoReal ? "Tempo real" : "Consultando"}
            </span>
            {ultimoLance && (
              <span className="texto-fraco pequeno" title="Tempo entre o lance do concorrente chegar e o nosso lance sair">
                último lance em {ultimoLance.reacaoMs} ms
              </span>
            )}
            <span className="texto-fraco pequeno">
              {new Date(agora).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (horário de Brasília)
            </span>
            <button
              className={`botao-icone ${som ? "" : "desligado"}`}
              onClick={() => {
                const novo = !som;
                setSom(novo);
                try {
                  localStorage.setItem("disputas-som", novo ? "1" : "0");
                } catch {
                  /* sem armazenamento: vale só nesta tela */
                }
                if (novo) tocar("aviso");
              }}
              aria-label={som ? "Desligar os avisos sonoros" : "Ligar os avisos sonoros"}
              title={som ? "Avisos sonoros ligados (2 min, 1 min, 30 s, 10 s e lance novo)" : "Avisos sonoros desligados"}
            >
              {som ? <Volume2 /> : <VolumeX />}
            </button>
            <button className="botao-icone" onClick={() => ponte.atualizar().catch((e) => avisar(mensagemDeErro(e), "erro"))} aria-label="Atualizar disputas" title="Atualizar disputas">
              <RefreshCw />
            </button>
          </div>

          {fase === "erro-lista" && painel?.aviso && <p className="alerta erro">{painel.aviso}</p>}
          {conexaoRuim && (
            <p className="alerta erro alerta-conexao">
              <TriangleAlert size={16} /> Robô ligado, mas a ligação com o Compras.gov.br está instável
              {painel?.fase === "sem-login" || painel?.conectado === false ? " (sessão expirada: clique em Entrar com gov.br)" : ""}. Confira a internet e o
              aplicativo.
            </p>
          )}

          {conferindo > 0 && (
            <p className="conferindo-disputas">
              <RefreshCw size={14} className="girando" /> Conferindo {conferindo} compra(s) no Compras.gov.br…
            </p>
          )}
          {ativas.length === 0 && conferindo > 0 ? null : ativas.length === 0 ? (
            <section className="cartao">
              <Vazio icone={<TriangleAlert />} titulo={`Nenhuma ${aba === "pregao" ? "disputa de pregão" : "dispensa"} acontecendo agora`}>
                Quando uma disputa sua começar no Compras.gov.br, ela aparece aqui sozinha.
                {(painel?.descartadas ?? 0) > 0 && ` ${painel!.descartadas} compra(s) já encerrada(s), revogada(s) ou deserta(s) ficaram de fora.`}
              </Vazio>
            </section>
          ) : (
            <div className="lista-disputas">{ativas.map(cartaoCompra)}</div>
          )}
          {semDisputa.length > 0 && (
            <details className="sem-disputa">
              <summary>
                <ChevronDown className="seta" /> Sem disputa agora ({semDisputa.length})
                <span className="texto-fraco pequeno"> · se a disputa começar, ela sobe sozinha</span>
              </summary>
              <div className="lista-disputas">{semDisputa.map(cartaoCompra)}</div>
            </details>
          )}
        </>
      )}
      {resultadosNaTela && resultadosNaTela.length > 0 && (
        <JanelaResultados resultados={resultadosNaTela} compras={compras} aoFechar={() => setResultadosNaTela(null)} />
      )}
      {classificacao && <JanelaClassificacao {...classificacao} quatro={(config[`${classificacao.compra}:${classificacao.item}`] ?? ITEM_ROBO_PADRAO).quatroCasas} aoFechar={() => setClassificacao(null)} />}
    </>
  );
}

/** Classificação do item (melhor lance de cada participante), lida na hora pelo aplicativo no Compras.gov.br. */
function JanelaClassificacao({ compra, item, titulo, quatro, aoFechar }: { compra: string; item: number; titulo: string; quatro: boolean; aoFechar: () => void }) {
  const [estado, setEstado] = useState<{ posicoes?: { valor: number; nosso: boolean }[]; erro?: string; em?: number } | null>(null);
  const ler = () => {
    setEstado(null);
    ponte
      .classificacao(compra, item)
      .then((r) => setEstado(r))
      .catch((e) => setEstado({ erro: mensagemDeErro(e) }));
  };
  useEffect(ler, [compra, item]);
  return (
    <Modal titulo={`Classificação · ${titulo}`} aoFechar={aoFechar}>
      {!estado ? (
        <p className="texto-suave carregando-linha">
          <RefreshCw className="girando" /> Lendo a classificação no Compras.gov.br…
        </p>
      ) : estado.erro ? (
        <p className="alerta erro">{estado.erro}</p>
      ) : !estado.posicoes?.length ? (
        <p className="texto-fraco">Ainda não há lances neste item.</p>
      ) : (
        <>
          <ol className="lista-classificacao">
            {estado.posicoes.map((p, n) => (
              <li key={n} className={p.nosso ? "nosso" : ""}>
                <span className="pos">{n + 1}º</span>
                <span>{p.nosso ? "Você" : "Concorrente"}</span>
                <b>{moeda(p.valor, quatro)}</b>
              </li>
            ))}
          </ol>
          <p className="texto-fraco pequeno">
            Melhor lance de cada participante, como na sala de disputa. Lida às {estado.em ? new Date(estado.em).toLocaleTimeString("pt-BR") : "—"}.
          </p>
        </>
      )}
      <div className="linha-acoes">
        <button className="botao secundario" onClick={ler}>
          <RefreshCw /> Atualizar
        </button>
      </div>
    </Modal>
  );
}

/** Faixa do cronômetro: aviso (≤ 2 min), crítico (≤ 30 s, vermelho) e final (≤ 10 s, pulsando). */
function faixaTempo(fase: string, restante: number | null) {
  if (fase === "AL") return "tempo-final";
  if (restante == null || !EM_DISPUTA.has(fase)) return "";
  if (restante <= SEGUNDOS_FINAIS) return "tempo-final";
  if (restante <= 30) return "tempo-critico";
  if (restante <= 120) return "tempo-aviso";
  return "";
}

let audio: AudioContext | null = null;
/** Bipes curtos (sem arquivo de som): aviso, urgente, final e lance novo. */
function tocar(tipo: "aviso" | "urgente" | "final" | "lance") {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const notas: Record<typeof tipo, [number, number][]> = {
      aviso: [[880, 0.12], [1175, 0.18]],
      urgente: [[988, 0.1], [988, 0.1], [1319, 0.22]],
      final: [[1319, 0.08], [1568, 0.08], [1319, 0.08], [1568, 0.2]],
      lance: [[660, 0.07]],
    };
    let t = audio.currentTime;
    for (const [freq, dur] of notas[tipo]) {
      const osc = audio.createOscillator();
      const ganho = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      ganho.gain.setValueAtTime(0.0001, t);
      ganho.gain.exponentialRampToValueAtTime(tipo === "lance" ? 0.12 : 0.25, t + 0.015);
      ganho.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(ganho).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur + 0.05;
    }
  } catch {
    /* sem áudio neste navegador */
  }
}

/** Fim das disputas: em que posição ficamos em cada item, agrupado por licitação. */
function JanelaResultados({ resultados, compras, aoFechar }: { resultados: NonNullable<PainelRobo["resultados"]>; compras: CompraNaTela[]; aoFechar: () => void }) {
  const porCompra = new Map<string, typeof resultados>();
  for (const r of resultados) porCompra.set(r.compra, [...(porCompra.get(r.compra) ?? []), r]);
  const titulo = (chave: string) => {
    const c = compras.find((x) => x.compra.chave === chave)?.compra ?? lerCompra({ chaveCompra: chave });
    return c ? [c.titulo, c.orgao].filter(Boolean).join(" · ") : chave;
  };
  return (
    <Modal titulo="Disputas encerradas" aoFechar={aoFechar}>
      <div className="resultados-disputa">
        {[...porCompra.entries()].map(([chave, itens]) => (
          <section key={chave}>
            <h3>{titulo(chave)}</h3>
            <ul>
              {itens
                .sort((a, b) => a.item - b.item)
                .map((r) => (
                  <li key={`${r.item}-${r.em}`} className={r.posicao === 1 ? "primeiro" : r.posicao > 0 && r.posicao <= 3 ? "podio" : ""}>
                    <span className="medalha">{r.posicao > 0 ? `${r.posicao}º` : "—"}</span>
                    <div>
                      <strong>
                        Item {r.item}
                        {r.descricao ? ` - ${r.descricao}` : ""}
                      </strong>
                      <span className="texto-fraco pequeno">
                        {r.posicao > 0 ? `${r.posicao}º lugar${r.total ? ` de ${r.total}` : ""}` : "posição não informada"} · seu lance {moeda(r.nosso, false)}
                        {r.posicao !== 1 && r.primeiro != null && ` · 1º lugar com ${moeda(r.primeiro, false)}`}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
