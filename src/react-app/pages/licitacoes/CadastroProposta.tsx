import {
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  FileUp,
  Hash,
  Info,
  Loader2,
  Save,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { Campo } from "../../components/Formulario";
import { temPonte } from "../../robo/ponte";
import { useCallback, useEffect, useMemo, useState } from "react";
import { lerAnexos } from "../../../shared/acompanhamento";
import { mensagemDeErro } from "../../api";
import { avisar, Modal } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import {
  buscarCompras,
  carregarCompra,
  chaveDoLink,
  type CompraCarregada,
  type CompraEncontrada,
  enviarProposta,
  FE,
  type ItemProposta,
  type NivelEquidade,
  niveisEquidade,
  paraNumero,
  prazoEncerrado,
  problemaDaProposta,
  textoNumero,
  textoValor,
  textoReferencia,
  tituloDaChave,
  txt,
  valorSugerido,
} from "./comprasCadastro";
import {
  carregarFicha,
  licitacaoDaCompra,
  type SugestaoItem,
  sugestoesDoQuadro,
} from "./sugestoesQuadro";
import { pedir } from "./ItemCompras";

export { chaveDaCompra } from "./comprasCadastro";

// Cadastro de proposta no Compras.gov.br pela plataforma (fase de propostas), como a tela "Propostas" oficial:
// 1) declarações da participação (aceite, ME/EPP, programa de integridade, equidade de gênero);
// 2) proposta de cada item (valor unitário ou desconto, quantidade, marca, modelo/versão) e anexos exigidos.
// Tudo vai pelo aplicativo, com a sua sessão do gov.br, e cada envio pede confirmação.

const dataHora = (s: string) => {
  const t = Date.parse(s);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";
};

function faltam(s: string) {
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "";
  const h = (t - Date.now()) / 3_600_000;
  if (h <= 0) return "";
  if (h < 1) return `faltam ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `faltam ${Math.round(h)} h`;
  return `faltam ${Math.round(h / 24)} dias`;
}

/** Procura a compra pelo número e pela UASG e mostra a lista; clicar abre o cadastro. */
export function NovaProposta({
  aoFechar,
  aoEscolher,
}: {
  aoFechar: () => void;
  aoEscolher: (chave: string) => void;
}) {
  const [numero, setNumero] = useState("");
  const [uasg, setUasg] = useState("");
  const [busca, setBusca] = useState<{
    carregando: boolean;
    erro: string;
    achadas: CompraEncontrada[] | null;
  }>({ carregando: false, erro: "", achadas: null });
  const pronto = /\d/.test(numero) && /\d/.test(uasg);

  async function procurar() {
    if (!pronto) return;
    setBusca({ carregando: true, erro: "", achadas: null });
    try {
      setBusca({
        carregando: false,
        erro: "",
        achadas: await buscarCompras(numero, uasg),
      });
    } catch (e) {
      setBusca({ carregando: false, erro: mensagemDeErro(e), achadas: null });
    }
  }

  return (
    <Modal titulo="Cadastrar proposta no Compras.gov.br" aoFechar={aoFechar}>
      <form
        className="nova-proposta"
        onSubmit={(e) => {
          e.preventDefault();
          procurar();
        }}
      >
        <p className="texto-suave">
          Digite o número da licitação e a UASG (o código do órgão). A
          plataforma procura as compras e você escolhe a certa.
        </p>
        <div className="busca-compra">
          <Campo
            rotulo="Número da licitação"
            name="numero"
            icone={Hash}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="90012/2026"
            autoFocus
            autoComplete="off"
          />
          <Campo
            rotulo="UASG"
            name="uasg"
            icone={Building2}
            value={uasg}
            onChange={(e) => setUasg(e.target.value)}
            inputMode="numeric"
            placeholder="80001"
            autoComplete="off"
          />
          <button
            className="botao acento"
            disabled={!pronto || busca.carregando}
          >
            {busca.carregando ? <Loader2 className="girando" /> : <Search />}{" "}
            Procurar
          </button>
        </div>
        <span className="texto-fraco pequeno">
          O ano é opcional: sem ele, a busca olha este ano e o anterior.
        </span>
      </form>
      {busca.erro && <p className="alerta erro">{busca.erro}</p>}
      {busca.carregando && (
        <p className="texto-suave carregando-marcas">
          <Loader2 className="girando" size={16} /> Procurando no PNCP e no
          Compras.gov.br…
        </p>
      )}
      {busca.achadas && (
        <div className="resultado-busca-compra">
          {busca.achadas.length === 0 ? (
            <p className="texto-fraco">
              Nenhuma compra com esse número nessa UASG. Confira o número e a
              UASG (a UASG aparece no edital e no Compras.gov.br).
            </p>
          ) : (
            <>
              <span className="texto-suave pequeno">
                {busca.achadas.length === 1
                  ? "1 compra encontrada"
                  : `${busca.achadas.length} compras encontradas`}{" "}
                · clique para cadastrar
              </span>
              <ul>
                {busca.achadas.map((c) => (
                  <li key={c.chave}>
                    <button
                      className="compra-achada"
                      onClick={() => aoEscolher(c.chave)}
                    >
                      <strong>{c.titulo}</strong>
                      {c.orgao && (
                        <span className="pequeno">
                          <Building2 size={13} /> {c.orgao}
                        </span>
                      )}
                      {c.objeto && (
                        <span className="texto-suave pequeno objeto-achado">
                          {c.objeto}
                        </span>
                      )}
                      {c.encerramento && (
                        <span className="texto-fraco pequeno">
                          <CalendarClock size={13} /> Propostas até{" "}
                          {dataHora(c.encerramento) || c.encerramento}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

export function CadastroProposta({
  chave,
  cnpj: cnpjDado,
  aoFechar,
}: {
  chave: string;
  cnpj: string;
  aoFechar: () => void;
}) {
  const [estado, setEstado] = useState<{ carregando: boolean; erro: string }>({
    carregando: true,
    erro: "",
  });
  const [dados, setDados] = useState<CompraCarregada | null>(null);
  const [vez, setVez] = useState(0);
  const recarregar = useCallback(() => setVez((v) => v + 1), []);

  useEffect(() => {
    let vivo = true;
    setEstado({ carregando: true, erro: "" });
    carregarCompra(chave).then(
      (d) => {
        if (!vivo) return;
        setDados(d);
        setEstado({ carregando: false, erro: "" });
      },
      (e) => vivo && setEstado({ carregando: false, erro: mensagemDeErro(e) }),
    );
    return () => {
      vivo = false;
    };
  }, [chave, vez]);

  const nome = tituloDaChave(chave);
  return (
    <Modal titulo={`Proposta · ${nome}`} aoFechar={aoFechar} largo>
      <style>{".modal.largo:has(.cadastro-proposta){max-width:1100px}"}</style>
      <div className="cadastro-proposta">
        {estado.carregando && !dados ? (
          <p className="texto-suave carregando-marcas">
            <Loader2 className="girando" size={16} /> Abrindo a compra no
            Compras.gov.br…
          </p>
        ) : estado.erro ? (
          <div className="alerta erro linha-erro-item">
            <span>{estado.erro}</span>
            <button className="botao secundario pequeno" onClick={recarregar}>
              Tentar de novo
            </button>
          </div>
        ) : dados ? (
          <ConteudoCadastro
            chave={chave}
            nome={nome}
            dados={dados}
            cnpj={cnpjDado || dados.cnpj}
            recarregar={recarregar}
          />
        ) : null}
      </div>
    </Modal>
  );
}

function ConteudoCadastro({
  chave,
  nome,
  dados,
  cnpj,
  recarregar,
}: {
  chave: string;
  nome: string;
  dados: CompraCarregada;
  cnpj: string;
  recarregar: () => void;
}) {
  const { compra, participacao, itens, declaracoes, itensBloqueados } = dados;
  const [soSem, setSoSem] = useState(false);
  // A mesma compra no quadro? Então valor (sigiloso/não informado), marca e modelo vêm do orçamento de lá.
  const [doQuadro, setDoQuadro] = useState<{
    sugestoes: Map<number, SugestaoItem>;
    numero: string;
  } | null>(null);
  useEffect(() => {
    let vivo = true;
    licitacaoDaCompra(chave)
      .then(async (id) => {
        if (!id) return;
        const { ficha, rascunho } = await carregarFicha(id);
        if (vivo)
          setDoQuadro({
            sugestoes: sugestoesDoQuadro(itens, ficha, rascunho),
            numero: ficha.licitacao.numero ?? "",
          });
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [chave, itens]);
  const participando = participacao.isFornecedorParticipante === true;
  const encerrado = prazoEncerrado(compra);
  const comProposta = itens.filter((i) => i.proposta && !i.grupo);
  const total = comProposta.reduce(
    (s, i) =>
      s +
      (i.desconto
        ? 0
        : (i.proposta?.valor ?? 0) *
          (i.porValorTotal
            ? 1
            : (i.proposta?.quantidade ?? i.quantidade ?? 0))),
    0,
  );
  const fim = txt(compra.dataHoraFimPropostas);
  const visiveis = soSem ? itens.filter((i) => i.grupo || !i.proposta) : itens;
  const orgao = [
    txt(compra.numeroUasg) || chave.slice(0, 6).replace(/^0+/, ""),
    txt(compra.nomeUasg),
  ]
    .filter(Boolean)
    .join(" - ");

  return (
    <>
      <div className="cabeca-cadastro">
        <div>
          <strong>{nome}</strong>
          <span>UASG {orgao}</span>
          {txt(compra.objeto ?? compra.objetoCompra) && (
            <span className="texto-suave pequeno objeto-cadastro">
              {txt(compra.objeto ?? compra.objetoCompra)}
            </span>
          )}
        </div>
        <div className={`prazo-cadastro ${encerrado ? "encerrado" : ""}`}>
          <span>Envio de propostas até</span>
          <strong>{fim ? dataHora(fim) : "—"}</strong>
          {encerrado ? (
            <span className="chip vermelho">Prazo encerrado</span>
          ) : (
            fim &&
            faltam(fim) && <span className="chip amarelo">{faltam(fim)}</span>
          )}
        </div>
      </div>
      {compra.compraNaBaseLegada === true && (
        <p className="alerta aviso">
          Esta compra é do sistema antigo do Compras.gov.br: o cadastro precisa
          ser feito lá.
        </p>
      )}

      <ol className="passos-cadastro">
        <li className={participando ? "feito" : "atual"}>
          <span>{participando ? <Check size={13} /> : 1}</span> Declarações
        </li>
        <li
          className={
            participando ? (comProposta.length ? "feito" : "atual") : ""
          }
        >
          <span>
            {comProposta.length && participando ? <Check size={13} /> : 2}
          </span>{" "}
          Propostas dos itens
        </li>
      </ol>

      <Declaracoes
        chave={chave}
        participacao={participacao}
        textos={declaracoes}
        encerrado={encerrado}
        aoSalvar={recarregar}
      />

      <section className={`itens-proposta ${participando ? "" : "bloqueado"}`}>
        <div className="lista-compras-topo">
          <h3>Itens ({itens.filter((i) => !i.grupo).length})</h3>
          <div className="resumo-itens-proposta">
            <span className="chip verde">
              {comProposta.length} com proposta
            </span>
            {total > 0 && <strong>{formatarMoeda(total)}</strong>}
            {itens.length > 6 && (
              <label className="pequeno">
                <input
                  type="checkbox"
                  checked={soSem}
                  onChange={(e) => setSoSem(e.target.checked)}
                />{" "}
                Só os sem proposta
              </label>
            )}
          </div>
        </div>
        {!participando && (
          <p className="aviso-itens-bloqueados">
            <Info size={15} />
            {itensBloqueados
              ? "Aceite as declarações acima para participar: o Compras.gov.br só mostra os itens depois disso."
              : "Aceite as declarações acima para liberar o cadastro dos itens."}
          </p>
        )}
        {itens.length > 0 && (
          <p className="nota-valor-cadastro">
            <Info size={14} />
            <span>
              O valor já vem com o <strong>valor de referência</strong> do órgão
              (o seu lance mínimo só vale na disputa). Orçamento sigiloso ou não
              informado:{" "}
              {doQuadro
                ? `calculado pelo orçamento da licitação Nº ${doQuadro.numero} do quadro.`
                : "informe o valor (ou cadastre a licitação no quadro com orçamento para a plataforma calcular)."}
            </span>
          </p>
        )}
        <ul>
          {visiveis.map((it) =>
            it.grupo ? (
              <CabecaGrupo
                key={`g${it.numero}`}
                grupo={it}
                itens={itens.filter((x) => x.grupoDe === it.numero)}
              />
            ) : (
              <LinhaItemProposta
                key={`${it.numero}-${doQuadro ? 1 : 0}`}
                chave={chave}
                cnpj={cnpj}
                item={it}
                sugestao={doQuadro?.sugestoes.get(it.numero) ?? null}
                liberado={participando && !encerrado}
                aoSalvar={recarregar}
              />
            ),
          )}
        </ul>
      </section>
    </>
  );
}

/** Cabeçalho de um grupo: a proposta do grupo é a dos itens dele (todos precisam ser cadastrados). */
function CabecaGrupo({
  grupo,
  itens,
}: {
  grupo: ItemProposta;
  itens: ItemProposta[];
}) {
  const feitos = itens.filter((x) => x.proposta).length;
  const total = itens.reduce(
    (s, x) =>
      s +
      (x.proposta?.valor ?? 0) *
        (x.porValorTotal ? 1 : (x.proposta?.quantidade ?? x.quantidade ?? 0)),
    0,
  );
  return (
    <li className="cabeca-grupo-proposta">
      <div>
        <strong>{grupo.nomeGrupo}</strong>
        <span className="texto-fraco pequeno">
          {itens.length
            ? `${itens.length} itens · cadastre todos para concorrer no grupo`
            : "Não consegui ler os itens deste grupo agora."}
          {grupo.referencia.tipo === "valor" &&
            ` · referência do grupo ${formatarMoeda(grupo.referencia.valor)}`}
          {grupo.referencia.tipo !== "valor" &&
            ` · referência ${textoReferencia(grupo.referencia)?.toLowerCase()}`}
        </span>
      </div>
      <div className="resumo-grupo-proposta">
        <span
          className={`chip ${itens.length && feitos === itens.length ? "verde" : feitos ? "amarelo" : "cinza"}`}
        >
          {feitos}/{itens.length} cadastrados
        </span>
        {total > 0 && <strong>{formatarMoeda(total)}</strong>}
      </div>
    </li>
  );
}

/** Sim / Não em botões (como a tela oficial, só que maiores). */
function SimNao({
  valor,
  mudar,
  desligado,
}: {
  valor: boolean | null;
  mudar: (v: boolean) => void;
  desligado?: boolean;
}) {
  return (
    <div className="sim-nao" role="radiogroup">
      {[true, false].map((v) => (
        <label key={String(v)} className={valor === v ? "marcado" : ""}>
          <input
            type="radio"
            checked={valor === v}
            onChange={() => mudar(v)}
            disabled={desligado}
          />{" "}
          {v ? "Sim" : "Não"}
        </label>
      ))}
    </div>
  );
}

// Valores usados antes de a lista oficial poder ser lida (aplicativo antigo).
const NIVEIS_RESERVA: NivelEquidade[] = [
  { valor: "O", rotulo: "Ouro" },
  { valor: "P", rotulo: "Prata" },
  { valor: "B", rotulo: "Bronze" },
];

export function Declaracoes({
  chave,
  participacao,
  textos,
  encerrado,
  aoSalvar,
}: {
  chave: string;
  participacao: Record<string, unknown>;
  textos: string[];
  encerrado: boolean;
  aoSalvar: () => void;
}) {
  const participando = participacao.isFornecedorParticipante === true;
  const exigeIntegridade =
    participacao.exigeDeclaracaoProgramasIntegridade === true;
  const exigeEquidade = participacao.exigeDeclaracaoEquidadeGenero === true;
  const [oficial, setOficial] = useState<{
    niveis: NivelEquidade[];
    nenhum: string;
  } | null>(null);
  const nenhum = oficial?.nenhum || "N";
  const niveis = oficial?.niveis.length ? oficial.niveis : NIVEIS_RESERVA;
  const nivelSalvo = txt(participacao.declaracaoEquidadeGenero);
  const [meEpp, setMeEpp] = useState<boolean | null>(
    participando ? participacao.declaracaoMeEpp === true : null,
  );
  const [integridade, setIntegridade] = useState<boolean | null>(
    participacao.declaracaoProgramasIntegridade == null
      ? null
      : participacao.declaracaoProgramasIntegridade === true,
  );
  const [equidadeSim, setEquidadeSim] = useState<boolean | null>(
    nivelSalvo ? nivelSalvo !== nenhum : null,
  );
  const [nivel, setNivel] = useState(
    nivelSalvo && nivelSalvo !== "N" ? nivelSalvo : "",
  );
  const [aceite, setAceite] = useState(participando);
  const [verTexto, setVerTexto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [editar, setEditar] = useState(!participando);

  useEffect(() => {
    if (exigeEquidade) niveisEquidade().then(setOficial);
  }, [exigeEquidade]);

  const pronto =
    aceite &&
    meEpp != null &&
    (!exigeIntegridade || integridade != null) &&
    (!exigeEquidade ||
      equidadeSim === false ||
      (equidadeSim === true && !!nivel));

  async function salvar() {
    if (
      !window.confirm(
        participando
          ? "Alterar as declarações desta compra no Compras.gov.br?"
          : "Confirmar as declarações e participar desta compra no Compras.gov.br?",
      )
    )
      return;
    setSalvando(true);
    try {
      await pedir({
        metodo: participando ? "PUT" : "POST",
        caminho: `${FE}/v1/compras/${chave}/participacao`,
        corpo: {
          declaracaoMeEpp: meEpp,
          declaracaoProgramasIntegridade: exigeIntegridade ? integridade : null,
          declaracaoEquidadeGenero: exigeEquidade
            ? equidadeSim
              ? nivel
              : nenhum
            : null,
        },
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
        <Check size={16} /> Declarações aceitas · ME/EPP:{" "}
        {participacao.declaracaoMeEpp === true ? "Sim" : "Não"}
        {!encerrado && (
          <button
            className="botao-link sem-margem"
            onClick={() => setEditar(true)}
          >
            Alterar
          </button>
        )}
      </section>
    );
  return (
    <section className="declaracoes-proposta">
      <h3>Declarações</h3>
      {textos.length > 0 ? (
        <div className={`textos-declaracoes ${verTexto ? "aberto" : ""}`}>
          {textos.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </div>
      ) : (
        <p className="texto-fraco pequeno">
          O Compras.gov.br não devolveu o texto das declarações; elas são as
          mesmas da tela oficial desta compra.
        </p>
      )}
      {textos.length > 0 && (
        <button
          className="botao-link sem-margem pequeno"
          onClick={() => setVerTexto((v) => !v)}
        >
          <ChevronDown size={14} className={verTexto ? "virado" : ""} />{" "}
          {verTexto ? "Recolher o texto" : "Ver o texto completo"}
        </button>
      )}
      <label className="ciente-anexos">
        <input
          type="checkbox"
          checked={aceite}
          onChange={(e) => setAceite(e.target.checked)}
          disabled={encerrado}
        />{" "}
        Li e concordo com as declarações acima
      </label>
      <div className="perguntas-declaracao">
        <div className="pergunta">
          <span>
            Sou ME/EPP (ou equiparada) e cumpro os requisitos do art. 3º da LC
            123/2006
          </span>
          <SimNao valor={meEpp} mudar={setMeEpp} desligado={encerrado} />
        </div>
        {exigeIntegridade && (
          <div className="pergunta">
            <span>Desenvolvo programa de integridade</span>
            <SimNao
              valor={integridade}
              mudar={setIntegridade}
              desligado={encerrado}
            />
          </div>
        )}
        {exigeEquidade && (
          <div className="pergunta">
            <span>
              Desenvolvo ações de equidade entre mulheres e homens no ambiente
              de trabalho (art. 60, III, da Lei 14.133/2021 e Decreto
              11.430/2023)
            </span>
            <SimNao
              valor={equidadeSim}
              mudar={setEquidadeSim}
              desligado={encerrado}
            />
            {equidadeSim && (
              <label className="nivel-equidade">
                Nível das ações
                <select
                  value={nivel}
                  onChange={(e) => setNivel(e.target.value)}
                  disabled={encerrado}
                >
                  <option value="">Escolha o nível</option>
                  {niveis.map((n) => (
                    <option key={n.valor} value={n.valor}>
                      {n.rotulo}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="ajuda-declaracao">
              <Info size={13} /> Esta pergunta só aparece em algumas compras e
              serve de critério de desempate. Os níveis (Bronze, Prata, Ouro…)
              indicam quantas das ações previstas no Decreto 11.430/2023 a
              empresa desenvolve, como paridade salarial, prevenção do assédio e
              mulheres em cargos de direção. Se a empresa não tem essas ações
              documentadas, responda <strong>Não</strong>: é a resposta segura.
            </p>
          </div>
        )}
      </div>
      <button
        className="botao acento"
        onClick={salvar}
        disabled={!pronto || salvando || encerrado}
      >
        {salvando ? <Loader2 className="girando" /> : <Check />}{" "}
        {participando ? "Salvar declarações" : "Aceitar e participar"}
      </button>
    </section>
  );
}

function LinhaItemProposta({
  chave,
  cnpj,
  item: it,
  sugestao,
  liberado,
  aoSalvar,
}: {
  chave: string;
  cnpj: string;
  item: ItemProposta;
  sugestao: SugestaoItem | null;
  liberado: boolean;
  aoSalvar: () => void;
}) {
  const p = it.proposta;
  // Sem proposta ainda: valor de referência (ou o calculado pelo orçamento quando sigiloso/não informado).
  const inicial = p
    ? null
    : (sugestao ??
      valorSugerido(it, {
        venda: null,
        custo: null,
        valorDigitado: null,
        marca: "",
        modelo: "",
      }));
  const [valor, setValor] = useState(
    it.desconto
      ? textoNumero(p?.valor)
      : textoValor(p ? p.valor : inicial?.valor),
  );
  const [quantidade, setQuantidade] = useState(
    textoNumero(p?.quantidade ?? it.quantidade ?? sugestao?.quantidade),
  );
  const [marca, setMarca] = useState(p?.marca ?? inicial?.marca ?? "");
  const [modelo, setModelo] = useState(p?.modelo ?? inicial?.modelo ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [anexos, setAnexos] = useState<{ nome: string; id: string }[] | null>(
    null,
  );
  const v = paraNumero(valor);
  const q = paraNumero(quantidade) ?? it.quantidade;
  const mudou =
    !p ||
    v !== p.valor ||
    q !== (p.quantidade ?? it.quantidade) ||
    marca !== p.marca ||
    modelo !== p.modelo;
  const valido = !problemaDaProposta(it, {
    valor: v ?? undefined,
    quantidade: q ?? undefined,
    marca,
    modelo,
  });
  const caminhoAnexos = `${FE}/v1/compras/${chave}/itens/${it.numero}/participacao/${cnpj}/anexos`;

  const carregarAnexos = useCallback(async () => {
    if (!cnpj || !it.anexoObrigatorio || !p) return;
    try {
      setAnexos(
        lerAnexos((await pedir({ caminho: caminhoAnexos })).dados).map((a) => ({
          nome: a.nome,
          id: a.id,
        })),
      );
    } catch {
      setAnexos([]);
    }
  }, [caminhoAnexos, cnpj, it.anexoObrigatorio, p]);
  useEffect(() => {
    carregarAnexos();
  }, [carregarAnexos]);

  async function salvar() {
    const texto = `${p ? "Alterar" : "Cadastrar"} a proposta do item ${it.numero}?\n\n${it.desconto ? `Desconto: ${valor}%` : `Valor unitário: ${formatarMoeda(v)}`} · Quantidade: ${q}${it.material ? `\nMarca: ${marca} · Modelo: ${modelo}` : ""}`;
    if (!window.confirm(texto)) return;
    setOcupado(true);
    try {
      await enviarProposta(chave, it, {
        valor: v!,
        quantidade: q!,
        marca,
        modelo,
      });
      avisar(
        `Proposta do item ${it.numero} ${p ? "alterada" : "cadastrada"} no Compras.gov.br.`,
      );
      aoSalvar();
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    if (
      !window.confirm(
        `Excluir a proposta do item ${it.numero} no Compras.gov.br?`,
      )
    )
      return;
    setOcupado(true);
    try {
      await pedir({
        metodo: "DELETE",
        caminho: `${FE}/v1/compras/${chave}/itens/${it.numero}/participacao`,
      });
      avisar(`Proposta do item ${it.numero} excluída.`);
      aoSalvar();
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    } finally {
      setOcupado(false);
    }
  }

  const totalItem = useMemo(
    () =>
      !it.desconto && v != null && q != null
        ? it.porValorTotal
          ? v
          : v * q
        : null,
    [it.desconto, it.porValorTotal, v, q],
  );
  const acimaEstimado =
    !it.desconto &&
    v != null &&
    it.valorEstimado != null &&
    v > it.valorEstimado + 1e-9;
  const id = (campo: string) => `${campo}-${chave}-${it.numero}`;

  return (
    <li
      className={`item-proposta ${p ? "com-proposta" : ""} ${it.grupoDe != null ? "subitem" : ""}`}
    >
      <div className="desc-item-proposta">
        <span className="numero-item-proposta">{it.numero}</span>
        <div>
          <button
            className={`texto-item-proposta ${aberto ? "aberto" : ""}`}
            onClick={() => setAberto((a) => !a)}
            title={aberto ? "Recolher" : "Ver a descrição toda"}
          >
            {it.descricao}
          </button>
          <div className="etiquetas-item-proposta">
            <span>
              {it.quantidade ?? sugestao?.quantidade ?? "—"} {it.unidade}
            </span>
            <span>{it.desconto ? "Maior desconto" : "Menor preço"}</span>
            {!it.desconto && (
              <span className="referencia-item">
                Referência:{" "}
                {it.referencia.tipo === "valor" ? (
                  <strong>
                    {formatarMoeda(it.referencia.valor)}
                    {it.porValorTotal ? " (total)" : ""}
                  </strong>
                ) : (
                  <span
                    className={`chip ${it.referencia.tipo === "sigiloso" ? "amarelo" : "cinza"}`}
                  >
                    {textoReferencia(it.referencia)}
                  </span>
                )}
              </span>
            )}
            {it.exclusivoMeEpp && <span>Exclusivo ME/EPP</span>}
            {it.srp && <span>Registro de preços</span>}
            {it.anexoObrigatorio && <span>Exige anexo</span>}
          </div>
        </div>
        {p ? (
          <span className="chip verde">Cadastrada</span>
        ) : (
          <span className="chip cinza">Sem proposta</span>
        )}
      </div>
      {it.grupo ? (
        <p className="texto-fraco pequeno">
          Item de grupo: cadastre pelo Compras.gov.br.
        </p>
      ) : (
        <div className="campos-item-proposta">
          <Campo
            rotulo={
              it.desconto
                ? "Desconto (%)"
                : it.porValorTotal
                  ? "Valor total (R$)"
                  : "Valor unitário (R$)"
            }
            id={id("valor")}
            aria-label={`Valor do item ${it.numero}`}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            disabled={!liberado || ocupado}
            placeholder={it.desconto ? "10,5" : "0,00"}
          />
          <Campo
            rotulo="Quantidade"
            id={id("quantidade")}
            aria-label={`Quantidade do item ${it.numero}`}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            inputMode="decimal"
            disabled={!liberado || ocupado}
            title={
              it.srp
                ? ""
                : "Sem registro de preços: normalmente a quantidade toda do edital"
            }
          />
          {it.material && (
            <>
              <Campo
                rotulo="Marca/Fabricante"
                id={id("marca")}
                aria-label={`Marca do item ${it.numero}`}
                value={marca}
                onChange={(e) => setMarca(e.target.value)}
                maxLength={100}
                disabled={!liberado || ocupado}
              />
              <Campo
                rotulo="Modelo/Versão"
                id={id("modelo")}
                aria-label={`Modelo do item ${it.numero}`}
                value={modelo}
                onChange={(e) => setModelo(e.target.value)}
                maxLength={100}
                disabled={!liberado || ocupado}
              />
            </>
          )}
          <div className="acoes-item-proposta">
            {totalItem != null && (
              <span
                className={`pequeno ${acimaEstimado ? "texto-vermelho" : "texto-suave"}`}
              >
                Total {formatarMoeda(totalItem)}
              </span>
            )}
            <button
              className="botao acento pequeno"
              onClick={salvar}
              disabled={!liberado || ocupado || !valido || !mudou}
            >
              {ocupado ? <Loader2 className="girando" /> : <Save />}{" "}
              {p ? "Salvar" : "Cadastrar"}
            </button>
            {p && (
              <button
                className="botao-icone"
                onClick={excluir}
                disabled={!liberado || ocupado}
                aria-label={`Excluir a proposta do item ${it.numero}`}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
      )}
      {!p && inicial?.origem && !it.grupo && (
        <span
          className={`pequeno ${inicial.aviso ? "texto-amarelo" : "texto-fraco"}`}
        >
          {inicial.aviso || `Valor preenchido: ${inicial.origem.toLowerCase()}`}
        </span>
      )}
      {acimaEstimado && (
        <span className="texto-vermelho pequeno">
          Valor acima da referência do órgão ({formatarMoeda(it.valorEstimado)}
          ).
        </span>
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
            <BotaoAnexo
              caminho={caminhoAnexos}
              numero={it.numero}
              aoEnviar={carregarAnexos}
            />
          )}
        </div>
      )}
    </li>
  );
}

/** Botão "Cadastrar proposta" para uma compra do Compras.gov.br achada na busca (o link do PNCP traz a chave). */
export function BotaoCadastrarCompra({
  link: linkCompra,
  pequeno = true,
}: {
  link: string | null | undefined;
  pequeno?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const chave = chaveDoLink(linkCompra);
  if (!chave) return null;
  return (
    <>
      <button
        className={`botao acento ${pequeno ? "pequeno" : ""}`}
        onClick={() =>
          temPonte()
            ? setAberto(true)
            : avisar(
                "Abra a plataforma pelo aplicativo Montzion e entre no Compras.gov.br para cadastrar a proposta.",
                "erro",
              )
        }
        title="Cadastrar a proposta desta compra no Compras.gov.br"
      >
        <Send /> Cadastrar proposta
      </button>
      {aberto && (
        <CadastroProposta
          chave={chave}
          cnpj=""
          aoFechar={() => setAberto(false)}
        />
      )}
    </>
  );
}

export function BotaoAnexo({
  caminho,
  numero,
  aoEnviar,
}: {
  caminho: string;
  numero: number;
  aoEnviar: () => void;
}) {
  return (
    <label className="botao secundario pequeno">
      <FileUp /> Anexar
      <input
        type="file"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 30 * 1024 * 1024)
            return avisar(
              "O Compras.gov.br aceita arquivos de até 30 MB.",
              "erro",
            );
          if (
            !window.confirm(
              `Enviar "${f.name}" como anexo da proposta do item ${numero}?\n\nDeclaro ciência de que os documentos serão divulgados com acesso irrestrito para consulta pública.`,
            )
          )
            return;
          try {
            const buf = new Uint8Array(await f.arrayBuffer());
            let s = "";
            for (let i = 0; i < buf.length; i += 32768)
              s += String.fromCharCode(...buf.subarray(i, i + 32768));
            await pedir({
              metodo: "POST",
              caminho,
              arquivo: {
                nome: f.name,
                tipo: f.type || "application/octet-stream",
                base64: btoa(s),
              },
            });
            avisar("Anexo enviado.");
            aoEnviar();
          } catch (x) {
            avisar(mensagemDeErro(x), "erro");
          }
        }}
      />
    </label>
  );
}
