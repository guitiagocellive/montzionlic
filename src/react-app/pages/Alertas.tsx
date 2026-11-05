import { ArrowRight, BellRing, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { Alerta, Usuario } from "../../shared/tipos";
import { api, mensagemDeErro } from "../api";
import { avisar, Carregando, Vazio } from "../components/Ui";
import { link } from "../rota";
import { ICONES_ALERTA } from "./Painel";

const GRUPOS: { chave: Alerta["gravidade"]; titulo: string }[] = [
  { chave: "urgente", titulo: "Urgente" },
  { chave: "atencao", titulo: "Atenção" },
  { chave: "info", titulo: "Para acompanhar" },
];

export function Alertas({ usuario }: { usuario: Usuario }) {
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [filtro, setFiltro] = useState<"todos" | Alerta["gravidade"]>("todos");

  useEffect(() => {
    api<{ alertas: Alerta[] }>("/alertas").then(
      (r) => setAlertas(r.alertas),
      (err) => avisar(mensagemDeErro(err), "erro"),
    );
  }, []);

  const conta = (g: Alerta["gravidade"]) => (alertas ?? []).filter((a) => a.gravidade === g).length;

  return (
    <>
      <div className="cabecalho-pagina entrar">
        <div>
          <span className="sobretitulo">Visão geral</span>
          <h1>Alertas</h1>
          <p className="texto-suave">Sessões próximas, orçamentos pendentes, entregas e atas vencendo.</p>
        </div>
        {usuario.papel === "admin" && (
          <a className="botao secundario" {...link("/configuracoes/alertas")}>
            <Settings /> Antecedência dos alertas
          </a>
        )}
      </div>

      <div className="pilulas entrar" style={{ marginTop: 18, ["--i" as string]: 1 }}>
        <button className={`pilula ${filtro === "todos" ? "ativa" : ""}`} onClick={() => setFiltro("todos")}>
          Todos <span>{alertas?.length ?? 0}</span>
        </button>
        {GRUPOS.map((g) => (
          <button key={g.chave} className={`pilula ${filtro === g.chave ? "ativa" : ""}`} onClick={() => setFiltro(g.chave)}>
            {g.titulo} <span>{conta(g.chave)}</span>
          </button>
        ))}
      </div>

      {alertas === null ? (
        <Carregando />
      ) : alertas.length === 0 ? (
        <section className="cartao">
          <Vazio icone={<BellRing />} titulo="Nenhum alerta agora">
            Quando houver sessões próximas, entregas ou atas vencendo, elas aparecem aqui e no sino.
          </Vazio>
        </section>
      ) : (
        GRUPOS.filter((g) => (filtro === "todos" || filtro === g.chave) && conta(g.chave) > 0).map((g, gi) => (
          <div key={g.chave} className="grupo-alertas entrar" style={{ ["--i" as string]: gi + 2 }}>
            <h3>{g.titulo}</h3>
            <div className="lista-alertas grande">
              {alertas
                .filter((a) => a.gravidade === g.chave)
                .map((a, i) => {
                  const Icone = ICONES_ALERTA[a.tipo];
                  return (
                    <a key={i} className="item-alerta" {...link(a.link)}>
                      <span className={`icone-redondo ${a.gravidade}`}>
                        <Icone />
                      </span>
                      <span>
                        <strong>{a.titulo}</strong>
                        <small>{a.detalhe}</small>
                      </span>
                      <ArrowRight />
                    </a>
                  );
                })}
            </div>
          </div>
        ))
      )}
    </>
  );
}
