// Funções de criptografia usando a WebCrypto nativa do Cloudflare Workers.

// O Workers limita o PBKDF2 a 100.000 iterações.
const ITERACOES = 100_000;
const TAMANHO_SALT = 16;
const TAMANHO_HASH = 32;

const encoder = new TextEncoder();

function paraBase64(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function deBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function paraHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function derivar(senha: string, salt: Uint8Array, iteracoes: number): Promise<Uint8Array> {
  const chave = await crypto.subtle.importKey("raw", encoder.encode(senha), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iteracoes },
    chave,
    TAMANHO_HASH * 8,
  );
  return new Uint8Array(bits);
}

function iguais(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

/** Gera o hash de uma senha no formato `pbkdf2$iteracoes$salt$hash`. */
export async function gerarHashSenha(senha: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(TAMANHO_SALT));
  const hash = await derivar(senha, salt, ITERACOES);
  return `pbkdf2$${ITERACOES}$${paraBase64(salt)}$${paraBase64(hash)}`;
}

/** Confere se a senha bate com o hash salvo. */
export async function verificarSenha(senha: string, salvo: string): Promise<boolean> {
  const [algoritmo, iteracoes, salt, hash] = salvo.split("$");
  if (algoritmo !== "pbkdf2" || !iteracoes || !salt || !hash) return false;
  const calculado = await derivar(senha, deBase64(salt), Number(iteracoes));
  return iguais(calculado, deBase64(hash));
}

/** Token aleatório para o cookie de sessão. */
export function gerarToken(): string {
  return paraHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(texto));
  return paraHex(new Uint8Array(digest));
}

// Hash fixo usado quando o e-mail não existe, para o tempo de resposta
// ser o mesmo e não revelar quais e-mails estão cadastrados.
export const HASH_FALSO =
  "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
