import { CalendarClock, Check, CircleX, ListChecks, LogIn, RefreshCw } from "lucide-react";
import { mensagemDeErro } from "../../api";
import { avisar, Modal } from "../../components/Ui";
import { formatarMoeda } from "../../formato";
import { link } from "../../rota";
import { ponte, temPonte } from "../../robo/ponte";
import { type DadosProposta, explicarErroProposta, type ItemProposta } from "./comprasCadastro";

// Cards que aparecem depois de clicar em Cadastrar/Salvar uma proposta: "cadastrada com sucesso" (com o resumo do
// que ficou no Compras.gov.br) ou "não deu certo" (com o motivo em português, a mensagem do Compras e o que fazer).

export interface ItemEnviado {
  numero: number;
  descricao: string;
  desconto: boolean;
  porValorTotal: boolean;
  valor: number | null;
  quantidade: number | null;
  marca: string;
  modelo: string;
}

export type ResultadoEnvio =
  /** itens = os que acabaram de ir para o Compras; faltam = itens da licitação ainda sem proposta. */
  | { ok: true; alterada: boolean; itens: ItemEnviado[]; faltam?: number }
  /** falhas = itens recusados (com a mensagem do Compras); enviados = os que foram no mesmo envio. */
  | { ok: false; alterada: boolean; falhas: { item: ItemEnviado; mensagem: string }[]; enviados?: ItemEnviado[] };

export function itemEnviado(it: ItemProposta, d?: DadosProposta): ItemEnviado {
  return {
    numero: it.numero,
    descricao: it.descricao,
    desconto: it.desconto,
    porValorTotal: it.porValorTotal,
    valor: d?.valor ?? it.proposta?.valor ?? null,
    quantidade: d?.quantidade ?? it.proposta?.quantidade ?? it.quantidade,
    marca: d?.marca ?? it.proposta?.marca ?? "",
    modelo: d?.modelo ?? it.proposta?.modelo ?? "",
  };
}

const totalDo = (i: ItemEnviado) => (i.desconto || i.valor == null ? null : i.porValorTotal ? i.valor : i.valor * (i.quantidade ?? 0));

export function JanelaResultado({
  resultado,
  nome,
  orgao,
  fim,
  emCadastradas = false,
  aoFechar,
  aoTentar,
  aoContinuar,
}: {
  resultado: ResultadoEnvio;
  nome: string;
  orgao: string;
  /** Fim do envio de propostas (texto já formatado). */
  fim: string;
  /** Já está na aba Cadastradas: não mostra o atalho para ela. */
  emCadastradas?: boolean;
  aoFechar: () => void;
  /** Só no erro: manda de novo os mesmos valores. */
  aoTentar?: () => void;
  /** Sucesso com itens ainda sem proposta: volta para cadastrar os outros. */
  aoContinuar?: () => void;
}) {
  if (resultado.ok) {
    const { itens, alterada, faltam = 0 } = resultado;
    const total = itens.reduce((s, i) => s + (totalDo(i) ?? 0), 0);
    return (
      <Modal titulo={alterada ? "Proposta alterada" : "Proposta cadastrada"} aoFechar={aoFechar} classe="modal-destaque janela-resultado-proposta">
        <div className="resultado-proposta ok">
          <span className="selo-resultado" aria-hidden="true">
            <Check size={30} strokeWidth={3} />
          </span>
          <h2>{alterada ? "Proposta alterada com sucesso!" : "Licitação cadastrada com sucesso!"}</h2>
          <p className="texto-suave">
            <strong>{nome}</strong>
            {orgao && <> · UASG {orgao}</>}
          </p>
          <p className="texto-suave pequeno">
            {itens.length === 1
              ? `A proposta do item ${itens[0].numero} foi ${alterada ? "alterada" : "registrada"} no Compras.gov.br.`
              : `As propostas de ${itens.length} itens foram ${alterada ? "alteradas" : "registradas"} no Compras.gov.br.`}
          </p>
          <div className="tabela-resultado-proposta">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Valor</th>
                  <th>Qtde</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.numero}>
                    <td>
                      <strong>
                        {i.numero} · {i.descricao}
                      </strong>
                      {(i.marca || i.modelo) && <span className="texto-fraco pequeno">{[i.marca, i.modelo].filter(Boolean).join(" · ")}</span>}
                    </td>
                    <td>{i.valor == null ? "—" : i.desconto ? `${String(i.valor).replace(".", ",")}%` : formatarMoeda(i.valor)}</td>
                    <td>{i.quantidade ?? "—"}</td>
                    <td>{totalDo(i) != null ? formatarMoeda(totalDo(i)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              {itens.length > 1 && total > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total enviado</td>
                    <td>{formatarMoeda(total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {faltam > 0 && (
            <p className="nota-resultado-proposta falta">
              Ainda {faltam === 1 ? "falta 1 item" : `faltam ${faltam} itens`} desta licitação sem proposta.
            </p>
          )}
          {fim && (
            <p className="nota-resultado-proposta">
              <CalendarClock size={15} /> Até {fim} dá para alterar ou excluir a proposta{emCadastradas ? "." : " na aba Cadastradas."}
            </p>
          )}
          <div className="linha-acoes centro">
            {!emCadastradas && (
              <a
                className="botao secundario"
                href="/licitacoes/cadastradas"
                onClick={(e) => {
                  link("/licitacoes/cadastradas").onClick(e);
                  aoFechar();
                }}
              >
                <ListChecks /> Ver em Cadastradas
              </a>
            )}
            {faltam > 0 && aoContinuar && (
              <button className="botao secundario" onClick={aoContinuar}>
                Cadastrar os outros itens
              </button>
            )}
            <button className="botao acento" onClick={aoFechar} autoFocus>
              Concluir
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const { falhas, alterada, enviados = [] } = resultado;
  const { item, mensagem } = falhas[0];
  const { motivo, dica } = explicarErroProposta(mensagem);
  const login = falhas.some((f) => explicarErroProposta(f.mensagem).login);
  async function entrar() {
    try {
      await ponte.entrar(true);
      avisar("Entre na janela do gov.br que abriu e depois clique em Tentar de novo.");
    } catch (e) {
      avisar(mensagemDeErro(e), "erro");
    }
  }
  return (
    <Modal titulo={alterada ? "Proposta não alterada" : "Proposta não cadastrada"} aoFechar={aoFechar} classe="modal-destaque janela-resultado-proposta">
      <div className="resultado-proposta erro">
        <span className="selo-resultado" aria-hidden="true">
          <CircleX size={32} />
        </span>
        <h2>{alterada ? "Não deu certo alterar a proposta" : "Não deu certo cadastrar a proposta"}</h2>
        <p className="texto-suave">
          <strong>{nome}</strong>
          {falhas.length === 1 ? (
            <>
              {" "}
              · item {item.numero} · {item.descricao}
            </>
          ) : (
            <> · {falhas.length} itens não foram aceitos</>
          )}
        </p>
        {enviados.length > 0 && (
          <p className="texto-suave pequeno">
            {enviados.length === 1 ? `O item ${enviados[0].numero} foi registrado.` : `${enviados.length} itens foram registrados.`} A janela continua aberta para corrigir o resto.
          </p>
        )}
        {falhas.length === 1 ? (
          <>
            <div className="motivo-resultado">
              <span className="texto-fraco pequeno">Motivo</span>
              <strong>{motivo}</strong>
              <span>{dica}</span>
            </div>
            <p className="mensagem-compras-resultado">
              <span className="texto-fraco pequeno">Mensagem do Compras.gov.br</span>
              <span>“{mensagem}”</span>
            </p>
          </>
        ) : (
          <ul className="falhas-resultado">
            {falhas.map((f) => {
              const e = explicarErroProposta(f.mensagem);
              return (
                <li key={f.item.numero}>
                  <strong>
                    Item {f.item.numero} · {f.item.descricao}
                  </strong>
                  <span>{e.motivo}</span>
                  <span className="texto-fraco pequeno">“{f.mensagem}”</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="linha-acoes centro">
          {login && temPonte() && (
            <button className="botao secundario" onClick={entrar}>
              <LogIn /> Entrar com gov.br
            </button>
          )}
          <button className="botao secundario" onClick={aoFechar}>
            Voltar e corrigir
          </button>
          {aoTentar && (
            <button className="botao acento" onClick={aoTentar} autoFocus>
              <RefreshCw /> Tentar de novo
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
