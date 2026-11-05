import { type RefObject, useEffect } from "react";

/** Fecha um menu ao clicar fora dele ou apertar Esc. */
export function useFecharAoClicarFora(ref: RefObject<HTMLElement | null>, aberto: boolean, fechar: () => void) {
  useEffect(() => {
    if (!aberto) return;
    const aoClicar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fechar();
    };
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    document.addEventListener("mousedown", aoClicar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [ref, aberto, fechar]);
}
