import { type MaterialAssinatura, decifrar, deBase64 } from "./assinatura";

interface LinhaCertificado {
  titular: string;
  documento: string | null;
  valido_ate: string;
  chave_cifrada: string;
  certificado: string;
  cadeia: string;
}

/** Carrega o certificado da empresa pronto para assinar (ou lança erro com mensagem amigável). */
export async function carregarCertificado(env: Env): Promise<MaterialAssinatura> {
  if (!env.CHAVE_CERTIFICADO) {
    throw new Error("A assinatura digital ainda não foi ativada no servidor (falta o segredo CHAVE_CERTIFICADO).");
  }
  const linha = await env.DB.prepare(
    "SELECT titular, documento, valido_ate, chave_cifrada, certificado, cadeia FROM certificado_digital WHERE id = 1",
  ).first<LinhaCertificado>();
  if (!linha) throw new Error("Nenhum certificado digital cadastrado. Um administrador cadastra em Configurações → Certificado digital.");
  if (new Date(linha.valido_ate) < new Date()) throw new Error("O certificado digital da empresa venceu. Cadastre o novo em Configurações.");
  let chave: Uint8Array;
  try {
    chave = await decifrar(linha.chave_cifrada, env.CHAVE_CERTIFICADO);
  } catch {
    throw new Error("Não foi possível abrir a chave do certificado (o segredo do servidor mudou). Cadastre o certificado de novo.");
  }
  return {
    chavePkcs8: chave,
    certificado: deBase64(linha.certificado),
    cadeia: (JSON.parse(linha.cadeia) as string[]).map(deBase64),
    titular: linha.titular,
    documento: linha.documento,
  };
}
