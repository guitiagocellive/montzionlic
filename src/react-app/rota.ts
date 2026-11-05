import { type MouseEvent, useEffect, useState } from "react";

// Navegação simples pela URL, sem biblioteca extra.

export function navegar(caminho: string) {
  if (window.location.pathname + window.location.search === caminho) return;
  window.history.pushState(null, "", caminho);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

export function useCaminho(): string {
  const [caminho, setCaminho] = useState(window.location.pathname);
  useEffect(() => {
    const atualizar = () => setCaminho(window.location.pathname);
    window.addEventListener("popstate", atualizar);
    return () => window.removeEventListener("popstate", atualizar);
  }, []);
  return caminho;
}

/** Confere se o caminho bate com o padrão (ex.: "/licitacoes/:id") e devolve os parâmetros. */
export function combinar(caminho: string, padrao: string): Record<string, string> | null {
  const partes = caminho.replace(/\/+$/, "").split("/");
  const esperado = padrao.split("/");
  if (partes.length !== esperado.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < esperado.length; i++) {
    if (esperado[i].startsWith(":")) params[esperado[i].slice(1)] = decodeURIComponent(partes[i]);
    else if (esperado[i] !== partes[i]) return null;
  }
  return params;
}

/** Props para um link que navega sem recarregar a página. */
export function link(destino: string) {
  return {
    href: destino,
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navegar(destino);
    },
  };
}
