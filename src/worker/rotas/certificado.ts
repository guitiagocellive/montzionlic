import { Hono } from "hono";
import { type Ambiente, exigirAdmin, exigirLogin } from "../auth";
import { cifrar, lerCertificadoA1, paraBase64 } from "../assinatura";

// Certificado digital A1 da empresa. Todos veem o status; só admin cadastra ou remove.
export const rotasCertificado = new Hono<Ambiente>();
rotasCertificado.use(exigirLogin);

rotasCertificado.get("/", async (c) => {
  const linha = await c.env.DB.prepare(
    `SELECT cd.titular, cd.documento, cd.emissor, cd.valido_de, cd.valido_ate, cd.criado_em, u.nome AS enviado_por_nome
       FROM certificado_digital cd LEFT JOIN usuarios u ON u.id = cd.enviado_por WHERE cd.id = 1`,
  ).first<{ titular: string; documento: string | null; emissor: string; valido_de: string; valido_ate: string; criado_em: string; enviado_por_nome: string | null }>();
  const segredo_configurado = !!c.env.CHAVE_CERTIFICADO;
  if (!linha) return c.json({ certificado: { configurado: false, segredo_configurado } });
  const dias = Math.floor((new Date(linha.valido_ate).getTime() - Date.now()) / 86_400_000);
  return c.json({ certificado: { configurado: true, ...linha, dias_restantes: dias, segredo_configurado } });
});

// Envio do .pfx/.p12 com a senha. A senha é usada só para abrir o arquivo e não fica guardada.
rotasCertificado.post("/", exigirAdmin, async (c) => {
  if (!c.env.CHAVE_CERTIFICADO) {
    return c.json({ erro: "Antes, configure o segredo CHAVE_CERTIFICADO no Worker (veja o README)." }, 400);
  }
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ erro: "Envio inválido." }, 400);
  const arquivo = form.get("arquivo");
  const senha = String(form.get("senha") ?? "");
  if (!arquivo || typeof arquivo === "string") return c.json({ erro: "Escolha o arquivo do certificado (.pfx ou .p12)." }, 400);
  if (arquivo.size > 100 * 1024) return c.json({ erro: "Arquivo grande demais para um certificado A1." }, 400);
  if (!senha) return c.json({ erro: "Informe a senha do certificado." }, 400);

  let cert;
  try {
    cert = lerCertificadoA1(await arquivo.arrayBuffer(), senha);
  } catch (err) {
    return c.json({ erro: (err as Error).message }, 400);
  }

  const chaveCifrada = await cifrar(cert.chavePkcs8, c.env.CHAVE_CERTIFICADO);
  await c.env.DB.prepare(
    `INSERT INTO certificado_digital (id, titular, documento, emissor, serial, valido_de, valido_ate, chave_cifrada, certificado, cadeia, enviado_por)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET titular = excluded.titular, documento = excluded.documento, emissor = excluded.emissor,
       serial = excluded.serial, valido_de = excluded.valido_de, valido_ate = excluded.valido_ate,
       chave_cifrada = excluded.chave_cifrada, certificado = excluded.certificado, cadeia = excluded.cadeia,
       enviado_por = excluded.enviado_por, criado_em = datetime('now')`,
  )
    .bind(
      cert.titular,
      cert.documento,
      cert.emissor,
      cert.serial,
      cert.validoDe,
      cert.validoAte,
      chaveCifrada,
      paraBase64(cert.certificado),
      JSON.stringify(cert.cadeia.map(paraBase64)),
      c.get("usuario").id,
    )
    .run();
  return c.json({ ok: true, titular: cert.titular, documento: cert.documento, valido_ate: cert.validoAte }, 201);
});

rotasCertificado.delete("/", exigirAdmin, async (c) => {
  await c.env.DB.prepare("DELETE FROM certificado_digital WHERE id = 1").run();
  return c.json({ ok: true });
});
