// Leitura e escrita mínimas de DER (ASN.1), só o necessário para certificados X.509
// e para montar a assinatura CMS. Bem mais leve que uma biblioteca completa — importante
// para caber no limite de processamento do plano grátis da Cloudflare.

export interface Tlv {
  tag: number;
  /** Início do elemento inteiro (tag) */
  inicio: number;
  /** Início do conteúdo */
  conteudo: number;
  /** Fim do elemento (exclusivo) */
  fim: number;
}

export function lerTlv(bytes: Uint8Array, pos: number): Tlv {
  const tag = bytes[pos];
  let p = pos + 1;
  let tamanho = bytes[p++];
  if (tamanho & 0x80) {
    const n = tamanho & 0x7f;
    if (n === 0 || n > 4) throw new Error("DER inválido");
    tamanho = 0;
    for (let i = 0; i < n; i++) tamanho = tamanho * 256 + bytes[p++];
  }
  const fim = p + tamanho;
  if (fim > bytes.length) throw new Error("DER inválido");
  return { tag, inicio: pos, conteudo: p, fim };
}

/** Filhos diretos de um elemento construído (SEQUENCE, SET, [n]). */
export function filhos(bytes: Uint8Array, pai: Tlv): Tlv[] {
  const lista: Tlv[] = [];
  let p = pai.conteudo;
  while (p < pai.fim) {
    const t = lerTlv(bytes, p);
    lista.push(t);
    p = t.fim;
  }
  return lista;
}

export const trecho = (bytes: Uint8Array, t: Tlv) => bytes.subarray(t.inicio, t.fim);
export const conteudo = (bytes: Uint8Array, t: Tlv) => bytes.subarray(t.conteudo, t.fim);

function tamanhoDer(n: number): number[] {
  if (n < 0x80) return [n];
  const partes: number[] = [];
  while (n > 0) {
    partes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return [0x80 | partes.length, ...partes];
}

/** Monta um elemento DER: tag + tamanho + conteúdo (concatenado). */
export function der(tag: number, ...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const cab = [tag, ...tamanhoDer(total)];
  const saida = new Uint8Array(cab.length + total);
  saida.set(cab);
  let p = cab.length;
  for (const parte of partes) {
    saida.set(parte, p);
    p += parte.length;
  }
  return saida;
}

export const SEQ = (...p: Uint8Array[]) => der(0x30, ...p);
export const SET = (...p: Uint8Array[]) => der(0x31, ...p);
export const INTEIRO = (n: number) => der(0x02, new Uint8Array([n]));
export const OCTETOS = (b: Uint8Array) => der(0x04, b);
export const NULO = new Uint8Array([0x05, 0x00]);

export function OID(texto: string): Uint8Array {
  const n = texto.split(".").map(Number);
  const bytes = [n[0] * 40 + n[1]];
  for (const v of n.slice(2)) {
    const grupo = [v & 0x7f];
    let x = Math.floor(v / 128);
    while (x > 0) {
      grupo.unshift((x & 0x7f) | 0x80);
      x = Math.floor(x / 128);
    }
    bytes.push(...grupo);
  }
  return der(0x06, new Uint8Array(bytes));
}

/** Compara bytes (para ordenar itens de um SET OF, como pede o DER). */
export function compararBytes(a: Uint8Array, b: Uint8Array) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

// ---------------------------------------------------------
// Certificado X.509
// ---------------------------------------------------------

export interface CertificadoX509 {
  /** Nome do emissor (DER completo) */
  emissor: Uint8Array;
  /** Número de série (INTEGER, DER completo) */
  serial: Uint8Array;
  /** Chave pública (SubjectPublicKeyInfo, DER completo) */
  chavePublica: Uint8Array;
  validoDe: Date;
  validoAte: Date;
}

function lerData(bytes: Uint8Array, t: Tlv): Date {
  const s = new TextDecoder().decode(conteudo(bytes, t));
  // UTCTime: AAMMDDhhmmssZ · GeneralizedTime: AAAAMMDDhhmmssZ
  const m = t.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s);
  if (!m) throw new Error("Data inválida no certificado");
  let ano = Number(m[1]);
  if (t.tag === 0x17) ano += ano < 50 ? 2000 : 1900;
  return new Date(Date.UTC(ano, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)));
}

export function lerCertificado(bytes: Uint8Array): CertificadoX509 {
  const cert = lerTlv(bytes, 0);
  if (cert.tag !== 0x30) throw new Error("Certificado inválido");
  const tbs = filhos(bytes, cert)[0];
  let campos = filhos(bytes, tbs);
  if (campos[0].tag === 0xa0) campos = campos.slice(1); // versão (opcional)
  const [serial, , emissor, validade, , chavePublica] = campos;
  if (!serial || serial.tag !== 0x02 || !emissor || !validade || !chavePublica) throw new Error("Certificado inválido");
  const [de, ate] = filhos(bytes, validade);
  return {
    emissor: trecho(bytes, emissor),
    serial: trecho(bytes, serial),
    chavePublica: trecho(bytes, chavePublica),
    validoDe: lerData(bytes, de),
    validoAte: lerData(bytes, ate),
  };
}
