import { CircleAlert, CircleCheck, Eye, EyeOff, type LucideIcon } from "lucide-react";
import { type InputHTMLAttributes, type ReactNode, useState } from "react";
import { Marca } from "./Marca";

interface CampoProps extends InputHTMLAttributes<HTMLInputElement> {
  rotulo: string;
  ajuda?: string;
  icone?: LucideIcon;
}

export function Campo({ rotulo, ajuda, icone: Icone, id, type, ...resto }: CampoProps) {
  const idCampo = id ?? resto.name;
  const ehSenha = type === "password";
  const [mostrar, setMostrar] = useState(false);

  const classes = ["entrada", Icone && "com-icone", ehSenha && "com-olho"].filter(Boolean);

  return (
    <div className="campo">
      <label htmlFor={idCampo}>
        <span className="texto-suave pequeno">{rotulo}</span>
      </label>
      <div className={classes.join(" ")}>
        {Icone && <Icone aria-hidden="true" />}
        <input id={idCampo} type={ehSenha && mostrar ? "text" : type} {...resto} />
        {ehSenha && (
          <button
            type="button"
            className="botao-olho"
            onClick={() => setMostrar((v) => !v)}
            aria-label={mostrar ? "Esconder senha" : "Mostrar senha"}
          >
            {mostrar ? <EyeOff /> : <Eye />}
          </button>
        )}
      </div>
      {ajuda && <small className="texto-fraco">{ajuda}</small>}
    </div>
  );
}

export function Alerta({
  tipo = "erro",
  children,
}: {
  tipo?: "erro" | "sucesso";
  children: ReactNode;
}) {
  if (!children) return null;
  const Icone = tipo === "erro" ? CircleAlert : CircleCheck;
  return (
    <div className={`alerta ${tipo}`} role={tipo === "erro" ? "alert" : "status"}>
      <Icone aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/** Tela de acesso (login, primeiro acesso) com planeta brilhante ao fundo. */
export function CartaoAcesso({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  children: ReactNode;
}) {
  return (
    <div className="tela-central">
      <div className="estrelas" aria-hidden="true" />
      <div className="planeta" aria-hidden="true" />
      <div className="cartao-acesso entrar">
        <Marca />
        <h1>{titulo}</h1>
        {subtitulo && <p className="texto-suave">{subtitulo}</p>}
        {children}
      </div>
    </div>
  );
}
