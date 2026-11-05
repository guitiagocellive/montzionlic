import { useMemo, useState } from "react";

type Valores = Record<string, unknown>;

/** Estado de um formulário que sabe quais campos foram alterados. */
export function useFormulario<T extends Valores>(inicial: T) {
  const [base, setBase] = useState(inicial);
  const [valores, setValores] = useState(inicial);

  const alterados = useMemo(() => {
    const diff: Partial<T> = {};
    for (const chave of Object.keys(valores) as (keyof T)[]) {
      if (valores[chave] !== base[chave]) diff[chave] = valores[chave];
    }
    return diff;
  }, [valores, base]);

  return {
    valores,
    definir: <K extends keyof T>(campo: K, valor: T[K]) => setValores((v) => ({ ...v, [campo]: valor })),
    preencher: (novos: Partial<T>) => setValores((v) => ({ ...v, ...novos })),
    alterados,
    sujo: Object.keys(alterados).length > 0,
    reiniciar: (novo: T) => {
      setBase(novo);
      setValores(novo);
    },
  };
}
