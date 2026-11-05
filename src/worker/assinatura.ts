// Assinatura digital de PDFs com certificado ICP-Brasil A1 (.pfx), padrão PAdES.
//
// - Na hora de cadastrar, o .pfx é aberto com a senha e só a chave privada (PKCS#8)
//   e os certificados são guardados — a chave vai criptografada (AES-GCM) com o
//   segredo CHAVE_CERTIFICADO do Worker. A senha do .pfx não é guardada.
// - Para assinar, a chave é decifrada só durante a assinatura e usada pela WebCrypto.

import * as asn1js from "asn1js";
import * as forgeModulo from "node-forge";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as pkijs from "pkijs";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import * as signpdfModulo from "@signpdf/signpdf";
import * as utilsModulo from "@signpdf/utils";
import { limparTexto } from "./propostaPdf";

// Pacotes CommonJS: dependendo do empacotador, o conteúdo fica em .default.
const forge = ((forgeModulo as unknown as { default?: typeof forgeModulo }).default ?? forgeModulo) as typeof forgeModulo;
type ClasseSignPdf = new () => { sign(pdf: Buffer, signer: { sign(conteudo: Buffer): Promise<Buffer> }): Promise<Buffer> };
const modSign = signpdfModulo as unknown as { SignPdf?: ClasseSignPdf; default?: { SignPdf?: ClasseSignPdf } };
const SignPdf = (modSign.SignPdf ?? modSign.default?.SignPdf) as ClasseSignPdf;
type ClasseSigner = new () => { sign(conteudo: Buffer): Promise<Buffer> };
const modUtils = utilsModulo as unknown as { Signer?: ClasseSigner; SUBFILTER_ETSI_CADES_DETACHED?: string; default?: { Signer?: ClasseSigner; SUBFILTER_ETSI_CADES_DETACHED?: string } };
const Signer = (modUtils.Signer ?? modUtils.default?.Signer) as ClasseSigner;
const SUBFILTER_ETSI_CADES_DETACHED = modUtils.SUBFILTER_ETSI_CADES_DETACHED ?? modUtils.default?.SUBFILTER_ETSI_CADES_DETACHED ?? "ETSI.CAdES.detached";

// ---------------------------------------------------------
// Utilitários
// ---------------------------------------------------------

const paraBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const deBase64 = (texto: string) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

const binarioParaBytes = (bin: string) => Uint8Array.from(bin, (c) => c.charCodeAt(0));
const bytesParaBinario = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};

const copia = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

// ---------------------------------------------------------
// Leitura do certificado A1
// ---------------------------------------------------------

export interface CertificadoLido {
  chavePkcs8: Uint8Array;
  certificado: Uint8Array;
  cadeia: Uint8Array[];
  titular: string;
  documento: string | null;
  emissor: string;
  serial: string;
  validoDe: string;
  validoAte: string;
}

// OIDs ICP-Brasil (DOC-ICP-04) para CNPJ e CPF no "otherName" do certificado.
const OID_CNPJ = "2.16.76.1.3.3";
const OID_DADOS_PF = "2.16.76.1.3.1";

function atributo(nome: forgeModulo.pki.CertificateField[] | undefined, chave: string) {
  return nome?.find((a) => a.shortName === chave || a.name === chave)?.value as string | undefined;
}

/** Procura CNPJ/CPF: primeiro no otherName (padrão ICP-Brasil), depois no nome comum ("EMPRESA:CNPJ"). */
function documentoDoCertificado(cert: forgeModulo.pki.Certificate, nomeComum: string): string | null {
  try {
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const texto = der;
    for (const oid of [OID_CNPJ, OID_DADOS_PF]) {
      const oidDer = forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OID, false, forge.asn1.oidToDer(oid).getBytes())).getBytes();
      const pos = texto.indexOf(oidDer);
      if (pos >= 0) {
        const trecho = texto.slice(pos, pos + 120).replace(/[^0-9]/g, " ");
        const cnpj = trecho.match(/\d{14}/);
        if (oid === OID_CNPJ && cnpj) return cnpj[0];
        if (oid === OID_DADOS_PF) {
          // Dados de pessoa física: data de nascimento (8) + CPF (11) ...
          const cpf = trecho.replace(/\s+/g, "").slice(8, 19);
          if (/^\d{11}$/.test(cpf)) return cpf;
        }
      }
    }
  } catch {
    // segue para o nome comum
  }
  const m = nomeComum.match(/:(\d{11}|\d{14})\s*$/);
  return m ? m[1] : null;
}

/** Abre o .pfx com a senha e devolve a chave e os certificados. Lança erro com mensagem amigável. */
export function lerCertificadoA1(pfx: ArrayBuffer, senha: string): CertificadoLido {
  let p12: forgeModulo.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(bytesParaBinario(new Uint8Array(pfx)));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (/mac|password|invalid/i.test(msg)) throw new Error("Senha do certificado incorreta (ou arquivo inválido).");
    throw new Error("Não foi possível abrir o certificado. Confira se é um arquivo .pfx ou .p12 de certificado A1.");
  }

  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const chave = chaves.find((b) => b.key)?.key as forgeModulo.pki.rsa.PrivateKey | undefined;
  if (!chave) throw new Error("O arquivo não tem a chave privada. Exporte o certificado A1 com a chave privada.");
  if (!("n" in chave)) throw new Error("Só certificados com chave RSA são suportados.");

  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b: forgeModulo.pkcs12.Bag) => b.cert)
    .filter((c: forgeModulo.pki.Certificate | undefined): c is forgeModulo.pki.Certificate => !!c);
  // O certificado do titular é o que tem a mesma chave pública da chave privada.
  const titularCert = certs.find((c: forgeModulo.pki.Certificate) => {
    const pub = c.publicKey as forgeModulo.pki.rsa.PublicKey;
    return pub.n && pub.n.equals(chave.n);
  });
  if (!titularCert) throw new Error("Não encontrei o certificado correspondente à chave privada.");

  const agora = new Date();
  if (titularCert.validity.notAfter < agora) throw new Error("Este certificado já venceu.");

  const paraDer = (c: forgeModulo.pki.Certificate) => binarioParaBytes(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes());
  const pkcs8 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(chave));
  const nomeComum = atributo(titularCert.subject.attributes, "CN") ?? "Titular";

  return {
    chavePkcs8: binarioParaBytes(forge.asn1.toDer(pkcs8).getBytes()),
    certificado: paraDer(titularCert),
    cadeia: certs.filter((c: forgeModulo.pki.Certificate) => c !== titularCert).map(paraDer),
    titular: nomeComum.replace(/:\d{11,14}\s*$/, "").trim(),
    documento: documentoDoCertificado(titularCert, nomeComum),
    emissor: atributo(titularCert.issuer.attributes, "CN") ?? atributo(titularCert.issuer.attributes, "O") ?? "",
    serial: titularCert.serialNumber,
    validoDe: titularCert.validity.notBefore.toISOString(),
    validoAte: titularCert.validity.notAfter.toISOString(),
  };
}

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

export { deBase64, paraBase64 };

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

function formatarDocumento(doc: string | null) {
  if (!doc) return "";
  if (doc.length === 14) return `CNPJ ${doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}`;
  return `CPF ${doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}`;
}

/** Monta o CMS (PKCS#7) assinado do conteúdo do PDF. */
async function montarCms(conteudo: Uint8Array, m: MaterialAssinatura): Promise<Uint8Array> {
  const engine = new pkijs.CryptoEngine({ name: "webcrypto", crypto, subtle: crypto.subtle });
  pkijs.setEngine("webcrypto", engine as unknown as pkijs.ICryptoEngine);

  const cert = pkijs.Certificate.fromBER(copia(m.certificado));
  const cadeia = m.cadeia.map((c) => pkijs.Certificate.fromBER(copia(c)));
  const resumo = await crypto.subtle.digest("SHA-256", copia(conteudo));
  const hashCert = await crypto.subtle.digest("SHA-256", copia(m.certificado));

  // signing-certificate-v2 (exigido pelo CAdES/PAdES): identifica o certificado do signatário.
  const essCertIdV2 = new asn1js.Sequence({
    value: [
      new asn1js.OctetString({ valueHex: hashCert }),
      new asn1js.Sequence({
        value: [
          new asn1js.Sequence({
            value: [new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 4 }, value: [cert.issuer.toSchema()] })],
          }),
          cert.serialNumber,
        ],
      }),
    ],
  });
  const signingCertificateV2 = new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] });

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: "1.2.840.113549.1.7.1" }),
    certificates: [cert, ...cadeia],
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 0,
          attributes: [
            new pkijs.Attribute({ type: "1.2.840.113549.1.9.3", values: [new asn1js.ObjectIdentifier({ value: "1.2.840.113549.1.7.1" })] }),
            new pkijs.Attribute({ type: "1.2.840.113549.1.9.4", values: [new asn1js.OctetString({ valueHex: resumo })] }),
            new pkijs.Attribute({ type: "1.2.840.113549.1.9.16.2.47", values: [signingCertificateV2] }),
          ],
        }),
      }),
    ],
  });

  const chave = await crypto.subtle.importKey("pkcs8", copia(m.chavePkcs8), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  await signedData.sign(chave, 0, "SHA-256");

  const contentInfo = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signedData.toSchema(true) });
  return new Uint8Array(contentInfo.toSchema().toBER(false));
}

/** Desenha o selo "Assinado digitalmente" no rodapé da última página. */
async function desenharSelo(pdf: PDFDocument, m: MaterialAssinatura, quando: Date) {
  const pagina = pdf.getPage(pdf.getPageCount() - 1);
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width } = pagina.getSize();
  const largura = 300;
  const altura = 50;
  const x = width - largura - 48;
  const y = 22;
  const verde = rgb(0.05, 0.5, 0.33);

  pagina.drawRectangle({ x, y, width: largura, height: altura, borderColor: verde, borderWidth: 1, color: rgb(0.94, 0.99, 0.96), opacity: 0.95 });
  // "carimbo" circular com check
  pagina.drawCircle({ x: x + 22, y: y + altura / 2, size: 13, color: verde });
  pagina.drawLine({ start: { x: x + 15, y: y + altura / 2 }, end: { x: x + 20, y: y + altura / 2 - 5 }, thickness: 2.2, color: rgb(1, 1, 1) });
  pagina.drawLine({ start: { x: x + 20, y: y + altura / 2 - 5 }, end: { x: x + 29, y: y + altura / 2 + 6 }, thickness: 2.2, color: rgb(1, 1, 1) });

  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(quando);
  const tx = x + 42;
  pagina.drawText("ASSINADO DIGITALMENTE", { x: tx, y: y + altura - 14, size: 8, font: negrito, color: verde });
  const titular = limparTexto(m.titular);
  pagina.drawText(titular.length > 52 ? `${titular.slice(0, 51)}…` : titular, { x: tx, y: y + altura - 25, size: 7.5, font: negrito, color: rgb(0.1, 0.1, 0.12) });
  pagina.drawText(limparTexto(`${formatarDocumento(m.documento)}${m.documento ? "  ·  " : ""}${data} (Brasília)`), { x: tx, y: y + altura - 35, size: 7, font: fonte, color: rgb(0.3, 0.3, 0.35) });
  pagina.drawText("Certificado ICP-Brasil · confira em validar.iti.gov.br", { x: tx, y: y + 7, size: 6.5, font: fonte, color: rgb(0.45, 0.45, 0.5) });
}

/** Assina um PDF (bytes) e devolve o PDF assinado. */
export async function assinarPdf(
  pdfBytes: Uint8Array,
  m: MaterialAssinatura,
  opcoes: { motivo: string; local: string; contato?: string },
): Promise<Uint8Array> {
  const quando = new Date();
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  } catch {
    throw new Error("Não foi possível abrir este PDF para assinar (ele pode estar protegido por senha).");
  }
  await desenharSelo(pdf, m, quando);

  const cadeiaTamanho = m.certificado.length + m.cadeia.reduce((s, c) => s + c.length, 0);
  pdflibAddPlaceholder({
    pdfDoc: pdf,
    reason: limparTexto(opcoes.motivo),
    contactInfo: limparTexto(opcoes.contato ?? ""),
    name: limparTexto(`${m.titular}${m.documento ? `:${m.documento}` : ""}`),
    location: limparTexto(opcoes.local),
    signingTime: quando,
    signatureLength: Math.max(12000, cadeiaTamanho * 2 + 4000),
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    widgetRect: [0, 0, 0, 0],
    appName: "Montzion",
  });
  const comEspaco = await pdf.save({ useObjectStreams: false });

  // A biblioteca exige um assinador derivado da classe Signer dela.
  class AssinadorA1 extends Signer {
    async sign(conteudo: Buffer): Promise<Buffer> {
      return Buffer.from(await montarCms(new Uint8Array(conteudo), m));
    }
  }
  const assinado = await new SignPdf().sign(Buffer.from(comEspaco), new AssinadorA1());
  return new Uint8Array(assinado);
}
