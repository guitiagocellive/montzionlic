import type { InputHTMLAttributes, ReactNode } from "react";
import { Marca } from "./Marca";

interface CampoProps extends InputHTMLAttributes<HTMLInputElement> {
  rotulo: string;
  ajuda?: string;
}

export function Campo({ rotulo, ajuda, id, ...resto }: CampoProps) {
  const idCampo = id ?? resto.name;
  return (
    <label className="campo" htmlFor={idCampo}>
      <span>{rotulo}</span>
      <input id={idCampo} {...resto} />
      {ajuda && <small className="texto-suave">{ajuda}</small>}
    </label>
  );
}

export function Alerta({ tipo = "erro", children }: { tipo?: "erro" | "sucesso"; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`alerta ${tipo}`} role={tipo === "erro" ? "alert" : "status"}>
      {children}
    </div>
  );
}

/** Cartão centralizado usado nas telas de login e primeiro acesso. */
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
      <div className="cartao-acesso">
        <Marca />
        <h1>{titulo}</h1>
        {subtitulo && <p className="texto-suave">{subtitulo}</p>}
        {children}
      </div>
    </div>
  );
}
