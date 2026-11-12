import { Download, FileUp, Gavel, Loader2, MessageSquare, Paperclip, RefreshCw, Scale, Search, Trash2, Trophy } from "lucide-react";
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
  lerLances,
  lerMensagem,
  type MensagemAcomp,
  type PropostaEmpresa,
  propostasDoItem,
} from "../../../shared/acompanhamento";
import { mensagemDeErro } from "../../api";
import { avisar, Modal } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import { type PedidoFornecedor, ponte } from "../../robo/ponte";

// Janela de um item da compra, com as mesmas telas do fornecedor no Compras.gov.br: propostas de todas as
// empresas (colocação, marca, modelo, valor, situação e anexos), lances, chat do item (pregoeiro com cada
// empresa), os seus anexos e diligências, e a fase recursal (intenções, recursos, contrarrazões e decisão).
// As ações (enviar anexo, intenção de recurso, recurso, contrarrazão) vão pelo aplicativo, depois de confirmar.

const FE = "/comprasnet-fase-externa";

type Aba = "propostas" | "lances" | "chat" | "anexos" | "diligencias" | "recursos";

async function pedir(p: PedidoFornecedor) {
  const r = await ponte.fornecedor(p);
  if (r.status >= 400 || r.status === 0) throw new Error(r.mensagem || `O Compras.gov.br respondeu ${r.status}.`);
  return r;
}

/** Tenta a tela do fornecedor e, se ela não existir para esta compra, a tela pública da mesma informação. */
async function consultar(caminhoV: string, opcoes: { captcha?: boolean; query?: string; publico?: boolean } = {}) {
  const { captcha = true, query = "", publico = true } = opcoes;
  try {
    return (await pedir({ caminho: `${FE}${caminhoV}`, captcha, query })).dados;
  } catch (e) {
    if (!publico || !/40[34]|não encontr|not found/i.test(mensagemDeErro(e))) throw e;
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

function dataHora(s: string) {
  const t = dataDe(s);
  return t ? new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

/** Carrega sob demanda (só quando a aba abre), com "tentar de novo". */
function useCarga<T>(ativo: boolean, carregar: () => Promise<T>, deps: unknown[]) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, vez, ...deps]);
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
      <div className="alerta erro linha-erro-item">
        <span>{erro}</span>
        <button className="botao secundario pequeno" onClick={recarregar}>
          <RefreshCw /> Tentar de novo
        </button>
      </div>
    );
  return <>{children}</>;
}

function DadosBrutos({ dados }: { dados: unknown }) {
  if (dados == null) return null;
  return (
    <details className="dados-brutos">
      <summary>Ver tudo o que o Compras.gov.br devolveu</summary>
      <pre>{JSON.stringify(dados, null, 2).slice(0, 20000)}</pre>
    </details>
  );
}

export function DetalheItemCompras({ compra, item, cnpj, aoFechar }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; aoFechar: () => void }) {
  const [aba, setAba] = useState<Aba>("propostas");
  const base = `/v1/compras/${compra.chave}/itens/${item.numero}`;

  // Propostas de todas as empresas (base para nomes no chat, nos lances e nos recursos).
  const propostas = useCarga(
    true,
    async () => {
      try {
        return { lista: propostasDoItem(await consultar(`${base}/propostas`)), bruto: null as unknown, iniciais: false };
      } catch (e) {
        const d = await consultar(`${base}/propostas-iniciais`).catch(() => {
          throw e;
        });
        return { lista: propostasDoItem(d), bruto: d, iniciais: true };
      }
    },
    [compra.chave, item.numero],
  );
  const nomes = useMemo(() => new Map((propostas.dados?.lista ?? []).map((p) => [p.cnpj, p.empresa])), [propostas.dados]);

  const abas: [Aba, string, ReactNode][] = [
    ["propostas", "Propostas", <Trophy key="p" size={14} />],
    ["lances", "Lances", <Gavel key="l" size={14} />],
    ["chat", "Chat do item", <MessageSquare key="c" size={14} />],
    ["anexos", "Meus anexos", <Paperclip key="a" size={14} />],
    ["diligencias", "Diligências", <Search key="d" size={14} />],
    ["recursos", "Recursos", <Scale key="r" size={14} />],
  ];

  return (
    <Modal titulo={`Item ${item.numero} · ${compra.modalidade} ${compra.numero}`} aoFechar={aoFechar} largo>
      <div className="detalhe-item-compras">
        <p className="texto-suave descricao-item-compras">{item.descricao}</p>
        <div className="segmentado pequeno abas-item-compras" role="tablist">
          {abas.map(([k, rotulo, icone]) => (
            <button key={k} role="tab" aria-selected={aba === k} className={aba === k ? "ativo" : ""} onClick={() => setAba(k)}>
              {icone} {rotulo}
            </button>
          ))}
        </div>
        {aba === "propostas" && (
          <Estado carregando={propostas.carregando} erro={propostas.erro} recarregar={propostas.recarregar}>
            {propostas.dados && <Propostas compra={compra} item={item} cnpj={cnpj} lista={propostas.dados.lista} iniciais={propostas.dados.iniciais} />}
          </Estado>
        )}
        {aba === "lances" && <Lances compra={compra} item={item} cnpj={cnpj} nomes={nomes} />}
        {aba === "chat" && <ChatItem compra={compra} item={item} cnpj={cnpj} nomes={nomes} />}
        {aba === "anexos" && <MeusAnexos compra={compra} item={item} cnpj={cnpj} />}
        {aba === "diligencias" && <Diligencias compra={compra} item={item} cnpj={cnpj} />}
        {aba === "recursos" && <Recursos compra={compra} item={item} cnpj={cnpj} nomes={nomes} />}
      </div>
    </Modal>
  );
}

// ---------- Propostas de todas as empresas ----------

function Propostas({ compra, item, cnpj, lista, iniciais }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; lista: PropostaEmpresa[]; iniciais: boolean }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [anexos, setAnexos] = useState<Record<string, number | "lendo" | "erro">>({});
  const [conferindo, setConferindo] = useState(false);
  const minhaPos = lista.findIndex((p) => p.cnpj === cnpj);
  const aFrente = (minhaPos > 0 ? lista.slice(0, minhaPos) : []).filter((p) => p.cnpj && !p.desclassificada).slice(0, 10);

  // Uma consulta por empresa, uma de cada vez (como abrir os anexos de cada uma na tela oficial).
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
  const melhor = lista.find((p) => !p.desclassificada && p.valor != null)?.valor ?? null;
  return (
    <>
      {iniciais && <p className="texto-fraco pequeno">Propostas iniciais (antes da disputa). A classificação final aparece quando o julgamento começar.</p>}
      {aFrente.length > 0 && (
        <div className="conferir-anexos">
          <button className="botao secundario pequeno" onClick={conferirAnexos} disabled={conferindo}>
            {conferindo ? <Loader2 className="girando" /> : <Paperclip />} {aFrente.length === 1 ? "Conferir anexos da empresa à sua frente" : `Conferir anexos das ${aFrente.length} empresas à sua frente`}
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
      <ol className="propostas-compras">
        {lista.map((p, i) => {
          const minha = !!cnpj && p.cnpj === cnpj;
          const dif = melhor && p.valor && p.valor > melhor ? (p.valor / melhor - 1) * 100 : null;
          return (
            <li key={p.cnpj || i} className={`${minha ? "minha" : ""} ${p.desclassificada ? "fora" : ""}`}>
              <div className="linha-proposta">
                <span className="posicao-proposta">{p.colocacao ?? i + 1}º</span>
                <div className="empresa-proposta">
                  <strong>
                    {p.empresa}
                    {minha && <span className="chip azul">Você</span>}
                    {p.convocada && <span className="chip amarelo">Convocada</span>}
                    {anexos[p.cnpj] === "lendo" && <Loader2 className="girando" size={13} />}
                    {anexos[p.cnpj] === 0 && <span className="chip vermelho">Sem anexos</span>}
                    {typeof anexos[p.cnpj] === "number" && (anexos[p.cnpj] as number) > 0 && (
                      <span className="chip verde">{anexos[p.cnpj] === 1 ? "1 anexo" : `${anexos[p.cnpj]} anexos`}</span>
                    )}
                  </strong>
                  <span className="texto-fraco pequeno">
                    {[cnpjFormatadoAcomp(p.cnpj), p.marca && `Marca ${p.marca}`, p.modelo && `Modelo ${p.modelo}`, p.quantidade != null && `Qtd. ${p.quantidade}`].filter(Boolean).join(" · ")}
                  </span>
                  {p.situacao && <span className={`pequeno ${p.desclassificada ? "texto-vermelho" : "texto-verde"}`}>{p.situacao}</span>}
                  {p.motivo && <span className="motivo-acomp">Motivo: {p.motivo}</span>}
                </div>
                <div className="valor-proposta">
                  <strong>{formatarMoeda(p.valor)}</strong>
                  <span className="texto-fraco pequeno">
                    {p.valorInicial != null && p.valorInicial !== p.valor ? `inicial ${formatarMoeda(p.valorInicial)}` : ""}
                    {dif != null ? ` +${dif.toFixed(1).replace(".", ",")}%` : ""}
                  </span>
                </div>
                {p.cnpj && (
                  <button className="botao secundario pequeno" onClick={() => setAberta(aberta === p.cnpj ? null : p.cnpj)} aria-expanded={aberta === p.cnpj}>
                    <Paperclip /> Anexos
                  </button>
                )}
              </div>
              {aberta === p.cnpj && <AnexosEmpresa compra={compra} item={item} empresa={p} />}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function ListaAnexos({ anexos, baixar, excluir }: { anexos: AnexoCompras[]; baixar: (a: AnexoCompras) => Promise<void>; excluir?: (a: AnexoCompras) => Promise<void> }) {
  const [ocupado, setOcupado] = useState("");
  if (!anexos.length) return <p className="texto-fraco pequeno">Nenhum anexo.</p>;
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
          <Paperclip size={14} />
          <span className="nome-anexo-compras">
            {a.nome}
            <span className="texto-fraco pequeno">{[a.tipo, dataHora(a.dataHora), a.tamanho ? `${Math.round(a.tamanho / 1024)} KB` : ""].filter(Boolean).join(" · ")}</span>
          </span>
          <button className="botao secundario pequeno" disabled={!!ocupado} onClick={() => fazer(a, baixar)}>
            {ocupado === (a.id || a.url) ? <Loader2 className="girando" /> : <Download />} Baixar
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

function AnexosEmpresa({ compra, item, empresa }: { compra: CompraAcomp; item: ItemAcomp; empresa: PropostaEmpresa }) {
  const base = `/v1/compras/${compra.chave}/itens/${item.numero}/participacoes/${empresa.cnpj}`;
  const carga = useCarga(true, async () => lerAnexos(await consultar(`${base}/anexos`)), [base]);
  return (
    <div className="anexos-empresa">
      <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
        <ListaAnexos
          anexos={carga.dados ?? []}
          baixar={async (a) => {
            const r = a.url
              ? await pedir({ url: a.url })
              : await pedir({ caminho: `${FE}/v2/compras/${compra.chave}/itens/${item.numero}/participacoes/${empresa.cnpj}/anexos/${a.id}`, captcha: true, baixar: true }).catch(() =>
                  pedir({ caminho: `${FE}/public/v2/compras/${compra.chave}/itens/${item.numero}/participacoes/${empresa.cnpj}/anexos/${a.id}`, captcha: true, baixar: true }),
                );
            salvarArquivo(r, a.nome);
          }}
        />
      </Estado>
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
      return { lances: lerLances(r.dados, cnpj), bruto: r.dados };
    },
    [compra.chave, item.numero],
  );
  const lances: LanceCompras[] = carga.dados?.lances ?? [];
  return (
    <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
      {lances.length === 0 ? (
        <p className="texto-fraco">Nenhum lance registrado neste item.</p>
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
      <DadosBrutos dados={lances.length ? null : carga.dados?.bruto} />
    </Estado>
  );
}

// ---------- Chat do item (pregoeiro com todas as empresas) ----------

function ChatItem({ compra, item, cnpj, nomes }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; nomes: Map<string, string> }) {
  const carga = useCarga(
    true,
    async () => {
      const r = await pedir({ caminho: `/comprasnet-mensagem/v2/chat/${compra.chave}/itens/${item.numero}`, query: "size=300&page=0&legadoAsp=false", captcha: true });
      const lista = Array.isArray(r.dados) ? r.dados : [];
      return lista
        .map((b) => {
          const m = lerMensagem(b);
          const x = (b ?? {}) as Record<string, unknown>;
          return m ? { ...m, remetente: String(x.identificadorRemetente ?? ""), destinatario: String(x.identificadorDestinatario ?? "") } : null;
        })
        .filter((m): m is MensagemAcomp & { remetente: string; destinatario: string } => !!m)
        .sort((a, b) => dataDe(a.dataHora) - dataDe(b.dataHora));
    },
    [compra.chave, item.numero],
  );
  const quem = (m: MensagemAcomp & { remetente: string; destinatario: string }) => {
    if (m.quem === "sistema") return "Sistema";
    if (m.quem === "pregoeiro") {
      const para = m.destinatario ? (m.destinatario === cnpj ? "você" : nomes.get(m.destinatario) || cnpjFormatadoAcomp(m.destinatario)) : "";
      return para ? `Pregoeiro → ${para}` : "Pregoeiro";
    }
    return m.remetente === cnpj || !m.remetente ? "Você" : nomes.get(m.remetente) || cnpjFormatadoAcomp(m.remetente);
  };
  return (
    <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
      <div className="mensagens-acomp chat-item-compras">
        {(carga.dados ?? []).length === 0 ? (
          <p className="texto-fraco pequeno">Nenhuma mensagem neste item.</p>
        ) : (
          (carga.dados ?? []).map((m) => (
            <div key={m.id} className={`msg-acomp ${m.quem === "voce" && m.remetente && m.remetente !== cnpj ? "outra" : m.quem}`}>
              <span className="quem-acomp">
                {quem(m)} <span className="texto-fraco">{dataHora(m.dataHora)}</span>
              </span>
              <span>{m.texto}</span>
            </div>
          ))
        )}
      </div>
      <p className="texto-fraco pequeno">Para escrever ao pregoeiro, use o campo de mensagens da compra (abaixo dos itens).</p>
    </Estado>
  );
}

// ---------- Envio de arquivo com confirmação ----------

function EnviarArquivo({ rotulo, confirmar, enviar }: { rotulo: string; confirmar: (nome: string) => string; enviar: (arquivo: { nome: string; tipo: string; base64: string }) => Promise<void> }) {
  const [enviando, setEnviando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  return (
    <label className={`botao acento pequeno ${enviando ? "desativado" : ""}`}>
      {enviando ? <Loader2 className="girando" /> : <FileUp />} {enviando ? "Enviando…" : rotulo}
      <input
        ref={campo}
        type="file"
        hidden
        disabled={enviando}
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

// ---------- Meus anexos (proposta ajustada, documentos de habilitação, convocação) ----------

function MeusAnexos({ compra, item, cnpj }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string }) {
  const caminho = `${FE}/v1/compras/${compra.chave}/itens/${item.numero}/participacao/${cnpj}/anexos`;
  const carga = useCarga(!!cnpj, async () => lerAnexos((await pedir({ caminho, captcha: false })).dados), [caminho]);
  if (!cnpj) return <p className="texto-fraco">Entre no Compras.gov.br para ver os seus anexos.</p>;
  return (
    <div className="painel-item-compras">
      {item.pendencias.some((p) => p.tipo === "anexos") && (
        <p className="alerta aviso">O pregoeiro pediu anexos neste item. Envie aqui; eles vão direto para o Compras.gov.br.</p>
      )}
      <div className="linha-acoes">
        <EnviarArquivo
          rotulo="Enviar anexo"
          confirmar={(n) => `Enviar "${n}" ao Compras.gov.br como anexo do item ${item.numero}?\n\nO pregoeiro e as outras empresas poderão ver o arquivo.`}
          enviar={async (arquivo) => {
            await pedir({ metodo: "POST", caminho, arquivo });
            carga.recarregar();
          }}
        />
        <span className="texto-fraco pequeno">Até 30 MB por arquivo.</span>
      </div>
      <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
        <ListaAnexos
          anexos={carga.dados ?? []}
          baixar={async (a) => salvarArquivo(a.url ? await pedir({ url: a.url }) : await pedir({ caminho: `${FE}/v2/compras/${compra.chave}/itens/${item.numero}/participacao/${cnpj}/anexos/${a.id}`, baixar: true }), a.nome)}
          excluir={async (a) => {
            if (!window.confirm(`Excluir "${a.nome}" do Compras.gov.br?`)) return;
            await pedir({ metodo: "DELETE", caminho: `${caminho}/${a.id}` });
            carga.recarregar();
          }}
        />
      </Estado>
    </div>
  );
}

// ---------- Diligências ----------

function Diligencias({ compra, item, cnpj }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string }) {
  const base = `${FE}/v1/compras/${compra.chave}/itens/${item.numero}/participacoes/${cnpj}/diligencias`;
  const carga = useCarga(!!cnpj, async () => (await pedir({ caminho: base, captcha: true })).dados, [base]);
  const lista = Array.isArray(carga.dados) ? (carga.dados as Record<string, unknown>[]) : carga.dados ? [carga.dados as Record<string, unknown>] : [];
  if (!cnpj) return <p className="texto-fraco">Entre no Compras.gov.br para ver as diligências.</p>;
  return (
    <Estado carregando={carga.carregando} erro={carga.erro} recarregar={carga.recarregar}>
      {lista.length === 0 ? (
        <p className="texto-fraco">Nenhuma diligência neste item.</p>
      ) : (
        <ul className="diligencias-compras">
          {lista.map((d, i) => (
            <li key={String(d.id ?? d.sequencial ?? i)}>
              <strong>{String(d.descricao ?? d.texto ?? d.motivo ?? `Diligência ${i + 1}`)}</strong>
              <span className="texto-fraco pequeno">
                {[d.dataHoraInicio && `Aberta em ${dataHora(String(d.dataHoraInicio))}`, d.dataHoraLimite && `Prazo ${dataHora(String(d.dataHoraLimite))}`, d.situacao && `Situação ${String(d.situacao)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
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
      <DadosBrutos dados={carga.dados} />
    </Estado>
  );
}

// ---------- Fase recursal ----------

function Recursos({ compra, item, cnpj, nomes }: { compra: CompraAcomp; item: ItemAcomp; cnpj: string; nomes: Map<string, string> }) {
  const caminho = `/v1/compras/${compra.chave}/itens/${item.numero}/fase-recursal/${item.sessao}`;
  const carga = useCarga(
    true,
    async () => {
      const d = await consultar(caminho).catch(async (e) => {
        if (!cnpj) throw e;
        return (await pedir({ caminho: `${FE}/v1/compras/${compra.chave}/itens/${item.numero}/fase-recursal-fornecedor/${item.sessao}`, captcha: false })).dados;
      });
      return { fase: lerFaseRecursal(d), bruto: d };
    },
    [caminho],
  );
  const [ocupado, setOcupado] = useState(false);
  const fase: FaseRecursal | null = carga.dados?.fase ?? null;
  const v1 = `${FE}/v1/compras/${compra.chave}/itens/${item.numero}`;
  const minha = fase?.empresas.find((e) => e.cnpj === cnpj);
  const nome = (c: string, n: string) => (c === cnpj ? "Você" : n || nomes.get(c) || cnpjFormatadoAcomp(c));

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
      <div className="painel-item-compras">
        {fase?.prazos.length ? (
          <div className="prazos-recurso">
            {fase.prazos.map((p) => (
              <span key={p.rotulo} className={dataDe(p.dataHora) > Date.now() ? "aberto" : ""}>
                <b>{p.rotulo}</b> até {dataHora(p.dataHora)}
              </span>
            ))}
          </div>
        ) : (
          <p className="texto-fraco">Este item ainda não tem fase recursal aberta.</p>
        )}

        <div className="linha-acoes">
          <button
            className="botao secundario pequeno"
            disabled={ocupado}
            onClick={() =>
              acao(`Registrar intenção de recurso no JULGAMENTO DA PROPOSTA do item ${item.numero}?`, { metodo: "POST", caminho: `${v1}/intencoes-recurso`, corpo: { etapaSelecaoFornecedores: "JP" } })
            }
          >
            <Scale /> Intenção de recurso (julgamento)
          </button>
          <button
            className="botao secundario pequeno"
            disabled={ocupado}
            onClick={() => acao(`Registrar intenção de recurso na HABILITAÇÃO do item ${item.numero}?`, { metodo: "POST", caminho: `${v1}/intencoes-recurso`, corpo: { etapaSelecaoFornecedores: "HF" } })}
          >
            <Scale /> Intenção de recurso (habilitação)
          </button>
          {minha?.intencao || minha?.etapa ? (
            <EnviarArquivo
              rotulo="Enviar recurso (arquivo)"
              confirmar={(n) => `Enviar "${n}" como RECURSO do item ${item.numero}? Depois de enviar, clique em "Concluir envio do recurso".`}
              enviar={async (arquivo) => {
                await pedir({ metodo: "POST", caminho: `${v1}/recursos`, arquivo });
                carga.recarregar();
              }}
            />
          ) : null}
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
                {e.temRecurso && e.cnpj !== cnpj && (
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
                      <button
                        className="botao acento pequeno"
                        disabled={ocupado}
                        onClick={() => acao("Concluir o envio da contrarrazão? Depois disso não dá para mudar.", { metodo: "PUT", caminho: `${v1}/recursos/${e.cnpj}/contrarrazoes`, corpo: null })}
                      >
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
        <DadosBrutos dados={carga.dados?.bruto} />
      </div>
    </Estado>
  );
}
