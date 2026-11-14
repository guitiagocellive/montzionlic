import { CircleCheck, CircleHelp, ExternalLink, Gavel, Info, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { formatarData, formatarMoeda, formatarNumero } from "../../formato";

// Análise de empresas — o que vem de dados públicos além das vitórias do PNCP:
// - Penalidades: Consulta Consolidada de Pessoa Jurídica do TCU (inidôneos TCU, CNIA/CNJ, CEIS e CNEP).
// - Participações, derrotas, desclassificações e motivos: base própria montada pelo aplicativo com as propostas de
//   todas as empresas nas licitações em que a sua empresa participou ("Todas as propostas" do Compras.gov.br).

async function pedir<T>(caminho: string): Promise<T> {
  const r = await fetch(`/api/analise-empresas${caminho}`, { credentials: "same-origin" });
  const d = (await r.json().catch(() => ({}))) as T & { erro?: string };
  if (!r.ok) throw new Error(d.erro || "Não foi possível consultar agora.");
  return d;
}

interface Certidao {
  tipo: string;
  descricao: string;
  emissor: string;
  situacao: string;
  linkConsultaManual?: string;
}

export function Penalidades({ cnpj }: { cnpj: string }) {
  const [estado, setEstado] = useState<{ certidoes?: Certidao[]; erro?: string } | null>(null);
  useEffect(() => {
    let vivo = true;
    setEstado(null);
    pedir<{ certidoes: Certidao[] }>(`/penalidades?cnpj=${cnpj}`)
      .then((d) => vivo && setEstado({ certidoes: d.certidoes ?? [] }))
      .catch((e) => vivo && setEstado({ erro: e instanceof Error ? e.message : String(e) }));
    return () => {
      vivo = false;
    };
  }, [cnpj]);
  const consta = estado?.certidoes?.filter((c) => c.situacao === "CONSTA").length ?? 0;
  return (
    <section className="cartao ficha-empresa penalidades-empresa">
      <h3>
        {consta ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />} Penalidades
      </h3>
      {!estado ? (
        <p className="texto-suave pequeno carregando-linha">
          <Loader2 className="girando" size={14} /> Consultando TCU, CNJ e Portal da Transparência…
        </p>
      ) : estado.erro ? (
        <p className="texto-fraco pequeno">{estado.erro}</p>
      ) : (
        <>
          <ul className="lista-penalidades">
            {estado.certidoes!.map((c) => (
              <li key={c.tipo} className={c.situacao === "CONSTA" ? "consta" : c.situacao === "NADA_CONSTA" ? "nada" : "indisponivel"}>
                {c.situacao === "CONSTA" ? <ShieldAlert size={15} /> : c.situacao === "NADA_CONSTA" ? <CircleCheck size={15} /> : <CircleHelp size={15} />}
                <span>
                  <b>{c.tipo}</b> · {c.descricao} <span className="texto-fraco">({c.emissor})</span>
                </span>
                <span className="situacao-penalidade">
                  {c.situacao === "CONSTA" ? "Consta" : c.situacao === "NADA_CONSTA" ? "Nada consta" : "Indisponível agora"}
                  {c.linkConsultaManual && (
                    <a href={c.linkConsultaManual} target="_blank" rel="noreferrer" aria-label={`Consultar ${c.tipo} no site oficial`}>
                      <ExternalLink size={12} />
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="texto-fraco pequeno">Fonte: Consulta Consolidada de Pessoa Jurídica do TCU (atualizada a cada consulta, guardada por 12 h).</p>
        </>
      )}
    </section>
  );
}

interface Totais {
  licitacoes?: number;
  itens?: number;
  vitorias?: number;
  derrotas?: number;
  desclassificadas?: number;
  inabilitadas?: number;
  andamento?: number;
  valorDisputado?: number;
  valorVencido?: number;
  empresa?: string;
}

interface Resumo {
  totais: Totais;
  motivos: { resultado: string; motivo: string; vezes: number }[];
  recentes: { compra: string; item: number; descricao: string | null; valor: number | null; quantidade: number | null; colocacao: number | null; resultado: string; motivo: string | null; orgao: string | null; em: number }[];
  base: { licitacoes?: number; empresas?: number };
}

const ROTULO: Record<string, string> = { vitoria: "Vitória", derrota: "Derrota", desclassificada: "Desclassificada", inabilitada: "Inabilitada", andamento: "Em andamento" };
const COR: Record<string, string> = { vitoria: "verde", derrota: "cinza", desclassificada: "vermelho", inabilitada: "amarelo", andamento: "azul" };

function nomeCompra(chave: string) {
  if (!/^\d{17}$/.test(chave)) return chave;
  const mod = chave.slice(6, 8) === "05" ? "Pregão" : chave.slice(6, 8) === "06" ? "Dispensa" : "Compra";
  return `${mod} ${Number(chave.slice(8, 13))}/${chave.slice(13)} · UASG ${Number(chave.slice(0, 6))}`;
}

function Barra({ partes }: { partes: { nome: string; valor: number; cor: string }[] }) {
  const total = partes.reduce((s, p) => s + p.valor, 0) || 1;
  return (
    <div className="barra-participacoes" role="img" aria-label={partes.map((p) => `${p.nome}: ${p.valor}`).join(", ")}>
      {partes
        .filter((p) => p.valor > 0)
        .map((p) => (
          <span key={p.nome} style={{ width: `${(p.valor / total) * 100}%`, background: p.cor }} title={`${p.nome}: ${formatarNumero(p.valor)}`} />
        ))}
    </div>
  );
}

export function Participacoes({ cnpj, Pizza }: { cnpj: string; Pizza: (p: { partes: { nome: string; valor: number; cor: string }[]; titulo: string }) => ReactNode }) {
  const [estado, setEstado] = useState<{ dados?: Resumo; erro?: string } | null>(null);
  useEffect(() => {
    let vivo = true;
    setEstado(null);
    pedir<Resumo>(`/participacoes?cnpj=${cnpj}`)
      .then((d) => vivo && setEstado({ dados: d }))
      .catch((e) => vivo && setEstado({ erro: e instanceof Error ? e.message : String(e) }));
    return () => {
      vivo = false;
    };
  }, [cnpj]);

  if (!estado)
    return (
      <p className="texto-suave carregando-linha">
        <Loader2 className="girando" size={16} /> Lendo a base de participações…
      </p>
    );
  if (estado.erro) return <p className="alerta erro">{estado.erro}</p>;
  const { totais: t, motivos, recentes, base } = estado.dados!;
  const vit = t.vitorias ?? 0,
    der = t.derrotas ?? 0,
    des = t.desclassificadas ?? 0,
    inab = t.inabilitadas ?? 0;
  const decididos = vit + der + des + inab;
  const disputado = t.valorDisputado ?? 0,
    vencido = t.valorVencido ?? 0;
  const nota = (
    <p className="explicacao fonte-mercado">
      <Info aria-hidden="true" />
      <span>
        Participações, derrotas, desclassificações e inabilitações <b>não</b> estão nos dados abertos do governo (só as vitórias estão). Esta base é
        montada pelo aplicativo Montzion com a tela pública "Todas as propostas" das licitações em que <b>a sua empresa</b> participou — hoje{" "}
        {formatarNumero(base.licitacoes ?? 0)} licitações e {formatarNumero(base.empresas ?? 0)} empresas. Ela cresce sozinha enquanto o aplicativo fica aberto.
      </span>
    </p>
  );
  if (!t.itens)
    return (
      <>
        <section className="cartao">
          <p className="texto-fraco">Esta empresa ainda não apareceu nas licitações em que a sua empresa participou.</p>
        </section>
        {nota}
      </>
    );
  return (
    <>
      <section className="cartao bloco-empresa">
        <h3>
          <Gavel size={15} /> Participações (nas licitações em que você também participou)
        </h3>
        <div className="numeros-empresa">
          <div className="numero-empresa">
            <strong>{formatarNumero(t.licitacoes ?? 0)}</strong>
            <span>Licitações</span>
          </div>
          <div className="numero-empresa">
            <strong>{formatarNumero(t.itens ?? 0)}</strong>
            <span>Itens disputados</span>
          </div>
          <div className="numero-empresa verde">
            <strong>{formatarNumero(vit)}</strong>
            <span>Vitórias</span>
          </div>
          <div className="numero-empresa">
            <strong>{formatarNumero(der)}</strong>
            <span>Derrotas</span>
          </div>
          <div className={`numero-empresa ${des + inab ? "aviso" : ""}`}>
            <strong>{formatarNumero(des + inab)}</strong>
            <span>
              Desclassificações ({formatarNumero(des)}) e inabilitações ({formatarNumero(inab)})
            </span>
          </div>
        </div>
        <Barra
          partes={[
            { nome: "Vitórias", valor: vit, cor: "var(--mapa-1)" },
            { nome: "Derrotas", valor: der, cor: "var(--mapa-outras)" },
            { nome: "Desclassificações", valor: des, cor: "var(--mapa-2)" },
            { nome: "Inabilitações", valor: inab, cor: "var(--mapa-3)" },
          ]}
        />
        <p className="texto-fraco pequeno">
          Taxa de vitória: {decididos ? `${Math.round((vit / decididos) * 1000) / 10}%` : "—"} dos itens já decididos
          {t.andamento ? ` · ${formatarNumero(t.andamento)} ainda em andamento` : ""}.
        </p>
      </section>
      <section className="cartao bloco-empresa">
        <h3>Valores</h3>
        <div className="numeros-empresa">
          <div className="numero-empresa">
            <strong>{formatarMoeda(disputado)}</strong>
            <span>Total disputado (valor ofertado × quantidade)</span>
          </div>
          <div className="numero-empresa verde">
            <strong>{formatarMoeda(vencido)}</strong>
            <span>Vencido</span>
          </div>
          <div className="numero-empresa">
            <strong>{formatarMoeda(Math.max(0, disputado - vencido))}</strong>
            <span>Perdido ou em andamento</span>
          </div>
        </div>
      </section>
      <div className="grade-empresa graficos-empresa">
        <Pizza
          titulo="Vitórias × derrotas (itens decididos)"
          partes={[
            { nome: "Vitórias", valor: vit, cor: "var(--mapa-1)" },
            { nome: "Derrotas, desclassificações e inabilitações", valor: der + des + inab, cor: "var(--mapa-2)" },
          ]}
        />
        <Pizza
          titulo="Valor vencido × disputado"
          partes={[
            { nome: "Vencido", valor: vencido, cor: "var(--mapa-1)" },
            { nome: "Não vencido", valor: Math.max(0, disputado - vencido), cor: "var(--mapa-2)" },
          ]}
        />
      </div>
      <section className="cartao">
        <h3 className="titulo-secao">
          <ShieldAlert size={15} /> Motivos de desclassificação e inabilitação
        </h3>
        {motivos.length === 0 ? (
          <p className="texto-fraco pequeno">Nenhuma desclassificação ou inabilitação nas licitações em comum.</p>
        ) : (
          <ul className="motivos-empresa">
            {motivos.map((m, i) => (
              <li key={i}>
                <span className={`chip ${COR[m.resultado]}`}>{m.resultado === "inabilitada" ? "INAB" : "DESC"}</span>
                <span>{m.motivo}</span>
                <b>{formatarNumero(m.vezes)}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="cartao">
        <h3 className="titulo-secao">Últimas participações</h3>
        <ul className="participacoes-recentes">
          {recentes.map((r) => (
            <li key={`${r.compra}:${r.item}`}>
              <span className={`chip ${COR[r.resultado]}`}>{ROTULO[r.resultado] ?? r.resultado}</span>
              <span className="desc-participacao">
                <b>{nomeCompra(r.compra)}</b> · item {r.item}
                {r.descricao ? ` — ${r.descricao}` : ""}
                <span className="texto-fraco pequeno">
                  {[r.orgao, r.colocacao ? `${r.colocacao}º lugar` : "", r.motivo ? `Motivo: ${r.motivo}` : "", `lido em ${formatarData(new Date(r.em).toISOString())}`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <b>{formatarMoeda(r.valor)}</b>
            </li>
          ))}
        </ul>
      </section>
      {nota}
    </>
  );
}
