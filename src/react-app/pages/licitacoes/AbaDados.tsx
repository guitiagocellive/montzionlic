import { Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { FASES, MODALIDADES, PORTAIS } from "../../../shared/negocio";
import type { Licitacao } from "../../../shared/tipos";
import { api, mensagemDeErro } from "../../api";
import { Campo } from "../../components/Formulario";
import { avisar, CampoArea, CampoSelect, Interruptor } from "../../components/Ui";
import { useFormulario } from "../../components/useFormulario";
import { paraNumero } from "../../formato";

function valoresIniciais(l: Licitacao) {
  return {
    numero: l.numero ?? "",
    uasg: l.uasg ?? "",
    orgao: l.orgao ?? "",
    objeto: l.objeto ?? "",
    modalidade: l.modalidade ?? "",
    nicho: l.nicho ?? "",
    data_sessao: l.data_sessao ?? "",
    horario: l.horario ?? "",
    portal: l.portal ?? "",
    link: l.link ?? "",
    registro_preco: l.registro_preco === 1,
    fase: l.fase ?? "",
    valor_estimado: l.valor_estimado == null ? "" : String(l.valor_estimado),
    responsavel_id: l.responsavel_id == null ? "" : String(l.responsavel_id),
    observacoes: l.observacoes ?? "",
  };
}

export function AbaDados({ licitacao, aoSalvar }: { licitacao: Licitacao; aoSalvar: () => Promise<void> | void }) {
  const form = useFormulario(valoresIniciais(licitacao));
  const [equipe, setEquipe] = useState<{ id: number; nome: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const v = form.valores;

  useEffect(() => {
    form.reiniciar(valoresIniciais(licitacao));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licitacao]);

  useEffect(() => {
    api<{ equipe: { id: number; nome: string }[] }>("/equipe").then((r) => setEquipe(r.equipe), () => {});
  }, []);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const corpo: Record<string, unknown> = { ...form.alterados };
    if ("valor_estimado" in corpo) corpo.valor_estimado = paraNumero(String(corpo.valor_estimado));
    setSalvando(true);
    try {
      await api(`/licitacoes/${licitacao.id}`, { metodo: "PATCH", corpo });
      avisar("Dados salvos.");
      await aoSalvar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    } finally {
      setSalvando(false);
    }
  }

  const texto = (campo: keyof typeof v) => ({
    name: campo,
    value: v[campo] as string,
    onChange: (e: { target: { value: string } }) => form.definir(campo, e.target.value as never),
  });

  return (
    <form className="formulario" onSubmit={salvar}>
      <section className="cartao">
        <h2>Principal</h2>
        <div className="grade-3">
          <Campo rotulo="Número da licitação" placeholder="90012/2026" {...texto("numero")} />
          <CampoSelect rotulo="Modalidade" opcoes={MODALIDADES} vazio="Selecione" {...texto("modalidade")} />
          <CampoSelect
            rotulo="Responsável"
            vazio="Ninguém"
            opcoes={equipe.map((p) => ({ valor: String(p.id), texto: p.nome }))}
            {...texto("responsavel_id")}
          />
        </div>
        <Campo rotulo="Órgão" placeholder="Nome do órgão público" {...texto("orgao")} />
        <CampoArea rotulo="Objeto" placeholder="O que está sendo comprado" rows={2} {...texto("objeto")} />
        <div className="grade-4">
          <Campo rotulo="Data da sessão" type="date" {...texto("data_sessao")} />
          <Campo rotulo="Horário (Brasília)" type="time" {...texto("horario")} />
          <div className="campo">
            <label htmlFor="portal">
              <span className="texto-suave pequeno">Portal</span>
            </label>
            <div className="entrada">
              <input id="portal" list="lista-portais" placeholder="Ex.: Compras.gov.br" {...texto("portal")} />
            </div>
            <datalist id="lista-portais">
              {PORTAIS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <Campo rotulo="Link da licitação" type="url" placeholder="https://" {...texto("link")} />
        </div>
      </section>

      <details className="cartao mais-detalhes">
        <summary>
          <strong>Mais detalhes</strong>
          <span className="texto-fraco pequeno">
            {[v.uasg && `UASG ${v.uasg}`, v.nicho, v.valor_estimado && `R$ ${v.valor_estimado}`, v.fase, v.registro_preco && "SRP", v.observacoes && "com anotações"]
              .filter(Boolean)
              .join(" · ") || "UASG, nicho, valor estimado, fase, registro de preço e anotações"}
          </span>
        </summary>
        <div className="grade-4">
          <Campo rotulo="UASG / código do órgão" placeholder="160123" {...texto("uasg")} />
          <Campo rotulo="Nicho" placeholder="Ex.: Informática" {...texto("nicho")} />
          <Campo rotulo="Valor estimado (R$)" type="number" step="0.01" min="0" {...texto("valor_estimado")} />
          <div className="campo">
            <label htmlFor="fase">
              <span className="texto-suave pequeno">Fase</span>
            </label>
            <div className="entrada">
              <input id="fase" list="lista-fases" placeholder="Ex.: Disputa de lances" {...texto("fase")} />
            </div>
            <datalist id="lista-fases">
              {FASES.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
        </div>
        <Interruptor
          rotulo="É registro de preço (SRP)"
          ligado={v.registro_preco}
          aoMudar={(ligado) => form.definir("registro_preco", ligado)}
        />
        <CampoArea rotulo="Anotações da equipe" rows={3} {...texto("observacoes")} />
      </details>

      <div className={`barra-salvar ${form.sujo ? "visivel" : ""}`}>
        <span>Você tem alterações não salvas.</span>
        <button type="button" className="botao secundario" onClick={() => form.reiniciar(valoresIniciais(licitacao))}>
          Descartar
        </button>
        <button className="botao" disabled={salvando || !form.sujo}>
          <Save aria-hidden="true" /> {salvando ? "Salvando…" : "Salvar dados"}
        </button>
      </div>
    </form>
  );
}
