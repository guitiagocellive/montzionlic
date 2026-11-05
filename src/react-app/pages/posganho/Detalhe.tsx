import {
  ArrowLeft,
  Building,
  CalendarCheck,
  FolderOpen,
  Gavel,
  MessageSquare,
  FileSignature,
  Package,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  calcularPreco,
  diasAte,
  ETAPAS_ANTES_DA_ENTREGA,
  ETAPAS_EXECUCAO,
  somarPrazo,
  type TipoPrazo,
} from "../../../shared/negocio";
import { podeEditar } from "../../../shared/permissoes";
import type { Arquivo, Execucao, ItemExecucao, Usuario } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { AbaArquivos } from "../../components/AbaArquivos";
import { PainelAtividade } from "../../components/Atividade";
import { Etapas } from "../../components/Etapas";
import { Campo } from "../../components/Formulario";
import { avisar, CampoArea, CampoSelect, Carregando, Interruptor, Vazio } from "../../components/Ui";
import { useFormulario } from "../../components/useFormulario";
import { formatarData, formatarMoeda, formatarNumero, hojeIso, paraNumero, textoPrazo } from "../../formato";
import { link, navegar } from "../../rota";

interface Ficha {
  execucao: Execucao;
  licitacao: {
    id: number;
    numero: string | null;
    uasg: string | null;
    orgao: string | null;
    objeto: string | null;
    modalidade: string | null;
    registro_preco: number;
    imposto_percentual: number;
    lucro_percentual: number;
  };
  itens: ItemExecucao[];
  itensLicitacao: { id: number; numero: string | null; descricao: string | null; quantidade: number | null; unidade: string | null }[];
  cotacoes: { id: number; item_id: number | null; produto: string | null; marca: string | null; custo_unitario: number | null; frete: number | null }[];
  arquivos: Arquivo[];
  atas: AtaDisponivel[];
}

interface AtaDisponivel {
  id: number;
  nome: string | null;
  numero_ata: string | null;
  licitacao_id: number | null;
  orgao_gerenciador: string | null;
  data_fim: string | null;
  itens: {
    id: number;
    item_numero: string | null;
    produto: string | null;
    unidade: string | null;
    quantidade: number | null;
    valor_unitario: number | null;
    empenhado: number;
    empenhado_aqui: number;
  }[];
}

function valoresIniciais(e: Execucao) {
  return {
    numero_empenho: e.numero_empenho ?? "",
    data_empenho: e.data_empenho ?? "",
    prazo_dias: e.prazo_dias == null ? "" : String(e.prazo_dias),
    prazo_tipo: e.prazo_tipo,
    registro_preco: e.registro_preco === 1,
    fat_razao_social: e.fat_razao_social ?? "",
    fat_cnpj: e.fat_cnpj ?? "",
    fat_endereco: e.fat_endereco ?? "",
    fat_email: e.fat_email ?? "",
    fat_telefone: e.fat_telefone ?? "",
    observacoes: e.observacoes ?? "",
    nota_fiscal: e.nota_fiscal ?? "",
    data_nota: e.data_nota ?? "",
    frete: e.frete == null ? "" : String(e.frete),
    outras_despesas: e.outras_despesas == null ? "" : String(e.outras_despesas),
    data_pagamento: e.data_pagamento ?? "",
    valor_recebido: e.valor_recebido == null ? "" : String(e.valor_recebido),
  };
}

export function DetalheExecucao({ id, usuario }: { id: number; usuario: Usuario }) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState("");
  const abaInicial = new URLSearchParams(location.search).get("aba") ?? "empenho";
  const [aba, setAba] = useState(abaInicial === "atividade" ? "empenho" : abaInicial);
  const [atividadeAberta, setAtividadeAberta] = useState(abaInicial === "atividade");
  const [comentarios, setComentarios] = useState(0);

  const carregar = useCallback(async () => {
    try {
      setFicha(await api<Ficha>(`/execucoes/${id}`));
    } catch (err) {
      setErro(mensagemDeErro(err));
    }
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function escolherAba(chave: string) {
    setAba(chave);
    history.replaceState(null, "", `/pos-ganho/${id}?aba=${chave}`);
  }

  async function mudarEtapa(etapa: string) {
    try {
      await api(`/execucoes/${id}`, { metodo: "PATCH", corpo: { etapa } });
      avisar("Etapa atualizada.");
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  async function excluir() {
    if (!confirm("Excluir este empenho e seus arquivos? A licitação continua no quadro de licitações.")) return;
    try {
      await api(`/execucoes/${id}`, { metodo: "DELETE" });
      avisar("Empenho excluído.");
      navegar("/pos-ganho");
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  if (erro) return <div className="alerta erro">{erro}</div>;
  if (!ficha) return <Carregando />;

  const { execucao: e, licitacao: l, itens, arquivos } = ficha;
  const etapa = ETAPAS_EXECUCAO.find((x) => x.chave === e.etapa);
  const valorTotal = itens.reduce((s, i) => s + (i.quantidade ?? 0) * (i.valor_unitario ?? 0), 0);

  const passos = [
    { chave: "empenho", titulo: "Empenho e prazo", descricao: e.data_limite ? `Entrega até ${formatarData(e.data_limite)}` : "Número, data e prazo", icone: CalendarCheck, completo: !!(e.numero_empenho && e.data_limite) },
    { chave: "itens", titulo: "Itens ganhos", descricao: `${itens.length} item(ns) · ${formatarMoeda(valorTotal)}`, icone: Package, completo: itens.length > 0 && itens.every((i) => i.valor_unitario != null) },
    { chave: "faturamento", titulo: "Faturamento", descricao: e.data_pagamento ? "Recebido" : e.nota_fiscal ? `NF ${e.nota_fiscal}` : "Nota fiscal e órgão", icone: Building, completo: !!(e.fat_razao_social && e.fat_cnpj) },
    { chave: "arquivos", titulo: "Arquivos e IA", descricao: `${arquivos.length} arquivo(s)`, icone: FolderOpen, completo: arquivos.some((a) => a.execucao_id) },
  ];

  return (
    <>
      <a className="voltar" {...link("/pos-ganho")}>
        <ArrowLeft aria-hidden="true" /> Empenhos e entregas
      </a>

      <div className="cabecalho-ficha entrar">
        <div className="ficha-titulo">
          <div className="card-etiquetas">
            <span className="chip etapa-chip" style={{ ["--cor-etapa" as string]: etapa?.cor }}>
              {etapa?.nome}
            </span>
            {e.registro_preco === 1 && <span className="chip destaque">Registro de preço</span>}
          </div>
          <h1>{e.numero_empenho ? `Empenho ${e.numero_empenho}` : "Empenho sem número"}</h1>
          <p className="texto-suave">
            {l.orgao || "Órgão não informado"} ·{" "}
            <a {...link(`/licitacoes/${l.id}`)} className="link-suave">
              <Gavel size={14} aria-hidden="true" /> Licitação nº {l.numero || "—"}
            </a>
          </p>
        </div>
        <div className="ficha-acoes">
          <select
            value={e.etapa}
            onChange={(ev) => mudarEtapa(ev.target.value)}
            aria-label="Mover para etapa"
            disabled={!podeEditar(usuario.permissoes, "posganho")}
          >
            {ETAPAS_EXECUCAO.map((x) => (
              <option key={x.chave} value={x.chave}>
                {x.nome}
              </option>
            ))}
          </select>
          <button className="botao secundario" onClick={() => setAtividadeAberta(true)}>
            <MessageSquare /> Atividade{comentarios > 0 && <span className="chip destaque">{comentarios}</span>}
          </button>
          {usuario.papel === "admin" && (
            <button className="botao-icone perigo" onClick={excluir} aria-label="Excluir empenho" title="Excluir">
              <Trash2 />
            </button>
          )}
        </div>
      </div>

      <Etapas passos={passos} atual={aba} aoEscolher={escolherAba} />

      <div key={aba} className="entrar">
        {(aba === "empenho" || aba === "faturamento") && (
          <FormEmpenho execucao={e} parte={aba} aoSalvar={carregar} />
        )}
        {aba === "itens" && <AbaItensGanhos ficha={ficha} aoSalvar={carregar} />}
        {aba === "arquivos" && (
          <AbaArquivos
            podeAssinar={podeEditar(usuario.permissoes, "assinatura")}
            arquivos={arquivos}
            destino={{ execucao_id: e.id }}
            tipoAnalise="empenho"
            rotuloHerdados="Arquivos da licitação"
            aoMudar={carregar}
            aoAplicarDados={async (dados) => {
              await api(`/execucoes/${e.id}`, { metodo: "PATCH", corpo: dados });
              await carregar();
            }}
            aoImportarItens={async (lista) => {
              const novos = lista.map((i) => {
                const doEdital = ficha.itensLicitacao.find((x) => x.numero && x.numero === i.item_numero);
                return { ...i, item_id: doEdital?.id ?? null };
              });
              await api(`/execucoes/${e.id}`, { metodo: "PATCH", corpo: { itens: [...itens, ...novos] } });
              await carregar();
            }}
          />
        )}
      </div>

      <PainelAtividade
        alvo={{ execucao_id: e.id }}
        usuario={usuario}
        aberto={atividadeAberta}
        aoFechar={() => setAtividadeAberta(false)}
        aoContar={setComentarios}
      />
    </>
  );
}

function FormEmpenho({
  execucao,
  parte,
  aoSalvar,
}: {
  execucao: Execucao;
  parte: "empenho" | "faturamento";
  aoSalvar: () => Promise<void>;
}) {
  const form = useFormulario(valoresIniciais(execucao));
  const [salvando, setSalvando] = useState(false);
  const v = form.valores;

  useEffect(() => {
    form.reiniciar(valoresIniciais(execucao));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execucao]);

  const texto = (campo: keyof typeof v) => ({
    name: campo,
    value: v[campo] as string,
    onChange: (e: { target: { value: string } }) => form.definir(campo, e.target.value as never),
  });

  const prazo = paraNumero(v.prazo_dias);
  const limite =
    v.data_empenho && prazo != null ? somarPrazo(v.data_empenho, Math.round(prazo), v.prazo_tipo as TipoPrazo) : null;
  const dias = limite ? diasAte(limite, hojeIso()) : null;
  const pendente = ETAPAS_ANTES_DA_ENTREGA.includes(execucao.etapa);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const corpo: Record<string, unknown> = { ...form.alterados };
    if ("prazo_dias" in corpo) corpo.prazo_dias = prazo == null ? null : Math.round(prazo);
    for (const campo of ["frete", "outras_despesas", "valor_recebido"]) {
      if (campo in corpo) corpo[campo] = paraNumero(String(corpo[campo] ?? ""));
    }
    setSalvando(true);
    try {
      await api(`/execucoes/${execucao.id}`, { metodo: "PATCH", corpo });
      avisar("Empenho salvo.");
      await aoSalvar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="formulario" onSubmit={salvar}>
      {parte === "empenho" ? (
        <>
          <section className="cartao">
            <h2>Empenho</h2>
            <div className="grade-2">
              <Campo rotulo="Número do empenho" placeholder="2026NE000123" {...texto("numero_empenho")} />
              <Campo rotulo="Data de recebimento do empenho" type="date" {...texto("data_empenho")} />
            </div>
            <Interruptor
              rotulo="Empenho de registro de preço (SRP)"
              ligado={v.registro_preco}
              aoMudar={(ligado) => form.definir("registro_preco", ligado)}
            />
          </section>

          <section className="cartao">
            <h2>Prazo de entrega</h2>
            <div className="grade-3">
              <Campo rotulo="Prazo (dias)" type="number" min="0" step="1" placeholder="15" {...texto("prazo_dias")} />
              <CampoSelect
                rotulo="Tipo de prazo"
                opcoes={[
                  { valor: "corridos", texto: "Dias corridos" },
                  { valor: "uteis", texto: "Dias úteis" },
                ]}
                {...texto("prazo_tipo")}
              />
              <div className={`prazo-calculado ${pendente && dias != null ? (dias < 0 ? "passou" : dias <= 2 ? "urgente" : dias <= 7 ? "proximo" : "ok") : ""}`}>
                <span>Entregar até</span>
                <strong>{limite ? formatarData(limite) : "—"}</strong>
                {limite && dias != null && pendente && <small>{dias < 0 ? `Atrasado ${-dias} dia(s)` : textoPrazo(dias)}</small>}
              </div>
            </div>
            <p className="texto-fraco pequeno" style={{ margin: 0 }}>
              Em dias úteis, sábados e domingos são pulados (feriados não são considerados).
            </p>
          </section>

          <section className="cartao">
            <h2>Observações</h2>
            <CampoArea rotulo="Anotações" rows={3} {...texto("observacoes")} />
          </section>
        </>
      ) : (
        <>
        <section className="cartao">
          <h2>Nota fiscal e recebimento</h2>
          <p className="descricao">Alimenta o Financeiro: a faturar, a receber, recebido e o lucro de cada empenho.</p>
          <div className="grade-3">
            <Campo rotulo="Nº da nota fiscal" {...texto("nota_fiscal")} />
            <Campo rotulo="Data da nota" type="date" {...texto("data_nota")} />
            <Campo rotulo="Data do pagamento" type="date" {...texto("data_pagamento")} />
          </div>
          <div className="grade-3">
            <Campo rotulo="Valor recebido (R$)" type="number" step="0.01" min="0" placeholder="Vazio = valor do empenho" {...texto("valor_recebido")} />
            <Campo rotulo="Frete pago (R$)" type="number" step="0.01" min="0" {...texto("frete")} />
            <Campo rotulo="Outras despesas (R$)" type="number" step="0.01" min="0" {...texto("outras_despesas")} />
          </div>
        </section>
        <section className="cartao">
          <h2>Dados de faturamento do órgão</h2>
          <div className="grade-2">
            <Campo rotulo="Razão social" {...texto("fat_razao_social")} />
            <Campo rotulo="CNPJ" {...texto("fat_cnpj")} />
          </div>
          <Campo rotulo="Endereço de entrega / faturamento" {...texto("fat_endereco")} />
          <div className="grade-2">
            <Campo rotulo="E-mail" type="email" {...texto("fat_email")} />
            <Campo rotulo="Telefone" {...texto("fat_telefone")} />
          </div>
        </section>
        </>
      )}

      <div className={`barra-salvar ${form.sujo ? "visivel" : ""}`}>
        <span>Você tem alterações não salvas.</span>
        <button type="button" className="botao secundario" onClick={() => form.reiniciar(valoresIniciais(execucao))}>
          Descartar
        </button>
        <button className="botao" disabled={salvando || !form.sujo}>
          <Save aria-hidden="true" /> {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}

type Linha = {
  ata_item_id: string;
  item_id: string;
  item_numero: string;
  produto: string;
  quantidade: string;
  valor_unitario: string;
  custo_unitario: string;
};

const paraLinha = (i: ItemExecucao): Linha => ({
  ata_item_id: i.ata_item_id == null ? "" : String(i.ata_item_id),
  item_id: i.item_id == null ? "" : String(i.item_id),
  item_numero: i.item_numero ?? "",
  produto: i.produto ?? "",
  quantidade: i.quantidade == null ? "" : String(i.quantidade),
  valor_unitario: i.valor_unitario == null ? "" : String(i.valor_unitario),
  custo_unitario: i.custo_unitario == null ? "" : String(i.custo_unitario),
});

function AbaItensGanhos({ ficha, aoSalvar }: { ficha: Ficha; aoSalvar: () => Promise<void> }) {
  const [linhas, setLinhas] = useState<Linha[]>(() => ficha.itens.map(paraLinha));
  const [ataId, setAtaId] = useState(ficha.execucao.ata_id ? String(ficha.execucao.ata_id) : "");
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setLinhas(ficha.itens.map(paraLinha));
    setAtaId(ficha.execucao.ata_id ? String(ficha.execucao.ata_id) : "");
    setSujo(false);
  }, [ficha.itens, ficha.execucao.ata_id]);

  const ata = ficha.atas.find((a) => String(a.id) === ataId) ?? null;
  const sugerida = !ficha.execucao.ata_id ? ficha.atas.find((a) => a.licitacao_id === ficha.licitacao.id) : null;

  /** Saldo do item da ata disponível para esta linha (descontando outras linhas deste empenho). */
  function saldoDaLinha(i: number): number | null {
    const l = linhas[i];
    const item = ata?.itens.find((x) => String(x.id) === l.ata_item_id);
    if (!item) return null;
    const outrasLinhas = linhas.reduce((s, x, j) => (j !== i && x.ata_item_id === l.ata_item_id ? s + (paraNumero(x.quantidade) ?? 0) : s), 0);
    return (item.quantidade ?? 0) - item.empenhado + item.empenhado_aqui - outrasLinhas;
  }

  function escolherItemAta(i: number, ataItemId: string) {
    const item = ata?.itens.find((x) => String(x.id) === ataItemId);
    if (!item) {
      mudar(i, { ata_item_id: "" });
      return;
    }
    const doEdital = ficha.itensLicitacao.find((x) => x.numero && x.numero === item.item_numero);
    mudar(i, {
      ata_item_id: ataItemId,
      item_numero: item.item_numero ?? linhas[i].item_numero,
      item_id: doEdital ? String(doEdital.id) : linhas[i].item_id,
      produto: item.produto ?? linhas[i].produto,
      valor_unitario: item.valor_unitario == null ? linhas[i].valor_unitario : String(item.valor_unitario),
    });
  }

  const excedidos = linhas.map((_, i) => saldoDaLinha(i)).some((s, i) => s != null && (paraNumero(linhas[i].quantidade) ?? 0) > s + 1e-9);

  function mudar(i: number, novo: Partial<Linha>) {
    setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...novo } : l)));
    setSujo(true);
  }

  function escolherItem(i: number, itemId: string) {
    const item = ficha.itensLicitacao.find((x) => String(x.id) === itemId);
    mudar(i, {
      item_id: itemId,
      item_numero: item?.numero ?? "",
      quantidade: item?.quantidade == null ? linhas[i].quantidade : String(item.quantidade),
    });
  }

  function escolherCotacao(i: number, cotacaoId: string) {
    const c = ficha.cotacoes.find((x) => String(x.id) === cotacaoId);
    if (!c) return;
    const item = ficha.itensLicitacao.find((x) => x.id === c.item_id);
    const calc = calcularPreco({
      custoUnitario: c.custo_unitario ?? 0,
      frete: c.frete ?? 0,
      quantidade: item?.quantidade ?? 1,
      impostoPercentual: 0,
      lucroPercentual: 0,
    });
    mudar(i, {
      produto: [c.produto, c.marca].filter(Boolean).join(" — "),
      custo_unitario: calc.custoUnitarioComFrete.toFixed(2),
    });
  }

  async function salvar() {
    setSalvando(true);
    try {
      await api(`/execucoes/${ficha.execucao.id}`, {
        metodo: "PATCH",
        corpo: {
          ata_id: ataId ? Number(ataId) : null,
          itens: linhas.map((l) => ({
            ata_item_id: ataId && l.ata_item_id ? Number(l.ata_item_id) : null,
            item_id: l.item_id ? Number(l.item_id) : null,
            item_numero: l.item_numero,
            produto: l.produto,
            quantidade: paraNumero(l.quantidade),
            valor_unitario: paraNumero(l.valor_unitario),
            custo_unitario: paraNumero(l.custo_unitario),
          })),
        },
      });
      avisar("Itens ganhos salvos.");
      await aoSalvar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setSalvando(false);
    }
  }

  const imposto = ficha.licitacao.imposto_percentual / 100;
  let totalVenda = 0;
  let totalLucro = 0;

  return (
    <>
      <section className="cartao">
        <div className="cartao-titulo">
          <h2>
            <Package size={18} color="#f0abfc" aria-hidden="true" /> Itens ganhos
          </h2>
          <button
            className="botao secundario"
            onClick={() => {
              setLinhas((ls) => [...ls, { ata_item_id: "", item_id: "", item_numero: "", produto: "", quantidade: "", valor_unitario: "", custo_unitario: "" }]);
              setSujo(true);
            }}
          >
            <Plus aria-hidden="true" /> Adicionar item
          </button>
        </div>
        <div className="seletor-ata">
          <span className="icone-redondo info">
            <FileSignature />
          </span>
          <div className="seletor-ata-texto">
            <strong>Ata de registro de preço</strong>
            <span className="texto-fraco pequeno">Se este empenho é de uma ata, escolha a ata e o item: o saldo é descontado sozinho.</span>
          </div>
          <select
            value={ataId}
            onChange={(e) => {
              setAtaId(e.target.value);
              if (!e.target.value) setLinhas((ls) => ls.map((l) => ({ ...l, ata_item_id: "" })));
              setSujo(true);
            }}
            aria-label="Ata de registro de preço"
          >
            <option value="">Não é de ata</option>
            {ficha.atas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome || `Ata ${a.numero_ata ?? ""}`}
                {a.data_fim ? ` · até ${formatarData(a.data_fim)}` : ""}
              </option>
            ))}
          </select>
        </div>
        {sugerida && !ataId && (
          <p className="dica-ia" style={{ margin: "10px 0 0" }}>
            Existe uma ata desta licitação ({sugerida.nome || `Ata ${sugerida.numero_ata ?? ""}`}).{" "}
            <button className="botao link" onClick={() => { setAtaId(String(sugerida.id)); setSujo(true); }}>
              Usar esta ata
            </button>
          </p>
        )}
        <p className="texto-fraco pequeno" style={{ marginTop: 12 }}>
          Escolha o item do edital e o produto cotado. Informe o valor unitário que ganhamos. O lucro desconta{" "}
          {formatarNumero(ficha.licitacao.imposto_percentual)}% de impostos.
        </p>

        {linhas.length === 0 ? (
          <Vazio icone={<Package />} titulo="Nenhum item ganho informado" />
        ) : (
          <div className="itens-ganhos">
            {linhas.map((l, i) => {
              const qtd = paraNumero(l.quantidade) ?? 0;
              const venda = paraNumero(l.valor_unitario);
              const custo = paraNumero(l.custo_unitario);
              const total = venda == null ? null : venda * qtd;
              const lucro = venda == null || custo == null ? null : (venda * (1 - imposto) - custo) * qtd;
              totalVenda += total ?? 0;
              totalLucro += lucro ?? 0;
              const cotacoesDoItem = ficha.cotacoes.filter((c) => String(c.item_id) === l.item_id);
              const saldo = saldoDaLinha(i);
              return (
                <div key={i} className={`linha-ganho ${saldo != null && (paraNumero(l.quantidade) ?? 0) > saldo + 1e-9 ? "sem-saldo" : ""}`}>
                  {ata && (
                    <div className="item-ata-linha">
                      <CampoSelect
                        rotulo="Item da ata"
                        value={l.ata_item_id}
                        onChange={(e) => escolherItemAta(i, e.target.value)}
                        vazio="Escolha o item da ata"
                        opcoes={ata.itens.map((x) => ({
                          valor: String(x.id),
                          texto: `${x.item_numero ?? "—"} · ${(x.produto ?? "").slice(0, 50)} — saldo ${formatarNumero((x.quantidade ?? 0) - x.empenhado + x.empenhado_aqui)}`,
                        }))}
                      />
                      {saldo != null && (
                        <span className={`selo ${(paraNumero(l.quantidade) ?? 0) > saldo + 1e-9 ? "vermelho" : "verde"}`}>
                          Pode empenhar até {formatarNumero(Math.max(0, saldo))}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="grade-ganho">
                    <CampoSelect
                      rotulo="Item do edital"
                      value={l.item_id}
                      onChange={(e) => escolherItem(i, e.target.value)}
                      vazio="Selecione"
                      opcoes={ficha.itensLicitacao.map((x) => ({
                        valor: String(x.id),
                        texto: `${x.numero ?? "—"} · ${(x.descricao ?? "").slice(0, 60)}`,
                      }))}
                    />
                    <CampoSelect
                      rotulo="Produto cotado"
                      value=""
                      onChange={(e) => escolherCotacao(i, e.target.value)}
                      vazio={cotacoesDoItem.length ? "Usar uma cotação…" : "Sem cotações"}
                      disabled={!cotacoesDoItem.length}
                      opcoes={cotacoesDoItem.map((c) => ({
                        valor: String(c.id),
                        texto: `${c.produto ?? "Produto"}${c.marca ? ` — ${c.marca}` : ""} (${formatarMoeda(c.custo_unitario)})`,
                      }))}
                    />
                    <Campo rotulo="Produto entregue" name={`produto-${i}`} value={l.produto} onChange={(e) => mudar(i, { produto: e.target.value })} />
                  </div>
                  <div className="grade-ganho numeros">
                    <Campo rotulo="Quantidade" name={`qtd-${i}`} type="number" step="any" min="0" value={l.quantidade} onChange={(e) => mudar(i, { quantidade: e.target.value })} />
                    <Campo rotulo="Valor ganho (unit.)" name={`venda-${i}`} type="number" step="0.01" min="0" value={l.valor_unitario} onChange={(e) => mudar(i, { valor_unitario: e.target.value })} />
                    <Campo rotulo="Custo (unit.)" name={`custo-${i}`} type="number" step="0.01" min="0" value={l.custo_unitario} onChange={(e) => mudar(i, { custo_unitario: e.target.value })} />
                    <div className="valor-calculado">
                      <span>Total</span>
                      <strong>{formatarMoeda(total)}</strong>
                    </div>
                    <div className="valor-calculado">
                      <span>Lucro</span>
                      <strong className={lucro != null && lucro < 0 ? "texto-vermelho" : "texto-verde"}>{formatarMoeda(lucro)}</strong>
                    </div>
                    <button
                      className="botao-icone perigo"
                      onClick={() => {
                        setLinhas((ls) => ls.filter((_, j) => j !== i));
                        setSujo(true);
                      }}
                      aria-label="Remover item"
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="resumo-linha">
        <div className="mini-indicador">
          <span>Valor total do empenho</span>
          <strong className="texto-gradiente">{formatarMoeda(totalVenda)}</strong>
        </div>
        <div className="mini-indicador">
          <span>Lucro previsto (após impostos)</span>
          <strong className={totalLucro < 0 ? "texto-vermelho" : "texto-verde"}>{formatarMoeda(totalLucro)}</strong>
        </div>
      </div>

      <div className={`barra-salvar ${sujo ? "visivel" : ""}`}>
        <span>Você tem alterações não salvas.</span>
        <button
          type="button"
          className="botao secundario"
          onClick={() => {
            setLinhas(ficha.itens.map(paraLinha));
            setSujo(false);
          }}
        >
          Descartar
        </button>
        <button className="botao" onClick={salvar} disabled={salvando || excedidos}>
          <Save aria-hidden="true" /> {salvando ? "Salvando…" : excedidos ? "Quantidade acima do saldo" : "Salvar itens"}
        </button>
      </div>
    </>
  );
}
