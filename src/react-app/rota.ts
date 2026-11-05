import { useEffect, useState } from "react";

// Navegação simples pela URL, sem biblioteca extra.

export function navegar(caminho: string) {
  if (window.location.pathname === caminho) return;
  window.history.pushState(null, "", caminho);
  window.dispatchEvent(new PopStateEvent("popstate"));
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
