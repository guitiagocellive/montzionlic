import type { Tema, TemaClaro, TemaEscuro } from "../shared/tipos";

// Modo (claro/escuro/sistema) + o tema escolhido para cada modo.
// O resultado vai para <html data-tema="claro|escuro" data-paleta="ceu|lavanda|oceano|grafite">.

export interface PreferenciaTema {
  modo: Tema;
  claro: TemaClaro;
  escuro: TemaEscuro;
}

const consulta = () => window.matchMedia("(prefers-color-scheme: light)");

function guardar(p: PreferenciaTema) {
  try {
    localStorage.setItem("tema", p.modo);
    localStorage.setItem("tema-claro", p.claro);
    localStorage.setItem("tema-escuro", p.escuro);
  } catch {
    // sem armazenamento: só aplica
  }
}

let atual: PreferenciaTema = { modo: "escuro", claro: "ceu", escuro: "oceano" };
let ouvinte: (() => void) | null = null;

export function aplicarTema(p: PreferenciaTema) {
  atual = p;
  guardar(p);
  const modo = p.modo === "sistema" ? (consulta().matches ? "claro" : "escuro") : p.modo;
  const html = document.documentElement;
  html.dataset.tema = modo;
  html.dataset.paleta = modo === "claro" ? p.claro : p.escuro;
  const cor = getComputedStyle(html).getPropertyValue("--fundo").trim();
  if (cor) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", cor);

  if (ouvinte) consulta().removeEventListener("change", ouvinte);
  ouvinte = null;
  if (p.modo === "sistema") {
    ouvinte = () => aplicarTema(atual);
    consulta().addEventListener("change", ouvinte);
  }
}

export function preferenciaAtual(): PreferenciaTema {
  return atual;
}

export function modoVisivel(): "claro" | "escuro" {
  return document.documentElement.dataset.tema === "claro" ? "claro" : "escuro";
}
