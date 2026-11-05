import type { Tema } from "../shared/tipos";

// Tema claro/escuro. "sistema" segue a configuração do computador/celular.

const consulta = () => window.matchMedia("(prefers-color-scheme: light)");

export function temaSalvo(): Tema {
  try {
    const t = localStorage.getItem("tema");
    return t === "claro" || t === "escuro" || t === "sistema" ? t : "escuro";
  } catch {
    return "escuro";
  }
}

function resolver(tema: Tema): "claro" | "escuro" {
  if (tema === "sistema") return consulta().matches ? "claro" : "escuro";
  return tema;
}

let ouvinte: (() => void) | null = null;

export function aplicarTema(tema: Tema) {
  try {
    localStorage.setItem("tema", tema);
  } catch {
    // sem armazenamento: só aplica
  }
  const html = document.documentElement;
  const real = resolver(tema);
  html.dataset.tema = real;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", real === "claro" ? "#f4f4f6" : "#0a0a0c");

  if (ouvinte) consulta().removeEventListener("change", ouvinte);
  ouvinte = null;
  if (tema === "sistema") {
    ouvinte = () => aplicarTema("sistema");
    consulta().addEventListener("change", ouvinte);
  }
}

export function temaAtual(): "claro" | "escuro" {
  return document.documentElement.dataset.tema === "claro" ? "claro" : "escuro";
}
