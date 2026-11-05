import { CalendarRange, FileSignature, Pencil, Plus, Search, Timer, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { diasAte } from "../../../shared/negocio";
import { podeEditar } from "../../../shared/permissoes";
import type { Ata, AtaItem, LicitacaoResumo, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Alerta, Campo } from "../../components/Formulario";
import { avisar, CampoArea, CampoSelect, Carregando, Modal, Vazio } from "../../components/Ui";
import { formatarData, formatarMoeda, formatarNumero, hojeIso, paraNumero } from "../../formato";
import { link } from "../../rota";

type Situacao = "vigente" | "vencendo" | "vencida" | "sem-data";

function situacao(ata: Ata, hoje: string): { tipo: Situacao; dias: number | null; progresso: number } {
  if (!ata.data_fim) return { tipo: "sem-data", dias: null, progresso: 0 };
  const dias = diasAte(ata.data_fim, hoje);
  let progresso = 0;
  if (ata.data_inicio) {
    const total = diasAte(ata.data_fim, ata.data_inicio);
    const passados = diasAte(hoje, ata.data_inicio);
    progresso = total > 0 ? Math.min(100, Math.max(0, (passados / total) * 100)) : 100;
  }
  if (dias < 0) return { tipo: "vencida", dias, progresso: 100 };
  if (dias <= 30) return { tipo: "vencendo", dias, progresso };
  return { tipo: "vigente", dias, progresso };
}

const ROTULOS: Record<Situacao, string> = {
  vigente: "Vigente",
  vencendo: "Vence em breve",
  vencida: "Vencida",
  "sem-data": "Sem data de fim",
};

export function Atas({ usuario }: { usuario: Usuario }) {
  const editar = podeEditar(usuario.permissoes, "atas");
  const [atas, setAtas] = useState<Ata[] | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todas" | Situacao>("todas");
  const [editando, setEditando] = useState<Ata | "nova" | null>(null);
  const hoje = hojeIso();

  async function carregar() {
    try {
      const { atas } = await api<{ atas: Ata[] }>("/atas");
      setAtas(atas);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const comSituacao = useMemo(() => (atas ?? []).map((a) => ({ ata: a, s: situacao(a, hoje) })), [atas, hoje]);

  const filtradas = comSituacao.filter(({ ata, s }) => {
    if (filtro !== "todas" && s.tipo !== filtro) return false;
    const termo = busca.trim().toLowerCase();
    if (!termo) return true;
    return [ata.nome, ata.numero_ata, ata.numero_licitacao, ata.orgao_gerenciador, ...ata.itens.map((i) => i.produto)]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(termo));
  });

  const contar = (t: Situacao) => comSituacao.filter((x) => x.s.tipo === t).length;

  async function excluir(a: Ata) {
    if (!confirm(`Excluir a ata "${a.nome ?? a.numero_ata ?? ""}"?`)) return;
    try {
      await api(`/atas/${a.id}`, { metodo: "DELETE" });
      avisar("Ata excluída.");
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Pós-ganho</span>
          <h1>Atas vigentes</h1>
          <p className="texto-suave">Atas de registro de preço com vigência, prazo de entrega e produtos.</p>
        </div>
        {editar && (
          <button className="botao" onClick={() => setEditando("nova")}>
            <Plus aria-hidden="true" /> Nova ata
          </button>
        )}
      </div>

      <div className="barra-filtros entrar" style={{ ["--i" as string]: 1 }}>
        <div className="entrada com-icone busca">
          <Search aria-hidden="true" />
          <input
            placeholder="Buscar por ata, licitação, órgão ou produto…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar atas"
          />
        </div>
      </div>

      <div className="pilulas entrar" style={{ ["--i" as string]: 2 }}>
        <button className={`pilula ${filtro === "todas" ? "ativa" : ""}`} onClick={() => setFiltro("todas")}>
          Todas <span>{atas?.length ?? 0}</span>
        </button>
        {(["vigente", "vencendo", "vencida"] as Situacao[]).map((t) => (
          <button key={t} className={`pilula ${filtro === t ? "ativa" : ""}`} onClick={() => setFiltro(t)}>
            {ROTULOS[t]} <span>{contar(t)}</span>
          </button>
        ))}
      </div>

      {atas === null ? (
        <Carregando />
      ) : filtradas.length === 0 ? (
        <section className="cartao">
          <Vazio icone={<FileSignature />} titulo={atas.length ? "Nenhuma ata encontrada" : "Nenhuma ata cadastrada"} />
        </section>
      ) : (
        <div className="grade-cartoes largos">
          {filtradas.map(({ ata, s }, i) => {
            const total = ata.itens.reduce((t, it) => t + (it.quantidade ?? 0) * (it.valor_unitario ?? 0), 0);
            return (
              <article key={ata.id} className={`cartao ata ${s.tipo} entrar`} style={{ ["--i" as string]: Math.min(i, 8) }}>
                <div className="ata-topo">
                  <span className="icone-brilho">
                    <FileSignature />
                  </span>
                  <div className="ata-titulo">
                    <h3>{ata.nome || `Ata ${ata.numero_ata ?? ""}`}</h3>
                    <span className="texto-fraco pequeno">
                      {ata.numero_ata && `Ata nº ${ata.numero_ata}`}
                      {ata.numero_licitacao && ` · Licitação nº ${ata.numero_licitacao}`}
                    </span>
                  </div>
                  <span className={`selo ${s.tipo === "vigente" ? "verde" : s.tipo === "vencendo" ? "amarelo" : "cinza"}`}>
                    {ROTULOS[s.tipo]}
                  </span>
                </div>

                <p className="ata-orgao">{ata.orgao_gerenciador || "Órgão gerenciador não informado"}</p>

                <div className="ata-vigencia">
                  <div className="ata-datas">
                    <span>
                      <CalendarRange aria-hidden="true" /> {formatarData(ata.data_inicio)} → {formatarData(ata.data_fim)}
                    </span>
                    {s.dias != null && (
                      <strong>{s.dias < 0 ? `Venceu há ${-s.dias} dias` : `${s.dias} dias restantes`}</strong>
                    )}
                  </div>
                  <div className="barra-progresso">
                    <span style={{ width: `${s.progresso}%` }} />
                  </div>
                </div>

                <div className="ata-info">
                  {ata.prazo_entrega != null && (
                    <span>
                      <Timer aria-hidden="true" /> Entrega em {ata.prazo_entrega} dias {ata.prazo_tipo === "uteis" ? "úteis" : "corridos"}
                    </span>
                  )}
                  {ata.licitacao_id && (
                    <a {...link(`/licitacoes/${ata.licitacao_id}`)} className="link-suave">
                      Ver licitação
                    </a>
                  )}
                </div>

                {ata.itens.length > 0 && (
                  <div className="ata-itens">
                    <div className="ata-itens-cabecalho">
                      <span>Saldo dos itens</span>
                      <span>{ata.total_empenhos ? `${ata.total_empenhos} empenho(s) vinculado(s)` : "Nenhum empenho vinculado"}</span>
                    </div>
                    {ata.itens.slice(0, 5).map((it, j) => {
                      const registrado = it.quantidade ?? 0;
                      const empenhado = it.empenhado ?? 0;
                      const saldo = Math.max(0, registrado - empenhado);
                      const uso = registrado > 0 ? Math.min(100, (empenhado / registrado) * 100) : 0;
                      return (
                        <div key={j} className="ata-item">
                          <span className="numero-item">{it.item_numero || "—"}</span>
                          <div className="ata-item-texto">
                            <span className="ata-item-produto">{it.produto || "Produto"}</span>
                            <div className={`barra-progresso fina ${uso >= 100 ? "cheia" : uso >= 80 ? "alta" : ""}`}>
                              <span style={{ width: `${uso}%` }} />
                            </div>
                          </div>
                          <span className="ata-item-saldo">
                            <strong className={saldo === 0 ? "texto-vermelho" : uso >= 80 ? "texto-amarelo" : ""}>{formatarNumero(saldo)}</strong>
                            <small className="texto-fraco">
                              de {formatarNumero(registrado)} {it.unidade} · {formatarMoeda(it.valor_unitario)}
                            </small>
                          </span>
                        </div>
                      );
                    })}
                    {ata.itens.length > 5 && <span className="texto-fraco pequeno">+ {ata.itens.length - 5} item(ns)</span>}
                  </div>
                )}

                <div className="ata-rodape">
                  <span>
                    Valor registrado <strong>{formatarMoeda(total)}</strong>
                  </span>
                  <div>
                    {editar && (
                      <button className="botao-icone" onClick={() => setEditando(ata)} aria-label="Editar ata">
                        <Pencil />
                      </button>
                    )}
                    {usuario.papel === "admin" && (
                      <button className="botao-icone perigo" onClick={() => excluir(ata)} aria-label="Excluir ata">
                        <Trash2 />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editando && (
        <ModalAta
          ata={editando === "nova" ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            carregar();
          }}
        />
      )}
    </>
  );
}

type LinhaAta = { id?: number; empenhado?: number; item_numero: string; produto: string; unidade: string; quantidade: string; valor_unitario: string };

const paraLinha = (i: AtaItem): LinhaAta => ({
  id: i.id,
  empenhado: i.empenhado,
  item_numero: i.item_numero ?? "",
  produto: i.produto ?? "",
  unidade: i.unidade ?? "",
  quantidade: i.quantidade == null ? "" : String(i.quantidade),
  valor_unitario: i.valor_unitario == null ? "" : String(i.valor_unitario),
});

function ModalAta({ ata, aoFechar, aoSalvar }: { ata: Ata | null; aoFechar: () => void; aoSalvar: () => void }) {
  const [licitacoes, setLicitacoes] = useState<LicitacaoResumo[]>([]);
  const [licitacaoId, setLicitacaoId] = useState(ata?.licitacao_id ? String(ata.licitacao_id) : "");
  const [dados, setDados] = useState({
    nome: ata?.nome ?? "",
    numero_licitacao: ata?.numero_licitacao ?? "",
    numero_ata: ata?.numero_ata ?? "",
    orgao_gerenciador: ata?.orgao_gerenciador ?? "",
    data_inicio: ata?.data_inicio ?? "",
    data_fim: ata?.data_fim ?? "",
    prazo_entrega: ata?.prazo_entrega == null ? "" : String(ata.prazo_entrega),
    prazo_tipo: ata?.prazo_tipo ?? "corridos",
    observacoes: ata?.observacoes ?? "",
  });
  const [linhas, setLinhas] = useState<LinhaAta[]>(() => (ata?.itens ?? []).map(paraLinha));
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<{ licitacoes: LicitacaoResumo[] }>("/licitacoes").then(
      (r) => setLicitacoes(r.licitacoes.filter((l) => l.etapa === "ganha")),
      () => {},
    );
  }, []);

  const campo = (nome: keyof typeof dados) => ({
    name: nome,
    value: dados[nome],
    onChange: (e: { target: { value: string } }) => setDados((d) => ({ ...d, [nome]: e.target.value })),
  });

  // Ao vincular uma licitação ganha, preenche os dados e os itens ganhos dela.
  async function vincular(id: string) {
    setLicitacaoId(id);
    const l = licitacoes.find((x) => String(x.id) === id);
    if (!l) return;
    setDados((d) => ({
      ...d,
      numero_licitacao: d.numero_licitacao || l.numero || "",
      orgao_gerenciador: d.orgao_gerenciador || l.orgao || "",
      nome: d.nome || [l.orgao, l.objeto].filter(Boolean).join(" — ").slice(0, 120),
    }));
    if (linhas.length > 0) return;
    try {
      const { execucoes } = await api<{ execucoes: { id: number; licitacao_id: number }[] }>("/execucoes");
      const primeira = execucoes.find((e) => e.licitacao_id === l.id);
      if (!primeira) return;
      const { itens } = await api<{ itens: { item_numero: string | null; produto: string | null; quantidade: number | null; valor_unitario: number | null }[] }>(
        `/execucoes/${primeira.id}`,
      );
      setLinhas(
        itens.map((i) => ({
          item_numero: i.item_numero ?? "",
          produto: i.produto ?? "",
          unidade: "",
          quantidade: i.quantidade == null ? "" : String(i.quantidade),
          valor_unitario: i.valor_unitario == null ? "" : String(i.valor_unitario),
        })),
      );
    } catch {
      // sem itens para sugerir
    }
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const corpo = {
      ...dados,
      licitacao_id: licitacaoId ? Number(licitacaoId) : null,
      prazo_entrega: paraNumero(dados.prazo_entrega) == null ? null : Math.round(paraNumero(dados.prazo_entrega)!),
      itens: linhas.map((l) => ({
        ...(l.id ? { id: l.id } : {}),
        item_numero: l.item_numero,
        produto: l.produto,
        unidade: l.unidade,
        quantidade: paraNumero(l.quantidade),
        valor_unitario: paraNumero(l.valor_unitario),
      })),
    };
    setErro("");
    setEnviando(true);
    try {
      if (ata) await api(`/atas/${ata.id}`, { metodo: "PATCH", corpo });
      else await api("/atas", { corpo });
      avisar(ata ? "Ata atualizada." : "Ata cadastrada.");
      aoSalvar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  const mudarLinha = (i: number, novo: Partial<LinhaAta>) =>
    setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...novo } : l)));

  return (
    <Modal titulo={ata ? "Editar ata" : "Nova ata de registro de preço"} aoFechar={aoFechar} largo>
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <CampoSelect
          rotulo="Vincular a uma licitação ganha (opcional)"
          value={licitacaoId}
          onChange={(e) => vincular(e.target.value)}
          vazio="Nenhuma"
          opcoes={licitacoes.map((l) => ({ valor: String(l.id), texto: `Nº ${l.numero ?? "—"} · ${l.orgao ?? ""}` }))}
        />
        <Campo rotulo="Nome da ata" placeholder="Ex.: Material de informática — Prefeitura X" {...campo("nome")} />
        <div className="grade-3">
          <Campo rotulo="Número da ata" {...campo("numero_ata")} />
          <Campo rotulo="Número da licitação" {...campo("numero_licitacao")} />
          <Campo rotulo="Órgão gerenciador" {...campo("orgao_gerenciador")} />
        </div>
        <div className="grade-4">
          <Campo rotulo="Início da vigência" type="date" {...campo("data_inicio")} />
          <Campo rotulo="Fim da vigência" type="date" {...campo("data_fim")} />
          <Campo rotulo="Prazo de entrega (dias)" type="number" min="0" {...campo("prazo_entrega")} />
          <CampoSelect
            rotulo="Tipo de prazo"
            opcoes={[
              { valor: "corridos", texto: "Dias corridos" },
              { valor: "uteis", texto: "Dias úteis" },
            ]}
            {...campo("prazo_tipo")}
          />
        </div>

        <div className="subtitulo-form">
          <h3>Produtos registrados</h3>
          <button
            type="button"
            className="botao secundario"
            onClick={() => setLinhas((ls) => [...ls, { item_numero: "", produto: "", unidade: "", quantidade: "", valor_unitario: "" }])}
          >
            <Plus aria-hidden="true" /> Produto
          </button>
        </div>
        {linhas.length === 0 ? (
          <p className="texto-fraco pequeno" style={{ margin: 0 }}>
            Nenhum produto. Vincule uma licitação ganha para preencher automaticamente.
          </p>
        ) : (
          <div className="linhas-ata">
            {linhas.map((l, i) => (
              <div key={i} className="linha-ata">
                <Campo rotulo="Item" name={`item-${i}`} value={l.item_numero} onChange={(e) => mudarLinha(i, { item_numero: e.target.value })} />
                <Campo rotulo="Produto" name={`prod-${i}`} value={l.produto} onChange={(e) => mudarLinha(i, { produto: e.target.value })} />
                <Campo rotulo="Unid." name={`un-${i}`} value={l.unidade} onChange={(e) => mudarLinha(i, { unidade: e.target.value })} />
                <Campo rotulo="Qtd" name={`qtd-${i}`} type="number" step="any" min="0" value={l.quantidade} onChange={(e) => mudarLinha(i, { quantidade: e.target.value })} />
                <Campo rotulo="Valor unit." name={`vu-${i}`} type="number" step="0.01" min="0" value={l.valor_unitario} onChange={(e) => mudarLinha(i, { valor_unitario: e.target.value })} />
                <button
                  type="button"
                  className="botao-icone perigo"
                  onClick={() => {
                    if ((l.empenhado ?? 0) > 0 && !confirm("Este item já tem empenhos vinculados. Remover mesmo assim?")) return;
                    setLinhas((ls) => ls.filter((_, j) => j !== i));
                  }}
                  aria-label="Remover produto"
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        )}

        <CampoArea rotulo="Observações" rows={2} {...campo("observacoes")} />
        <div className="botoes-modal">
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar ata"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
