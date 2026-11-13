import { ArrowLeft, Calculator, FileArchive, MoreHorizontal, CalendarClock, ExternalLink, FileText, FolderOpen, Landmark, ListChecks, MessageSquare, Pencil, Trash2, Trophy, UserRound, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cotacaoDaProposta, ETAPAS_EXECUCAO, ETAPAS_LICITACAO, nomeEtapa } from "../../../shared/negocio";
import { podeEditar, podeVer } from "../../../shared/permissoes";
import type { Arquivo, Cotacao, ItemLicitacao, Licitacao, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { AbaArquivos } from "../../components/AbaArquivos";
import { Avatar } from "../../components/Avatar";
import { PainelAtividade } from "../../components/Atividade";
import { avisar, Carregando, Modal } from "../../components/Ui";
import { MenuContexto } from "../../components/MenuContexto";
import { diasAte } from "../../../shared/negocio";
import { formatarData, formatarMoeda, formatarNumero, hojeIso, textoPrazo } from "../../formato";
import { link, navegar } from "../../rota";
import { AbaDados } from "./AbaDados";
import { AbaItens } from "./AbaItens";
import { AbaOrcamento } from "./AbaOrcamento";
import { AbaProposta } from "./AbaProposta";
import { BotaoUmClique, ehDoCompras } from "./CadastroUmClique";
import { AbaResultado } from "./AbaResultado";
import { ModalGanhamos } from "./ModalGanhamos";
import { PainelEtapa } from "./PainelEtapa";

export interface FichaLicitacao {
  licitacao: Licitacao;
  itens: ItemLicitacao[];
  cotacoes: Cotacao[];
  arquivos: Arquivo[];
  execucoes: { id: number; etapa: string; numero_empenho: string | null }[];
}

export function DetalheLicitacao({ id, usuario }: { id: number; usuario: Usuario }) {
  const [ficha, setFicha] = useState<FichaLicitacao | null>(null);
  const [erro, setErro] = useState("");
  const abaInicial = new URLSearchParams(location.search).get("aba") ?? "itens";
  const [aba, setAba] = useState(["atividade", "dados"].includes(abaInicial) ? "itens" : abaInicial);
  const [atividadeAberta, setAtividadeAberta] = useState(abaInicial === "atividade");
  const [editando, setEditando] = useState(abaInicial === "dados");
  const [ganhando, setGanhando] = useState(new URLSearchParams(location.search).get("ganhar") === "1");
  const [comentarios, setComentarios] = useState(0);
  const [pedidoHabilitacao, setPedidoHabilitacao] = useState(0);
  const [menuMais, setMenuMais] = useState<{ x: number; y: number } | null>(null);
  const [equipe, setEquipe] = useState<{ id: number; nome: string; cor: string | null; foto: string | null }[]>([]);

  useEffect(() => {
    api<{ equipe: { id: number; nome: string; cor: string | null; foto: string | null }[] }>("/equipe").then((r) => setEquipe(r.equipe), () => {});
  }, []);

  const carregar = useCallback(async () => {
    try {
      setFicha(await api<FichaLicitacao>(`/licitacoes/${id}`));
    } catch (err) {
      setErro(mensagemDeErro(err));
    }
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function escolherAba(chave: string) {
    setAba(chave);
    history.replaceState(null, "", `/licitacoes/${id}?aba=${chave}`);
  }

  async function mudarEtapa(etapa: string, extra?: Record<string, unknown>) {
    try {
      const r = await api<{ execucaoCriada: number | null }>(`/licitacoes/${id}`, {
        metodo: "PATCH",
        corpo: { etapa, ...extra },
      });
      avisar(
        r.execucaoCriada
          ? "Licitação ganha! O card também foi criado no Pós-ganho."
          : `Movida para "${nomeEtapa(ETAPAS_LICITACAO, etapa)}".`,
      );
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  async function novoEmpenho() {
    try {
      const r = await api<{ execucao: { id: number } }>("/execucoes", { corpo: { licitacao_id: id } });
      avisar("Empenho criado. Escolha os itens ganhos dele.");
      navegar(`/pos-ganho/${r.execucao.id}?aba=itens`);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  async function excluir() {
    if (!confirm("Excluir esta licitação, seus itens, cotações, arquivos e empenhos? Isso não pode ser desfeito.")) return;
    try {
      await api(`/licitacoes/${id}`, { metodo: "DELETE" });
      avisar("Licitação excluída.");
      navegar("/licitacoes");
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  if (erro) return <div className="alerta erro">{erro}</div>;
  if (!ficha) return <Carregando />;

  const { licitacao: l, itens, cotacoes, arquivos } = ficha;

  const participando = itens.filter((i) => i.participar);
  const conta = (r: string) => participando.filter((i) => i.resultado === r).length;
  // Na ordem do trabalho: olhar os itens, orçar, fazer a proposta e, por último, o resultado. Arquivos no fim.
  const abas = [
    { chave: "itens", titulo: "Itens", icone: ListChecks, info: `${participando.length}`, completo: participando.length > 0 },
    { chave: "orcamento", titulo: "Orçamento", icone: Calculator, info: cotacoes.length ? `${cotacoes.length}` : "", completo: participando.length > 0 && participando.every((i) => cotacoes.some((c) => c.item_id === i.id)) },
    { chave: "proposta", titulo: "Proposta", icone: FileText, info: `${arquivos.filter((a) => a.categoria === "Proposta").length || ""}`, completo: arquivos.some((a) => a.categoria === "Proposta") },
    {
      chave: "resultado",
      titulo: "Resultado",
      icone: Trophy,
      info: participando.some((i) => i.resultado) ? `${participando.filter((i) => i.resultado).length}/${participando.length}` : "",
      completo: participando.length > 0 && participando.every((i) => i.resultado && i.resultado !== "acompanhando"),
    },
    { chave: "arquivos", titulo: "Arquivos", icone: FolderOpen, info: arquivos.length ? `${arquivos.length}` : "", completo: arquivos.length > 0 },
  ].filter((p) => !["orcamento", "proposta"].includes(p.chave) || podeVer(usuario.permissoes, "orcamento"));

  const hoje = hojeIso();
  const reaberta = !!l.data_reabertura && l.data_reabertura >= hoje;
  const dataSessao = reaberta ? l.data_reabertura : l.data_sessao;
  const horaSessao = reaberta ? l.hora_reabertura : l.horario;
  const dias = dataSessao ? diasAte(dataSessao, hoje) : null;
  const responsavel = equipe.find((p) => p.id === l.responsavel_id);
  const editar = podeEditar(usuario.permissoes, "licitacoes");

  return (
    <>
      <a className="voltar" {...link("/licitacoes")}>
        <ArrowLeft aria-hidden="true" /> Quadro de licitações
      </a>

      <div className="cabecalho-ficha entrar">
        <div className="ficha-titulo">
          <h1>
            {l.numero ? `Nº ${l.numero}` : "Licitação sem número"}
            <small>{[l.uasg && `UASG ${l.uasg}`, l.modalidade, l.registro_preco === 1 ? "Registro de preço" : ""].filter(Boolean).join(" · ")}</small>
          </h1>
          <p className="texto-suave">{l.orgao || "Órgão não informado"}</p>
        </div>
        <div className="ficha-acoes">
          <select
            value={l.etapa}
            onChange={(e) => (e.target.value === "ganha" && ficha.itens.some((i) => i.participar) ? setGanhando(true) : mudarEtapa(e.target.value))}
            aria-label="Mover para etapa"
            disabled={!podeEditar(usuario.permissoes, "licitacoes")}
          >
            {ETAPAS_LICITACAO.map((e) => (
              <option key={e.chave} value={e.chave}>
                {e.nome}
              </option>
            ))}
          </select>
          <button className="botao-icone com-contador" onClick={() => setAtividadeAberta(true)} aria-label="Atividade" title="Atividade">
            <MessageSquare />
            {comentarios > 0 && <span className="contador-icone">{comentarios}</span>}
          </button>
          {l.link && (
            <a className="botao-icone" href={l.link} target="_blank" rel="noreferrer noopener" aria-label="Abrir no portal" title="Abrir no portal">
              <ExternalLink aria-hidden="true" />
            </a>
          )}
          <button
            className="botao-icone"
            aria-label="Mais ações"
            title="Mais ações"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenuMais({ x: r.right - 230, y: r.bottom + 6 });
            }}
          >
            <MoreHorizontal />
          </button>
          {menuMais && (
            <MenuContexto
              x={menuMais.x}
              y={menuMais.y}
              aoFechar={() => setMenuMais(null)}
              itens={[
                ...(editar ? [{ rotulo: "Editar dados", icone: <Pencil size={15} />, aoClicar: () => setEditando(true) }] : []),
                { rotulo: "Atividade e comentários", icone: <MessageSquare size={15} />, aoClicar: () => setAtividadeAberta(true) },
                ...(usuario.papel === "admin" ? [{ separador: true }, { rotulo: "Excluir licitação", icone: <Trash2 size={15} />, perigo: true, aoClicar: excluir }] : []),
              ]}
            />
          )}
        </div>
      </div>

      <div className="ficha-layout">
        <aside className="ficha-lateral entrar">
          <section className="cartao resumo-licitacao">
            <div className="cartao-titulo">
              <h2>Dados principais</h2>
              {editar && (
                <button className="botao secundario pequeno" onClick={() => setEditando(true)}>
                  <Pencil /> Editar
                </button>
              )}
            </div>
            <dl className="dados-resumo">
              <div className={`dado-sessao ${dias != null && dias >= 0 && dias <= 1 ? "urgente" : ""}`}>
                <dt>
                  <CalendarClock /> {reaberta ? "Reabertura" : "Sessão"}
                </dt>
                <dd>
                  {dataSessao ? `${formatarData(dataSessao)}${horaSessao ? ` às ${horaSessao}` : ""}` : "Sem data"}
                  {dias != null && dias >= 0 && !["ganha", "perdida"].includes(l.etapa) && <strong>{textoPrazo(dias)}</strong>}
                </dd>
              </div>
              <div>
                <dt>
                  <Landmark /> Órgão
                </dt>
                <dd>{l.orgao || <span className="falta">Não informado</span>}</dd>
              </div>
              <div className="dupla">
                <div>
                  <dt>UASG</dt>
                  <dd>{l.uasg || "—"}</dd>
                </div>
                <div>
                  <dt>Registro de preço</dt>
                  <dd>{l.registro_preco ? <span className="chip destaque">Sim (SRP)</span> : "Não"}</dd>
                </div>
              </div>
              <div className="dupla">
                <div>
                  <dt>Modalidade</dt>
                  <dd>{l.modalidade || "—"}</dd>
                </div>
                <div>
                  <dt>Portal</dt>
                  <dd>
                    {l.link ? (
                      <a className="link-suave" href={l.link} target="_blank" rel="noreferrer noopener">
                        {l.portal || "Abrir"} <ExternalLink size={12} />
                      </a>
                    ) : (
                      l.portal || "—"
                    )}
                  </dd>
                </div>
              </div>
              <div className="dupla">
                <div>
                  <dt>
                    <Wallet /> Valor estimado
                  </dt>
                  <dd>{l.valor_estimado != null ? formatarMoeda(l.valor_estimado) : "—"}</dd>
                </div>
                <div>
                  <dt>
                    <UserRound /> Responsável
                  </dt>
                  <dd>
                    {responsavel ? (
                      <span className="responsavel-resumo">
                        <Avatar nome={responsavel.nome} cor={responsavel.cor} foto={responsavel.foto} pequeno />
                        {responsavel.nome.split(" ")[0]}
                      </span>
                    ) : (
                      "Ninguém"
                    )}
                  </dd>
                </div>
              </div>
              <div>
                <dt>Objeto</dt>
                <dd className="objeto-resumo">{l.objeto || <span className="falta">Não informado</span>}</dd>
              </div>
            </dl>
          </section>

          {(ficha.execucoes.length > 0 || l.etapa === "ganha") && (
          <section className="cartao resumo-itens">
            <h2>Itens</h2>
            <div className="contagem-itens">
              <span>
                <strong>{participando.length}</strong> participando
              </span>
              <span className="verde">
                <strong>{conta("ganho")}</strong> ganhos
              </span>
              <span className="amarelo">
                <strong>{conta("acompanhando")}</strong> acompanhando
              </span>
              <span className="vermelho">
                <strong>{conta("perdido")}</strong> perdidos
              </span>
              <span className="fraco">
                <strong>{participando.filter((i) => !i.resultado).length}</strong> sem resultado
              </span>
            </div>
            {ficha.execucoes.length > 0 &&
              ficha.execucoes.map((e) => (
                <a key={e.id} className="link-empenho" {...link(`/pos-ganho/${e.id}`)}>
                  <Trophy size={14} /> {e.numero_empenho ? `Empenho ${e.numero_empenho}` : "Empenho no Pós-ganho"} · {nomeEtapa(ETAPAS_EXECUCAO, e.etapa)}
                </a>
              ))}
            {l.etapa === "ganha" && podeEditar(usuario.permissoes, "posganho") && (
              <button className="botao link pequeno" style={{ marginTop: 8 }} onClick={novoEmpenho}>
                + Registrar outro empenho desta licitação
              </button>
            )}
          </section>
          )}
        </aside>

        <div className="ficha-principal">
          {ehDoCompras(l) && !["perdida", "ganha"].includes(l.etapa) && (
            <div className="faixa-um-clique">
              {l.compras_cadastrado_em ? (
                <span>
                  <strong className="texto-verde">Proposta cadastrada no Compras.gov.br</strong> · {l.compras_itens ?? 0} item(ns), em{" "}
                  {new Date(l.compras_cadastrado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}. Dá para alterar valores ou retirar itens por aqui.
                </span>
              ) : (
                <span>
                  <strong>Cadastro com um clique</strong> · a plataforma acha esta compra no Compras.gov.br e monta a proposta com os itens do orçamento.
                </span>
              )}
              <BotaoUmClique licitacaoId={l.id} cadastrada={!!l.compras_cadastrado_em} aoFechar={carregar} />
            </div>
          )}
          <PainelEtapa
            licitacao={l}
            participando={participando.length}
            semCotacao={participando.filter((i) => !cotacoes.some((c) => c.item_id === i.id)).length}
            execucoes={ficha.execucoes}
            podeEditar={editar}
            aoMudarEtapa={mudarEtapa}
            aoGanhar={() => setGanhando(true)}
            aoIrPara={escolherAba}
            aoSalvar={carregar}
          />

          <nav className="abas-ficha" aria-label="Seções da licitação">
            {abas.map((a) => {
              const Icone = a.icone;
              return (
                <button key={a.chave} className={`aba-ficha ${aba === a.chave ? "ativa" : ""}`} onClick={() => escolherAba(a.chave)}>
                  <Icone />
                  <span>{a.titulo}</span>
                  {a.info && <small>{a.info}</small>}
                </button>
              );
            })}
          </nav>

      <div key={aba} className="entrar">
            {aba === "itens" && <AbaItens licitacaoId={l.id} itens={itens} aoMudar={carregar} />}
            {aba === "arquivos" && (
              <AbaArquivos
                podeAssinar={podeEditar(usuario.permissoes, "assinatura")}
                arquivos={arquivos}
                destino={{ licitacao_id: l.id }}
                categoriaInicial="Edital"
                pedidoHabilitacao={pedidoHabilitacao}
                aoAtenderHabilitacao={() => setPedidoHabilitacao(0)}
                aoMudar={carregar}
              />
            )}
            {aba === "orcamento" && (
              <AbaOrcamento licitacao={l} itens={itens} cotacoes={cotacoes} aoMudar={carregar} />
            )}
            {aba === "proposta" && (
              <AbaProposta licitacao={l} itens={itens} cotacoes={cotacoes} arquivos={arquivos} usuario={usuario} aoMudar={carregar} aoEditarDados={() => setEditando(true)} />
            )}
            {aba === "resultado" && (
              <AbaResultado licitacao={l} itens={itens} podeEditar={podeEditar(usuario.permissoes, "licitacoes")} aoMudar={carregar} />
            )}
          </div>
        </div>

        <aside className="ficha-direita entrar">
          {podeVer(usuario.permissoes, "orcamento") && <CartaoFinanceiro licitacao={l} itens={participando} cotacoes={cotacoes} />}
          <CartaoArquivos
            arquivos={arquivos}
            aoIrPara={escolherAba}
            aoHabilitacao={() => {
              escolherAba("arquivos");
              setPedidoHabilitacao((n) => n + 1);
            }}
          />
        </aside>
      </div>

      {editando && (
        <Modal titulo="Dados da licitação" aoFechar={() => setEditando(false)} largo>
          <AbaDados
            licitacao={l}
            aoCancelar={() => setEditando(false)}
            aoSalvar={async () => {
              setEditando(false);
              await carregar();
            }}
          />
        </Modal>
      )}

      {ganhando && (
        <ModalGanhamos
          licitacao={l}
          itens={itens}
          cotacoes={cotacoes}
          aoFechar={() => setGanhando(false)}
          aoConfirmar={async () => {
            setGanhando(false);
            await mudarEtapa("ganha");
          }}
        />
      )}

      <PainelAtividade
        alvo={{ licitacao_id: l.id }}
        usuario={usuario}
        aberto={atividadeAberta}
        aoFechar={() => setAtividadeAberta(false)}
        aoContar={setComentarios}
      />
    </>
  );
}

/** Coluna da direita: o dinheiro da licitação (estimado, nossa proposta, custo, impostos e lucro). */
function CartaoFinanceiro({ licitacao: l, itens, cotacoes }: { licitacao: Licitacao; itens: ItemLicitacao[]; cotacoes: Cotacao[] }) {
  let venda = 0;
  let custo = 0;
  let lucro = 0;
  let cotados = 0;
  for (const item of itens) {
    const c = cotacaoDaProposta(cotacoes, item, l.imposto_percentual, l.lucro_percentual);
    if (!c) continue;
    venda += c.calculo.totalVenda;
    custo += c.calculo.totalCusto;
    lucro += c.calculo.lucroTotal;
    cotados++;
  }
  const impostos = venda * (l.imposto_percentual / 100);
  const estimado = l.valor_estimado ?? 0;
  const parte = estimado > 0 && venda > 0 ? Math.min(100, (venda / estimado) * 100) : 0;
  return (
    <section className="cartao cartao-financeiro">
      <div className="cartao-titulo">
        <h2>
          <Wallet size={17} /> Financeiro
        </h2>
      </div>
      <dl className="linhas-financeiro">
        <div>
          <dt>Valor estimado</dt>
          <dd>{estimado > 0 ? formatarMoeda(estimado) : "—"}</dd>
        </div>
        <div>
          <dt>Nossa proposta</dt>
          <dd className="texto-azul">{venda > 0 ? formatarMoeda(venda) : "—"}</dd>
        </div>
      </dl>
      {parte > 0 && (
        <>
          <div className="barra-financeiro">
            <i style={{ width: `${parte}%` }} />
          </div>
          <span className="texto-fraco pequeno">proposta = {Math.round((venda / estimado) * 100)}% do estimado</span>
        </>
      )}
      <dl className="linhas-financeiro">
        <div>
          <dt>Custo total</dt>
          <dd>{custo > 0 ? formatarMoeda(custo) : "—"}</dd>
        </div>
        <div>
          <dt>Impostos ({formatarNumero(l.imposto_percentual)}%)</dt>
          <dd>{venda > 0 ? formatarMoeda(impostos) : "—"}</dd>
        </div>
      </dl>
      <div className="lucro-financeiro">
        <span>Lucro previsto</span>
        <strong className={lucro > 0 ? "texto-verde" : ""}>
          {venda > 0 ? formatarMoeda(lucro) : "—"} {venda > 0 && <small>{formatarNumero(l.lucro_percentual)}%</small>}
        </strong>
      </div>
    </section>
  );
}

/** Coluna da direita: os arquivos da licitação a um clique. */
function CartaoArquivos({ arquivos, aoIrPara, aoHabilitacao }: { arquivos: Arquivo[]; aoIrPara: (aba: string) => void; aoHabilitacao: () => void }) {
  return (
    <section className="cartao cartao-arquivos-ficha">
      <div className="cartao-titulo">
        <h2>
          <FolderOpen size={17} /> Arquivos ({arquivos.length})
        </h2>
        <button className="botao-link sem-margem" onClick={() => aoIrPara("arquivos")}>
          + enviar
        </button>
      </div>
      {arquivos.length === 0 ? (
        <p className="texto-fraco pequeno" style={{ margin: 0 }}>
          Nenhum arquivo ainda. Envie o edital, o termo de referência e os anexos.
        </p>
      ) : (
        <ul className="lista-arquivos-ficha">
          {arquivos.slice(0, 6).map((a) => (
            <li key={a.id}>
              <a href={`/api/arquivos/${a.id}`} target="_blank" rel="noreferrer noopener" title={a.nome}>
                <FileText size={15} />
                <span>{a.nome}</span>
              </a>
              {a.categoria && <span className="chip">{a.categoria}</span>}
            </li>
          ))}
        </ul>
      )}
      {arquivos.length > 6 && (
        <button className="botao-link sem-margem" onClick={() => aoIrPara("arquivos")}>
          ver todos os {arquivos.length}
        </button>
      )}
      <button className="botao secundario pequeno botao-largo" onClick={aoHabilitacao} title="Junta os documentos da aba Documentação num .zip, salva no computador e anexa aqui">
        <FileArchive size={14} /> Documentos de habilitação
      </button>
    </section>
  );
}
