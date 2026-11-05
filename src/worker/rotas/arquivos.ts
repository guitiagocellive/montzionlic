import { Hono } from "hono";
import { CATEGORIAS_ARQUIVO } from "../../shared/negocio";
import { type Modulo, podeEditar, podeVer } from "../../shared/permissoes";
import type { Usuario } from "../../shared/tipos";
import { type Ambiente, exigirLogin } from "../auth";
import { buscar } from "../banco";
import { analisarDocumento, type TipoAnalise } from "../ia";
import { registrarEvento } from "../atividades";
import { comandoUsarPedido, pedidoValido } from "../pedidosAssinatura";
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

  // PDF assinado no navegador: precisa do pedido de assinatura feito ao servidor.
  const pedidoId = String(form.get("pedido_assinatura") ?? "");
  let titular: string | null = null;
  if (pedidoId) {
    if (arquivo.type !== "application/pdf") return c.json({ erro: "Só PDFs podem ser assinados." }, 400);
    titular = await pedidoValido(c.env.DB, pedidoId, c.get("usuario").id);
    if (!titular) return c.json({ erro: "Assinatura expirada ou inválida. Assine de novo." }, 400);
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
    `INSERT INTO arquivos (licitacao_id, execucao_id, chave, nome, tipo_mime, tamanho, categoria, enviado_por, assinado_em, assinado_por, assinatura_titular)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, nome, tipo_mime, tamanho, categoria, criado_em, assinado_em, assinatura_titular`,
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
      titular ? Date.now() : null,
      titular ? c.get("usuario").id : null,
      titular,
    )
    .first<{ id: number }>();
  if (titular && registro) await comandoUsarPedido(c.env.DB, pedidoId, registro.id).run();
  await registrarEvento(
    c.env.DB,
    execucaoId ? { execucao_id: execucaoId } : { licitacao_id: licitacaoId! },
    c.get("usuario").id,
    titular
      ? `assinou digitalmente "${arquivo.name.slice(0, 120)}" (certificado de ${titular})`
      : `enviou o arquivo "${arquivo.name.slice(0, 120)}" (${categoria})`,
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

