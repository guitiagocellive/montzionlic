import { Hono } from "hono";
import type { Configuracoes } from "../../shared/tipos";
import { type Ambiente, exigirAdmin, exigirLogin } from "../auth";
import { CONFIG_PADRAO, lerConfiguracoes } from "../configuracoes";
import { lerJson } from "../validacao";

// Configurações da empresa: todos leem (usadas como padrão), só admin altera.
export const rotasConfiguracoes = new Hono<Ambiente>();
rotasConfiguracoes.use(exigirLogin);

rotasConfiguracoes.get("/", async (c) => c.json({ configuracoes: await lerConfiguracoes(c.env.DB) }));

const LIMITES: Partial<Record<keyof Configuracoes, [number, number]>> = {
  margem_padrao: [0, 95],
  imposto_padrao: [0, 95],
  alerta_sessao_dias: [0, 60],
  alerta_entrega_dias: [0, 60],
  alerta_ata_dias: [0, 365],
  alerta_documento_dias: [0, 180],
  validade_proposta_padrao: [1, 365],
};

rotasConfiguracoes.patch("/", exigirAdmin, async (c) => {
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Requisição inválida." }, 400);
  const comandos: D1PreparedStatement[] = [];

  for (const chave of Object.keys(CONFIG_PADRAO) as (keyof Configuracoes)[]) {
    if (!(chave in corpo)) continue;
    const valor = corpo[chave];
    const limite = LIMITES[chave];
    if (limite) {
      const n = Number(valor);
      if (!Number.isFinite(n) || n < limite[0] || n > limite[1]) {
        return c.json({ erro: `Valor inválido em "${chave}" (entre ${limite[0]} e ${limite[1]}).` }, 400);
      }
      comandos.push(salvar(c.env.DB, chave, chave.startsWith("alerta") || chave === "validade_proposta_padrao" ? Math.round(n) : n));
    } else {
      if (typeof valor !== "string" || valor.length > 200) return c.json({ erro: `Valor inválido em "${chave}".` }, 400);
      comandos.push(salvar(c.env.DB, chave, valor.trim()));
    }
  }
  if (comandos.length === 0) return c.json({ erro: "Nada para alterar." }, 400);
  // Mudou a antecedência dos alertas: gera as notificações de novo na próxima abertura do sino.
  comandos.push(c.env.DB.prepare("DELETE FROM configuracoes WHERE chave = 'ultima_geracao_notificacoes'"));
  await c.env.DB.batch(comandos);
  return c.json({ configuracoes: await lerConfiguracoes(c.env.DB) });
});

function salvar(db: D1Database, chave: string, valor: unknown) {
  return db
    .prepare(
      `INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
       ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = datetime('now')`,
    )
    .bind(chave, JSON.stringify(valor));
}
