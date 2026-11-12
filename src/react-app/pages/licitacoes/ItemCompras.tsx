import { ErroCompras } from "../../robo/ErroCompras";
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileUp, Loader2, Paperclip, Send, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AnexoCompras,
  cnpjFormatadoAcomp,
  type CompraAcomp,
  dataDe,
  type FaseRecursal,
  type ItemAcomp,
  type LanceCompras,
  lerAnexos,
  lerFaseRecursal,
  lerItemComPropostas,
  lerLances,
  lerMensagem,
  lerProposta,
  type MensagemAcomp,
  type PropostaEmpresa,
  propostasDoItem,
  ROTULO_CHANCE,
} from "../../../shared/acompanhamento";
import { mensagemDeErro } from "../../api";
import { avisar } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import { type PedidoFornecedor, ponte } from "../../robo/ponte";

// "Ver item" do Compras.gov.br dentro da plataforma, no mesmo desenho da tela oficial:
// Minha proposta (classificação, declarações, UF, chat, proposta, anexos, diligências, recursos e lances) e
// Todas as propostas (empresas em ordem; a seta abre o chat, a proposta, os anexos e as diligências de cada uma).
// Quem consulta é o aplicativo, com a sua sessão do gov.br; as ações só vão depois de você confirmar.

const FE = "/comprasnet-fase-externa";

export const COR_CHANCE: Record<string, string> = { ganhou: "verde", alta: "verde", media: "amarelo", baixa: "vermelho", fora: "cinza", aguardando: "azul", encerrado: "cinza" };

export async function pedir(p: PedidoFornecedor) {
  const r = await ponte.fornecedor(p);
  if (r.status >= 400 || r.status === 0) {
    const m = (r.mensagem ?? "").trim();
    throw new Error(m && m !== "[]" && m !== "{}" ? m : `O Compras.gov.br respondeu ${r.status || "sem dados"}.`);
  }
  return r;
}

/** Tela do fornecedor e, se ela não existir para esta compra, a tela pública com a mesma informação. */
async function consultar(caminhoV: string, opcoes: { captcha?: boolean; query?: string } = {}) {
  const { captcha = true, query = "" } = opcoes;
  try {
    return (await pedir({ caminho: `${FE}${caminhoV}`, captcha, query })).dados;
  } catch (e) {
    if (!/40[34]|não encontr|not found/i.test(mensagemDeErro(e))) throw e;
    return (await pedir({ caminho: `${FE}/public${caminhoV}`, captcha, query })).dados;
  }
}

function salvarArquivo(r: { base64?: string; nome?: string; tipo?: string }, nomePadrao: string) {
  if (!r.base64) throw new Error("O Compras.gov.br não devolveu o arquivo.");
  const bin = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bin], { type: r.tipo || "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = r.nome && r.nome !== "arquivo" ? r.nome : nomePadrao;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function lerArquivo(f: File) {
  if (f.size > 30 * 1024 * 1024) throw new Error("O Compras.gov.br aceita arquivos de até 30 MB.");
  if (f.name.length > 150) throw new Error("O nome do arquivo pode ter até 150 caracteres.");
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
  return { nome: f.name, tipo: f.type || "application/octet-stream", base64: btoa(s) };
}

const dataHora = (s: string) => {
  const t = dataDe(s);
  return t ? new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
};
const hora = (s: string) => {
  const t = dataDe(s);
  return t ? new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
};
const moeda4 = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 }));

/** Carrega sob demanda (quando a parte abre), com "tentar de novo". */
function useCarga<T>(ativo: boolean, carregar: () => Promise<T>, chave: string) {
  const [estado, setEstado] = useState<{ carregando: boolean; erro: string; dados: T | null }>({ carregando: false, erro: "", dados: null });
  const [vez, setVez] = useState(0);
  const ref = useRef(carregar);
  ref.current = carregar;
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    setEstado((e) => ({ ...e, carregando: true, erro: "" }));
    ref
      .current()
      .then((dados) => vivo && setEstado({ carregando: false, erro: "", dados }))
      .catch((e) => vivo && setEstado((x) => ({ ...x, carregando: false, erro: mensagemDeErro(e) })));
    return () => {
      vivo = false;
    };
  }, [ativo, vez, chave]);
  return { ...estado, recarregar: useCallback(() => setVez((v) => v + 1), []) };
}

function Estado({ carregando, erro, recarregar, children }: { carregando: boolean; erro: string; recarregar: () => void; children: ReactNode }) {
  if (carregando)
    return (
      <p className="texto-suave carregando-marcas">
        <Loader2 className="girando" size={16} /> Consultando o Compras.gov.br…
      </p>
    );
  if (erro)
    return (
      <ErroCompras erro={erro} aoTentar={recarregar} />
    );
  return <>{children}</>;
}

/** Bloco que abre e fecha, como "Chat", "Proposta", "Anexos" e "Diligências" da tela oficial. */
function Secao({ titulo, aberta: inicial = false, extra, children }: { titulo: string; aberta?: boolean; extra?: ReactNode; children: (aberta: boolean) => ReactNode }) {
  const [aberta, setAberta] = useState(inicial);
  return (
    <section className={`secao-compras ${aberta ? "aberta" : ""}`}>
      <button className="titulo-secao-compras" onClick={() => setAberta((v) => !v)} aria-expanded={aberta}>
        <ChevronDown size={16} /> {titulo} {extra}
      </button>
      {aberta && <div className="corpo-secao-compras">{children(aberta)}</div>}
    </section>
  );
}

export function ItemCompras({
  compra,
  item,
  cnpj,
  anterior,
  proximo,
}: {
  compra: CompraAcomp;
  item: ItemAcomp;
  cnpj: string;
  anterior?: () => void;
  proximo?: () => void;
}) {
  const [aba, setAba] = useState<"minha" | "todas">("minha");
  const base = `/v1/compras/${compra.chave}/itens/${item.numero}`;
  const dados = useCarga(
    true,
    async () => {
      // 1) tela da fase de seleção ("Todas as propostas" oficial); 2) item com as propostas; 3) propostas iniciais.
      const naoExiste = (e: unknown) => /40[034]|não encontr|not found|sem dados/i.test(mensagemDeErro(e));
      try {
        const d = await consultar(`/v1/compras/${compra.chave}/em-selecao-fornecedores/itens/${item.numero}/propostas`, { query: "ordenacao-propostas=P", captcha: false });
        const lido = lerItemComPropostas(d, cnpj);
        if (lido.todas.length) return { ...lido, iniciais: false };
      } catch (e) {
        if (!naoExiste(e)) throw e;
      }
      try {
        return { ...lerItemComPropostas(await consultar(`${base}/propostas`), cnpj), iniciais: false };
      } catch (e) {
        if (!naoExiste(e)) throw e;
        const d = await consultar(`${base}/propostas-iniciais`).catch(() => {
          throw e;
        });
        return { ...lerItemComPropostas({ propostasItem: propostasDoItem(d, item.numero) }, cnpj), iniciais: true };
      }
    },
    `${compra.chave}:${item.numero}`,
  );
  const nomes = useMemo(() => new Map((dados.dados?.todas ?? []).map((p) => [p.cnpj, p.empresa])), [dados.dados]);
  // Reserva: a sua proposta como veio na lista de itens (aparece na hora, antes da tela do item responder).
  const minha = dados.dados?.minha ?? (item.propostaBruta ? lerProposta(item.propostaBruta) : null);
  const participantes = dados.dados?.participantes ?? item.participantes;
  const colocacao = minha?.colocacao ?? item.colocacao;

  return (
    <div className="item-compras">
      <div className="cabeca-item-compras">
        <div>
          <strong>
            {item.numero} &nbsp;{item.descricao.toUpperCase()}
          </strong>
          {item.etapa && <span className="etapa-item-compras">{item.etapa}</span>}
        </div>
        <dl>
          <dt>Qtde solicitada</dt>
          <dd>{item.quantidade ?? "—"}</dd>
          <dt>Valor estimado (unitário)</dt>
          <dd>{item.valorEstimado != null ? moeda4(item.valorEstimado) : "Não informado"}</dd>
        </dl>
        <div className="navegar-itens">
          <button className="botao-icone" onClick={anterior} disabled={!anterior} aria-label="Item anterior">
            <ChevronLeft size={16} />
          </button>
          <button className="botao-icone" onClick={proximo} disabled={!proximo} aria-label="Próximo item">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="abas-compras" role="tablist">
        <button role="tab" aria-selected={aba === "minha"} className={aba === "minha" ? "ativo" : ""} onClick={() => setAba("minha")}>
          Minha proposta
        </button>
        <button role="tab" aria-selected={aba === "todas"} className={aba === "todas" ? "ativo" : ""} onClick={() => setAba("todas")}>
          Todas as propostas
        </button>
      </div>

      {aba === "minha" ? (
        <div className="painel-compras">
          <div className="resumo-minha-proposta">
            <div>
              <span>Classificação</span>
              <strong>{colocacao != null ? `${colocacao}º${participantes ? ` de ${participantes} propostas` : ""}` : "—"}</strong>
              <span className={`chip ${COR_CHANCE[item.chance]}`}>{ROTULO_CHANCE[item.chance]}</span>
            </div>
            <div>
              <span>Declarações</span>
              <strong>ME/EPP: {minha?.meEpp || compra.meEpp ? "Sim" : compra.meEpp === false || minha ? "Não" : "—"}</strong>
            </div>
            <div>
              <span>UF do fornecedor</span>
              <strong>{minha?.uf || compra.uf || "—"}</strong>
            </div>
          </div>
          <p className="texto-fraco pequeno explicacao-chance">{item.explicacao}</p>
          {item.pendencias.map((p) => (
            <p key={p.tipo} className="alerta aviso">
              Convocação aberta: {p.rotulo}.
            </p>
          ))}

          <Secao titulo="Chat" aberta>
            {() => <Chat compra={compra} item={item} cnpj={cnpj} nomes={nomes} participante={cnpj} podeEscrever />}
          </Secao>
          <Secao titulo="Proposta" aberta>
            {() => (
              <Estado carregando={dados.carregando} erro={dados.erro} recarregar={dados.recarregar}>
                {minha ? <DadosProposta p={minha} /> : <p className="texto-fraco">O Compras.gov.br ainda não mostra a sua proposta deste item.</p>}
              </Estado>
            )}
          </Secao>
          <Secao titulo="Anexos" aberta={item.pendencias.some((p) => p.tipo === "anexos")}>
            {() => <MeusAnexos compra={compra} item={item} cnpj={cnpj} convocado={item.pendencias.some((p) => p.tipo === "anexos") || !!minha?.convocada} />}
          </Secao>
          <Secao titulo="Diligências" aberta={item.pendencias.some((p) => p.tipo === "diligencia")}>
            {() => <Diligencias compra={compra} item={item} cnpj={cnpj} podeEnviar={item.pendencias.some((p) => p.tipo === "diligencia")} />}
          </Secao>
          <Secao titulo="Recursos">{() => <Recursos compra={compra} item={item} cnpj={cnpj} nomes={nomes} />}</Secao>
          <Secao titulo="Lances">{() => <Lances compra={compra} item={item} cnpj={cnpj} nomes={nomes} />}</Secao>
        </div>
      ) : (
        <Estado carregando={dados.carregando} erro={dados.erro} recarregar={dados.recarregar}>
          <TodasPropostas compra={compra} item={item} cnpj={cnpj} lista={dados.dados?.todas ?? []} iniciais={!!dados.dados?.iniciais} nomes={nomes} />
        </Estado>
      )}
    </div>
  );
}

function DadosProposta({ p }: { p: PropostaEmpresa }) {
  const q = p.quantidade;
  const total = (v: number | null) => (v != null && q != null ? moeda4(v * q) : "");
  return (
    <div className="dados-proposta-compras">
      <div>
        <span>Valor proposta (unitário | total)</span>
        <strong>
          {moeda4(p.valorProposta)} {total(p.valorProposta) && <span className="texto-fraco">| {total(p.valorProposta)}</span>}
        </strong>
      </div>
      <div>
        <span>Valor ofertado (unitário | total)</span>
        <strong>
          {moeda4(p.valorOfertado)} {total(p.valorOfertado) && <span className="texto-fraco">| {total(p.valorOfertado)}</span>}
        </strong>
      </div>
      <div>
        <span>Valor negociado (unitário | total)</span>
        <strong>
          {p.valorNegociado != null ? moeda4(p.valorNegociado) : "—"} {total(p.valorNegociado) && <span className="texto-fraco">| {total(p.valorNegociado)}</span>}
        </strong>
      </div>
      <div>
        <span>Quantidade ofertada</span>
        <strong>{q ?? "—"}</strong>
      </div>
      <div>
        <span>Marca/Fabricante</span>
        <strong>{p.marca || "—"}</strong>
      </div>
      <div>
        <span>Modelo/Versão</span>
        <strong>{p.modelo || "—"}</strong>
      </div>
      {(p.situacao || p.motivo) && (
        <div className="largura-toda">
          <span>Situação</span>
          <strong className={p.desclassificada ? "texto-vermelho" : ""}>{p.situacao || "—"}</strong>
          {p.motivo && <span className="motivo-acomp">Motivo: {p.motivo}</span>}
        </div>
      )}
    </div>
  );
}

// ---------- Chat do item ----------

/** Chat do item com uma empresa (a sua, em "Minha proposta", ou a de cada colocada, em "Todas as propostas"). */
function Chat({
  compra,
  item,
  cnpj,
  nomes,
  empresa,
  participante,
  podeEscrever,
}: {
  compra: CompraAcomp;
  item: ItemAcomp;
  cnpj: string;
  nomes: Map<string, string>;
  empresa?: PropostaEmpresa;
  participante?: string;
  podeEscrever?: boolean;
}) {
  const de = participante ?? empresa?.cnpj ?? "";
  const carga = useCarga(
    true,
    async () => {
      const query = `size=300&page=0&legadoAsp=false${de ? `&identificadorParticipante=${de}` : ""}`;
      const r = await pedir({ caminho: `/comprasnet-mensagem/v2/chat/${compra.chave}/itens/${item.numero}`, query, captcha: true });
      const lista = Array.isArray(r.dados) ? r.dados : [];
      return lista
        .map(lerMensagem)
        .filter((m): m is MensagemAcomp => !!m)
        .sort((a, b) => dataDe(a.dataHora) - dataDe(b.dataHora));
    },
    `${compra.chave}:${item.numero}:${de}`,
  );
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (caixa.current) caixa.current.scrollTop = caixa.current.scrollHeight;
  }, [carga.dados]);

  const quem = (m: MensagemAcomp) => {
    if (m.quem === "sistema") return "Sistema";
    if (m.quem === "pregoeiro") {
      const para = m.destinatario ? (m.destinatario === cnpj ? "você" : nomes.get(m.destinatario) || cnpjFormatadoAcomp(m.destinatario)) : "";
      return para ? `Pregoeiro → ${para}` : "Pregoeiro";
    }
    if (!m.remetente || m.remetente === cnpj) return "Você";
    return nomes.get(m.remetente) || empresa?.empresa || cnpjFormatadoAcomp(m.remetente);
  };
  // Mesmo lado da tela oficial: pregoeiro à esquerda, fornecedor e sistema à direita.
  const lado = (m: MensagemAcomp) => (m.quem === "pregoeiro" ? "pregoeiro" : m.quem === "voce" && m.remetente && m.remetente !== cnpj ? "outra" : m.quem);

  async function enviar() {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await ponte.mensagem(compra.chave, item.numero, texto.trim());
      setTexto("");
      avisar("Mensagem enviada ao pregoeiro.");
      carga.recarregar();
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setEnviando(false);
    }
  }

  let dia = "";
  return (
    <Estado carregando={carga.carregando && !carga.dados} erro={carga.erro} recarregar={carga.recarregar}>
      <div className="chat-compras" ref={caixa}>
        {(carga.dados ?? []).length === 0 ? (
          <p className="texto-fraco pequeno">Nenhuma mensagem neste item.</p>
        ) : (
          (carga.dados ?? []).map((m) => {
            const d = m.dataHora ? new Date(dataDe(m.dataHora)).toLocaleDateString("pt-BR") : "";
            const mostrarDia = d && d !== dia;
            dia = d || dia;
            return (
              <div key={m.id} className="linha-chat">
                {mostrarDia && <span className="dia-chat">{d}</span>}
                <div className={`msg-compras ${lado(m)}`}>
                  <span className="quem-acomp">{quem(m)}</span>
                  <span>{m.texto}</span>
                  <span className="hora-chat">{hora(m.dataHora)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
      {podeEscrever && (
        <>
          <div className="enviar-compras">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Nova mensagem"
              rows={2}
              maxLength={2000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar();
              }}
            />
            <button className="botao acento" onClick={enviar} disabled={enviando || !texto.trim()}>
              {enviando ? <Loader2 className="girando" /> : <Send />} Enviar mensagem
            </button>
          </div>
          <p className="texto-fraco pequeno">O Compras.gov.br só aceita mensagem quando o pregoeiro abre a conversa para você (por exemplo, numa convocação).</p>
        </>
      )}
    </Estado>
  );
}

// ---------- Anexos ----------

function ListaAnexos({ anexos, baixar, excluir }: { anexos: AnexoCompras[]; baixar: (a: AnexoCompras) => Promise<void>; excluir?: (a: AnexoCompras) => Promise<void> }) {
  const [ocupado, setOcupado] = useState("");
  if (!anexos.length) return <p className="texto-fraco pequeno">Nenhum anexo enviado.</p>;
  const fazer = async (a: AnexoCompras, f: (a: AnexoCompras) => Promise<void>) => {
    setOcupado(a.id || a.url);
    try {
      await f(a);
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setOcupado("");
    }
  };
  return (
    <ul className="anexos-compras">
      {anexos.map((a) => (
        <li key={a.id || a.url}>
          <span className="nome-anexo-compras">{a.nome}</span>
          <span className="texto-fraco pequeno">{dataHora(a.dataHora)}</span>
          <button className="botao-icone" aria-label={`Baixar ${a.nome}`} disabled={!!ocupado} onClick={() => fazer(a, baixar)}>
            {ocupado === (a.id || a.url) ? <Loader2 className="girando" size={15} /> : <Download size={15} />}
          </button>
          {excluir && (
            <button className="botao-icone" aria-label={`Excluir ${a.nome}`} disabled={!!ocupado} onClick={() => fazer(a, excluir)}>
              <Trash2 size={15} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function EnviarArquivo({ rotulo, desativado, confirmar, enviar }: { rotulo: string; desativado?: boolean; confirmar: (nome: string) => string; enviar: (arquivo: { nome: string; tipo: string; base64: string }) => Promise<void> }) {
  const [enviando, setEnviando] = useState(false);
  return (
    <label className={`botao acento pequeno ${enviando || desativado ? "desativado" : ""}`} title={desativado ? "Para enviar o arquivo é necessário estar ciente dos termos do anexo" : ""}>
      {enviando ? <Loader2 className="girando" /> : <FileUp />} {enviando ? "Enviando…" : rotulo}
      <input
        type="file"
        hidden
        disabled={enviando || desativado}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || !window.confirm(confirmar(f.name))) return;
          setEnviando(true);
          try {
            await enviar(await lerArquivo(f));
            avisar("Arquivo enviado ao Compras.gov.br.");
          } catch (x) {
            avisar(mensagemDeErro(x), "erro");
          } finally {
            setEnviando(false);
          }
        }}
      />
    </label>
  );
}

const baixarAnexo = async (compra: CompraAcomp, item: ItemAcomp, cnpjEmpresa: string, a: AnexoCompras, minha: boolean) => {
  if (a.url) return salvarArquivo(await pedir({ url: a.url }), a.nome);
  const trecho = minha ? `participacao/${cnpjEmpresa}` : `participacoes/${cnpjEmpresa}`;
  const r = await pedir({ caminho: `${FE}/v2/compras/${compra.chave}/itens/${item.numero}/${trecho}/anexos/${a.id}`, captcha: !minha, baixar: true }).catch(() =>
    pedir({ caminho: `${FE}/public/v2/compras/${compra.chave}/itens/${item.numero}/participacoes/${cnpjEmpresa}/anexos/${a.id}`, captcha: true, baixar: true }),
  );
  salvarArquivo(r, a.nome);
};

function MeusAnexos({ compra, item, cnpj, convocado }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; convocado: boolean }) {
  const caminho = `${FE}/v1/compras/${compra.chave}/itens/${item.numero}/participacao/${cnpj}/anexos`;
  const carga = useCarga(!!cnpj, async () => lerAnexos((await pedir({ caminho, captcha: false })).dados), caminho);
  const [ciente, setCiente] = useState(false);
  if (!cnpj) return <p className="texto-fraco">Entre no Compras.gov.br para ver os seus anexos.</p>;
  return (
    <>
      {convocado ? (
        <div className="termo-anexos">
          <p>É necessário o registro de ciência sobre o acesso irrestrito às informações para iniciar o envio de anexo.</p>
          <p>
            Declaro ciência de que todos os documentos e informações apresentados relacionados a este procedimento de contratação serão divulgados com acesso irrestrito
            para consulta pública no sistema. Dessa forma, documentos pessoais serão inseridos exclusivamente no SICAF, nos termos da Instrução Normativa vigente.
          </p>
          <label className="ciente-anexos">
            <input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} /> Ciente
          </label>
          <div className="linha-acoes">
            <EnviarArquivo
              rotulo="Anexar arquivo"
              desativado={!ciente}
              confirmar={(n) => `Enviar "${n}" ao Compras.gov.br como anexo do item ${item.numero}?`}
              enviar={async (arquivo) => {
                await pedir({ metodo: "POST", caminho, arquivo });
                carga.recarregar();
              }}
            />
            <span className="texto-fraco pequeno">PDF, DOC, XLS, ZIP e outros, até 30 MB cada.</span>
          </div>
        </div>
      ) : (
        <p className="texto-fraco pequeno">O envio de anexos só fica liberado quando o pregoeiro convoca você neste item.</p>
      )}
      <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
        <ListaAnexos
          anexos={carga.dados ?? []}
          baixar={(a) => baixarAnexo(compra, item, cnpj, a, true)}
          excluir={
            convocado
              ? async (a) => {
                  if (!window.confirm(`Excluir "${a.nome}" do Compras.gov.br?`)) return;
                  await pedir({ metodo: "DELETE", caminho: `${caminho}/${a.id}` });
                  carga.recarregar();
                }
              : undefined
          }
        />
      </Estado>
    </>
  );
}

function AnexosEmpresa({ compra, item, empresa, aoContar }: { compra: CompraAcomp; item: ItemAcomp; empresa: PropostaEmpresa; aoContar?: (n: number) => void }) {
  const caminho = `/v1/compras/${compra.chave}/itens/${item.numero}/participacoes/${empresa.cnpj}/anexos`;
  const carga = useCarga(true, async () => lerAnexos(await consultar(caminho)), caminho);
  useEffect(() => {
    if (carga.dados) aoContar?.(carga.dados.length);
  }, [carga.dados, aoContar]);
  return (
    <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
      <ListaAnexos anexos={carga.dados ?? []} baixar={(a) => baixarAnexo(compra, item, empresa.cnpj, a, false)} />
    </Estado>
  );
}

// ---------- Diligências ----------

function Diligencias({ compra, item, cnpj, podeEnviar }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; podeEnviar?: boolean }) {
  const base = `${FE}/v1/compras/${compra.chave}/itens/${item.numero}/participacoes/${cnpj}/diligencias`;
  const carga = useCarga(!!cnpj, async () => (await pedir({ caminho: base, captcha: true })).dados, base);
  const lista = Array.isArray(carga.dados) ? (carga.dados as Record<string, unknown>[]) : carga.dados ? [carga.dados as Record<string, unknown>] : [];
  if (!cnpj) return null;
  return (
    <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
      {lista.length === 0 ? (
        <p className="texto-fraco pequeno">Nenhuma diligência.</p>
      ) : (
        <ul className="diligencias-compras">
          {lista.map((d, i) => (
            <li key={String(d.id ?? d.sequencial ?? i)}>
              <strong>{String(d.descricao ?? d.texto ?? d.motivo ?? `Diligência ${i + 1}`)}</strong>
              <span className="texto-fraco pequeno">
                {[d.dataHoraInicio && `Aberta em ${dataHora(String(d.dataHoraInicio))}`, d.dataHoraLimite && `Prazo ${dataHora(String(d.dataHoraLimite))}`].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {podeEnviar && (
        <div className="linha-acoes">
          <EnviarArquivo
            rotulo="Enviar documento da diligência"
            confirmar={(n) => `Enviar "${n}" ao Compras.gov.br como resposta à diligência do item ${item.numero}?`}
            enviar={async (arquivo) => {
              await pedir({ metodo: "POST", caminho: `${base}/anexos-participante`, arquivo });
              carga.recarregar();
            }}
          />
        </div>
      )}
    </Estado>
  );
}

// ---------- Todas as propostas ----------

function TodasPropostas({
  compra,
  item,
  cnpj,
  lista,
  iniciais,
  nomes,
}: {
  compra: CompraAcomp;
  item: ItemAcomp;
  cnpj: string;
  lista: PropostaEmpresa[];
  iniciais: boolean;
  nomes: Map<string, string>;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [anexos, setAnexos] = useState<Record<string, number | "lendo" | "erro">>({});
  const [conferindo, setConferindo] = useState(false);
  const minhaPos = lista.findIndex((p) => p.cnpj === cnpj);
  const aFrente = (minhaPos > 0 ? lista.slice(0, minhaPos) : []).filter((p) => p.cnpj && !p.desclassificada).slice(0, 10);

  // Uma empresa de cada vez, como abrir os anexos de cada uma na tela oficial.
  async function conferirAnexos() {
    setConferindo(true);
    for (const p of aFrente) {
      setAnexos((a) => ({ ...a, [p.cnpj]: "lendo" }));
      try {
        const lidos = lerAnexos(await consultar(`/v1/compras/${compra.chave}/itens/${item.numero}/participacoes/${p.cnpj}/anexos`));
        setAnexos((a) => ({ ...a, [p.cnpj]: lidos.length }));
      } catch {
        setAnexos((a) => ({ ...a, [p.cnpj]: "erro" }));
      }
    }
    setConferindo(false);
  }
  const conferidas = aFrente.filter((p) => typeof anexos[p.cnpj] === "number");
  const semAnexos = conferidas.filter((p) => anexos[p.cnpj] === 0);

  if (!lista.length) return <p className="texto-fraco">O Compras.gov.br ainda não mostra as propostas deste item (elas aparecem depois da disputa).</p>;
  return (
    <div className="painel-compras">
      {iniciais && <p className="texto-fraco pequeno">Propostas iniciais (antes da disputa).</p>}
      {aFrente.length > 0 && (
        <div className="conferir-anexos">
          <button className="botao secundario pequeno" onClick={conferirAnexos} disabled={conferindo}>
            {conferindo ? <Loader2 className="girando" /> : <Paperclip />}{" "}
            {aFrente.length === 1 ? "Conferir anexos da empresa à sua frente" : `Conferir anexos das ${aFrente.length} empresas à sua frente`}
          </button>
          {conferidas.length === aFrente.length && (
            <span className={semAnexos.length ? "texto-verde" : "texto-suave"}>
              {semAnexos.length
                ? aFrente.length === 1
                  ? "A empresa à sua frente não enviou anexos: se o edital exige, ela tende a ser recusada e você sobe."
                  : `${semAnexos.length} de ${aFrente.length} empresas à sua frente não enviaram anexos: se o edital exige, elas tendem a ser recusadas e você sobe.`
                : "Todas as empresas à sua frente enviaram anexos."}
            </span>
          )}
        </div>
      )}
      <ol className="todas-propostas">
        {lista.map((p, i) => {
          const minha = !!cnpj && p.cnpj === cnpj;
          const aberto = aberta === (p.cnpj || String(i));
          const n = anexos[p.cnpj];
          return (
            <li key={p.cnpj || i} className={`${minha ? "minha" : ""} ${p.desclassificada ? "fora" : ""} ${aberto ? "aberta" : ""}`}>
              <button className="linha-todas" onClick={() => setAberta(aberto ? null : p.cnpj || String(i))} aria-expanded={aberto}>
                <span className="posicao-proposta">{p.colocacao ?? i + 1}º</span>
                <span className="cnpj-todas">
                  {cnpjFormatadoAcomp(p.cnpj)}
                  {p.meEpp && <small>ME/EPP</small>}
                </span>
                <span className="nome-todas">
                  <span>
                    {p.empresa} {minha && <span className="chip azul">Você</span>}
                  </span>
                  <small>{p.uf}</small>
                </span>
                <span className="valores-todas">
                  <span>
                    <small>Valor ofertado (unitário)</small> {moeda4(p.valorOfertado ?? p.valor)}
                  </span>
                  <span>
                    <small>Valor negociado (unitário)</small> {p.valorNegociado != null ? moeda4(p.valorNegociado) : "-"}
                  </span>
                </span>
                <span className="chips-todas">
                  {p.desclassificada && <span className="chip vermelho">{p.situacao || "Recusada"}</span>}
                  {!p.desclassificada && p.situacao && <span className="chip verde">{p.situacao}</span>}
                  {p.convocada && <span className="chip amarelo">Convocada</span>}
                  {n === "lendo" && <Loader2 className="girando" size={13} />}
                  {n === 0 && <span className="chip vermelho">Sem anexos</span>}
                  {typeof n === "number" && n > 0 && <span className="chip verde">{n === 1 ? "1 anexo" : `${n} anexos`}</span>}
                </span>
                <ChevronDown className="seta-todas" size={18} />
              </button>
              {aberto && (
                <div className="detalhe-empresa">
                  <Secao titulo="Chat" aberta>
                    {() => <Chat compra={compra} item={item} cnpj={cnpj} nomes={nomes} empresa={p} />}
                  </Secao>
                  <Secao titulo="Proposta" aberta>
                    {() => <DadosProposta p={p} />}
                  </Secao>
                  <Secao titulo="Anexos" aberta>
                    {() => <AnexosEmpresa compra={compra} item={item} empresa={p} aoContar={(c) => setAnexos((a) => (a[p.cnpj] === c ? a : { ...a, [p.cnpj]: c }))} />}
                  </Secao>
                  <Secao titulo="Diligências">{() => <Diligencias compra={compra} item={item} cnpj={p.cnpj} />}</Secao>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- Lances ----------

function Lances({ compra, item, cnpj, nomes }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; nomes: Map<string, string> }) {
  const carga = useCarga(
    true,
    async () => {
      const caminho = `/comprasnet-disputa/v1/compras/${compra.chave}/itens/${item.numero}/lances`;
      const query = "pagina=0&tamanhoPagina=500";
      const r = await pedir({ caminho, query, captcha: false }).catch(() => pedir({ caminho, query, captcha: true }));
      return lerLances(r.dados, cnpj);
    },
    `${compra.chave}:${item.numero}`,
  );
  const lances: LanceCompras[] = carga.dados ?? [];
  return (
    <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
      {lances.length === 0 ? (
        <p className="texto-fraco pequeno">Nenhum lance registrado neste item.</p>
      ) : (
        <table className="tabela-lances-compras">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Empresa</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            {lances.map((l, i) => (
              <tr key={i} className={l.meu ? "meu" : ""}>
                <td>{dataHora(l.dataHora)}</td>
                <td>{l.meu ? "Você" : l.empresa || nomes.get(l.cnpj) || (l.cnpj ? cnpjFormatadoAcomp(l.cnpj) : "Fornecedor")}</td>
                <td>{formatarMoeda(l.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Estado>
  );
}

// ---------- Recursos ----------

function Recursos({ compra, item, cnpj, nomes }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; nomes: Map<string, string> }) {
  const caminho = `/v1/compras/${compra.chave}/itens/${item.numero}/fase-recursal/${item.sessao}`;
  const carga = useCarga(
    true,
    async () => {
      const d = await consultar(caminho).catch(async (e) => {
        if (!cnpj) throw e;
        return (await pedir({ caminho: `${FE}/v1/compras/${compra.chave}/itens/${item.numero}/fase-recursal-fornecedor/${item.sessao}`, captcha: false })).dados;
      });
      return lerFaseRecursal(d);
    },
    caminho,
  );
  const [ocupado, setOcupado] = useState(false);
  const fase: FaseRecursal | null = carga.dados ?? null;
  const v1 = `${FE}/v1/compras/${compra.chave}/itens/${item.numero}`;
  const minha = fase?.empresas.find((e) => e.cnpj === cnpj);
  const nome = (c: string, n: string) => (c === cnpj ? "Você" : n || nomes.get(c) || cnpjFormatadoAcomp(c));
  const prazoAberto = (rotulo: RegExp) => fase?.prazos.some((p) => rotulo.test(p.rotulo) && dataDe(p.dataHora) > Date.now()) ?? false;

  async function acao(texto: string, p: PedidoFornecedor) {
    if (!window.confirm(texto)) return;
    setOcupado(true);
    try {
      await pedir(p);
      avisar("Feito no Compras.gov.br.");
      carga.recarregar();
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setOcupado(false);
    }
  }

  async function baixarArquivos(caminhoV2: string, rotulo: string) {
    try {
      const dados = await consultar(caminhoV2);
      const anexos = lerAnexos(Array.isArray(dados) ? dados : [dados]);
      if (!anexos.length) return avisar("Sem arquivos.", "erro");
      for (const a of anexos) salvarArquivo(await pedir(a.url ? { url: a.url } : { caminho: `${FE}${caminhoV2}`, captcha: true, baixar: true }), a.nome || rotulo);
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    }
  }

  return (
    <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
      {fase?.prazos.length ? (
        <div className="prazos-recurso">
          {fase.prazos.map((p) => (
            <span key={p.rotulo} className={dataDe(p.dataHora) > Date.now() ? "aberto" : ""}>
              <b>{p.rotulo}</b> até {dataHora(p.dataHora)}
            </span>
          ))}
        </div>
      ) : (
        <p className="texto-fraco pequeno">Este item ainda não tem fase recursal aberta.</p>
      )}
      <div className="linha-acoes">
        {prazoAberto(/julgamento/i) && (
          <button
            className="botao secundario pequeno"
            disabled={ocupado}
            onClick={() => acao(`Registrar intenção de recurso no JULGAMENTO DA PROPOSTA do item ${item.numero}?`, { metodo: "POST", caminho: `${v1}/intencoes-recurso`, corpo: { etapaSelecaoFornecedores: "JP" } })}
          >
            Intenção de recurso (julgamento)
          </button>
        )}
        {prazoAberto(/habilitação/i) && (
          <button
            className="botao secundario pequeno"
            disabled={ocupado}
            onClick={() => acao(`Registrar intenção de recurso na HABILITAÇÃO do item ${item.numero}?`, { metodo: "POST", caminho: `${v1}/intencoes-recurso`, corpo: { etapaSelecaoFornecedores: "HF" } })}
          >
            Intenção de recurso (habilitação)
          </button>
        )}
        {(minha?.intencao || minha?.etapa) && prazoAberto(/recurso$/i) && (
          <EnviarArquivo
            rotulo="Enviar recurso (arquivo)"
            confirmar={(n) => `Enviar "${n}" como RECURSO do item ${item.numero}? Depois, clique em "Concluir envio do recurso".`}
            enviar={async (arquivo) => {
              await pedir({ metodo: "POST", caminho: `${v1}/recursos`, arquivo });
              carga.recarregar();
            }}
          />
        )}
        {minha?.temRecurso && (
          <button className="botao acento pequeno" disabled={ocupado} onClick={() => acao(`Concluir o envio do recurso do item ${item.numero}? Depois disso não dá para mudar.`, { metodo: "PUT", caminho: `${v1}/recursos`, corpo: null })}>
            Concluir envio do recurso
          </button>
        )}
      </div>
      {fase && fase.empresas.length > 0 && (
        <ul className="recursos-compras">
          {fase.empresas.map((e) => (
            <li key={e.cnpj}>
              <strong>{nome(e.cnpj, e.empresa)}</strong>
              {e.intencao || e.etapa ? (
                <span>
                  Intenção de recurso{e.etapa ? ` (${e.etapa})` : ""} {e.dataIntencao && <span className="texto-fraco pequeno">{dataHora(e.dataIntencao)}</span>}
                  {e.intencao && <q>{e.intencao}</q>}
                </span>
              ) : null}
              {e.temRecurso && (
                <span>
                  Recurso: {e.situacaoRecurso || "enviado"} {e.dataRecurso && <span className="texto-fraco pequeno">{dataHora(e.dataRecurso)}</span>}{" "}
                  <button className="botao-link sem-margem" onClick={() => baixarArquivos(`/v2/compras/${compra.chave}/itens/${item.numero}/fase-recursal/${item.sessao}/recursos/${e.cnpj}/arquivos`, "recurso")}>
                    Baixar recurso
                  </button>
                </span>
              )}
              {e.contrarrazoes.map((c) => (
                <span key={c.cnpj} className="contrarrazao-compras">
                  Contrarrazão de {nome(c.cnpj, c.empresa)}: {c.situacao || "enviada"}{" "}
                  <button
                    className="botao-link sem-margem"
                    onClick={() => baixarArquivos(`/v2/compras/${compra.chave}/itens/${item.numero}/fase-recursal/${item.sessao}/recursos/${e.cnpj}/contrarrazoes/${c.cnpj}/arquivos`, "contrarrazao")}
                  >
                    Baixar
                  </button>
                </span>
              ))}
              {e.temRecurso && e.cnpj !== cnpj && prazoAberto(/contrarraz/i) && (
                <div className="linha-acoes">
                  <EnviarArquivo
                    rotulo="Enviar contrarrazão"
                    confirmar={(n) => `Enviar "${n}" como CONTRARRAZÃO ao recurso de ${nome(e.cnpj, e.empresa)}? Depois, clique em "Concluir contrarrazão".`}
                    enviar={async (arquivo) => {
                      await pedir({ metodo: "POST", caminho: `${v1}/recursos/${e.cnpj}/contrarrazoes`, arquivo });
                      carga.recarregar();
                    }}
                  />
                  {e.contrarrazoes.some((c) => c.cnpj === cnpj) && (
                    <button className="botao acento pequeno" disabled={ocupado} onClick={() => acao("Concluir o envio da contrarrazão? Depois disso não dá para mudar.", { metodo: "PUT", caminho: `${v1}/recursos/${e.cnpj}/contrarrazoes`, corpo: null })}>
                      Concluir contrarrazão
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {(fase?.decisao || fase?.revisao) && (
        <div className="decisao-recurso">
          {[fase.decisao && { t: "Decisão do pregoeiro", d: fase.decisao }, fase.revisao && { t: "Decisão da autoridade", d: fase.revisao }]
            .filter((x): x is { t: string; d: NonNullable<FaseRecursal["decisao"]> } => !!x)
            .map(({ t, d }) => (
              <div key={t}>
                <strong>
                  {t}: {d.situacao}
                </strong>
                <span className="texto-fraco pequeno">{[d.responsavel, dataHora(d.dataHora)].filter(Boolean).join(" · ")}</span>
                {d.fundamentacao && <p>{d.fundamentacao}</p>}
              </div>
            ))}
          <button className="botao-link sem-margem" onClick={() => baixarArquivos(`/v2/compras/${compra.chave}/itens/${item.numero}/fase-recursal/${item.sessao}/arquivos`, "decisao")}>
            Baixar arquivos da decisão
          </button>
        </div>
      )}
    </Estado>
  );
}

