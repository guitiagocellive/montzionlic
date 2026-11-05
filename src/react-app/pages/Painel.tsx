import { CalendarClock, FileCheck2, Gavel, Send, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { Usuario } from "../../shared/tipos";

function saudacao(hora: number) {
  if (hora < 5) return "Boa noite";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function useAgora() {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return agora;
}

const INDICADORES = [
  { nome: "Licitações ativas", icone: Gavel },
  { nome: "Sessões nesta semana", icone: CalendarClock },
  { nome: "Certidões a vencer", icone: FileCheck2 },
  { nome: "Propostas enviadas", icone: Send },
];

// Alturas só decorativas: a prévia do gráfico ainda não usa dados reais.
const BARRAS = [38, 55, 44, 70, 52, 62, 92, 58, 47, 66, 40, 54];

export function Painel({ usuario }: { usuario: Usuario }) {
  const agora = useAgora();
  const primeiroNome = usuario.nome.split(" ")[0];

  return (
    <div className="grade-painel">
      <section className="cartao boas-vindas entrar" style={{ margin: 0 }}>
        <div className="boas-vindas-texto">
          <span className="rotulo">
            <span className="ponto-vivo" /> Sistema online
          </span>
          <h1>
            {saudacao(agora.getHours())}, <span className="texto-gradiente">{primeiroNome}</span>
          </h1>
          <p className="texto-suave">
            Sua central de licitações. Os módulos vão aparecer aqui conforme forem ativados.
          </p>
        </div>
        <div className="relogio">
          <strong>
            {agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </strong>
          <span>{maiuscula(agora.toLocaleDateString("pt-BR", { weekday: "long" }))}</span>
        </div>
        <svg className="onda" viewBox="0 0 1200 90" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="grad-onda" x1="0" x2="1">
              <stop offset="0" stopColor="#8b5cf6" stopOpacity="0" />
              <stop offset="0.5" stopColor="#d946ef" />
              <stop offset="1" stopColor="#ec4899" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id="grad-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#d946ef" stopOpacity="0.22" />
              <stop offset="1" stopColor="#d946ef" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 70 C120 70 160 30 260 38 S420 80 520 58 S700 12 800 30 S980 76 1080 46 S1160 30 1200 34 V90 H0Z"
            fill="url(#grad-area)"
          />
          <path
            className="linha-onda"
            d="M0 70 C120 70 160 30 260 38 S420 80 520 58 S700 12 800 30 S980 76 1080 46 S1160 30 1200 34"
            fill="none"
            stroke="url(#grad-onda)"
            strokeWidth="2.5"
          />
        </svg>
      </section>

      {INDICADORES.map(({ nome, icone: Icone }, i) => (
        <section
          key={nome}
          className="cartao indicador entrar"
          style={{ margin: 0, ["--i" as string]: i + 1 }}
        >
          <div className="indicador-topo">
            <span className="icone-brilho">
              <Icone aria-hidden="true" />
            </span>
            <span className="chip">Em breve</span>
          </div>
          <div>
            <div className="indicador-valor">—</div>
            <div className="indicador-nome">{nome}</div>
          </div>
        </section>
      ))}

      <section className="cartao atividade entrar" style={{ margin: 0, ["--i" as string]: 5 }}>
        <div className="cartao-titulo">
          <h2>
            <Sparkles size={18} color="#f0abfc" aria-hidden="true" /> Atividade
          </h2>
          <span className="chip">Prévia</span>
        </div>
        <div className="barras" aria-hidden="true">
          {BARRAS.map((h, i) => (
            <div
              key={i}
              className={`barra ${i === 6 ? "destaque" : ""}`}
              style={{ ["--h" as string]: `${h}%`, ["--i" as string]: i }}
            />
          ))}
        </div>
        <p className="legenda-previa">
          O gráfico vai mostrar o andamento das licitações quando o módulo for ativado.
        </p>
      </section>
    </div>
  );
}
