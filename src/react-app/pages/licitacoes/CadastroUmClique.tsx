import { CircleAlert, ExternalLink, Loader2, Send, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cotacaoDaProposta } from "../../../shared/negocio";
import type { Cotacao, ItemLicitacao, Licitacao, RascunhoProposta } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { avisar, Modal } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import { temPonte } from "../../robo/ponte";
import { CadastroProposta, Declaracoes } from "./CadastroProposta";
import {
  buscarCompras,
  carregarCompra,
  chaveDoLink,
  type CompraCarregada,
  type CompraEncontrada,
  enviarProposta,
  type ItemProposta,
  paraNumero,
  prazoEncerrado,
  problemaDaProposta,
  textoNumero,
  tituloDaChave,
  txt,
} from "./comprasCadastro";

// Cadastro com um clique: a licitação do quadro já tem número, UASG, itens e orçamento. A plataforma acha a compra
// no Compras.gov.br, casa os itens pelo número, preenche valor (proposta/orçamento), marca e modelo (produto
// cotado), marca os itens viáveis e só pede para confirmar. Nada é enviado sem a pessoa confirmar.

interface Ficha {
  licitacao: Licitacao;
  itens: ItemLicitacao[];
  cotacoes: Cotacao[];
}

interface Linha {
  item: ItemProposta;
  marcado: boolean;
  valor: string;
  quantidade: string;
  marca: string;
  modelo: string;
  origem: string;
  aviso: string;
  status: "" | "enviando" | "ok" | "erro";
  erro: string;
}

const semZeros = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");

/** Monta as linhas: casa cada item do Compras.gov.br com o item da licitação (pelo número) e puxa o orçamento. */
export function montarLinhas(itensCompras: ItemProposta[], ficha: Ficha, rascunho: RascunhoProposta | null): Linha[] {
  const { licitacao: l, itens, cotacoes } = ficha;
  const porNumero = new Map(itens.map((i) => [semZeros(i.numero), i]));
  return itensCompras.map((it) => {
    const nosso = porNumero.get(String(it.numero));
    const linha: Linha = { item: it, marcado: false, valor: "", quantidade: textoNumero(it.quantidade), marca: "", modelo: "", origem: "", aviso: "", status: "", erro: "" };
    if (it.proposta) {
      linha.valor = textoNumero(it.proposta.valor);
      linha.marca = it.proposta.marca;
      linha.modelo = it.proposta.modelo;
      linha.quantidade = textoNumero(it.proposta.quantidade ?? it.quantidade);
      linha.origem = "Já cadastrada";
    }
    if (it.grupo) return { ...linha, aviso: "Item de grupo: cadastre pelo Compras.gov.br" };
    if (!nosso) return { ...linha, aviso: it.proposta ? "" : "Este item não está na licitação do quadro" };
    const escolhida = cotacaoDaProposta(cotacoes, nosso, l.imposto_percentual, l.lucro_percentual);
    const r = rascunho?.itens?.[String(nosso.id)];
    const valorRascunho = r?.valor ? paraNumero(r.valor) : null;
    const valor = valorRascunho ?? (escolhida ? Math.round(escolhida.calculo.precoVenda * 100) / 100 : null);
    if (!it.proposta) {
      linha.valor = textoNumero(valor);
      linha.marca = (r?.marca || escolhida?.cotacao.marca || "").trim();
      linha.modelo = (escolhida?.cotacao.produto || "").trim();
      linha.origem = valorRascunho != null ? "Valor da proposta" : escolhida ? "Preço de venda do orçamento" : "";
    }
    const estimado = it.valorEstimado ?? nosso.valor_referencia;
    const v = paraNumero(linha.valor);
    if (!nosso.participar || r?.incluir === false) linha.aviso = "Marcado para não participar";
    else if (v == null) linha.aviso = "Sem orçamento: informe o valor";
    else if (!it.desconto && estimado != null && v > estimado + 1e-9) linha.aviso = `Acima do estimado (${formatarMoeda(estimado)})`;
    else if (escolhida && !it.desconto && v < escolhida.calculo.precoMinimo - 1e-9) linha.aviso = "Abaixo do custo com impostos";
    // Viável: participa, tem valor dentro do estimado e ainda não foi cadastrado (ou mudou).
    linha.marcado = !linha.aviso && !it.proposta;
    return linha;
  });
}

export function CadastroUmClique({ licitacaoId, aoFechar }: { licitacaoId: number; aoFechar: () => void }) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [rascunho, setRascunho] = useState<RascunhoProposta | null>(null);
  const [erro, setErro] = useState("");
  const [chave, setChave] = useState("");
  const [opcoes, setOpcoes] = useState<CompraEncontrada[] | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [compra, setCompra] = useState<CompraCarregada | null>(null);
  const [carregandoCompra, setCarregandoCompra] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [verCompleto, setVerCompleto] = useState(false);
  const [vez, setVez] = useState(0);
  const app = temPonte();

  // 1) a licitação, o orçamento e o rascunho da proposta
  useEffect(() => {
    Promise.all([
      api<Ficha>(`/licitacoes/${licitacaoId}`),
      api<{ rascunho: RascunhoProposta | null }>(`/licitacoes/${licitacaoId}/proposta/rascunho`).catch(() => ({ rascunho: null })),
    ]).then(
      ([f, r]) => {
        setFicha(f);
        setRascunho(r.rascunho);
      },
      (e) => setErro(mensagemDeErro(e)),
    );
  }, [licitacaoId]);

  // 2) a compra no Compras.gov.br: pelo link (PNCP traz a chave) ou procurando número + UASG
  useEffect(() => {
    if (!ficha || !app || chave) return;
    const l = ficha.licitacao;
    const direta = chaveDoLink(l.link) || chaveDoLink(l.observacoes);
    if (direta) {
      setChave(direta);
      return;
    }
    if (!l.numero || !l.uasg) {
      setOpcoes([]);
      return;
    }
    setProcurando(true);
    buscarCompras(l.numero, l.uasg)
      .then((achadas) => {
        if (achadas.length === 1) setChave(achadas[0].chave);
        else setOpcoes(achadas);
      })
      .catch((e) => setErro(mensagemDeErro(e)))
      .finally(() => setProcurando(false));
  }, [ficha, app, chave]);

  // 3) os itens dessa compra e a proposta montada a partir do orçamento
  useEffect(() => {
    if (!chave || !ficha) return;
    let vivo = true;
    setCarregandoCompra(true);
    carregarCompra(chave)
      .then((c) => {
        if (!vivo) return;
        setCompra(c);
        setLinhas(montarLinhas(c.itens, ficha, rascunho));
        // Guarda o link da compra na licitação (da próxima vez abre direto).
        if (!chaveDoLink(ficha.licitacao.link)) {
          api(`/licitacoes/${ficha.licitacao.id}`, {
            metodo: "PATCH",
            corpo: { link: `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${chave}` },
          }).catch(() => {});
        }
      })
      .catch((e) => vivo && setErro(mensagemDeErro(e)))
      .finally(() => vivo && setCarregandoCompra(false));
    return () => {
      vivo = false;
    };
  }, [chave, ficha, rascunho, vez]);

  const participando = compra?.participacao.isFornecedorParticipante === true;
  const encerrado = compra ? prazoEncerrado(compra.compra) : false;
  const marcadas = linhas.filter((x) => x.marcado);
  const dadosDe = (x: Linha) => ({
    valor: paraNumero(x.valor) ?? 0,
    quantidade: x.item.srp ? (paraNumero(x.quantidade) ?? 0) : (x.item.quantidade ?? 0),
    marca: x.marca,
    modelo: x.modelo,
  });
  const problemas = marcadas.map((x) => problemaDaProposta(x.item, dadosDe(x))).filter(Boolean);
  const total = useMemo(() => marcadas.reduce((s, x) => s + (x.item.desconto ? 0 : dadosDe(x).valor * dadosDe(x).quantidade), 0), [linhas]); // eslint-disable-line react-hooks/exhaustive-deps

  const mudar = (i: number, n: Partial<Linha>) => setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, ...n } : x)));

  async function confirmar() {
    if (!compra || !marcadas.length || problemas.length) return;
    const resumo = marcadas
      .map((x) => `• Item ${x.item.numero}: ${x.item.desconto ? `${x.valor}%` : formatarMoeda(dadosDe(x).valor)}${x.item.material ? ` · ${x.marca} ${x.modelo}` : ""}`)
      .join("\n");
    if (!window.confirm(`Cadastrar ${marcadas.length} item(ns) no Compras.gov.br?\n\n${resumo}\n\nTotal: ${formatarMoeda(total)}`)) return;
    setEnviando(true);
    let ok = 0;
    for (let i = 0; i < linhas.length; i++) {
      const x = linhas[i];
      if (!x.marcado) continue;
      mudar(i, { status: "enviando", erro: "" });
      try {
        await enviarProposta(chave, x.item, dadosDe(x));
        mudar(i, { status: "ok", marcado: false });
        ok++;
      } catch (e) {
        mudar(i, { status: "erro", erro: mensagemDeErro(e) });
      }
    }
    setEnviando(false);
    avisar(ok === marcadas.length ? `${ok} item(ns) cadastrado(s) no Compras.gov.br.` : `${ok} de ${marcadas.length} cadastrado(s). Veja os erros na lista.`, ok === marcadas.length ? "sucesso" : "erro");
  }

  const l = ficha?.licitacao;
  const titulo = chave ? tituloDaChave(chave) : l?.numero ? `Nº ${l.numero}` : "licitação";

  if (verCompleto && chave) return <CadastroProposta chave={chave} cnpj={compra?.cnpj ?? ""} aoFechar={() => (setVerCompleto(false), setVez((v) => v + 1))} />;

  return (
    <Modal titulo={`Cadastrar no Compras.gov.br · ${titulo}`} aoFechar={aoFechar} largo>
      <style>{".modal.largo:has(.um-clique){max-width:1180px}"}</style>
      <div className="um-clique cadastro-proposta">
        {!app ? (
          <p className="alerta aviso">Abra a plataforma pelo aplicativo Montzion e entre no Compras.gov.br para cadastrar a proposta por aqui.</p>
        ) : erro ? (
          <div className="alerta erro linha-erro-item">
            <span>{erro}</span>
            <button className="botao secundario pequeno" onClick={() => (setErro(""), setVez((v) => v + 1))}>
              Tentar de novo
            </button>
          </div>
        ) : !ficha || procurando || (chave && carregandoCompra && !compra) ? (
          <p className="texto-suave carregando-marcas">
            <Loader2 className="girando" size={16} /> {!ficha ? "Lendo a licitação e o orçamento…" : procurando ? "Procurando a compra no Compras.gov.br…" : "Abrindo a compra e montando a proposta…"}
          </p>
        ) : !chave ? (
          <EscolherCompra opcoes={opcoes ?? []} licitacao={ficha.licitacao} aoEscolher={setChave} />
        ) : compra ? (
          <>
            <div className="cabeca-cadastro">
              <div>
                <strong>{titulo}</strong>
                <span>{[l?.uasg && `UASG ${l.uasg}`, txt(compra.compra.nomeUasg) || l?.orgao].filter(Boolean).join(" - ")}</span>
                {l?.objeto && <span className="texto-suave pequeno objeto-cadastro">{l.objeto}</span>}
              </div>
              <div className={`prazo-cadastro ${encerrado ? "encerrado" : ""}`}>
                <span>Envio de propostas até</span>
                <strong>{txt(compra.compra.dataHoraFimPropostas) ? new Date(Date.parse(txt(compra.compra.dataHoraFimPropostas))).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}</strong>
                {encerrado && <span className="chip vermelho">Prazo encerrado</span>}
              </div>
            </div>

            {!participando && (
              <>
                <p className="aviso-itens-bloqueados">
                  <CircleAlert size={15} /> Primeiro aceite as declarações desta compra. Depois a plataforma monta a proposta com os itens do orçamento.
                </p>
                <Declaracoes chave={chave} participacao={compra.participacao} textos={compra.declaracoes} encerrado={encerrado} aoSalvar={() => setVez((v) => v + 1)} />
              </>
            )}

            {participando && (
              <section className="itens-proposta">
                <div className="lista-compras-topo">
                  <h3>
                    <Zap size={16} /> Proposta montada pelo orçamento
                  </h3>
                  <span className="texto-suave pequeno">Confira, ajuste se precisar e confirme. Itens com aviso ficam desmarcados.</span>
                </div>
                <div className="tabela-um-clique">
                  <table>
                    <thead>
                      <tr>
                        <th aria-label="Cadastrar" />
                        <th>Item</th>
                        <th>Valor unit.</th>
                        <th>Qtde</th>
                        <th>Marca</th>
                        <th>Modelo</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((x, i) => {
                        const d = dadosDe(x);
                        const bloqueado = x.item.grupo || enviando || encerrado || x.status === "ok";
                        return (
                          <tr key={x.item.numero} className={`${x.marcado ? "marcado" : ""} ${x.status}`}>
                            <td>
                              <input type="checkbox" checked={x.marcado} disabled={bloqueado} onChange={(e) => mudar(i, { marcado: e.target.checked })} aria-label={`Cadastrar o item ${x.item.numero}`} />
                            </td>
                            <td className="col-item">
                              <strong>
                                {x.item.numero}. {x.item.descricao}
                              </strong>
                              <span className="pequeno texto-fraco">
                                {x.origem}
                                {x.status === "ok" && <span className="texto-verde"> · Cadastrado</span>}
                                {x.status === "enviando" && " · Enviando…"}
                              </span>
                              {x.aviso && <span className="pequeno texto-amarelo">{x.aviso}</span>}
                              {x.erro && <span className="pequeno texto-vermelho">{x.erro}</span>}
                            </td>
                            <td>
                              <input value={x.valor} onChange={(e) => mudar(i, { valor: e.target.value })} inputMode="decimal" disabled={bloqueado} aria-label={`Valor do item ${x.item.numero}`} />
                            </td>
                            <td>
                              <input value={x.quantidade} onChange={(e) => mudar(i, { quantidade: e.target.value })} inputMode="decimal" disabled={bloqueado || !x.item.srp} aria-label={`Quantidade do item ${x.item.numero}`} />
                            </td>
                            <td>{x.item.material ? <input value={x.marca} onChange={(e) => mudar(i, { marca: e.target.value })} disabled={bloqueado} aria-label={`Marca do item ${x.item.numero}`} /> : <span className="texto-fraco">—</span>}</td>
                            <td>{x.item.material ? <input value={x.modelo} onChange={(e) => mudar(i, { modelo: e.target.value })} disabled={bloqueado} aria-label={`Modelo do item ${x.item.numero}`} /> : <span className="texto-fraco">—</span>}</td>
                            <td className="col-total">{x.item.desconto ? `${x.valor}%` : d.valor ? formatarMoeda(d.valor * d.quantidade) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {linhas.length === 0 && <p className="texto-fraco">O Compras.gov.br não devolveu itens para esta compra.</p>}
                <div className="rodape-um-clique">
                  <button className="botao-link sem-margem" onClick={() => setVerCompleto(true)}>
                    <ExternalLink size={14} /> Abrir o cadastro completo (anexos, declarações)
                  </button>
                  <div>
                    {problemas.length > 0 && <span className="texto-vermelho pequeno">{problemas[0]}</span>}
                    <strong>{formatarMoeda(total)}</strong>
                    <button className="botao acento" onClick={confirmar} disabled={!marcadas.length || problemas.length > 0 || enviando || encerrado}>
                      {enviando ? <Loader2 className="girando" /> : <Send />} Confirmar e cadastrar {marcadas.length || ""} {marcadas.length === 1 ? "item" : "itens"}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function EscolherCompra({ opcoes, licitacao, aoEscolher }: { opcoes: CompraEncontrada[]; licitacao: Licitacao; aoEscolher: (chave: string) => void }) {
  if (!opcoes.length)
    return (
      <p className="alerta aviso">
        {licitacao.numero && licitacao.uasg
          ? `Não achei a compra Nº ${licitacao.numero} na UASG ${licitacao.uasg} no Compras.gov.br. Confira o número e a UASG nos dados da licitação.`
          : "Preencha o número e a UASG nos dados da licitação para a plataforma achar a compra no Compras.gov.br."}
      </p>
    );
  return (
    <div className="resultado-busca-compra">
      <span className="texto-suave pequeno">Achei mais de uma compra com esse número nessa UASG. Qual é a desta licitação?</span>
      <ul>
        {opcoes.map((c) => (
          <li key={c.chave}>
            <button className="compra-achada" onClick={() => aoEscolher(c.chave)}>
              <strong>{c.titulo}</strong>
              {c.orgao && <span className="pequeno">{c.orgao}</span>}
              {c.objeto && <span className="texto-suave pequeno objeto-achado">{c.objeto}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A licitação é do Compras.gov.br? (link com a chave, portal ou UASG + número sem outro portal) */
export function ehDoCompras(l: { portal: string | null; uasg: string | null; numero: string | null; link?: string | null }) {
  if (chaveDoLink(l.link)) return true;
  const portal = (l.portal ?? "").toLowerCase();
  if (portal) return /compras\.gov|comprasnet|compras gov/.test(portal);
  return !!(l.uasg && l.numero);
}

/** Botão do card do quadro e da ficha. */
export function BotaoUmClique({ licitacaoId, compacto = false }: { licitacaoId: number; compacto?: boolean }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        className={compacto ? "botao-um-clique" : "botao acento"}
        onClick={(e) => {
          e.stopPropagation();
          setAberto(true);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        title="Cadastrar a proposta no Compras.gov.br com os itens do orçamento"
      >
        <Zap size={compacto ? 13 : 16} /> {compacto ? "Cadastrar" : "Cadastrar no Compras.gov.br"}
      </button>
      {aberto && (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <CadastroUmClique licitacaoId={licitacaoId} aoFechar={() => setAberto(false)} />
        </span>
      )}
    </>
  );
}

