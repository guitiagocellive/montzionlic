import { useState } from "react";
import { hojeIso } from "../formato";
import { Campo } from "./Formulario";

// Filtro de período (este mês, 3 meses, ano...) e utilidades de relatório.

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const nomeMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

export const taxa = (g: number, p: number) => (g + p > 0 ? `${Math.round((g / (g + p)) * 100)}%` : "—");

export function periodo(tipo: string): [string, string] {
  const hoje = hojeIso();
  const [a, m] = hoje.split("-").map(Number);
  if (tipo === "mes") {
    const ultimo = new Date(a, m, 0).getDate();
    return [`${a}-${String(m).padStart(2, "0")}-01`, `${a}-${String(m).padStart(2, "0")}-${ultimo}`];
  }
  if (tipo === "trimestre") {
    const d = new Date(a, m - 3, 1);
    return [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, hoje];
  }
  if (tipo === "12meses") {
    const d = new Date(a, m - 12, 1);
    return [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, hoje];
  }
  return [`${a}-01-01`, `${a}-12-31`];
}

export function baixarCsv(nome: string, linhas: (string | number)[][]) {
  const csv = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Estado do filtro de período. */
export function usePeriodo(inicial = "ano") {
  const [tipo, setTipo] = useState(inicial);
  const [[de, ate], setDatas] = useState(() => periodo(inicial));
  function escolher(t: string) {
    setTipo(t);
    if (t !== "personalizado") setDatas(periodo(t));
  }
  return { tipo, de, ate, escolher, setDatas };
}

export function BarraPeriodo({ p }: { p: ReturnType<typeof usePeriodo> }) {
  return (
    <div className="barra-periodo entrar" style={{ ["--i" as string]: 1 }}>
      <div className="segmentado grande">
        {[
          ["mes", "Este mês"],
          ["trimestre", "3 meses"],
          ["ano", "Este ano"],
          ["12meses", "12 meses"],
          ["personalizado", "Personalizado"],
        ].map(([v, r]) => (
          <button key={v} className={p.tipo === v ? "ativo" : ""} onClick={() => p.escolher(v)}>
            {r}
          </button>
        ))}
      </div>
      {p.tipo === "personalizado" && (
        <div className="linha-acoes">
          <Campo rotulo="De" name="de" type="date" value={p.de} onChange={(e) => p.setDatas([e.target.value, p.ate])} />
          <Campo rotulo="Até" name="ate" type="date" value={p.ate} onChange={(e) => p.setDatas([p.de, e.target.value])} />
        </div>
      )}
    </div>
  );
}
