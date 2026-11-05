// Permissões por módulo. Administradores têm acesso total.

export type Nivel = "nenhum" | "ver" | "editar";

export const MODULOS = [
  { chave: "licitacoes", nome: "Licitações", descricao: "Quadro, ficha, itens e arquivos das licitações" },
  { chave: "orcamento", nome: "Orçamentos e preços", descricao: "Cotações, custos, margem e preço de venda" },
  { chave: "fornecedores", nome: "Fornecedores", descricao: "Cadastro de fornecedores e contatos" },
  { chave: "posganho", nome: "Empenhos e entregas", descricao: "Quadro de pós-ganho, prazos e faturamento" },
  { chave: "atas", nome: "Atas vigentes", descricao: "Atas de registro de preço" },
  { chave: "documentacao", nome: "Documentação", descricao: "Documentos e certidões da empresa" },
  { chave: "financeiro", nome: "Financeiro", descricao: "Lucro, impostos, a faturar, a receber e relatórios financeiros" },
  { chave: "assinatura", nome: "Assinatura digital", descricao: "Assinar propostas e PDFs com o certificado da empresa (Editar = pode assinar)" },
] as const;

export type Modulo = (typeof MODULOS)[number]["chave"];
export type Permissoes = Record<Modulo, Nivel>;

export const NIVEIS: Nivel[] = ["nenhum", "ver", "editar"];

export const ACESSO_TOTAL: Permissoes = Object.fromEntries(
  MODULOS.map((m) => [m.chave, "editar"]),
) as Permissoes;

/** Lê as permissões salvas (JSON). Vazio = acesso total (contas antigas). */
export function resolverPermissoes(papel: string, salvas: string | null | undefined): Permissoes {
  if (papel === "admin" || !salvas) return { ...ACESSO_TOTAL };
  let dados: Record<string, unknown> = {};
  try {
    dados = JSON.parse(salvas);
  } catch {
    return { ...ACESSO_TOTAL };
  }
  return Object.fromEntries(
    MODULOS.map((m) => {
      const n = dados[m.chave];
      return [m.chave, NIVEIS.includes(n as Nivel) ? n : "nenhum"];
    }),
  ) as Permissoes;
}

/** Confere e normaliza permissões enviadas pela tela. Devolve null se inválidas. */
export function validarPermissoes(valor: unknown): Permissoes | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const dados = valor as Record<string, unknown>;
  const resultado = {} as Permissoes;
  for (const m of MODULOS) {
    const n = dados[m.chave] ?? "nenhum";
    if (!NIVEIS.includes(n as Nivel)) return null;
    resultado[m.chave] = n as Nivel;
  }
  return resultado;
}

export function podeVer(p: Permissoes, modulo: Modulo) {
  return p[modulo] === "ver" || p[modulo] === "editar";
}

export function podeEditar(p: Permissoes, modulo: Modulo) {
  return p[modulo] === "editar";
}

export const CORES_EQUIPE = [
  "#8b5cf6",
  "#6366f1",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
];
