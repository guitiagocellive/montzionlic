import { BarChart3, Pause, Play, RotateCcw, Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type ConfigRobo, ITEM_ROBO_PADRAO } from "../../../shared/robo";
import type { Cotacao, ItemLicitacao, Licitacao } from "../../../shared/tipos";
import { Modal } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import {
  avancar,
  classificacao,
  criarSimulacao,
  type ItemSimulado,
  type ModoSimulacao,
  posicaoNossa,
  resultado,
  type Simulacao,
  simularAteOFim,
  terminou,
} from "../../robo/simulador";
import { precosDoItem } from "./AbaRobo";

const MODOS: { valor: ModoSimulacao; nome: string; dica: string }[] = [
  { valor: "aberto", nome: "Aberto", dica: "Lance nos 2 minutos finais prorroga por mais 2 minutos" },
  { valor: "fixo", nome: "Hora fixa", dica: "Termina na hora marcada, sem prorrogação (como na dispensa)" },
  { valor: "aberto-fechado", nome: "Aberto e fechado", dica: "Depois do cronômetro vem um fim aleatório e um lance fechado" },
];

const relogio = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

interface Comparacao {
  esperando: { vitorias: number; lances: number; margem: number };
  imediato: { vitorias: number; lances: number; margem: number };
  rodadas: number;
}

export function SimuladorRobo({
  licitacao,
  itens,
  cotacoes,
  config,
  aoFechar,
}: {
  licitacao: Licitacao;
  itens: ItemLicitacao[];
  cotacoes: Cotacao[];
  config: ConfigRobo;
  aoFechar: () => void;
}) {
  const [modo, setModo] = useState<ModoSimulacao>("aberto");
  const [duracao, setDuracao] = useState(3);
  const [velocidade, setVelocidade] = useState(5);
  const [concorrentes, setConcorrentes] = useState(3);
  const [semente, setSemente] = useState(() => Math.floor(Math.random() * 1e9));
  const [rodando, setRodando] = useState(false);
  const [, setQuadro] = useState(0);
  const [comparacao, setComparacao] = useState<Comparacao | null>(null);
  const [comparando, setComparando] = useState(false);
  const sim = useRef<Simulacao | null>(null);

  // Itens do simulador: os que têm valor mínimo; proposta inicial = preço de venda do orçamento.
  const simulados = useMemo<ItemSimulado[]>(
    () =>
      itens
        .map((i): ItemSimulado | null => {
          const cfg = config.itens[i.id] ?? ITEM_ROBO_PADRAO;
          if (!cfg.ativo || !cfg.minimo) return null;
          const p = precosDoItem(i, cotacoes, licitacao);
          const proposta = Math.max(p.venda ?? i.valor_referencia ?? cfg.minimo * 1.25, cfg.minimo * 1.02);
          return {
            id: i.id,
            numero: i.numero ?? String(i.id),
            descricao: i.descricao ?? "",
            quantidade: i.quantidade ?? 1,
            proposta: Math.round(proposta * 100) / 100,
            referencia: i.valor_referencia ?? proposta,
            config: cfg,
          };
        })
        .filter((x): x is ItemSimulado => !!x),
    [itens, cotacoes, licitacao, config],
  );

  const opcoes = { modo, duracaoMs: duracao * 60_000, concorrentes, semente };
  const geral = { segundosFinais: config.segundosFinais, naoAguardar: config.naoAguardar };

  function recomecar(novaSemente = true) {
    const s = novaSemente ? Math.floor(Math.random() * 1e9) : semente;
    setSemente(s);
    sim.current = criarSimulacao(simulados, { ...opcoes, semente: s }, geral);
    setComparacao(null);
    setRodando(false);
    setQuadro((q) => q + 1);
  }

  // Monta a disputa quando abre ou quando muda alguma opção.
  useEffect(() => {
    sim.current = criarSimulacao(simulados, opcoes, geral);
    setRodando(false);
    setComparacao(null);
    setQuadro((q) => q + 1);
  }, [modo, duracao, concorrentes, simulados]); // eslint-disable-line react-hooks/exhaustive-deps

  // Relógio: a cada 100 ms reais avança 100 ms x velocidade.
  useEffect(() => {
    if (!rodando) return;
    const t = setInterval(() => {
      const s = sim.current;
      if (!s) return;
      for (let k = 0; k < velocidade && !terminou(s); k++) avancar(s, 100);
      if (terminou(s)) setRodando(false);
      setQuadro((q) => q + 1);
    }, 100);
    return () => clearInterval(t);
  }, [rodando, velocidade]);

  function comparar() {
    setComparando(true);
    // Deixa a tela atualizar antes do cálculo.
    setTimeout(() => {
      const rodadas = 60;
      const soma = { esperando: { vitorias: 0, lances: 0, margem: 0 }, imediato: { vitorias: 0, lances: 0, margem: 0 } };
      for (let r = 0; r < rodadas; r++) {
        for (const [nome, naoAguardar] of [
          ["esperando", false],
          ["imediato", true],
        ] as const) {
          const res = simularAteOFim(simulados, { ...opcoes, semente: semente + r }, { segundosFinais: config.segundosFinais, naoAguardar });
          for (const x of res) {
            if (x.posicao === 1) {
              soma[nome].vitorias++;
              soma[nome].margem += x.margemSobreMinimo ?? 0;
            }
            soma[nome].lances += x.nossosLances;
          }
        }
      }
      setComparacao({ ...soma, rodadas });
      setComparando(false);
    }, 30);
  }

  const s = sim.current;
  if (!s) return null;
  const fim = terminou(s);
  const res = fim ? resultado(s) : null;
  const totalItens = simulados.length * (comparacao?.rodadas ?? 1);

  return (
    <Modal titulo="Simulador do robô de lances" aoFechar={aoFechar} largo>
      <div className="simulador">
        <p className="texto-fraco pequeno" style={{ margin: "-8px 0 0" }}>
          Disputa de mentira com concorrentes virtuais. O robô usa as configurações desta licitação:{" "}
          <strong>{config.naoAguardar ? "dá lance assim que perde o 1º lugar" : `só dá lances nos últimos ${config.segundosFinais} segundos`}</strong>.
        </p>

        <div className="simulador-opcoes">
          <div className="segmentado pequeno" role="radiogroup" aria-label="Modo de disputa">
            {MODOS.map((m) => (
              <button key={m.valor} type="button" className={modo === m.valor ? "ativo" : ""} onClick={() => setModo(m.valor)} title={m.dica}>
                {m.nome}
              </button>
            ))}
          </div>
          <label className="campo-inline">
            <span>Duração</span>
            <select value={duracao} onChange={(e) => setDuracao(Number(e.target.value))} aria-label="Duração">
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </select>
          </label>
          <label className="campo-inline">
            <span>Concorrentes</span>
            <select value={concorrentes} onChange={(e) => setConcorrentes(Number(e.target.value))} aria-label="Concorrentes">
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="campo-inline">
            <span>Velocidade</span>
            <select value={velocidade} onChange={(e) => setVelocidade(Number(e.target.value))} aria-label="Velocidade">
              {[1, 5, 10, 30].map((n) => (
                <option key={n} value={n}>
                  {n}x
                </option>
              ))}
            </select>
          </label>
          <span className="espaco" />
          {!fim && (
            <button className="botao acento pequeno" onClick={() => setRodando((r) => !r)}>
              {rodando ? <Pause /> : <Play />} {rodando ? "Pausar" : s.t > 0 ? "Continuar" : "Começar"}
            </button>
          )}
          <button className="botao secundario pequeno" onClick={() => recomecar(true)}>
            <RotateCcw /> Nova disputa
          </button>
        </div>
        <p className="texto-fraco pequeno" style={{ margin: 0 }}>
          {MODOS.find((m) => m.valor === modo)?.dica}. Tempo da disputa: <strong>{relogio(s.t)}</strong>
        </p>

        <div className="tabela-rolavel">
          <table className="tabela-fin tabela-simulador">
            <thead>
              <tr>
                <th>Item</th>
                <th>Cronômetro</th>
                <th className="num">Melhor lance</th>
                <th className="num">Nosso lance</th>
                <th>Posição</th>
                <th>O que o robô está fazendo</th>
              </tr>
            </thead>
            <tbody>
              {s.itens.map((d) => {
                const rank = classificacao(d);
                const pos = posicaoNossa(d);
                const restante = d.fimAberta - s.t;
                const naJanela = d.fase === "aberta" && restante <= config.segundosFinais * 1000;
                return (
                  <tr key={d.item.id}>
                    <td>
                      <strong>{d.item.numero}</strong> {d.item.descricao}
                      <small>mínimo {formatarMoeda(d.item.config.minimo)}</small>
                    </td>
                    <td>
                      {d.fase === "aberta" ? (
                        <span className={`cronometro ${naJanela ? "final" : ""}`}>{relogio(restante)}</span>
                      ) : d.fase === "aleatoria" ? (
                        <span className="cronometro final">fim aleatório</span>
                      ) : d.fase === "fechada" ? (
                        <span className="cronometro final">lance fechado</span>
                      ) : (
                        <span className="texto-fraco">encerrada</span>
                      )}
                      {d.prorrogacoes > 0 && <small>{d.prorrogacoes} prorrogação(ões)</small>}
                    </td>
                    <td className="num">
                      {formatarMoeda(rank[0].valor)}
                      <small>{rank[0].quem}</small>
                    </td>
                    <td className="num">{formatarMoeda(d.nosso)}</td>
                    <td>
                      <span className={`chip ${pos === 1 ? "verde" : ""}`}>{pos}º</span>
                    </td>
                    <td className="texto-suave pequeno">{d.ultimaDecisao || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {res && (
          <div className="resultado-simulador">
            <h3>
              <Trophy size={16} /> Resultado
            </h3>
            <ul>
              {res.map((r) => (
                <li key={r.numero}>
                  <strong>Item {r.numero}:</strong> {r.posicao === 1 ? "ganhamos" : `${r.posicao}º lugar`} com {formatarMoeda(r.nosso)}
                  {r.posicao !== 1 && ` (vencedor: ${formatarMoeda(r.vencedor.valor)})`} · {r.nossosLances} lance(s)
                  {r.posicao === 1 && r.margemSobreMinimo != null && ` · ${formatarMoeda(r.margemSobreMinimo)} acima do mínimo no total`}
                  {r.minimo != null && r.nosso < r.minimo - 0.001 && <strong className="texto-perigo"> · ABAIXO DO MÍNIMO</strong>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="comparacao-simulador">
          <div>
            <strong>
              <BarChart3 size={15} /> Esperar os segundos finais vale a pena?
            </strong>
            <p className="texto-fraco pequeno" style={{ margin: "2px 0 0" }}>
              Roda 60 disputas neste modo com as duas estratégias e compara.
            </p>
          </div>
          <button className="botao secundario pequeno" onClick={comparar} disabled={comparando}>
            {comparando ? "Calculando…" : "Comparar"}
          </button>
          {comparacao && (
            <table className="tabela-fin tabela-comparacao">
              <thead>
                <tr>
                  <th />
                  <th className="num">Itens ganhos</th>
                  <th className="num">Lances por item</th>
                  <th className="num">Acima do mínimo (média por vitória)</th>
                </tr>
              </thead>
              <tbody>
                {(["esperando", "imediato"] as const).map((k) => (
                  <tr key={k}>
                    <td>{k === "esperando" ? `Esperando os ${config.segundosFinais} s finais` : "Sem esperar"}</td>
                    <td className="num">
                      {comparacao[k].vitorias} de {totalItens}
                    </td>
                    <td className="num">{(comparacao[k].lances / totalItens).toFixed(1)}</td>
                    <td className="num">{formatarMoeda(comparacao[k].vitorias ? comparacao[k].margem / comparacao[k].vitorias : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="registro-simulador" aria-label="Registro da disputa">
          {s.registro
            .slice(-40)
            .reverse()
            .map((l, k) => (
              <div key={`${l.t}-${k}`} className={`linha-registro ${l.tipo}`}>
                <span>{relogio(l.t)}</span> {l.texto}
              </div>
            ))}
        </div>
      </div>
    </Modal>
  );
}
