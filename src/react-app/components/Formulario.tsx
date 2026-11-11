import { CircleAlert, CircleCheck, Eye, EyeOff, type LucideIcon } from "lucide-react";
import { type ChangeEvent, type InputHTMLAttributes, type ReactNode, useState } from "react";
import { SeletorData } from "./Calendario";
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

  // Datas abrem o calendário da plataforma (e não o seletor do navegador).
  if (type === "date") {
    const { name, value, defaultValue, onChange, disabled, min, max } = resto;
    return (
      <div className="campo">
        <label htmlFor={idCampo}>
          <span className="texto-suave pequeno">{rotulo}</span>
        </label>
        <SeletorData
          id={idCampo}
          nome={name}
          rotulo={rotulo}
          valor={value === undefined ? undefined : String(value ?? "")}
          valorInicial={defaultValue === undefined ? undefined : String(defaultValue ?? "")}
          aoMudar={(v) => onChange?.({ target: { value: v, name: name ?? "" }, currentTarget: { value: v, name: name ?? "" } } as unknown as ChangeEvent<HTMLInputElement>)}
          desabilitado={disabled}
          min={min === undefined ? undefined : String(min)}
          max={max === undefined ? undefined : String(max)}
        />
        {ajuda && <small className="texto-fraco">{ajuda}</small>}
      </div>
    );
  }

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

/** Tela de acesso (login, primeiro acesso, convite). */
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
      <div className="cartao-acesso entrar">
        <Marca />
        <h1>{titulo}</h1>
        {subtitulo && <p className="texto-suave">{subtitulo}</p>}
        {children}
      </div>
    </div>
  );
}
