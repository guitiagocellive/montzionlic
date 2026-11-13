import { Calculator, Copy, Crown, FileText, Info, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { calcularPreco, type CalculoPreco, cotacaoDaProposta } from "../../../shared/negocio";
import type { Cotacao, Fornecedor, ItemLicitacao, Licitacao } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Alerta, Campo } from "../../components/Formulario";
import { avisar, CampoArea, CampoSelect, Modal, Vazio } from "../../components/Ui";
import { formatarMoeda, formatarNumero, paraNumero } from "../../formato";

interface Props {
  licitacao: Licitacao;
  itens: ItemLicitacao[];
  cotacoes: Cotacao[];
  aoMudar: () => Promise<void> | void;
}

export function AbaOrcamento({ licitacao, itens, cotacoes, aoMudar }: Props) {
  const [lucro, setLucro] = useState(String(licitacao.lucro_percentual));
  const [imposto, setImposto] = useState(String(licitacao.imposto_percentual));
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [modal, setModal] = useState<{ item: ItemLicitacao; cotacao: Cotacao | null } | null>(null);
  const [editandoParametros, setEditandoParametros] = useState(false);

  useEffect(() => {
    api<{ fornecedores: Fornecedor[] }>("/fornecedores").then((r) => setFornecedores(r.fornecedores), () => {});
  }, []);

  useEffect(() => {
    setLucro(String(licitacao.lucro_percentual));
    setImposto(String(licitacao.imposto_percentual));
  }, [licitacao.lucro_percentual, licitacao.imposto_percentual]);

  const lucroN = paraNumero(lucro) ?? 0;
  const impostoN = paraNumero(imposto) ?? 0;
  const parametrosMudaram =
    lucroN !== licitacao.lucro_percentual || impostoN !== licitacao.imposto_percentual;

  async function salvarParametros() {
    try {
      await api(`/licitacoes/${licitacao.id}`, {
        metodo: "PATCH",
        corpo: { lucro_percentual: lucroN, imposto_percentual: impostoN },
      });
      avisar("Parâmetros salvos.");
      await aoMudar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  async function excluir(c: Cotacao) {
    if (!confirm(`Excluir a cotação "${c.produto ?? ""}"?`)) return;
    try {
      await api(`/licitacoes/cotacoes/${c.id}`, { metodo: "DELETE" });
      await aoMudar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  async function usarNaProposta(c: Cotacao) {
    try {
      await api(`/licitacoes/cotacoes/${c.id}`, { metodo: "PATCH", corpo: { escolhida: true } });
      avisar(`"${c.produto ?? "Produto"}" vai na proposta.`);
      await aoMudar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  const calcular = (c: Cotacao, item: ItemLicitacao) =>
    calcularPreco({
      custoUnitario: c.custo_unitario ?? 0,
      frete: c.frete ?? 0,
      quantidade: item.quantidade ?? 1,
      impostoPercentual: impostoN,
      lucroPercentual: lucroN,
    });

  const itensVisiveis = itens.filter((i) => i.participar || cotacoes.some((c) => c.item_id === i.id));

  // Resumo: considera a cotação que vai na proposta (a marcada, ou a mais barata) de cada item.
  let totalVenda = 0;
  let totalCusto = 0;
  let totalLucro = 0;
  let itensCotados = 0;
  for (const item of itensVisiveis) {
    const escolhida = cotacaoDaProposta(cotacoes, item, impostoN, lucroN);
    if (!escolhida) continue;
    const melhor = escolhida.calculo;
    totalVenda += melhor.totalVenda;
    totalCusto += melhor.totalCusto;
    totalLucro += melhor.lucroTotal;
    itensCotados++;
  }
  const invalido = impostoN + lucroN >= 100;

  return (
    <>
      {/* Parâmetros numa linha só; os números do orçamento ficam no cartão Financeiro e no rodapé. */}
      <section className="cartao parametros parametros-compacto">
        <div className="parametros-linha">
          <span>
            <strong className="titulo-orcamento">Orçamento</strong>
            <span className="texto-fraco pequeno">
              Impostos {formatarNumero(licitacao.imposto_percentual)}% · lucro {formatarNumero(licitacao.lucro_percentual)}% · frete dividido pela quantidade
            </span>
          </span>
          <span className="texto-fraco pequeno parametros-cotados">
            {itensCotados}/{itensVisiveis.length} itens cotados
          </span>
          <button className="botao secundario pequeno" onClick={() => setEditandoParametros((v) => !v)} aria-expanded={editandoParametros}>
            {editandoParametros ? "Fechar" : "Parâmetros"}
          </button>
        </div>
        {editandoParametros && (
          <>
            <div className="parametros-grade">
              <Campo rotulo="Lucro desejado (%)" name="lucro" type="number" step="0.1" min="0" value={lucro} onChange={(e) => setLucro(e.target.value)} />
              <Campo rotulo="Impostos sobre a venda (%)" name="imposto" type="number" step="0.01" min="0" value={imposto} onChange={(e) => setImposto(e.target.value)} />
              <button className="botao" onClick={salvarParametros} disabled={!parametrosMudaram || invalido}>
                Salvar parâmetros
              </button>
            </div>
            <p className="explicacao">
              <Info aria-hidden="true" />
              <span>
                Preço de venda = custo unitário com frete ÷ (1 − impostos − lucro). O frete é dividido pela quantidade do item. O <strong>preço mínimo</strong>{" "}
                só cobre custo e impostos (lucro zero).
              </span>
            </p>
            {invalido && <Alerta>Impostos + lucro precisam somar menos de 100%.</Alerta>}
          </>
        )}
      </section>

      {itensVisiveis.length === 0 ? (
        <section className="cartao">
          <Vazio icone={<Calculator />} titulo="Nenhum item para orçar">
            Marque na etapa "Itens" os itens em que a empresa vai participar.
          </Vazio>
        </section>
      ) : (
        itensVisiveis.map((item) => {
          const lista = cotacoes.filter((c) => c.item_id === item.id);
          const calculos = lista.map((c) => ({ c, calc: calcular(c, item) }));
          const melhor = calculos.length
            ? calculos.reduce((a, b) => (b.calc.precoVenda < a.calc.precoVenda ? b : a)).c.id
            : null;
          const naProposta = cotacaoDaProposta(lista, item, impostoN, lucroN)?.cotacao.id ?? null;
          // A que vai para a proposta (a mais vantajosa, ou a que você trocou) vem primeiro, com a coroa.
          calculos.sort((a, b) => Number(b.c.id === naProposta) - Number(a.c.id === naProposta) || a.calc.precoVenda - b.calc.precoVenda);
          return (
            <section key={item.id} className="cartao item-orcamento">
              <div className="item-orcamento-topo">
                <span className="numero-item">{item.numero || "—"}</span>
                <div className="item-orcamento-texto">
                  <p>{item.descricao || "Sem descrição"}</p>
                  <div className="linha-item-meta">
                    <span>
                      Qtd: <strong>{formatarNumero(item.quantidade)}</strong> {item.unidade}
                    </span>
                    <span>
                      Ref. unitária: <strong>{formatarMoeda(item.valor_referencia)}</strong>
                    </span>
                  </div>
                </div>
                <button className="botao secundario" onClick={() => setModal({ item, cotacao: null })}>
                  <Plus aria-hidden="true" /> Cotar produto
                </button>
              </div>

              {calculos.length === 0 ? (
                <p className="texto-fraco pequeno" style={{ margin: "14px 0 0" }}>
                  Nenhum produto cotado para este item ainda.
                </p>
              ) : (
                <div className="cotacoes">
                  {calculos.map(({ c, calc }) => (
                    <LinhaCotacao
                      key={c.id}
                      cotacao={c}
                      calculo={calc}
                      melhor={c.id === melhor}
                      naProposta={c.id === naProposta}
                      varias={calculos.length > 1}
                      aoUsarNaProposta={() => usarNaProposta(c)}
                      referencia={item.valor_referencia}
                      aoEditar={() => setModal({ item, cotacao: c })}
                      aoExcluir={() => excluir(c)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}

      {itensCotados > 0 && (
        <div className="totais-orcamento">
          <span>
            Custo <strong>{formatarMoeda(totalCusto)}</strong>
          </span>
          <span>
            Venda <strong className="texto-azul">{formatarMoeda(totalVenda)}</strong>
          </span>
          <span>
            Lucro <strong className="texto-verde">{formatarMoeda(totalLucro)}</strong>
          </span>
        </div>
      )}

      {modal && (
        <ModalCotacao
          licitacaoId={licitacao.id}
          item={modal.item}
          cotacao={modal.cotacao}
          fornecedores={fornecedores}
          impostoPercentual={impostoN}
          lucroPercentual={lucroN}
          aoFechar={() => setModal(null)}
          aoSalvar={async () => {
            setModal(null);
            await aoMudar();
          }}
        />
      )}
    </>
  );
}

function LinhaCotacao({
  cotacao: c,
  calculo,
  melhor,
  naProposta,
  varias,
  aoUsarNaProposta,
  referencia,
  aoEditar,
  aoExcluir,
}: {
  cotacao: Cotacao;
  calculo: CalculoPreco;
  melhor: boolean;
  naProposta: boolean;
  varias: boolean;
  aoUsarNaProposta: () => void;
  referencia: number | null;
  aoEditar: () => void;
  aoExcluir: () => void;
}) {
  const acimaReferencia = referencia != null && calculo.precoVenda > referencia;
  // Coroa: a cotação que vai para a proposta (a mais vantajosa por padrão). Nas outras, dá para trocar.
  return (
    <div className={`linha-cotacao ${naProposta ? "coroa" : ""} ${varias && !naProposta ? "alternativa" : ""}`}>
      <div className="cotacao-produto">
        <strong>
          {naProposta && (
            <span className="coroa-cotacao" title={melhor ? "Mais vantajosa: vai na proposta" : "Escolhida para a proposta"}>
              <Crown size={15} aria-label={melhor ? "Mais vantajosa, vai na proposta" : "Escolhida para a proposta"} />
            </span>
          )}
          {c.produto || "Produto sem nome"}
        </strong>
        <span className="texto-fraco pequeno">
          {[c.marca, c.fornecedor_cadastrado || c.fornecedor_nome].filter(Boolean).join(" · ") || "Sem fornecedor"}
          {!naProposta && melhor && <span className="texto-verde"> · menor preço</span>}
        </span>
        {c.descricao ? (
          <span className="cotacao-descritivo" title={c.descricao}>
            <FileText size={12} /> {c.descricao}
          </span>
        ) : (
          <button type="button" className="botao-link sem-margem" onClick={aoEditar}>
            <FileText size={12} /> Adicionar descritivo para a proposta
          </button>
        )}
        {!naProposta && (
          <button type="button" className="botao-link sem-margem trocar-coroa" onClick={aoUsarNaProposta}>
            Usar esta na proposta
          </button>
        )}
      </div>
      <div className="cotacao-numeros">
        <div>
          <span>Custo c/ frete</span>
          <strong>{formatarMoeda(calculo.custoUnitarioComFrete)}</strong>
        </div>
        <div>
          <span>Preço mínimo</span>
          <strong>{formatarMoeda(calculo.precoMinimo)}</strong>
        </div>
        <div className="destaque-preco">
          <span>Preço de venda</span>
          <strong>{formatarMoeda(calculo.precoVenda)}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>{formatarMoeda(calculo.totalVenda)}</strong>
        </div>
        <div>
          <span>Lucro</span>
          <strong className="texto-verde">{formatarMoeda(calculo.lucroTotal)}</strong>
        </div>
      </div>
      {acimaReferencia && (
        <span className="selo vermelho" title="O preço de venda passa do valor de referência do edital">
          <TriangleAlert size={13} /> Acima da referência
        </span>
      )}
      <div className="cotacao-acoes">
        <button className="botao-icone" onClick={aoEditar} aria-label="Editar cotação">
          <Pencil />
        </button>
        <button className="botao-icone perigo" onClick={aoExcluir} aria-label="Excluir cotação">
          <Trash2 />
        </button>
      </div>
    </div>
  );
}

function ModalCotacao({
  licitacaoId,
  item,
  cotacao,
  fornecedores,
  impostoPercentual,
  lucroPercentual,
  aoFechar,
  aoSalvar,
}: {
  licitacaoId: number;
  item: ItemLicitacao;
  cotacao: Cotacao | null;
  fornecedores: Fornecedor[];
  impostoPercentual: number;
  lucroPercentual: number;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [custo, setCusto] = useState(cotacao?.custo_unitario == null ? "" : String(cotacao.custo_unitario));
  const [frete, setFrete] = useState(cotacao?.frete == null ? "" : String(cotacao.frete));
  const [fornecedorId, setFornecedorId] = useState(cotacao?.fornecedor_id ? String(cotacao.fornecedor_id) : "");
  const [descritivo, setDescritivo] = useState(cotacao?.descricao ?? "");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const previa = calcularPreco({
    custoUnitario: paraNumero(custo) ?? 0,
    frete: paraNumero(frete) ?? 0,
    quantidade: item.quantidade ?? 1,
    impostoPercentual,
    lucroPercentual,
  });

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const corpo = {
      item_id: item.id,
      produto: f.get("produto"),
      marca: f.get("marca"),
      fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
      fornecedor_nome: fornecedorId ? null : f.get("fornecedor_nome"),
      custo_unitario: paraNumero(custo),
      frete: paraNumero(frete),
      observacoes: f.get("observacoes"),
      descricao: descritivo,
    };
    setErro("");
    setEnviando(true);
    try {
      if (cotacao) await api(`/licitacoes/cotacoes/${cotacao.id}`, { metodo: "PATCH", corpo });
      else await api(`/licitacoes/${licitacaoId}/cotacoes`, { corpo });
      avisar(cotacao ? "Cotação atualizada." : "Produto cotado.");
      aoSalvar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={`Cotar item ${item.numero ?? ""}`} aoFechar={aoFechar} largo>
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <div className="grade-2">
          <Campo rotulo="Produto" name="produto" defaultValue={cotacao?.produto ?? ""} required autoFocus />
          <Campo rotulo="Marca / modelo" name="marca" defaultValue={cotacao?.marca ?? ""} />
        </div>
        <div className="grade-2">
          <CampoSelect
            rotulo="Fornecedor cadastrado"
            value={fornecedorId}
            onChange={(e) => setFornecedorId(e.target.value)}
            vazio="Outro (digitar ao lado)"
            opcoes={fornecedores.map((f) => ({
              valor: String(f.id),
              texto: f.nicho ? `${f.nome} · ${f.nicho}` : f.nome,
            }))}
          />
          {!fornecedorId && (
            <Campo rotulo="Nome do fornecedor" name="fornecedor_nome" defaultValue={cotacao?.fornecedor_nome ?? ""} />
          )}
        </div>
        <div className="grade-3">
          <Campo
            rotulo="Custo unitário (R$)"
            name="custo"
            type="number"
            step="0.01"
            min="0"
            value={custo}
            onChange={(e) => setCusto(e.target.value)}
            required
          />
          <Campo
            rotulo="Frete total (R$)"
            name="frete"
            type="number"
            step="0.01"
            min="0"
            value={frete}
            onChange={(e) => setFrete(e.target.value)}
          />
          <Campo
            rotulo="Quantidade (do edital)"
            name="quantidade"
            value={`${formatarNumero(item.quantidade)} ${item.unidade ?? ""}`}
            readOnly
          />
        </div>
        <div className="campo-descritivo">
          <CampoArea
            rotulo="Descritivo do produto (vai na proposta)"
            name="descricao"
            rows={4}
            value={descritivo}
            onChange={(e) => setDescritivo(e.target.value)}
            placeholder="Descrição do produto que você está ofertando: características, modelo, embalagem…"
          />
          {item.descricao && (
            <button type="button" className="botao-link sem-margem" onClick={() => setDescritivo(item.descricao ?? "")}>
              <Copy size={12} /> Começar pela descrição do edital
            </button>
          )}
        </div>
        <CampoArea rotulo="Observações (internas, não vão na proposta)" name="observacoes" rows={2} defaultValue={cotacao?.observacoes ?? ""} />

        <div className="previa-preco">
          <div>
            <span>Preço mínimo</span>
            <strong>{formatarMoeda(previa.precoMinimo)}</strong>
          </div>
          <div className="destaque-preco">
            <span>Preço de venda ({formatarNumero(lucroPercentual)}% de lucro)</span>
            <strong>{formatarMoeda(previa.precoVenda)}</strong>
          </div>
          <div>
            <span>Lucro total</span>
            <strong className="texto-verde">{formatarMoeda(previa.lucroTotal)}</strong>
          </div>
        </div>

        <div className="botoes-modal">
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar cotação"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
