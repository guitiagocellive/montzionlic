import { Hono } from "hono";
import { CATEGORIAS_ARQUIVO } from "../../shared/negocio";
import { type Modulo, podeEditar, podeVer } from "../../shared/permissoes";
import type { Usuario } from "../../shared/tipos";
import { type Ambiente, exigirLogin } from "../auth";
import { buscar } from "../banco";
import { analisarDocumento, type TipoAnalise } from "../ia";
import { registrarEvento } from "../atividades";
import { assinarPdf } from "../assinatura";
import { carregarCertificado } from "../certificado";
import { lerConfiguracoes } from "../configuracoes";
import { idDaRota } from "../validacao";

export const rotasArquivos = new Hono<Ambiente>();
rotasArquivos.use(exigirLogin);

const TAMANHO_MAXIMO = 50 * 1024 * 1024; // 50 MB

// Tipos que podem abrir direto no navegador. Os demais são sempre baixados,
// para que um arquivo HTML/SVG enviado não rode scripts dentro da plataforma.
const VISUALIZAVEIS = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
]);

// Tipos que a IA consegue ler.
const ANALISAVEIS = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/html",
]);

interface Arquivo {
  id: number;
  licitacao_id: number | null;
  execucao_id: number | null;
  chave: string;
  nome: string;
  tipo_mime: string | null;
  tamanho: number;
  categoria: string | null;
}

/** Confere se a pessoa pode ver (ou editar) o arquivo, conforme onde ele está. */
function semAcesso(usuario: Usuario, arquivo: { execucao_id: number | null }, editar: boolean) {
  const modulo: Modulo = arquivo.execucao_id ? "posganho" : "licitacoes";
  return editar ? !podeEditar(usuario.permissoes, modulo) : !podeVer(usuario.permissoes, modulo);
}

function nomeSeguro(nome: string) {
  return (
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w.\-]+/g, "_")
      .slice(-120) || "arquivo"
  );
}

// Envio: formulário com "arquivo", "categoria" e "licitacao_id" ou "execucao_id".
rotasArquivos.post("/", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ erro: "Envio inválido." }, 400);
  }
  const arquivo = form.get("arquivo");
  if (!arquivo || typeof arquivo === "string") return c.json({ erro: "Escolha um arquivo." }, 400);
  if (arquivo.size === 0) return c.json({ erro: "O arquivo está vazio." }, 400);
  if (arquivo.size > TAMANHO_MAXIMO) return c.json({ erro: "O arquivo passa de 50 MB." }, 400);

  const licitacaoId = idDaRota(String(form.get("licitacao_id") ?? ""));
  const execucaoId = idDaRota(String(form.get("execucao_id") ?? ""));
  if (!licitacaoId && !execucaoId) return c.json({ erro: "Destino do arquivo inválido." }, 400);
  if (semAcesso(c.get("usuario"), { execucao_id: execucaoId }, true)) {
    return c.json({ erro: "Você não pode enviar arquivos aqui." }, 403);
  }
  if (licitacaoId && !(await buscar(c.env.DB, "licitacoes", licitacaoId))) {
    return c.json({ erro: "Licitação não encontrada." }, 404);
  }
  if (execucaoId && !(await buscar(c.env.DB, "execucoes", execucaoId))) {
    return c.json({ erro: "Empenho não encontrado." }, 404);
  }

  const categoriaBruta = String(form.get("categoria") ?? "");
  const categoria = CATEGORIAS_ARQUIVO.includes(categoriaBruta) ? categoriaBruta : "Outro";
  const tipoMime = arquivo.type || "application/octet-stream";
  const pasta = execucaoId ? `execucoes/${execucaoId}` : `licitacoes/${licitacaoId}`;
  const chave = `${pasta}/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;

  await c.env.ARQUIVOS.put(chave, arquivo.stream(), {
    httpMetadata: { contentType: tipoMime },
  });

  const registro = await c.env.DB.prepare(
    `INSERT INTO arquivos (licitacao_id, execucao_id, chave, nome, tipo_mime, tamanho, categoria, enviado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, nome, tipo_mime, tamanho, categoria, criado_em`,
  )
    .bind(
      execucaoId ? null : licitacaoId,
      execucaoId,
      chave,
      arquivo.name.slice(0, 250),
      tipoMime,
      arquivo.size,
      categoria,
      c.get("usuario").id,
    )
    .first();
  await registrarEvento(
    c.env.DB,
    execucaoId ? { execucao_id: execucaoId } : { licitacao_id: licitacaoId! },
    c.get("usuario").id,
    `enviou o arquivo "${arquivo.name.slice(0, 120)}" (${categoria})`,
  );
  return c.json({ arquivo: registro }, 201);
});

// Abre (ou baixa com ?baixar=1) o arquivo.
rotasArquivos.get("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Arquivo inválido." }, 400);
  const registro = await buscar<Arquivo>(c.env.DB, "arquivos", id);
  if (!registro) return c.json({ erro: "Arquivo não encontrado." }, 404);
  if (semAcesso(c.get("usuario"), registro, false)) return c.json({ erro: "Você não tem acesso a este arquivo." }, 403);
  const objeto = await c.env.ARQUIVOS.get(registro.chave);
  if (!objeto) return c.json({ erro: "Arquivo não encontrado no armazenamento." }, 404);

  const tipo = registro.tipo_mime ?? "application/octet-stream";
  const inline = VISUALIZAVEIS.has(tipo) && c.req.query("baixar") !== "1";
  const nome = encodeURIComponent(registro.nome);

  return new Response(objeto.body, {
    headers: {
      "Content-Type": inline ? tipo : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${nome}`,
      "Content-Length": String(objeto.size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
});

rotasArquivos.patch("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Arquivo inválido." }, 400);
  const dono = await c.env.DB.prepare("SELECT execucao_id FROM arquivos WHERE id = ?").bind(id).first<{ execucao_id: number | null }>();
  if (!dono) return c.json({ erro: "Arquivo não encontrado." }, 404);
  if (semAcesso(c.get("usuario"), dono, true)) return c.json({ erro: "Você não tem acesso a este arquivo." }, 403);
  const corpo = (await c.req.json().catch(() => null)) as { categoria?: string } | null;
  if (!corpo?.categoria || !CATEGORIAS_ARQUIVO.includes(corpo.categoria)) {
    return c.json({ erro: "Categoria inválida." }, 400);
  }
  await c.env.DB.prepare("UPDATE arquivos SET categoria = ? WHERE id = ?")
    .bind(corpo.categoria, id)
    .run();
  return c.json({ ok: true });
});

rotasArquivos.delete("/:id", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Arquivo inválido." }, 400);
  const registro = await buscar<Arquivo>(c.env.DB, "arquivos", id);
  if (!registro) return c.json({ erro: "Arquivo não encontrado." }, 404);
  if (semAcesso(c.get("usuario"), registro, true)) return c.json({ erro: "Você não tem acesso a este arquivo." }, 403);
  await c.env.ARQUIVOS.delete(registro.chave);
  await c.env.DB.prepare("DELETE FROM arquivos WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// Última análise salva (evita gastar a cota da IA de novo).
rotasArquivos.get("/:id/analise", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Arquivo inválido." }, 400);
  const dono = await c.env.DB.prepare("SELECT execucao_id FROM arquivos WHERE id = ?").bind(id).first<{ execucao_id: number | null }>();
  if (!dono) return c.json({ erro: "Arquivo não encontrado." }, 404);
  if (semAcesso(c.get("usuario"), dono, false)) return c.json({ erro: "Você não tem acesso a este arquivo." }, 403);
  const analise = await c.env.DB.prepare(
    "SELECT tipo, resultado, criado_em FROM analises_ia WHERE arquivo_id = ? ORDER BY id DESC LIMIT 1",
  )
    .bind(id)
    .first<{ tipo: string; resultado: string; criado_em: string }>();
  if (!analise) return c.json({ analise: null });
  return c.json({ analise: { ...analise, resultado: JSON.parse(analise.resultado) } });
});

// Pede para a IA ler o arquivo. ?tipo=edital (padrão) ou ?tipo=empenho
rotasArquivos.post("/:id/analisar", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Arquivo inválido." }, 400);
  const tipo: TipoAnalise = c.req.query("tipo") === "empenho" ? "empenho" : "edital";

  const registro = await buscar<Arquivo>(c.env.DB, "arquivos", id);
  if (!registro) return c.json({ erro: "Arquivo não encontrado." }, 404);
  if (semAcesso(c.get("usuario"), registro, true)) return c.json({ erro: "Você não tem acesso a este arquivo." }, 403);
  const tipoMime = registro.tipo_mime ?? "";
  if (!ANALISAVEIS.has(tipoMime)) {
    return c.json({ erro: "A IA lê PDF, imagens (PNG, JPG, WEBP), Word (.docx) e Excel (.xlsx)." }, 400);
  }
  const objeto = await c.env.ARQUIVOS.get(registro.chave);
  if (!objeto) return c.json({ erro: "Arquivo não encontrado no armazenamento." }, 404);

  try {
    const resultado = await analisarDocumento(c.env.AI, tipo, {
      nome: registro.nome,
      dados: await objeto.arrayBuffer(),
      tipoMime,
    });
    await c.env.DB.prepare("INSERT INTO analises_ia (arquivo_id, tipo, resultado) VALUES (?, ?, ?)")
      .bind(id, tipo, JSON.stringify(resultado))
      .run();
    return c.json({ analise: { tipo, resultado } });
  } catch (err) {
    console.error("Falha na IA", err);
    const mensagem = err instanceof Error ? err.message : "";
    if (/neuron|limit|quota|capacity|429/i.test(mensagem)) {
      return c.json(
        { erro: "O limite diário gratuito da IA acabou. Ele renova todo dia às 21h (horário de Brasília)." },
        429,
      );
    }
    if (mensagem.startsWith("A IA")) return c.json({ erro: mensagem }, 502);
    return c.json({ erro: "A IA não conseguiu analisar o arquivo agora. Tente novamente." }, 502);
  }
});

function contemTexto(bytes: Uint8Array, texto: string) {
  const alvo = Array.from(texto, (ch) => ch.charCodeAt(0));
  externo: for (let i = 0; i <= bytes.length - alvo.length; i++) {
    for (let j = 0; j < alvo.length; j++) if (bytes[i + j] !== alvo[j]) continue externo;
    return true;
  }
  return false;
}

// Assina um PDF já enviado com o certificado da empresa. Cria um novo arquivo "(assinado)".
rotasArquivos.post("/:id/assinar", async (c) => {
  const id = idDaRota(c.req.param("id"));
  if (!id) return c.json({ erro: "Arquivo inválido." }, 400);
  const usuario = c.get("usuario");
  if (!podeEditar(usuario.permissoes, "assinatura")) return c.json({ erro: "Você não tem permissão para assinar documentos." }, 403);
  const registro = await buscar<Arquivo & { assinado_em: number | null }>(c.env.DB, "arquivos", id);
  if (!registro) return c.json({ erro: "Arquivo não encontrado." }, 404);
  if (semAcesso(usuario, registro, true)) return c.json({ erro: "Você não tem acesso a este arquivo." }, 403);
  if (registro.tipo_mime !== "application/pdf") return c.json({ erro: "Só arquivos PDF podem ser assinados." }, 400);
  if (registro.assinado_em) return c.json({ erro: "Este PDF já está assinado." }, 400);
  const objeto = await c.env.ARQUIVOS.get(registro.chave);
  if (!objeto) return c.json({ erro: "Arquivo não encontrado no armazenamento." }, 404);
  const original = new Uint8Array(await objeto.arrayBuffer());
  // Um PDF assinado fora da plataforma perderia a assinatura dele ao ser regravado.
  if (contemTexto(original, "/ByteRange")) {
    return c.json({ erro: "Este PDF já tem uma assinatura digital. Assinar de novo invalidaria a assinatura existente." }, 400);
  }

  let assinado: Uint8Array;
  let material: Awaited<ReturnType<typeof carregarCertificado>>;
  try {
    material = await carregarCertificado(c.env);
    const config = await lerConfiguracoes(c.env.DB);
    assinado = await assinarPdf(original, material, {
      motivo: registro.categoria ? `${registro.categoria} assinado(a) digitalmente` : "Documento assinado digitalmente",
      local: config.empresa_cidade || "Brasil",
      contato: config.empresa_email,
    });
  } catch (err) {
    return c.json({ erro: (err as Error).message || "Não foi possível assinar o PDF." }, 400);
  }

  const pasta = registro.execucao_id ? `execucoes/${registro.execucao_id}` : `licitacoes/${registro.licitacao_id}`;
  const chave = `${pasta}/${crypto.randomUUID()}-assinado.pdf`;
  await c.env.ARQUIVOS.put(chave, assinado, { httpMetadata: { contentType: "application/pdf" } });
  const nome = registro.nome.replace(/\.pdf$/i, "") + " (assinado).pdf";
  const novo = await c.env.DB.prepare(
    `INSERT INTO arquivos (licitacao_id, execucao_id, chave, nome, tipo_mime, tamanho, categoria, enviado_por, assinado_em, assinado_por, assinatura_titular)
     VALUES (?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?) RETURNING id, nome`,
  )
    .bind(registro.licitacao_id, registro.execucao_id, chave, nome, assinado.byteLength, registro.categoria, usuario.id, Date.now(), usuario.id, material.titular)
    .first<{ id: number; nome: string }>();
  await registrarEvento(
    c.env.DB,
    registro.execucao_id ? { execucao_id: registro.execucao_id } : { licitacao_id: registro.licitacao_id! },
    usuario.id,
    `assinou digitalmente "${registro.nome}"`,
  );
  return c.json({ arquivo: novo }, 201);
});
