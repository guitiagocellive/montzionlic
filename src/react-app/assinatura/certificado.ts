// Roda no navegador: abre o certificado A1 (.pfx/.p12) com a senha e separa a chave
// privada e os certificados. A senha nunca sai do navegador.
import * as forgeModulo from "node-forge";

// Pacote CommonJS: dependendo do empacotador, o conteúdo fica em .default.
const forge = ((forgeModulo as unknown as { default?: typeof forgeModulo }).default ?? forgeModulo) as typeof forgeModulo;

const binarioParaBytes = (bin: string) => Uint8Array.from(bin, (c) => c.charCodeAt(0));
const bytesParaBinario = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};

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
