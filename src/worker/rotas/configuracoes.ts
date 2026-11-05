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
    if (!(chave in corpo) || chave === "empresa_logo_chave") continue;
    const valor = corpo[chave];
    const limite = LIMITES[chave];
    if (limite) {
      const n = Number(valor);
      if (!Number.isFinite(n) || n < limite[0] || n > limite[1]) {
        return c.json({ erro: `Valor inválido em "${chave}" (entre ${limite[0]} e ${limite[1]}).` }, 400);
      }
      comandos.push(salvar(c.env.DB, chave, chave.startsWith("alerta") || chave === "validade_proposta_padrao" ? Math.round(n) : n));
    } else {
      const limite = chave === "proposta_declaracao" ? 3000 : 200;
      if (typeof valor !== "string" || valor.length > limite) return c.json({ erro: `Valor inválido em "${chave}".` }, 400);
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

// ---------- Logo da empresa (usada na proposta em PDF) ----------

const TIPOS_LOGO = new Set(["image/png", "image/jpeg"]);

rotasConfiguracoes.get("/logo", async (c) => {
  const config = await lerConfiguracoes(c.env.DB);
  if (!config.empresa_logo_chave) return c.json({ erro: "Sem logo." }, 404);
  const objeto = await c.env.ARQUIVOS.get(config.empresa_logo_chave);
  if (!objeto) return c.json({ erro: "Sem logo." }, 404);
  return new Response(objeto.body, {
    headers: { "Content-Type": objeto.httpMetadata?.contentType ?? "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300" },
  });
});

rotasConfiguracoes.post("/logo", exigirAdmin, async (c) => {
  const form = await c.req.formData().catch(() => null);
  const logo = form?.get("logo");
  if (!logo || typeof logo === "string") return c.json({ erro: "Escolha a imagem do logo." }, 400);
  if (!TIPOS_LOGO.has(logo.type)) return c.json({ erro: "Use uma imagem PNG ou JPG." }, 400);
  if (logo.size > 1.5 * 1024 * 1024) return c.json({ erro: "O logo passa de 1,5 MB." }, 400);
  const anterior = (await lerConfiguracoes(c.env.DB)).empresa_logo_chave;
  const chave = `empresa/logo-${crypto.randomUUID()}`;
  await c.env.ARQUIVOS.put(chave, logo.stream(), { httpMetadata: { contentType: logo.type } });
  await salvar(c.env.DB, "empresa_logo_chave", chave).run();
  if (anterior) await c.env.ARQUIVOS.delete(anterior);
  return c.json({ ok: true });
});

rotasConfiguracoes.delete("/logo", exigirAdmin, async (c) => {
  const anterior = (await lerConfiguracoes(c.env.DB)).empresa_logo_chave;
  if (anterior) await c.env.ARQUIVOS.delete(anterior);
  await salvar(c.env.DB, "empresa_logo_chave", "").run();
  return c.json({ ok: true });
});
