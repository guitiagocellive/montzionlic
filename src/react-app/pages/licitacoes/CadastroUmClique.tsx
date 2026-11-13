import { ErroCompras } from "../../robo/ErroCompras";
import { CircleAlert, ExternalLink, Loader2, Pencil, Save, Send, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Licitacao, RascunhoProposta } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { avisar, Modal } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import { temPonte } from "../../robo/ponte";
import { pedir } from "./ItemCompras";
import { CadastroProposta, Declaracoes } from "./CadastroProposta";
import {
  buscarCompras,
  carregarCompra,
  chaveDoLink,
  type CompraCarregada,
  type CompraEncontrada,
  enviarProposta,
  FE,
  type ItemProposta,
  paraNumero,
  prazoEncerrado,
  problemaDaProposta,
  textoNumero,
  textoValor,
  tituloDaChave,
  txt,
  textoReferencia,
} from "./comprasCadastro";
import { type FichaQuadro, sugestoesDoQuadro } from "./sugestoesQuadro";

// Cadastro com um clique: a licitação do quadro já tem número, UASG, itens e orçamento. A plataforma acha a compra
// no Compras.gov.br, casa os itens pelo número, preenche valor (proposta/orçamento), marca e modelo (produto
// cotado), marca os itens viáveis e só pede para confirmar. Nada é enviado sem a pessoa confirmar.

type Ficha = FichaQuadro;

interface Linha {
  item: ItemProposta;
  marcado: boolean;
  valor: string;
  quantidade: string;
  marca: string;
  modelo: string;
  origem: string;
  aviso: string;
  status: "" | "enviando" | "ok" | "erro" | "retirada";
  erro: string;
  /** Valores como estão no Compras.gov.br (só nos itens já cadastrados): mudou → marca para salvar a alteração. */
  orig: string;
}

const assinatura = (x: Pick<Linha, "valor" | "quantidade" | "marca" | "modelo">) =>
  [paraNumero(x.valor), paraNumero(x.quantidade), x.marca.trim(), x.modelo.trim()].join("|");

/**
 * Monta as linhas: casa cada item do Compras.gov.br com o item da licitação (pelo número). O valor é o de
 * referência do órgão; sigiloso ou não informado, calcula pelo orçamento. Marca só os viáveis.
 */
export function montarLinhas(
  itensCompras: ItemProposta[],
  ficha: Ficha,
  rascunho: RascunhoProposta | null,
): Linha[] {
  const sugestoes = sugestoesDoQuadro(itensCompras, ficha, rascunho);
  const linhas = itensCompras.map((it) => {
    const s = sugestoes.get(it.numero)!;
    const linha: Linha = {
      item: it,
      marcado: false,
      valor: textoValor(s.valor),
      // Quantidade: a do Compras.gov.br; se ele não mandar, a do edital (item da licitação no quadro).
      quantidade: textoNumero(it.quantidade ?? s.quantidade),
      marca: s.marca,
      modelo: s.modelo,
      origem: s.origem,
      aviso: "",
      status: "",
      erro: "",
      orig: "",
    };
    if (it.proposta) {
      linha.valor = textoValor(it.proposta.valor);
      linha.marca = it.proposta.marca;
      linha.modelo = it.proposta.modelo;
      linha.quantidade = textoNumero(
        it.proposta.quantidade ?? it.quantidade ?? s.quantidade,
      );
      linha.origem = "Cadastrada no Compras.gov.br";
      linha.orig = assinatura(linha);
    }
    if (it.grupo) return { ...linha, valor: "", origem: it.nomeGrupo };
    if (!s.noQuadro)
      return {
        ...linha,
        aviso: it.proposta ? "" : "Este item não está na licitação do quadro",
      };
    if (!s.participar) linha.aviso = "Marcado para não participar";
    else if (!it.proposta) linha.aviso = s.aviso;
    linha.marcado = !linha.aviso && !it.proposta && s.valor != null;
    return linha;
  });
  // Grupo: a proposta precisa de TODOS os itens dele. O grupo só vai marcado se todos são viáveis.
  for (const g of linhas.filter((x) => x.item.grupo)) {
    const dele = linhas.filter((x) => x.item.grupoDe === g.item.numero);
    if (!dele.length) {
      g.aviso =
        "Não consegui ler os itens deste grupo: abra o cadastro completo";
      continue;
    }
    const cadastrados = dele.every((x) => x.item.proposta);
    const problema = dele.find(
      (x) => !x.item.proposta && (x.aviso || paraNumero(x.valor) == null),
    );
    g.aviso = cadastrados
      ? ""
      : problema
        ? `O grupo precisa de todos os itens. Item ${problema.item.numero}: ${problema.aviso || "sem valor"}`
        : "";
    g.origem = cadastrados
      ? `${g.item.nomeGrupo} · cadastrado no Compras.gov.br`
      : `${g.item.nomeGrupo} · ${dele.length} itens: a proposta vai em cada um` +
        (g.item.referencia.tipo === "valor"
          ? ` · referência do grupo ${formatarMoeda(g.item.referencia.valor)}`
          : g.item.referencia.tipo === "sigiloso"
            ? " · referência sigilosa"
            : "");
    g.marcado = !cadastrados && !problema;
    for (const x of dele) x.marcado = g.marcado;
  }
  return linhas;
}

export function CadastroUmClique({
  licitacaoId,
  aoFechar,
}: {
  licitacaoId: number;
  aoFechar: () => void;
}) {
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
  const tentarDeNovo = useCallback(() => {
    setErro("");
    setOpcoes(null);
    setVez((v) => v + 1);
  }, []);
  const app = temPonte();

  // 1) a licitação, o orçamento e o rascunho da proposta
  useEffect(() => {
    Promise.all([
      api<Ficha>(`/licitacoes/${licitacaoId}`),
      api<{ rascunho: RascunhoProposta | null }>(
        `/licitacoes/${licitacaoId}/proposta/rascunho`,
      ).catch(() => ({ rascunho: null })),
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
  }, [ficha, app, chave, vez]);

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
        sincronizar(c.itens.filter((x) => !x.grupo && x.proposta).length);
        // Guarda o link da compra na licitação (da próxima vez abre direto).
        if (!chaveDoLink(ficha.licitacao.link)) {
          api(`/licitacoes/${ficha.licitacao.id}`, {
            metodo: "PATCH",
            corpo: {
              link: `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${chave}`,
            },
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
  // O cabeçalho do grupo não é enviado: só os itens dele.
  const marcadas = linhas.filter((x) => x.marcado && !x.item.grupo);
  const dadosDe = (x: Linha) => ({
    valor: paraNumero(x.valor) ?? 0,
    quantidade: paraNumero(x.quantidade) ?? x.item.quantidade ?? 0,
    marca: x.marca,
    modelo: x.modelo,
  });
  const problemas = marcadas
    .map((x) => problemaDaProposta(x.item, dadosDe(x)))
    .filter(Boolean);
  const totalDe = (x: Linha) =>
    x.item.desconto
      ? 0
      : x.item.porValorTotal
        ? dadosDe(x).valor
        : dadosDe(x).valor * dadosDe(x).quantidade;
  const total = useMemo(
    () => marcadas.reduce((s, x) => s + totalDe(x), 0),
    [linhas],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const mudar = (i: number, n: Partial<Linha>) =>
    setLinhas((ls) => ls.map((x, j) => (j === i ? { ...x, ...n } : x)));
  // Editar um campo: num item já cadastrado, marca sozinho para "salvar alteração" quando muda do que está lá.
  const editar = (i: number, n: Partial<Pick<Linha, "valor" | "quantidade" | "marca" | "modelo">>) =>
    setLinhas((ls) =>
      ls.map((x, j) => {
        if (j !== i) return x;
        const novo = { ...x, ...n };
        return x.item.proposta ? { ...novo, marcado: assinatura(novo) !== x.orig, status: novo.status === "ok" ? "" : novo.status } : novo;
      }),
    );
  const cadastradas = linhas.filter((x) => !x.item.grupo && x.item.proposta);
  const jaCadastrada = cadastradas.length > 0;
  const novas = marcadas.filter((x) => !x.item.proposta);
  const alteradas = marcadas.filter((x) => x.item.proposta);
  const textoBotao =
    alteradas.length && !novas.length
      ? `Salvar ${alteradas.length} ${alteradas.length === 1 ? "alteração" : "alterações"}`
      : novas.length && !alteradas.length
        ? `Cadastrar ${novas.length} ${novas.length === 1 ? "item" : "itens"}`
        : marcadas.length
          ? `Enviar ${marcadas.length} itens (${novas.length} novos, ${alteradas.length} alterados)`
          : jaCadastrada
            ? "Nada alterado"
            : "Cadastrar itens";

  const sincronizando = useRef<Promise<unknown> | null>(null);
  // Fecha só depois de salvar a situação na licitação (o quadro recarrega já com "Alterar no Compras").
  const fechar = () => void Promise.resolve(sincronizando.current).finally(aoFechar);
  // Guarda na licitação do quadro se há proposta no Compras.gov.br (o card mostra "Alterar no Compras").
  const sincronizar = useCallback(
    (qtd: number) => {
      if (!ficha) return;
      const tinha = ficha.licitacao.compras_itens ?? 0;
      if (tinha === qtd && (qtd > 0) === !!ficha.licitacao.compras_cadastrado_em) return;
      ficha.licitacao.compras_itens = qtd;
      ficha.licitacao.compras_cadastrado_em = qtd > 0 ? new Date().toISOString() : null;
      sincronizando.current = api(`/licitacoes/${ficha.licitacao.id}`, { metodo: "PATCH", corpo: { compras_itens: qtd, compras_cadastrado_em: qtd > 0 ? new Date().toISOString() : null } }).catch(() => {});
    },
    [ficha],
  );

  async function retirar(alvos: number[], texto: string) {
    if (!window.confirm(texto)) return;
    setEnviando(true);
    let ok = 0;
    for (const i of alvos) {
      const x = linhas[i];
      mudar(i, { status: "enviando", erro: "" });
      try {
        await pedir({ metodo: "DELETE", caminho: `${FE}/v1/compras/${chave}/itens/${x.item.numero}/participacao` });
        mudar(i, { status: "retirada", marcado: false, item: { ...x.item, proposta: null }, origem: "Retirada do Compras.gov.br", orig: "" });
        ok++;
      } catch (e) {
        mudar(i, { status: "erro", erro: mensagemDeErro(e) });
      }
    }
    setEnviando(false);
    setLinhas((ls) => {
      sincronizar(ls.filter((x) => !x.item.grupo && x.item.proposta).length);
      return ls;
    });
    avisar(ok === alvos.length ? `${ok} item(ns) retirado(s) do Compras.gov.br.` : `${ok} de ${alvos.length} retirado(s). Veja os erros na lista.`, ok === alvos.length ? "sucesso" : "erro");
  }
  const indicesCadastrados = (filtro: (x: Linha) => boolean) => linhas.map((x, i) => (filtro(x) && !x.item.grupo && x.item.proposta ? i : -1)).filter((i) => i >= 0);
  // Marcar/desmarcar o grupo marca/desmarca todos os itens dele juntos.
  const marcarGrupo = (grupo: number, marcado: boolean) =>
    setLinhas((ls) =>
      ls.map((x) =>
        (x.item.numero === grupo && x.item.grupo) || x.item.grupoDe === grupo
          ? { ...x, marcado: x.status === "ok" ? false : marcado }
          : x,
      ),
    );
  const totalGrupo = (grupo: number) =>
    linhas
      .filter((x) => x.item.grupoDe === grupo)
      .reduce((s, x) => s + (paraNumero(x.valor) != null ? totalDe(x) : 0), 0);

  async function confirmar() {
    if (!compra || !marcadas.length || problemas.length) return;
    const resumo = marcadas
      .map(
        (x) =>
          `• Item ${x.item.numero}: ${x.item.desconto ? `${x.valor}%` : formatarMoeda(dadosDe(x).valor)}${x.item.material ? ` · ${x.marca} ${x.modelo}` : ""}`,
      )
      .join("\n");
    if (
      !window.confirm(
        `${alteradas.length && !novas.length ? "Alterar" : "Cadastrar"} ${marcadas.length} item(ns) no Compras.gov.br?\n\n${resumo}\n\nTotal: ${formatarMoeda(total)}`,
      )
    )
      return;
    setEnviando(true);
    let ok = 0;
    for (let i = 0; i < linhas.length; i++) {
      const x = linhas[i];
      if (!x.marcado) continue;
      mudar(i, { status: "enviando", erro: "" });
      try {
        const d = dadosDe(x);
        await enviarProposta(chave, x.item, d);
        const item = { ...x.item, proposta: { valor: d.valor, quantidade: d.quantidade, marca: d.marca, modelo: d.modelo, pais: x.item.proposta?.pais ?? "BRA", margem: x.item.proposta?.margem ?? "0" } };
        mudar(i, { status: "ok", marcado: false, item, origem: x.item.proposta ? "Alterada no Compras.gov.br" : "Cadastrada no Compras.gov.br", orig: assinatura(x) });
        ok++;
      } catch (e) {
        mudar(i, { status: "erro", erro: mensagemDeErro(e) });
      }
    }
    setEnviando(false);
    setLinhas((ls) => {
      sincronizar(ls.filter((y) => !y.item.grupo && y.item.proposta).length);
      return ls;
    });
    avisar(
      ok === marcadas.length
        ? `${ok} item(ns) ${alteradas.length && !novas.length ? "alterado(s)" : "enviado(s)"} no Compras.gov.br.`
        : `${ok} de ${marcadas.length} cadastrado(s). Veja os erros na lista.`,
      ok === marcadas.length ? "sucesso" : "erro",
    );
  }

  const l = ficha?.licitacao;
  const titulo = chave
    ? tituloDaChave(chave)
    : l?.numero
      ? `Nº ${l.numero}`
      : "licitação";

  if (verCompleto && chave)
    return (
      <CadastroProposta
        chave={chave}
        cnpj={compra?.cnpj ?? ""}
        aoFechar={() => (setVerCompleto(false), setVez((v) => v + 1))}
      />
    );

  return (
    <Modal
      titulo={`${jaCadastrada ? "Alterar proposta no Compras.gov.br" : "Cadastrar no Compras.gov.br"} · ${titulo}`}
      aoFechar={fechar}
      largo
    >
      <style>{".modal.largo:has(.um-clique){max-width:1180px}"}</style>
      <div className="um-clique cadastro-proposta">
        {!app ? (
          <p className="alerta aviso">
            Abra a plataforma pelo aplicativo Montzion e entre no Compras.gov.br
            para cadastrar a proposta por aqui.
          </p>
        ) : erro ? (
          <ErroCompras erro={erro} aoTentar={tentarDeNovo} />
        ) : !ficha || procurando || (chave && carregandoCompra && !compra) ? (
          <p className="texto-suave carregando-marcas">
            <Loader2 className="girando" size={16} />{" "}
            {!ficha
              ? "Lendo a licitação e o orçamento…"
              : procurando
                ? "Procurando a compra no Compras.gov.br…"
                : "Abrindo a compra e montando a proposta…"}
          </p>
        ) : !chave ? (
          <EscolherCompra
            opcoes={opcoes ?? []}
            licitacao={ficha.licitacao}
            aoEscolher={setChave}
          />
        ) : compra ? (
          <>
            <div className="cabeca-cadastro">
              <div>
                <strong>{titulo}</strong>
                <span>
                  {[
                    l?.uasg && `UASG ${l.uasg}`,
                    txt(compra.compra.nomeUasg) || l?.orgao,
                  ]
                    .filter(Boolean)
                    .join(" - ")}
                </span>
                {l?.objeto && (
                  <span className="texto-suave pequeno objeto-cadastro">
                    {l.objeto}
                  </span>
                )}
              </div>
              <div className={`prazo-cadastro ${encerrado ? "encerrado" : ""}`}>
                <span>Envio de propostas até</span>
                <strong>
                  {txt(compra.compra.dataHoraFimPropostas)
                    ? new Date(
                        Date.parse(txt(compra.compra.dataHoraFimPropostas)),
                      ).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "—"}
                </strong>
                {encerrado && (
                  <span className="chip vermelho">Prazo encerrado</span>
                )}
              </div>
            </div>

            {!participando && (
              <>
                <p className="aviso-itens-bloqueados">
                  <CircleAlert size={15} /> Primeiro aceite as declarações desta
                  compra. Depois a plataforma monta a proposta com os itens do
                  orçamento.
                </p>
                <Declaracoes
                  chave={chave}
                  participacao={compra.participacao}
                  textos={compra.declaracoes}
                  encerrado={encerrado}
                  aoSalvar={() => setVez((v) => v + 1)}
                />
              </>
            )}

            {participando && (
              <section className="itens-proposta">
                <div className="lista-compras-topo">
                  <h3>
                    {jaCadastrada ? <Pencil size={16} /> : <Zap size={16} />}{" "}
                    {jaCadastrada ? "Proposta cadastrada no Compras.gov.br" : "Proposta montada pelo orçamento"}
                  </h3>
                  <span className="texto-suave pequeno">
                    {jaCadastrada
                      ? "Mude o valor, a marca ou o modelo e salve a alteração, ou retire itens da proposta."
                      : "Confira, ajuste se precisar e confirme. Itens com aviso ficam desmarcados."}
                  </span>
                </div>
                <div className="tabela-um-clique">
                  <table>
                    <thead>
                      <tr>
                        <th aria-label="Cadastrar" />
                        <th>Item</th>
                        <th>Referência</th>
                        <th>Valor</th>
                        <th>Qtde</th>
                        <th>Marca</th>
                        <th>Modelo</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((x, i) => {
                        const d = dadosDe(x);
                        const bloqueado = x.item.grupo || enviando || encerrado;
                        if (x.item.grupo)
                          return (
                            <tr
                              key={x.item.numero}
                              className={`linha-grupo ${x.marcado ? "marcado" : ""}`}
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  checked={x.marcado}
                                  disabled={
                                    enviando ||
                                    encerrado ||
                                    !linhas.some(
                                      (y) => y.item.grupoDe === x.item.numero,
                                    )
                                  }
                                  onChange={(e) =>
                                    marcarGrupo(x.item.numero, e.target.checked)
                                  }
                                  aria-label={`Cadastrar o ${x.item.nomeGrupo}`}
                                />
                              </td>
                              <td className="col-item" colSpan={6}>
                                <strong>{x.item.nomeGrupo}</strong>
                                <span className="pequeno texto-fraco">
                                  {x.origem}
                                </span>
                                {x.aviso && (
                                  <span className="pequeno texto-amarelo">
                                    {x.aviso}
                                  </span>
                                )}
                              </td>
                              <td className="col-total">
                                {formatarMoeda(totalGrupo(x.item.numero))}
                                {linhas.some((y) => y.item.grupoDe === x.item.numero && y.item.proposta) && (
                                  <button
                                    className="botao-retirar"
                                    disabled={enviando || encerrado}
                                    onClick={() =>
                                      retirar(
                                        indicesCadastrados((y) => y.item.grupoDe === x.item.numero),
                                        `Retirar o ${x.item.nomeGrupo} (todos os itens dele) da proposta no Compras.gov.br?`,
                                      )
                                    }
                                    title="Retirar o grupo da proposta"
                                    aria-label={`Retirar o ${x.item.nomeGrupo}`}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        return (
                          <tr
                            key={x.item.numero}
                            className={`${x.marcado ? "marcado" : ""} ${x.status} ${x.item.grupoDe != null ? "subitem" : ""}`}
                          >
                            <td>
                              {x.item.grupoDe == null && (
                                <input
                                  type="checkbox"
                                  checked={x.marcado}
                                  disabled={bloqueado}
                                  onChange={(e) =>
                                    mudar(i, { marcado: e.target.checked })
                                  }
                                  aria-label={`Cadastrar o item ${x.item.numero}`}
                                />
                              )}
                            </td>
                            <td className="col-item">
                              <strong>
                                {x.item.numero}. {x.item.descricao}
                              </strong>
                              <span className="pequeno texto-fraco">
                                {x.origem}
                                {x.status === "ok" && <span className="texto-verde"> · Enviado agora</span>}
                                {x.item.proposta && x.marcado && x.status !== "enviando" && <span className="texto-amarelo"> · alteração a salvar</span>}
                                {x.status === "enviando" && " · Enviando…"}
                              </span>
                              {x.aviso && (
                                <span className="pequeno texto-amarelo">
                                  {x.aviso}
                                </span>
                              )}
                              {x.erro && (
                                <span className="pequeno texto-vermelho">
                                  {x.erro}
                                </span>
                              )}
                            </td>
                            <td className="col-referencia">
                              {x.item.referencia.tipo === "valor" ? (
                                formatarMoeda(x.item.referencia.valor)
                              ) : (
                                <span
                                  className={`chip ${x.item.referencia.tipo === "sigiloso" ? "amarelo" : "cinza"}`}
                                >
                                  {textoReferencia(x.item.referencia)}
                                </span>
                              )}
                              {x.item.porValorTotal && (
                                <small className="texto-fraco">
                                  valor total
                                </small>
                              )}
                            </td>
                            <td>
                              <div className="entrada">
                                <input
                                  value={x.valor}
                                  onChange={(e) =>
                                    editar(i, { valor: e.target.value })
                                  }
                                  inputMode="decimal"
                                  disabled={bloqueado}
                                  aria-label={`Valor do item ${x.item.numero}`}
                                />
                              </div>
                            </td>
                            <td>
                              <div className="entrada">
                                <input
                                  value={x.quantidade}
                                  onChange={(e) =>
                                    editar(i, { quantidade: e.target.value })
                                  }
                                  inputMode="decimal"
                                  disabled={bloqueado}
                                  title={
                                    x.item.srp
                                      ? ""
                                      : "Sem registro de preços: normalmente a quantidade toda do edital"
                                  }
                                  aria-label={`Quantidade do item ${x.item.numero}`}
                                />
                              </div>
                            </td>
                            <td>
                              {x.item.material ? (
                                <div className="entrada">
                                  <input
                                    value={x.marca}
                                    onChange={(e) =>
                                      editar(i, { marca: e.target.value })
                                    }
                                    disabled={bloqueado}
                                    aria-label={`Marca do item ${x.item.numero}`}
                                  />
                                </div>
                              ) : (
                                <span className="texto-fraco">—</span>
                              )}
                            </td>
                            <td>
                              {x.item.material ? (
                                <div className="entrada">
                                  <input
                                    value={x.modelo}
                                    onChange={(e) =>
                                      editar(i, { modelo: e.target.value })
                                    }
                                    disabled={bloqueado}
                                    aria-label={`Modelo do item ${x.item.numero}`}
                                  />
                                </div>
                              ) : (
                                <span className="texto-fraco">—</span>
                              )}
                            </td>
                            <td className="col-total">
                              {x.item.desconto
                                ? `${x.valor}%`
                                : d.valor
                                  ? formatarMoeda(totalDe(x))
                                  : "—"}
                              {x.item.proposta && x.item.grupoDe == null && (
                                <button
                                  className="botao-retirar"
                                  disabled={enviando || encerrado}
                                  onClick={() => retirar([i], `Retirar o item ${x.item.numero} da proposta no Compras.gov.br?`)}
                                  title="Retirar este item da proposta"
                                  aria-label={`Retirar o item ${x.item.numero}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {linhas.length === 0 && (
                  <p className="texto-fraco">
                    O Compras.gov.br não devolveu itens para esta compra.
                  </p>
                )}
                <div className="rodape-um-clique">
                  <button
                    className="botao-link sem-margem"
                    onClick={() => setVerCompleto(true)}
                  >
                    <ExternalLink size={14} /> Abrir o cadastro completo
                  </button>
                  {jaCadastrada && (
                    <button
                      className="botao secundario pequeno perigo"
                      disabled={enviando || encerrado}
                      onClick={() =>
                        retirar(
                          indicesCadastrados(() => true),
                          `Retirar a proposta INTEIRA (${cadastradas.length} item(ns)) do Compras.gov.br?\n\nAs declarações continuam aceitas; dá para cadastrar de novo até o fim do prazo.`,
                        )
                      }
                    >
                      <Trash2 size={14} /> Retirar a proposta
                    </button>
                  )}
                  <div>
                    {problemas.length > 0 && (
                      <span className="texto-vermelho pequeno">
                        {problemas[0]}
                      </span>
                    )}
                    <strong>{formatarMoeda(total)}</strong>
                    <button
                      className="botao acento"
                      onClick={confirmar}
                      disabled={
                        !marcadas.length ||
                        problemas.length > 0 ||
                        enviando ||
                        encerrado
                      }
                    >
                      {enviando ? <Loader2 className="girando" /> : alteradas.length && !novas.length ? <Save /> : <Send />} {textoBotao}
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

function EscolherCompra({
  opcoes,
  licitacao,
  aoEscolher,
}: {
  opcoes: CompraEncontrada[];
  licitacao: Licitacao;
  aoEscolher: (chave: string) => void;
}) {
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
      <span className="texto-suave pequeno">
        Achei mais de uma compra com esse número nessa UASG. Qual é a desta
        licitação?
      </span>
      <ul>
        {opcoes.map((c) => (
          <li key={c.chave}>
            <button
              className="compra-achada"
              onClick={() => aoEscolher(c.chave)}
            >
              <strong>{c.titulo}</strong>
              {c.orgao && <span className="pequeno">{c.orgao}</span>}
              {c.objeto && (
                <span className="texto-suave pequeno objeto-achado">
                  {c.objeto}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A licitação é do Compras.gov.br? (link com a chave, portal ou UASG + número sem outro portal) */
export function ehDoCompras(l: {
  portal: string | null;
  uasg: string | null;
  numero: string | null;
  link?: string | null;
}) {
  if (chaveDoLink(l.link)) return true;
  const portal = (l.portal ?? "").toLowerCase();
  if (portal) return /compras\.gov|comprasnet|compras gov/.test(portal);
  return !!(l.uasg && l.numero);
}

export interface SituacaoCadastro {
  /** Mostrar a ação (cadastrar ou alterar) para esta licitação. */
  mostrar: boolean;
  /** Já dá para fazer (com orçamento pronto, ou para alterar o que já foi cadastrado). */
  pode: boolean;
  alterar: boolean;
  /** Por que ainda não dá, ou um lembrete (ex.: só os itens orçados vão). */
  aviso: string;
  orcados: number;
  total: number;
}

/**
 * Quando oferecer o cadastro no Compras.gov.br: só na etapa Orçamento (é quando o preço está pronto) e só se há
 * item orçado. Depois de cadastrada, "Alterar" fica disponível até a sessão. Depois da sessão, nada de cadastro.
 */
export function situacaoCadastro(
  l: {
    etapa: string;
    portal: string | null;
    uasg: string | null;
    numero: string | null;
    link?: string | null;
    data_sessao: string | null;
    data_reabertura?: string | null;
    compras_cadastrado_em?: string | null;
  },
  orcados: number,
  total: number,
  hoje: string,
): SituacaoCadastro {
  const base = { orcados, total, aviso: "" };
  const nada = { ...base, mostrar: false, pode: false, alterar: false };
  if (!ehDoCompras(l) || ["boa_colocacao", "ganha", "perdida"].includes(l.etapa)) return nada;
  const data = l.data_reabertura && l.data_reabertura >= hoje ? l.data_reabertura : l.data_sessao;
  if (data && data < hoje) return nada; // a sessão já aconteceu
  if (l.compras_cadastrado_em) return { ...base, mostrar: true, pode: true, alterar: true };
  if (l.etapa !== "orcamento") return nada;
  if (total === 0) return { ...base, mostrar: true, pode: false, alterar: false, aviso: "Marque na aba Itens em quais itens vamos participar." };
  if (orcados === 0) return { ...base, mostrar: true, pode: false, alterar: false, aviso: `Nenhum dos ${total} itens tem produto cotado ainda. Faça o orçamento primeiro.` };
  if (orcados < total)
    return { ...base, mostrar: true, pode: true, alterar: false, aviso: `${orcados} de ${total} itens orçados: o cadastro leva só os orçados.` };
  return { ...base, mostrar: true, pode: true, alterar: false };
}

/** Botão do card do quadro e da ficha. */
export function BotaoUmClique({
  licitacaoId,
  compacto = false,
  cadastrada = false,
  aoFechar,
}: {
  licitacaoId: number;
  compacto?: boolean;
  /** Já há proposta no Compras.gov.br: o botão vira "Alterar". */
  cadastrada?: boolean;
  aoFechar?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        className={`${compacto ? "botao-um-clique" : cadastrada ? "botao secundario" : "botao acento"} ${cadastrada ? "cadastrada" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setAberto(true);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        title={cadastrada ? "Proposta já cadastrada no Compras.gov.br: alterar ou retirar" : "Cadastrar a proposta no Compras.gov.br com os itens do orçamento"}
      >
        {cadastrada ? <Pencil size={compacto ? 13 : 16} /> : <Zap size={compacto ? 13 : 16} />}{" "}
        {cadastrada ? (compacto ? "Alterar no Compras" : "Alterar proposta no Compras.gov.br") : compacto ? "Cadastrar" : "Cadastrar no Compras.gov.br"}
      </button>
      {aberto && (
        <span
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <CadastroUmClique
            licitacaoId={licitacaoId}
            aoFechar={() => {
              setAberto(false);
              aoFechar?.();
            }}
          />
        </span>
      )}
    </>
  );
}
