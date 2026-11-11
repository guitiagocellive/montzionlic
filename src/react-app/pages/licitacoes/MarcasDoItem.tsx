import { Loader2, Tag, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { buscarNoCatalogo, type RegistroPreco, resumir, type Resumo, semAcentoMaiusculo, semRepetidos } from "../../../shared/mercado";
import { Modal } from "../../components/Ui";
import { formatarMoeda, formatarNumero } from "../../formato";
import { navegar } from "../../rota";
import { carregarCatalogo, emLotes, intervalo, type Pdm } from "./Mercado";

// Pop-up "Marcas" de um item da licitação: as marcas que mais venceram esse produto nos últimos 12 meses
// (dados oficiais do Compras.gov.br, os mesmos da Inteligência de mercado).

type Pagina = { resultado?: RegistroPreco[]; totalRegistros?: number; totalPaginas?: number };

async function consultar(params: Record<string, string>): Promise<Pagina> {
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetch(`/api/mercado/precos?${new URLSearchParams(params)}`, { credentials: "same-origin" });
    if (r.ok) return (await r.json()) as Pagina;
    if (tentativa >= 2 || r.status === 400) throw new Error("O Compras.gov.br não respondeu agora. Tente de novo em instantes.");
    await new Promise((ok) => setTimeout(ok, 1200 * (tentativa + 1)));
  }
}

/** "Monitor Multiparâmetro tipo: pré configurado..." → "Monitor Multiparâmetro". */
export function tituloDoItem(descricao: string) {
  const inicio = (descricao.split(/[:,;(\n]| - /)[0] ?? descricao).trim();
  const palavras = inicio.split(/\s+/);
  while (palavras.length > 1 && /^(tipo|material|modelo|aplicação|aplicacao|nome|composição|composicao)$/i.test(palavras[palavras.length - 1])) palavras.pop();
  const t = palavras.join(" ");
  return t.length > 70 ? `${t.slice(0, 70)}…` : t || "Item";
}

const MAX_PAGINAS = 6; // até 3 mil compras mais recentes
const FRACAS = new Set(["DE", "DA", "DO", "DAS", "DOS", "PARA", "COM", "SEM", "E", "EM", "A", "O", "AS", "OS", "TIPO", "USO", "P"]);

/** Produtos do catálogo parecidos com o nome do item: os que têm mais palavras em comum vêm primeiro. */
function produtosParecidos(pdms: Pdm[], titulo: string): Pdm[] {
  const palavras = semAcentoMaiusculo(titulo)
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 2 && !FRACAS.has(p));
  if (!palavras.length) return [];
  for (let n = Math.min(3, palavras.length); n >= 1; n--) {
    const achados = buscarNoCatalogo(pdms, palavras.slice(0, n).join(" "), 60);
    if (!achados.length) continue;
    const comum = (p: Pdm) => {
      const nome = semAcentoMaiusculo(p[1]);
      return palavras.filter((w) => nome.includes(w)).length;
    };
    return achados.sort((a, b) => comum(b) - comum(a)).slice(0, 8);
  }
  return [];
}

export function MarcasDoItem({ descricao, codigoCatalogo, aoFechar }: { descricao: string; codigoCatalogo: number | null; aoFechar: () => void }) {
  const titulo = tituloDoItem(descricao);
  const [estado, setEstado] = useState<{ etapa: string } | { erro: string } | { resumo: Resumo; base: string; termo: string; mediana: number | null } | null>({ etapa: "Procurando o produto no catálogo do governo…" });

  useEffect(() => {
    let vivo = true;
    const datas = intervalo(12);
    (async () => {
      // 1) Código exato do item (quando o PNCP informa); 2) senão, o produto do catálogo mais comprado com esse nome.
      let alvo: { params: Record<string, string>; base: string; total: number } | null = null;
      if (codigoCatalogo) {
        const r = await consultar({ item: String(codigoCatalogo), pagina: "1", inicio: datas[0], fim: datas[1], tamanho: "10" }).catch(() => null);
        if (r?.totalRegistros) alvo = { params: { item: String(codigoCatalogo) }, base: `item ${codigoCatalogo} do catálogo`, total: r.totalRegistros };
      }
      if (!alvo) {
        const cat = await carregarCatalogo();
        const achados = produtosParecidos(cat.pdms, titulo);
        if (vivo) setEstado({ etapa: "Contando as compras de produtos parecidos…" });
        const totais = await emLotes(achados, 4, async (p) => (await consultar({ pdm: String(p[0]), pagina: "1", inicio: datas[0], fim: datas[1], tamanho: "10" }).catch(() => null))?.totalRegistros ?? 0);
        const melhor = achados.map((p, i) => ({ p, total: totais[i] })).sort((a, b) => b.total - a.total)[0];
        if (melhor?.total) alvo = { params: { pdm: String(melhor.p[0]) }, base: melhor.p[1].replace(/^"+|"+$/g, ""), total: melhor.total };
      }
      if (!vivo) return;
      if (!alvo) return setEstado({ erro: "Não achei compras desse produto nos últimos 12 meses." });
      setEstado({ etapa: `Baixando as compras de ${alvo.base}…` });
      const paginas = Math.min(MAX_PAGINAS, Math.ceil(alvo.total / 500));
      const partes = await emLotes(
        Array.from({ length: paginas }, (_, i) => i + 1),
        3,
        async (n) => (await consultar({ ...alvo!.params, pagina: String(n), inicio: datas[0], fim: datas[1] })).resultado ?? [],
      );
      const registros = semRepetidos(partes.flat());
      const precos = registros.map((x) => Number(x.precoUnitario)).filter((x) => x > 0).sort((a, b) => a - b);
      const meio = Math.floor(precos.length / 2);
      const mediana = precos.length ? (precos.length % 2 ? precos[meio] : (precos[meio - 1] + precos[meio]) / 2) : null;
      if (vivo) setEstado({ resumo: resumir(registros), base: alvo.base, termo: alvo.base, mediana });
    })().catch((e) => vivo && setEstado({ erro: e instanceof Error ? e.message : "Não foi possível buscar agora." }));
    return () => {
      vivo = false;
    };
  }, [codigoCatalogo, titulo]);

  const max = estado && "resumo" in estado ? Math.max(1, ...estado.resumo.marcas.slice(0, 10).map((m) => m.compras)) : 1;

  return (
    <Modal titulo={`Marcas que mais venceram · ${titulo}`} aoFechar={aoFechar} largo>
      {estado && "etapa" in estado && (
        <p className="texto-suave carregando-marcas">
          <Loader2 className="girando" size={16} /> {estado.etapa}
        </p>
      )}
      {estado && "erro" in estado && <p className="alerta erro">{estado.erro}</p>}
      {estado && "resumo" in estado && (
        <div className="marcas-item">
          <p className="base-marcas">
            Produto do catálogo: <b>{estado.base}</b>
            <span className="texto-fraco">
              {" "}
              · últimos 12 meses · {formatarNumero(estado.resumo.registros)} itens vencidos em {formatarNumero(estado.resumo.compras)} licitações
            </span>
          </p>
          <div className="resumo-marcas-item">
            <div>
              <span>Preço mediano</span>
              <strong>{formatarMoeda(estado.mediana)}</strong>
            </div>
            <div>
              <span>Marcas vencedoras</span>
              <strong>{formatarNumero(estado.resumo.marcas.length)}</strong>
            </div>
            <div>
              <span>Empresas vencedoras</span>
              <strong>{formatarNumero(estado.resumo.empresas.length)}</strong>
            </div>
          </div>
          {estado.resumo.marcas.length === 0 ? (
            <p className="texto-fraco">Os fornecedores não informaram marca nessas compras.</p>
          ) : (
            <ol className="lista-ranking">
              {estado.resumo.marcas
                .slice()
                .sort((a, b) => b.compras - a.compras || b.valor - a.valor)
                .slice(0, 10)
                .map((m, i) => (
                  <li key={m.chave}>
                    <div className="linha-ranking">
                      <span className="posicao-ranking">{i + 1}</span>
                      <span className="corpo-ranking">
                        <span className="nome-ranking">
                          <Tag size={12} /> {m.nome}
                        </span>
                        <span className="barra-progresso fina" aria-hidden="true">
                          <span style={{ width: `${Math.max(3, (m.compras / max) * 100)}%` }} />
                        </span>
                      </span>
                      <span className="numeros-ranking">
                        <strong>{formatarNumero(m.compras)} vitórias</strong>
                        <span className="texto-fraco">{m.precoMediano != null ? `${formatarMoeda(m.precoMediano)}/un` : ""}</span>
                      </span>
                    </div>
                  </li>
                ))}
            </ol>
          )}
          <div className="acoes-marcas-item">
            <button
              className="botao secundario"
              onClick={() => {
                aoFechar();
                navegar(`/licitacoes/mercado?produto=${encodeURIComponent(titulo)}`);
              }}
            >
              <TrendingUp size={15} /> Não é esse produto? Escolher na Inteligência de mercado
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
