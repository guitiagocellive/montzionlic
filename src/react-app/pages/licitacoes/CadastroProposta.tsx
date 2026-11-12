import { Check, FileUp, Loader2, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { dataDe, lerAnexos, modalidadePelaChave, numeroPelaChave } from "../../../shared/acompanhamento";
import { mensagemDeErro } from "../../api";
import { avisar, Modal } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import { pedir } from "./ItemCompras";

// Cadastro de proposta no Compras.gov.br pela plataforma (fase de propostas), como a tela "Propostas" oficial:
// 1) declarações da participação (aceite, ME/EPP, programa de integridade, equidade de gênero);
// 2) proposta de cada item (valor unitário ou desconto, quantidade, marca, modelo/versão) e anexos exigidos.
// Tudo vai pelo aplicativo, com a sua sessão do gov.br, e cada envio pede confirmação.

const FE = "/comprasnet-fase-externa";

type Bruto = Record<string, unknown>;
const obj = (v: unknown): Bruto => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : {});
const txt = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const valorDe = (v: unknown): number | null => num(v) ?? num(obj(v).valorInformado) ?? num(obj(v).valorCalculado);
const lista = (d: unknown): unknown[] => {
  if (Array.isArray(d)) return d;
  const o = obj(d);
  for (const k of ["content", "itens", "lista", "resultado", "registros"]) if (Array.isArray(o[k])) return o[k] as unknown[];
  return (Object.values(o).find((v) => Array.isArray(v)) as unknown[]) ?? [];
};

interface ItemProposta {
  numero: number;
  descricao: string;
  quantidade: number | null;
  unidade: string;
  desconto: boolean;
  material: boolean;
  exclusivoMeEpp: boolean;
  srp: boolean;
  margem: boolean;
  anexoObrigatorio: boolean;
  grupo: boolean;
  proposta: { valor: number | null; quantidade: number | null; marca: string; modelo: string; pais: string; margem: string } | null;
}

function lerItem(b: unknown, srp: boolean): ItemProposta | null {
  const x = obj(b);
  const n = num(x.numero);
  if (n == null) return null;
  const p = obj(x.propostaItem);
  const tem = Object.keys(p).length > 0;
  const criterio = txt(x.criterioJulgamento);
  const desconto = x.isPorMaiorDesconto === true || criterio === "2";
  const valores = obj(p.valores);
  const trat = txt(x.tipoTratamentoDiferenciadoMeEpp);
  return {
    numero: n,
    descricao: txt(x.descricao ?? x.descricaoDetalhada) || `Item ${n}`,
    quantidade: num(x.quantidadeSolicitada ?? x.quantidade),
    unidade: txt(x.unidadeFornecimento ?? x.unidadeMedida ?? x.unidade),
    desconto,
    material: txt(x.tipoItemCatalogo) !== "S",
    exclusivoMeEpp: trat === "1" || x.participacaoExclusivaMeEppOuEquiparadas === true,
    srp,
    margem: x.utilizaMargemPreferencia === true,
    anexoObrigatorio: x.isObrigatorioEnvioAnexo === true,
    grupo: x.isGrupo === true,
    proposta: tem
      ? {
          valor: valorDe(valores.valorPropostaInicial) ?? valorDe(valores.valorPropostaInicialOuLances),
          quantidade: num(p.quantidadeOfertada),
          marca: txt(p.marcaFabricante),
          modelo: txt(p.modeloVersao),
          pais: txt(p.codigoPaisOrigemItem) || "BRA",
          margem: txt(p.declaracoesMargemPreferencia) || "0",
        }
      : null,
  };
}

const paraNumero = (s: string) => {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
};
const textoNumero = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

export function chaveDaCompra(uasg: string, modalidade: string, numero: string, ano: string) {
  const u = uasg.replace(/\D/g, ""),
    n = numero.replace(/\D/g, ""),
    a = ano.replace(/\D/g, "");
  if (!u || !n || a.length !== 4 || u.length > 6 || n.length > 5) return "";
  return u.padStart(6, "0") + modalidade + n.padStart(5, "0") + a;
}

/** Pede a compra (UASG, modalidade, número e ano) e abre o cadastro. */
export function NovaProposta({ aoFechar, aoEscolher }: { aoFechar: () => void; aoEscolher: (chave: string) => void }) {
  const [uasg, setUasg] = useState("");
  const [modalidade, setModalidade] = useState("06");
  const [numero, setNumero] = useState("");
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const chave = chaveDaCompra(uasg, modalidade, numero, ano);
  return (
    <Modal titulo="Cadastrar proposta no Compras.gov.br" aoFechar={aoFechar}>
      <form
        className="formulario nova-proposta"
        onSubmit={(e) => {
          e.preventDefault();
          if (chave) aoEscolher(chave);
        }}
      >
        <p className="texto-suave">Informe a compra como aparece no Compras.gov.br (ex.: Dispensa Eletrônica Nº 231/2026, UASG 80001).</p>
        <label>
          UASG
          <input value={uasg} onChange={(e) => setUasg(e.target.value)} inputMode="numeric" placeholder="80001" autoFocus />
        </label>
        <label>
          Modalidade
          <select value={modalidade} onChange={(e) => setModalidade(e.target.value)}>
            <option value="06">Dispensa eletrônica</option>
            <option value="05">Pregão eletrônico</option>
            <option value="03">Concorrência eletrônica</option>
          </select>
        </label>
        <div className="linha-campos">
          <label>
            Número
            <input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric" placeholder="231" />
          </label>
          <label>
            Ano
            <input value={ano} onChange={(e) => setAno(e.target.value)} inputMode="numeric" />
          </label>
        </div>
        <button className="botao acento" disabled={!chave}>
          Abrir a compra
        </button>
      </form>
    </Modal>
  );
}

export function CadastroProposta({ chave, cnpj, aoFechar }: { chave: string; cnpj: string; aoFechar: () => void }) {
  const [estado, setEstado] = useState<{ carregando: boolean; erro: string }>({ carregando: true, erro: "" });
  const [compra, setCompra] = useState<Bruto>({});
  const [participacao, setParticipacao] = useState<Bruto>({});
  const [itens, setItens] = useState<ItemProposta[]>([]);
  const [declaracoes, setDeclaracoes] = useState<string[]>([]);
  const [vez, setVez] = useState(0);
  const recarregar = useCallback(() => setVez((v) => v + 1), []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setEstado({ carregando: true, erro: "" });
      const c = obj((await pedir({ caminho: `${FE}/v1/compras/${chave}` }).catch(() => pedir({ caminho: `${FE}/v1/compras/${chave}`, captcha: true }))).dados);
      const p = obj((await pedir({ caminho: `${FE}/v1/compras/${chave}/participacao` }).catch(() => ({ dados: {} }))).dados);
      const todos: unknown[] = [];
      for (let pagina = 0; pagina < 10; pagina++) {
        const r = await pedir({ caminho: `${FE}/v1/compras/${chave}/itens`, captcha: true, query: `situacoes=1,2,3,4,5,6,7,8,9,13,14&pagina=${pagina}&tamanhoPagina=50` });
        const l = lista(r.dados);
        todos.push(...l);
        const paginas = Number(r.cabecalhos?.["pages-count"] ?? 0);
        if (l.length < 50 || (paginas && pagina + 1 >= paginas)) break;
      }
      const srp = c.comCaracteristicaSRP === true;
      // Textos das declarações: os que vêm na compra ou os do fundamento legal dela.
      let textos = Object.values(obj(c.textosDeclaracoes)).flatMap((v) => (Array.isArray(v) ? v.map(txt) : [txt(v)])).filter(Boolean);
      if (!textos.length && c.fundamentoLegal) {
        const d = await pedir({ caminho: `${FE}/v1/declaracoes`, query: `fundamentoLegal=${encodeURIComponent(txt(c.fundamentoLegal))}` }).catch(() => null);
        textos = Object.values(obj(d?.dados)).flatMap((v) => (Array.isArray(v) ? v.map(txt) : [txt(v)])).filter(Boolean);
      }
      if (!vivo) return;
      setCompra(c);
      setParticipacao(p);
      setItens(todos.map((b) => lerItem(b, srp)).filter((x): x is ItemProposta => !!x));
      setDeclaracoes(textos);
      setEstado({ carregando: false, erro: "" });
    })().catch((e) => vivo && setEstado({ carregando: false, erro: mensagemDeErro(e) }));
    return () => {
      vivo = false;
    };
  }, [chave, vez]);

  const participando = participacao.isFornecedorParticipante === true;
  const encerrado = compra.prazoCadastroPropostaEncerrado === true || (dataDe(txt(compra.dataHoraFimPropostas)) > 0 && dataDe(txt(compra.dataHoraFimPropostas)) < Date.now());
  const comProposta = itens.filter((i) => i.proposta);
  const total = comProposta.reduce((s, i) => s + (i.proposta?.valor ?? 0) * (i.proposta?.quantidade ?? i.quantidade ?? 0), 0);
  const nome = `${modalidadePelaChave(chave)} Nº ${numeroPelaChave(chave)}`;

  return (
    <Modal titulo={`Proposta · ${nome}`} aoFechar={aoFechar} largo>
      <style>{".modal.largo:has(.cadastro-proposta){max-width:1100px}"}</style>
      <div className="cadastro-proposta">
        {estado.carregando ? (
          <p className="texto-suave carregando-marcas">
            <Loader2 className="girando" size={16} /> Abrindo a compra no Compras.gov.br…
          </p>
        ) : estado.erro ? (
          <div className="alerta erro linha-erro-item">
            <span>{estado.erro}</span>
            <button className="botao secundario pequeno" onClick={recarregar}>
              Tentar de novo
            </button>
          </div>
        ) : (
          <>
            <div className="cabeca-cadastro">
              <div>
                <strong>{nome}</strong>
                <span>
                  UASG {txt(compra.numeroUasg) || chave.slice(0, 6)} {txt(compra.nomeUasg) && `- ${txt(compra.nomeUasg)}`}
                </span>
                {txt(compra.objeto) && <span className="texto-suave pequeno">{txt(compra.objeto)}</span>}
              </div>
              <div className="prazo-cadastro">
                <span>Envio de propostas até</span>
                <strong className={encerrado ? "texto-vermelho" : ""}>
                  {txt(compra.dataHoraFimPropostas) ? new Date(dataDe(txt(compra.dataHoraFimPropostas))).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}
                </strong>
                {encerrado && <span className="chip vermelho">Prazo encerrado</span>}
              </div>
            </div>
            {compra.compraNaBaseLegada === true && <p className="alerta aviso">Esta compra é do sistema antigo do Compras.gov.br: o cadastro precisa ser feito lá.</p>}

            <Declaracoes chave={chave} participacao={participacao} textos={declaracoes} encerrado={encerrado} aoSalvar={recarregar} />

            <section className={`itens-proposta ${participando ? "" : "bloqueado"}`}>
              <div className="lista-compras-topo">
                <h3>Itens ({itens.length})</h3>
                <span className="texto-suave pequeno">
                  {comProposta.length} com proposta · total {formatarMoeda(total)}
                </span>
              </div>
              {!participando && <p className="texto-fraco pequeno">Aceite as declarações acima para liberar o cadastro dos itens.</p>}
              <ul>
                {itens.map((it) => (
                  <LinhaItemProposta key={it.numero} chave={chave} cnpj={cnpj} item={it} liberado={participando && !encerrado} aoSalvar={recarregar} />
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function Declaracoes({ chave, participacao, textos, encerrado, aoSalvar }: { chave: string; participacao: Bruto; textos: string[]; encerrado: boolean; aoSalvar: () => void }) {
  const participando = participacao.isFornecedorParticipante === true;
  const [meEpp, setMeEpp] = useState<boolean | null>(participando ? participacao.declaracaoMeEpp === true : null);
  const [integridade, setIntegridade] = useState<boolean | null>(participacao.declaracaoProgramasIntegridade == null ? null : participacao.declaracaoProgramasIntegridade === true);
  const [equidade, setEquidade] = useState(txt(participacao.declaracaoEquidadeGenero) || "");
  const [aceite, setAceite] = useState(participando);
  const [salvando, setSalvando] = useState(false);
  const [editar, setEditar] = useState(!participando);
  const exigeIntegridade = participacao.exigeDeclaracaoProgramasIntegridade === true;
  const exigeEquidade = participacao.exigeDeclaracaoEquidadeGenero === true;
  const pronto = aceite && meEpp != null && (!exigeIntegridade || integridade != null) && (!exigeEquidade || !!equidade);

  async function salvar() {
    if (!window.confirm(participando ? "Alterar as declarações desta compra no Compras.gov.br?" : "Confirmar as declarações e participar desta compra no Compras.gov.br?")) return;
    setSalvando(true);
    try {
      await pedir({
        metodo: participando ? "PUT" : "POST",
        caminho: `${FE}/v1/compras/${chave}/participacao`,
        corpo: { declaracaoMeEpp: meEpp, declaracaoProgramasIntegridade: exigeIntegridade ? integridade : null, declaracaoEquidadeGenero: exigeEquidade ? equidade : null },
      });
      avisar("Declarações registradas no Compras.gov.br.");
      setEditar(false);
      aoSalvar();
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setSalvando(false);
    }
  }

  if (participando && !editar)
    return (
      <section className="declaracoes-proposta feito">
        <Check size={16} /> Declarações aceitas · ME/EPP: {participacao.declaracaoMeEpp === true ? "Sim" : "Não"}
        {!encerrado && (
          <button className="botao-link sem-margem" onClick={() => setEditar(true)}>
            Alterar
          </button>
        )}
      </section>
    );
  return (
    <section className="declaracoes-proposta">
      <h3>Declarações</h3>
      {textos.length > 0 ? (
        <div className="textos-declaracoes">
          {textos.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </div>
      ) : (
        <p className="texto-fraco pequeno">O Compras.gov.br não devolveu o texto das declarações; elas são as mesmas da tela oficial desta compra.</p>
      )}
      <label className="ciente-anexos">
        <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} disabled={encerrado} /> Li e concordo com as declarações acima
      </label>
      <div className="perguntas-declaracao">
        <fieldset>
          <legend>Declaro que sou ME/EPP (ou equiparada) e cumpro os requisitos do art. 3º da LC 123/2006</legend>
          <label>
            <input type="radio" checked={meEpp === true} onChange={() => setMeEpp(true)} disabled={encerrado} /> Sim
          </label>
          <label>
            <input type="radio" checked={meEpp === false} onChange={() => setMeEpp(false)} disabled={encerrado} /> Não
          </label>
        </fieldset>
        {exigeIntegridade && (
          <fieldset>
            <legend>Possui programa de integridade</legend>
            <label>
              <input type="radio" checked={integridade === true} onChange={() => setIntegridade(true)} /> Sim
            </label>
            <label>
              <input type="radio" checked={integridade === false} onChange={() => setIntegridade(false)} /> Não
            </label>
          </fieldset>
        )}
        {exigeEquidade && (
          <fieldset>
            <legend>Equidade de gênero</legend>
            <select value={equidade} onChange={(e) => setEquidade(e.target.value)}>
              <option value="">Escolha</option>
              <option value="O">Ouro</option>
              <option value="P">Prata</option>
              <option value="B">Bronze</option>
              <option value="N">Nenhum</option>
            </select>
          </fieldset>
        )}
      </div>
      <button className="botao acento" onClick={salvar} disabled={!pronto || salvando || encerrado}>
        {salvando ? <Loader2 className="girando" /> : <Check />} {participando ? "Salvar declarações" : "Aceitar e participar"}
      </button>
    </section>
  );
}

function LinhaItemProposta({ chave, cnpj, item: it, liberado, aoSalvar }: { chave: string; cnpj: string; item: ItemProposta; liberado: boolean; aoSalvar: () => void }) {
  const p = it.proposta;
  const [valor, setValor] = useState(textoNumero(p?.valor));
  const [quantidade, setQuantidade] = useState(textoNumero(p?.quantidade ?? it.quantidade));
  const [marca, setMarca] = useState(p?.marca ?? "");
  const [modelo, setModelo] = useState(p?.modelo ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [anexos, setAnexos] = useState<{ nome: string; id: string }[] | null>(null);
  const v = paraNumero(valor);
  const q = it.srp ? paraNumero(quantidade) : it.quantidade;
  const mudou = !p || v !== p.valor || (it.srp && q !== p.quantidade) || marca !== p.marca || modelo !== p.modelo;
  const valido = v != null && v > 0 && (!it.desconto || v <= 100) && q != null && q > 0 && (!it.material || (marca.trim() && modelo.trim()));
  const caminhoAnexos = `${FE}/v1/compras/${chave}/itens/${it.numero}/participacao/${cnpj}/anexos`;

  const carregarAnexos = useCallback(async () => {
    if (!cnpj || !it.anexoObrigatorio || !p) return;
    try {
      setAnexos(lerAnexos((await pedir({ caminho: caminhoAnexos })).dados).map((a) => ({ nome: a.nome, id: a.id })));
    } catch {
      setAnexos([]);
    }
  }, [caminhoAnexos, cnpj, it.anexoObrigatorio, p]);
  useEffect(() => {
    carregarAnexos();
  }, [carregarAnexos]);

  async function salvar() {
    const corpo = {
      quantidadeOfertada: q,
      propostaTrabalhoMre: 0,
      valor: v,
      marcaFabricante: it.material ? marca.trim() : null,
      modeloVersao: it.material ? modelo.trim() : null,
      codigoPaisOrigemItem: it.margem ? p?.pais || "BRA" : null,
      declaracoesMargemPreferencia: it.margem ? p?.margem || "0" : null,
      declaracaoConteudoNacional: false,
      modificado: true,
    };
    const texto = `${p ? "Alterar" : "Cadastrar"} a proposta do item ${it.numero}?\n\n${it.desconto ? `Desconto: ${valor}%` : `Valor unitário: ${formatarMoeda(v)}`} · Quantidade: ${q}${it.material ? `\nMarca: ${marca} · Modelo: ${modelo}` : ""}`;
    if (!window.confirm(texto)) return;
    setOcupado(true);
    try {
      await pedir({ metodo: p ? "PUT" : "POST", caminho: `${FE}/v1/compras/${chave}/itens/${it.numero}/participacao`, corpo });
      avisar(`Proposta do item ${it.numero} ${p ? "alterada" : "cadastrada"} no Compras.gov.br.`);
      aoSalvar();
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    if (!window.confirm(`Excluir a proposta do item ${it.numero} no Compras.gov.br?`)) return;
    setOcupado(true);
    try {
      await pedir({ metodo: "DELETE", caminho: `${FE}/v1/compras/${chave}/itens/${it.numero}/participacao` });
      avisar(`Proposta do item ${it.numero} excluída.`);
      aoSalvar();
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setOcupado(false);
    }
  }

  const totalItem = useMemo(() => (!it.desconto && v != null && q != null ? v * q : null), [it.desconto, v, q]);

  return (
    <li className={`item-proposta ${p ? "com-proposta" : ""}`}>
      <div className="desc-item-proposta">
        <strong>
          {it.numero} &nbsp;{it.descricao}
        </strong>
        <span className="texto-fraco pequeno">
          Qtde solicitada: {it.quantidade ?? "—"} {it.unidade} · {it.desconto ? "Maior desconto" : "Menor preço"}
          {it.exclusivoMeEpp && " · Exclusivo ME/EPP"}
          {it.srp && " · Registro de preços"}
        </span>
        {p ? <span className="chip verde">Proposta cadastrada</span> : <span className="chip cinza">Sem proposta</span>}
      </div>
      {it.grupo ? (
        <p className="texto-fraco pequeno">Item de grupo: cadastre pelo Compras.gov.br.</p>
      ) : (
        <div className="campos-item-proposta">
          <label>
            {it.desconto ? "Desconto (%)" : "Valor unitário (R$)"}
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" disabled={!liberado || ocupado} placeholder={it.desconto ? "10,5" : "0,00"} />
          </label>
          <label>
            Quantidade ofertada
            <input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} inputMode="decimal" disabled={!liberado || ocupado || !it.srp} title={it.srp ? "" : "Sem registro de preços: oferta a quantidade toda"} />
          </label>
          {it.material && (
            <>
              <label>
                Marca/Fabricante
                <input value={marca} onChange={(e) => setMarca(e.target.value)} maxLength={100} disabled={!liberado || ocupado} />
              </label>
              <label>
                Modelo/Versão
                <input value={modelo} onChange={(e) => setModelo(e.target.value)} maxLength={100} disabled={!liberado || ocupado} />
              </label>
            </>
          )}
          <div className="acoes-item-proposta">
            {totalItem != null && <span className="texto-suave pequeno">Total {formatarMoeda(totalItem)}</span>}
            <button className="botao acento pequeno" onClick={salvar} disabled={!liberado || ocupado || !valido || !mudou}>
              {ocupado ? <Loader2 className="girando" /> : <Save />} {p ? "Salvar alteração" : "Cadastrar"}
            </button>
            {p && (
              <button className="botao-icone" onClick={excluir} disabled={!liberado || ocupado} aria-label={`Excluir a proposta do item ${it.numero}`}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
      )}
      {it.anexoObrigatorio && p && (
        <div className="anexos-item-proposta">
          <span className="pequeno">Este item exige anexo da proposta:</span>
          {(anexos ?? []).map((a) => (
            <span key={a.id || a.nome} className="chip verde">
              {a.nome}
            </span>
          ))}
          {liberado && (
            <label className="botao secundario pequeno">
              <FileUp /> Anexar
              <input
                type="file"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (f.size > 30 * 1024 * 1024) return avisar("O Compras.gov.br aceita arquivos de até 30 MB.", "erro");
                  if (!window.confirm(`Enviar "${f.name}" como anexo da proposta do item ${it.numero}?\n\nDeclaro ciência de que os documentos serão divulgados com acesso irrestrito para consulta pública.`)) return;
                  try {
                    const buf = new Uint8Array(await f.arrayBuffer());
                    let s = "";
                    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
                    await pedir({ metodo: "POST", caminho: caminhoAnexos, arquivo: { nome: f.name, tipo: f.type || "application/octet-stream", base64: btoa(s) } });
                    avisar("Anexo enviado.");
                    carregarAnexos();
                  } catch (x) {
                    avisar(mensagemDeErro(x), "erro");
                  }
                }}
              />
            </label>
          )}
        </div>
      )}
    </li>
  );
}

