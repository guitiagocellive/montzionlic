import { CheckSquare, FileSearch, ListPlus, RefreshCw, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { AnaliseIA } from "../../shared/tipos";
import { mensagemDeErro } from "../api";
import { formatarData, formatarMoeda, formatarNumero } from "../formato";
import { avisar, Modal } from "./Ui";

type Formato = "texto" | "data" | "hora" | "numero" | "bool" | "inteiro" | "prazo";

const CAMPOS: Record<AnaliseIA["tipo"], { campo: string; rotulo: string; formato: Formato }[]> = {
  edital: [
    { campo: "numero", rotulo: "Número", formato: "texto" },
    { campo: "uasg", rotulo: "UASG", formato: "texto" },
    { campo: "orgao", rotulo: "Órgão", formato: "texto" },
    { campo: "modalidade", rotulo: "Modalidade", formato: "texto" },
    { campo: "objeto", rotulo: "Objeto", formato: "texto" },
    { campo: "data_sessao", rotulo: "Data da sessão", formato: "data" },
    { campo: "horario", rotulo: "Horário", formato: "hora" },
    { campo: "portal", rotulo: "Portal", formato: "texto" },
    { campo: "registro_preco", rotulo: "Registro de preço", formato: "bool" },
    { campo: "valor_estimado", rotulo: "Valor estimado", formato: "numero" },
  ],
  empenho: [
    { campo: "numero_empenho", rotulo: "Nº do empenho", formato: "texto" },
    { campo: "data_empenho", rotulo: "Data do empenho", formato: "data" },
    { campo: "prazo_dias", rotulo: "Prazo de entrega (dias)", formato: "inteiro" },
    { campo: "prazo_tipo", rotulo: "Tipo de prazo", formato: "prazo" },
    { campo: "fat_razao_social", rotulo: "Razão social (faturamento)", formato: "texto" },
    { campo: "fat_cnpj", rotulo: "CNPJ", formato: "texto" },
    { campo: "fat_endereco", rotulo: "Endereço", formato: "texto" },
    { campo: "fat_email", rotulo: "E-mail", formato: "texto" },
    { campo: "fat_telefone", rotulo: "Telefone", formato: "texto" },
  ],
};

/** Confere o valor que a IA devolveu e converte para o formato do sistema. */
function limpar(valor: unknown, formato: Formato): unknown {
  if (valor == null || valor === "") return undefined;
  switch (formato) {
    case "data":
      return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : undefined;
    case "hora": {
      const m = typeof valor === "string" ? valor.match(/^(\d{1,2})[:h](\d{2})/) : null;
      return m ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined;
    }
    case "numero":
    case "inteiro": {
      const n = typeof valor === "number" ? valor : Number(String(valor).replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(n)) return undefined;
      return formato === "inteiro" ? Math.round(n) : n;
    }
    case "bool":
      return typeof valor === "boolean" ? valor : undefined;
    case "prazo":
      return valor === "uteis" || valor === "corridos" ? valor : undefined;
    default:
      return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : undefined;
  }
}

function exibir(valor: unknown, formato: Formato): string {
  if (formato === "data") return formatarData(valor as string);
  if (formato === "bool") return valor ? "Sim" : "Não";
  if (formato === "numero") return formatarMoeda(valor as number);
  if (formato === "prazo") return valor === "uteis" ? "Dias úteis" : "Dias corridos";
  return String(valor);
}

interface Props {
  nomeArquivo: string;
  analise: AnaliseIA;
  aoFechar: () => void;
  aoRefazer: () => void;
  aoAplicarDados: (dados: Record<string, unknown>) => Promise<void>;
  aoImportarItens: (itens: Record<string, unknown>[]) => Promise<void>;
}

export function ResultadoIA({ nomeArquivo, analise, aoFechar, aoRefazer, aoAplicarDados, aoImportarItens }: Props) {
  const r = analise.resultado;

  const campos = useMemo(
    () =>
      CAMPOS[analise.tipo]
        .map((c) => ({ ...c, valor: limpar(r[c.campo], c.formato) }))
        .filter((c) => c.valor !== undefined),
    [analise, r],
  );

  const itens = useMemo(() => {
    const lista = Array.isArray(r.itens) ? r.itens : [];
    return lista.map((i) =>
      analise.tipo === "edital"
        ? {
            numero: limpar(i.numero, "texto") as string | undefined,
            descricao: limpar(i.descricao, "texto") as string | undefined,
            quantidade: limpar(i.quantidade, "numero") as number | undefined,
            unidade: limpar(i.unidade, "texto") as string | undefined,
            valor_referencia: limpar(i.valor_referencia, "numero") as number | undefined,
          }
        : {
            item_numero: limpar(i.item_numero, "texto") as string | undefined,
            produto: limpar(i.produto, "texto") as string | undefined,
            quantidade: limpar(i.quantidade, "numero") as number | undefined,
            valor_unitario: limpar(i.valor_unitario, "numero") as number | undefined,
          },
    );
  }, [analise, r]);

  const [camposMarcados, setCamposMarcados] = useState(() => new Set(campos.map((c) => c.campo)));
  const [itensMarcados, setItensMarcados] = useState(() => new Set(itens.map((_, i) => i)));
  const [aplicando, setAplicando] = useState(false);

  const alternar = <T,>(conjunto: Set<T>, valor: T, definir: (s: Set<T>) => void) => {
    const novo = new Set(conjunto);
    if (novo.has(valor)) novo.delete(valor);
    else novo.add(valor);
    definir(novo);
  };

  async function aplicarDados() {
    const dados = Object.fromEntries(
      campos.filter((c) => camposMarcados.has(c.campo)).map((c) => [c.campo, c.valor]),
    );
    setAplicando(true);
    try {
      await aoAplicarDados(dados);
      avisar("Dados preenchidos com a leitura da IA.");
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setAplicando(false);
    }
  }

  async function importarItens() {
    const lista = itens.filter((_, i) => itensMarcados.has(i));
    setAplicando(true);
    try {
      await aoImportarItens(lista);
      avisar(`${lista.length} item(ns) importado(s).`);
      aoFechar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setAplicando(false);
    }
  }

  const pontos = Array.isArray(r.pontos_atencao) ? r.pontos_atencao : [];
  const documentos = Array.isArray(r.documentos_habilitacao) ? r.documentos_habilitacao : [];

  return (
    <Modal titulo="Análise da IA" aoFechar={aoFechar} largo>
      <div className="resultado-ia">
        <div className="ia-cabecalho">
          <span className="icone-brilho">
            <Sparkles />
          </span>
          <div>
            <strong>{nomeArquivo}</strong>
            <span className="texto-fraco pequeno">
              Confira as informações antes de aplicar. A IA pode errar.
            </span>
          </div>
          <button className="botao secundario" onClick={aoRefazer}>
            <RefreshCw aria-hidden="true" /> Ler de novo
          </button>
        </div>

        {r.documento_cortado && (
          <div className="alerta erro">
            <TriangleAlert aria-hidden="true" />
            <div>O documento é muito longo: a IA leu só a parte inicial.</div>
          </div>
        )}

        {r.resumo && (
          <section className="bloco-ia">
            <h3>
              <FileSearch aria-hidden="true" /> Resumo
            </h3>
            <p>{r.resumo}</p>
          </section>
        )}

        {campos.length > 0 && (
          <section className="bloco-ia">
            <h3>
              <Wand2 aria-hidden="true" /> Dados encontrados
            </h3>
            <div className="campos-ia">
              {campos.map((c) => (
                <label key={c.campo} className="campo-ia">
                  <input
                    type="checkbox"
                    checked={camposMarcados.has(c.campo)}
                    onChange={() => alternar(camposMarcados, c.campo, setCamposMarcados)}
                  />
                  <span>
                    <small>{c.rotulo}</small>
                    {exibir(c.valor, c.formato)}
                  </span>
                </label>
              ))}
            </div>
            <button className="botao" onClick={aplicarDados} disabled={aplicando || camposMarcados.size === 0}>
              <CheckSquare aria-hidden="true" /> Preencher {camposMarcados.size} campo(s) selecionado(s)
            </button>
          </section>
        )}

        {itens.length > 0 && (
          <section className="bloco-ia">
            <h3>
              <ListPlus aria-hidden="true" /> Itens encontrados ({itens.length})
            </h3>
            <div className="itens-ia">
              {itens.map((item, i) => {
                const numero = "numero" in item ? item.numero : item.item_numero;
                const texto = "descricao" in item ? item.descricao : item.produto;
                const valor = "valor_referencia" in item ? item.valor_referencia : item.valor_unitario;
                return (
                  <label key={i} className="item-ia">
                    <input
                      type="checkbox"
                      checked={itensMarcados.has(i)}
                      onChange={() => alternar(itensMarcados, i, setItensMarcados)}
                    />
                    <span className="numero-item">{numero ?? "—"}</span>
                    <span className="item-ia-texto">
                      {texto ?? "Sem descrição"}
                      <small className="texto-fraco">
                        Qtd {formatarNumero(item.quantidade)} {"unidade" in item ? item.unidade ?? "" : ""} ·{" "}
                        {formatarMoeda(valor)}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
            <button className="botao" onClick={importarItens} disabled={aplicando || itensMarcados.size === 0}>
              <ListPlus aria-hidden="true" /> Importar {itensMarcados.size} item(ns)
            </button>
          </section>
        )}

        {documentos.length > 0 && (
          <section className="bloco-ia">
            <h3>Documentos de habilitação</h3>
            <ul>
              {documentos.map((d, i) => (
                <li key={i}>{String(d)}</li>
              ))}
            </ul>
          </section>
        )}

        {pontos.length > 0 && (
          <section className="bloco-ia atencao">
            <h3>
              <TriangleAlert aria-hidden="true" /> Pontos de atenção
            </h3>
            <ul>
              {pontos.map((p, i) => (
                <li key={i}>{String(p)}</li>
              ))}
            </ul>
          </section>
        )}

        {typeof r.prazo_entrega === "string" && r.prazo_entrega && (
          <section className="bloco-ia">
            <h3>Prazo de entrega</h3>
            <p>{r.prazo_entrega}</p>
          </section>
        )}
      </div>
    </Modal>
  );
}
