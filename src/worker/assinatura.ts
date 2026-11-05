// Assinatura digital (PAdES) com o certificado ICP-Brasil A1 da empresa.
//
// O trabalho pesado (abrir o .pfx, montar o PDF, desenhar o carimbo) roda no navegador.
// O servidor só guarda a chave criptografada e assina o resumo (hash) do PDF — assim
// a chave nunca sai do servidor e cada assinatura cabe no limite do plano grátis.

import { compararBytes, der, INTEIRO, lerCertificado, NULO, OCTETOS, OID, SEQ, SET } from "./der";

const paraBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const deBase64 = (texto: string) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

const copia = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

export { deBase64, paraBase64 };

const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

// ---------------------------------------------------------
// Criptografia da chave guardada
// ---------------------------------------------------------

async function chaveDoSegredo(segredo: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(segredo));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function cifrar(dados: Uint8Array, segredo: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chaveDoSegredo(segredo), copia(dados)));
  const tudo = new Uint8Array(iv.length + cifrado.length);
  tudo.set(iv);
  tudo.set(cifrado, iv.length);
  return paraBase64(tudo);
}

export async function decifrar(texto: string, segredo: string): Promise<Uint8Array> {
  const tudo = deBase64(texto);
  const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: tudo.slice(0, 12) }, await chaveDoSegredo(segredo), tudo.slice(12));
  return new Uint8Array(claro);
}

// ---------------------------------------------------------
// Conferência do certificado enviado pelo navegador
// ---------------------------------------------------------

export interface CertificadoConferido {
  validoDe: string;
  validoAte: string;
  serial: string;
}

/** Confere se o certificado é legível, está na validade e corresponde à chave privada. */
export async function conferirCertificado(chavePkcs8: Uint8Array, certificadoDer: Uint8Array): Promise<CertificadoConferido> {
  let cert;
  try {
    cert = lerCertificado(certificadoDer);
  } catch {
    throw new Error("Certificado inválido.");
  }
  if (cert.validoAte < new Date()) throw new Error("Este certificado já venceu.");
  let chave: CryptoKey;
  try {
    chave = await crypto.subtle.importKey("pkcs8", copia(chavePkcs8), RSA, false, ["sign"]);
  } catch {
    throw new Error("Chave privada inválida (só certificados RSA são suportados).");
  }
  const teste = crypto.getRandomValues(new Uint8Array(32));
  const assinatura = await crypto.subtle.sign(RSA.name, chave, teste);
  let confere = false;
  try {
    const publica = await crypto.subtle.importKey("spki", copia(cert.chavePublica), RSA, false, ["verify"]);
    confere = await crypto.subtle.verify(RSA.name, publica, assinatura, teste);
  } catch {
    confere = false;
  }
  if (!confere) throw new Error("A chave privada não corresponde a este certificado.");
  const valor = cert.serial.subarray(2);
  const serial = Array.from(valor, (b) => b.toString(16).padStart(2, "0")).join("");
  return { validoDe: cert.validoDe.toISOString(), validoAte: cert.validoAte.toISOString(), serial };
}

// ---------------------------------------------------------
// Assinatura PAdES (CMS destacado, ETSI.CAdES.detached)
// ---------------------------------------------------------

export interface MaterialAssinatura {
  chavePkcs8: Uint8Array;
  certificado: Uint8Array;
  cadeia: Uint8Array[];
  titular: string;
  documento: string | null;
}

const OID_SHA256 = OID("2.16.840.1.101.3.4.2.1");
const OID_RSA = OID("1.2.840.113549.1.1.1");
const OID_DADOS = OID("1.2.840.113549.1.7.1");
const OID_SIGNED_DATA = OID("1.2.840.113549.1.7.2");
const OID_CONTENT_TYPE = OID("1.2.840.113549.1.9.3");
const OID_MESSAGE_DIGEST = OID("1.2.840.113549.1.9.4");
const OID_SIGNING_CERT_V2 = OID("1.2.840.113549.1.9.16.2.47");

/**
 * Monta o CMS (PKCS#7 SignedData destacado) a partir do resumo SHA-256 do PDF, calculado no navegador.
 * Atributos assinados: content-type, message-digest e signing-certificate-v2 (exigidos pelo PAdES).
 */
export async function assinarResumo(resumo: Uint8Array, m: MaterialAssinatura): Promise<Uint8Array> {
  if (resumo.length !== 32) throw new Error("Resumo inválido.");
  const cert = lerCertificado(m.certificado);
  const hashCert = new Uint8Array(await crypto.subtle.digest("SHA-256", copia(m.certificado)));

  // ESSCertIDv2 { certHash, issuerSerial { issuer: GeneralNames [directoryName], serial } } (SHA-256 é o padrão, sem AlgorithmIdentifier)
  const issuerSerial = SEQ(SEQ(der(0xa4, cert.emissor)), cert.serial);
  const signingCertificateV2 = SEQ(SEQ(SEQ(OCTETOS(hashCert), issuerSerial)));

  const atributos = [
    SEQ(OID_CONTENT_TYPE, SET(OID_DADOS)),
    SEQ(OID_MESSAGE_DIGEST, SET(OCTETOS(resumo))),
    SEQ(OID_SIGNING_CERT_V2, SET(signingCertificateV2)),
  ].sort(compararBytes);

  // A assinatura é feita sobre os atributos codificados como SET (tag 0x31).
  const chave = await crypto.subtle.importKey("pkcs8", copia(m.chavePkcs8), RSA, false, ["sign"]);
  const assinatura = new Uint8Array(await crypto.subtle.sign(RSA.name, chave, copia(SET(...atributos))));

  const signerInfo = SEQ(
    INTEIRO(1),
    SEQ(cert.emissor, cert.serial),
    SEQ(OID_SHA256),
    der(0xa0, ...atributos),
    SEQ(OID_RSA, NULO),
    OCTETOS(assinatura),
  );
  const signedData = SEQ(
    INTEIRO(1),
    SET(SEQ(OID_SHA256)),
    SEQ(OID_DADOS),
    der(0xa0, m.certificado, ...m.cadeia),
    SET(signerInfo),
  );
  return SEQ(OID_SIGNED_DATA, der(0xa0, signedData));
}
