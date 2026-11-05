import { Hono } from "hono";
import { type Ambiente, exigirAdmin, exigirLogin } from "../auth";
import { podeEditar } from "../../shared/permissoes";
import { assinarResumo, cifrar, conferirCertificado, deBase64, paraBase64 } from "../assinatura";
import { carregarCertificado } from "../certificado";
import { criarPedido } from "../pedidosAssinatura";
import { lerJson } from "../validacao";

// Certificado digital A1 da empresa. Todos veem o status; só admin cadastra ou remove.
export const rotasCertificado = new Hono<Ambiente>();
rotasCertificado.use(exigirLogin);

rotasCertificado.get("/", async (c) => {
  const linha = await c.env.DB.prepare(
    `SELECT cd.titular, cd.documento, cd.emissor, cd.valido_de, cd.valido_ate, cd.criado_em, u.nome AS enviado_por_nome,
            length(cd.certificado) + length(cd.cadeia) AS tamanho_certificados
       FROM certificado_digital cd LEFT JOIN usuarios u ON u.id = cd.enviado_por WHERE cd.id = 1`,
  ).first<{ titular: string; documento: string | null; emissor: string; valido_de: string; valido_ate: string; criado_em: string; enviado_por_nome: string | null; tamanho_certificados: number }>();
  const segredo_configurado = !!c.env.CHAVE_CERTIFICADO;
  if (!linha) return c.json({ certificado: { configurado: false, segredo_configurado } });
  const dias = Math.floor((new Date(linha.valido_ate).getTime() - Date.now()) / 86_400_000);
  return c.json({ certificado: { configurado: true, ...linha, dias_restantes: dias, segredo_configurado } });
});

// Cadastro: o navegador abre o .pfx com a senha (que não sai do navegador) e envia
// a chave privada e os certificados. O servidor confere e guarda a chave criptografada.
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

rotasCertificado.post("/", exigirAdmin, async (c) => {
  if (!c.env.CHAVE_CERTIFICADO) {
    return c.json({ erro: "Antes, configure o segredo CHAVE_CERTIFICADO no Worker (veja o README)." }, 400);
  }
  const corpo = await lerJson(c);
  if (!corpo) return c.json({ erro: "Envio inválido." }, 400);
  const chaveB64 = texto(corpo.chave_pkcs8, 8000);
  const certB64 = texto(corpo.certificado, 12000);
  const cadeiaB64 = Array.isArray(corpo.cadeia) ? corpo.cadeia.slice(0, 6).map((x) => texto(x, 12000)) : [];
  if (!B64.test(chaveB64) || !B64.test(certB64) || cadeiaB64.some((x) => !B64.test(x))) {
    return c.json({ erro: "Certificado inválido." }, 400);
  }
  const titular = texto(corpo.titular, 200);
  if (!titular) return c.json({ erro: "Certificado sem titular." }, 400);
  const documento = texto(corpo.documento, 14).replace(/\D/g, "") || null;

  const chave = deBase64(chaveB64);
  let conferido;
  try {
    conferido = await conferirCertificado(chave, deBase64(certB64));
  } catch (err) {
    return c.json({ erro: (err as Error).message }, 400);
  }

  const chaveCifrada = await cifrar(chave, c.env.CHAVE_CERTIFICADO);
  await c.env.DB.prepare(
    `INSERT INTO certificado_digital (id, titular, documento, emissor, serial, valido_de, valido_ate, chave_cifrada, certificado, cadeia, enviado_por)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET titular = excluded.titular, documento = excluded.documento, emissor = excluded.emissor,
       serial = excluded.serial, valido_de = excluded.valido_de, valido_ate = excluded.valido_ate,
       chave_cifrada = excluded.chave_cifrada, certificado = excluded.certificado, cadeia = excluded.cadeia,
       enviado_por = excluded.enviado_por, criado_em = datetime('now')`,
  )
    .bind(
      titular,
      documento,
      texto(corpo.emissor, 200),
      conferido.serial,
      conferido.validoDe,
      conferido.validoAte,
      chaveCifrada,
      certB64,
      JSON.stringify(cadeiaB64),
      c.get("usuario").id,
    )
    .run();
  return c.json({ ok: true, titular, documento, valido_ate: conferido.validoAte }, 201);
});

// Assina o resumo (SHA-256) de um PDF preparado no navegador e devolve a assinatura (CMS).
rotasCertificado.post("/assinar", async (c) => {
  const usuario = c.get("usuario");
  if (!podeEditar(usuario.permissoes, "assinatura")) return c.json({ erro: "Você não tem permissão para assinar documentos." }, 403);
  const corpo = await lerJson(c);
  const resumoB64 = texto(corpo?.resumo, 64);
  if (!B64.test(resumoB64)) return c.json({ erro: "Resumo inválido." }, 400);
  const resumo = deBase64(resumoB64);
  if (resumo.length !== 32) return c.json({ erro: "Resumo inválido." }, 400);
  try {
    const material = await carregarCertificado(c.env);
    const cms = await assinarResumo(resumo, material);
    const pedido = await criarPedido(c.env.DB, usuario.id, material.titular);
    return c.json({ cms: paraBase64(cms), pedido });
  } catch (err) {
    return c.json({ erro: (err as Error).message || "Não foi possível assinar." }, 400);
  }
});

rotasCertificado.delete("/", exigirAdmin, async (c) => {
  await c.env.DB.prepare("DELETE FROM certificado_digital WHERE id = 1").run();
  return c.json({ ok: true });
});
