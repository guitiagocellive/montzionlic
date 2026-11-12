import { useEffect } from "react";
import { avisosDe, montarCompras } from "../../shared/acompanhamento";
import { api } from "../api";
import { ponte, temPonte } from "./ponte";

// Dentro do aplicativo, em qualquer página: a cada 90 s pega o que o aplicativo leu das participações e manda
// os avisos novos (convocações, situação da proposta, mensagens do pregoeiro) para o sino da equipe.
const GUARDADOS = "montzion:avisos-acompanhamento";

function lerEnviados(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(GUARDADOS) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function guardarEnviados(s: Set<string>) {
  try {
    localStorage.setItem(GUARDADOS, JSON.stringify([...s].slice(-600)));
  } catch {
    /* sem armazenamento: o servidor já não repete */
  }
}

export function VigiaAcompanhamento() {
  useEffect(() => {
    let vivo = true;
    let parado = false;
    let ultima = 0;
    const vigiar = async () => {
      if (!vivo || parado || !temPonte()) return;
      try {
        const p = await ponte.acompanhamento("", false, ultima);
        if (!p?.em || p.igual) return;
        ultima = p.versao ?? 0;
        const enviados = lerEnviados();
        const novos = avisosDe(montarCompras(p.andamento, p.detalhes), p.agora).filter((a) => !enviados.has(a.chave));
        if (!novos.length) return;
        await api("/acompanhamento/avisos", {
          corpo: { avisos: novos.slice(0, 40).map(({ chave, compra, urgente, titulo, mensagem }) => ({ chave, compra, urgente, titulo, mensagem })) },
        });
        for (const a of novos.slice(0, 40)) enviados.add(a.chave);
        guardarEnviados(enviados);
      } catch (e) {
        // Aplicativo antigo (não conhece o pedido): para de perguntar.
        if (e instanceof Error && /desconhecido/i.test(e.message)) parado = true;
      }
    };
    const primeiro = setTimeout(vigiar, 15_000);
    const t = setInterval(vigiar, 90_000);
    return () => {
      vivo = false;
      clearTimeout(primeiro);
      clearInterval(t);
    };
  }, []);
  return null;
}
