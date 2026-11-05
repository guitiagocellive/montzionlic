// Leitura de documentos com a IA gratuita da Cloudflare (Workers AI).
// 1) toMarkdown transforma o PDF/imagem em texto;
// 2) um modelo de linguagem extrai os dados em formato estruturado.

export const MODELO_IA = "@cf/meta/llama-4-scout-17b-16e-instruct";

// ~40 mil tokens: cabe com folga no modelo e permite várias análises por dia no plano grátis.
const LIMITE_CARACTERES = 140_000;

export type TipoAnalise = "edital" | "empenho";

const ESQUEMA_EDITAL = {
  type: "object",
  properties: {
    resumo: { type: "string" },
    uasg: { type: "string" },
    numero: { type: "string" },
    orgao: { type: "string" },
    objeto: { type: "string" },
    modalidade: { type: "string" },
    data_sessao: { type: "string", description: "AAAA-MM-DD" },
    horario: { type: "string", description: "HH:MM" },
    portal: { type: "string" },
    registro_preco: { type: "boolean" },
    valor_estimado: { type: "number" },
    prazo_entrega: { type: "string" },
    documentos_habilitacao: { type: "array", items: { type: "string" } },
    pontos_atencao: { type: "array", items: { type: "string" } },
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          numero: { type: "string" },
          descricao: { type: "string" },
          quantidade: { type: "number" },
          unidade: { type: "string" },
          valor_referencia: { type: "number" },
        },
        required: ["numero", "descricao"],
      },
    },
  },
  required: ["resumo", "itens"],
};

const ESQUEMA_EMPENHO = {
  type: "object",
  properties: {
    resumo: { type: "string" },
    numero_empenho: { type: "string" },
    data_empenho: { type: "string", description: "AAAA-MM-DD" },
    prazo_dias: { type: "number" },
    prazo_tipo: { type: "string", enum: ["corridos", "uteis"] },
    valor_total: { type: "number" },
    fat_razao_social: { type: "string" },
    fat_cnpj: { type: "string" },
    fat_endereco: { type: "string" },
    fat_email: { type: "string" },
    fat_telefone: { type: "string" },
    pontos_atencao: { type: "array", items: { type: "string" } },
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item_numero: { type: "string" },
          produto: { type: "string" },
          quantidade: { type: "number" },
          valor_unitario: { type: "number" },
        },
        required: ["produto"],
      },
    },
  },
  required: ["resumo", "itens"],
};

const INSTRUCOES: Record<TipoAnalise, string> = {
  edital: `Você é um especialista brasileiro em licitações públicas (Lei 14.133/2021).
Leia o documento (edital, termo de referência ou anexo) e extraia os dados pedidos.
Regras:
- Responda SOMENTE com JSON válido no formato pedido, em português.
- Não invente: se um dado não estiver no documento, omita o campo.
- "resumo": 3 a 5 frases sobre o objeto, a disputa e exigências importantes.
- "uasg": código UASG do órgão (só números), se houver.
- "modalidade": por exemplo "Pregão eletrônico" ou "Dispensa eletrônica".
- "data_sessao" no formato AAAA-MM-DD e "horario" no formato HH:MM (horário de Brasília).
- "registro_preco": true se for Sistema de Registro de Preços (SRP).
- "itens": todos os itens/lotes com número, descrição completa (especificação técnica),
  quantidade, unidade e valor unitário de referência quando existir.
- "documentos_habilitacao": lista dos documentos exigidos para habilitação.
- "pontos_atencao": prazos, amostras, garantias, exigências incomuns ou riscos.`,
  empenho: `Você é um especialista brasileiro em licitações e execução de contratos públicos.
Leia a nota de empenho (ou ordem de fornecimento) e extraia os dados pedidos.
Regras:
- Responda SOMENTE com JSON válido no formato pedido, em português.
- Não invente: se um dado não estiver no documento, omita o campo.
- "data_empenho" no formato AAAA-MM-DD.
- "prazo_dias" e "prazo_tipo" ("corridos" ou "uteis") se o prazo de entrega for informado.
- Campos "fat_*": dados do órgão para faturamento (razão social, CNPJ, endereço, e-mail, telefone).
- "itens": produtos empenhados com número do item, descrição, quantidade e valor unitário.`,
};

/** Converte o arquivo em texto (markdown). */
async function extrairTexto(ai: Ai, nome: string, dados: ArrayBuffer, tipo: string) {
  const resultado = await ai.toMarkdown({ name: nome, blob: new Blob([dados], { type: tipo }) });
  const r = Array.isArray(resultado) ? resultado[0] : resultado;
  if (!r || r.format === "error" || !r.data) {
    throw new Error(
      r?.format === "error" && r.error
        ? `A IA não conseguiu ler o arquivo: ${r.error}`
        : "A IA não conseguiu ler o arquivo.",
    );
  }
  return r.data;
}

function interpretarJson(resposta: unknown): Record<string, unknown> {
  if (resposta && typeof resposta === "object") return resposta as Record<string, unknown>;
  if (typeof resposta === "string") {
    const inicio = resposta.indexOf("{");
    const fim = resposta.lastIndexOf("}");
    if (inicio >= 0 && fim > inicio) {
      return JSON.parse(resposta.slice(inicio, fim + 1));
    }
  }
  throw new Error("A IA respondeu em um formato inesperado. Tente novamente.");
}

export async function analisarDocumento(
  ai: Ai,
  tipo: TipoAnalise,
  arquivo: { nome: string; dados: ArrayBuffer; tipoMime: string },
): Promise<Record<string, unknown>> {
  let texto = await extrairTexto(ai, arquivo.nome, arquivo.dados, arquivo.tipoMime);
  const cortado = texto.length > LIMITE_CARACTERES;
  if (cortado) texto = texto.slice(0, LIMITE_CARACTERES);

  const mensagens = [
    { role: "system", content: INSTRUCOES[tipo] },
    {
      role: "user",
      content: `Documento "${arquivo.nome}"${cortado ? " (trecho inicial, o documento é muito longo)" : ""}:\n\n${texto}`,
    },
  ];
  const esquema = tipo === "edital" ? ESQUEMA_EDITAL : ESQUEMA_EMPENHO;

  let resposta: unknown;
  try {
    const r = (await ai.run(MODELO_IA as keyof AiModels, {
      messages: mensagens,
      max_tokens: 6000,
      temperature: 0.1,
      response_format: { type: "json_schema", json_schema: esquema },
    } as never)) as { response?: unknown };
    resposta = r.response;
  } catch {
    // Alguns modelos recusam o formato estruturado: tenta de novo pedindo JSON no texto.
    const r = (await ai.run(MODELO_IA as keyof AiModels, {
      messages: [
        ...mensagens,
        { role: "user", content: `Responda só com o JSON, seguindo este esquema: ${JSON.stringify(esquema)}` },
      ],
      max_tokens: 6000,
      temperature: 0.1,
    } as never)) as { response?: unknown };
    resposta = r.response;
  }

  const dados = interpretarJson(resposta);
  return { ...dados, documento_cortado: cortado };
}
