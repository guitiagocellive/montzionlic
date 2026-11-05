// Tipos compartilhados entre o backend (Worker) e o frontend (React).

import type { Permissoes } from "./permissoes";

export type Papel = "admin" | "membro";
export type Tema = "claro" | "escuro" | "sistema";

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  trocarSenha: boolean;
  criadoEm: string;
  cargo: string | null;
  cor: string;
  tema: Tema;
  /** Endereço da foto de perfil, ou null. */
  foto: string | null;
  permissoes: Permissoes;
}

export interface Notificacao {
  id: number;
  tipo: string;
  titulo: string;
  mensagem: string | null;
  link: string | null;
  lida: boolean;
  criadoEm: number;
}

export interface Alerta {
  tipo: "sessao" | "sessao_sem_orcamento" | "entrega_atrasada" | "entrega" | "ata";
  gravidade: "urgente" | "atencao" | "info";
  titulo: string;
  detalhe: string;
  data: string;
  link: string;
}

export interface Configuracoes {
  empresa_nome: string;
  empresa_cnpj: string;
  margem_padrao: number;
  imposto_padrao: number;
  alerta_sessao_dias: number;
  alerta_entrega_dias: number;
  alerta_ata_dias: number;
}

export interface Convite {
  id: number;
  email: string | null;
  papel: Papel;
  cargo: string | null;
  cor: string | null;
  permissoes: Permissoes;
  expira_em: number;
  usado_em: number | null;
  usado_por_nome: string | null;
  criado_em: string;
}

export const SENHA_MINIMA = 8;

// ---------------- Seção 1: Licitações ----------------

export interface LicitacaoResumo {
  id: number;
  etapa: string;
  posicao: number;
  uasg: string | null;
  numero: string | null;
  orgao: string | null;
  objeto: string | null;
  modalidade: string | null;
  nicho: string | null;
  data_sessao: string | null;
  horario: string | null;
  portal: string | null;
  registro_preco: number;
  fase: string | null;
  valor_estimado: number | null;
  responsavel_id: number | null;
  responsavel_nome: string | null;
  total_itens: number;
  total_arquivos: number;
  total_cotacoes: number;
}

export interface Licitacao {
  id: number;
  etapa: string;
  posicao: number;
  uasg: string | null;
  numero: string | null;
  orgao: string | null;
  objeto: string | null;
  modalidade: string | null;
  nicho: string | null;
  data_sessao: string | null;
  horario: string | null;
  portal: string | null;
  registro_preco: number;
  fase: string | null;
  valor_estimado: number | null;
  link: string | null;
  observacoes: string | null;
  lucro_percentual: number;
  imposto_percentual: number;
  responsavel_id: number | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ItemLicitacao {
  id: number;
  licitacao_id: number;
  numero: string | null;
  descricao: string | null;
  quantidade: number | null;
  unidade: string | null;
  valor_referencia: number | null;
  participar: number;
}

export interface Cotacao {
  id: number;
  licitacao_id: number;
  item_id: number | null;
  produto: string | null;
  marca: string | null;
  fornecedor_id: number | null;
  fornecedor_nome: string | null;
  fornecedor_cadastrado?: string | null;
  custo_unitario: number | null;
  frete: number | null;
  observacoes: string | null;
}

export interface Arquivo {
  id: number;
  nome: string;
  tipo_mime: string | null;
  tamanho: number;
  categoria: string | null;
  criado_em: string;
  enviado_por_nome: string | null;
  analisado: number;
  execucao_id?: number | null;
}

export interface Fornecedor {
  id: number;
  nome: string;
  nicho: string | null;
  vendedor: string | null;
  telefone: string | null;
  email: string | null;
  site: string | null;
  catalogo: string | null;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  observacoes: string | null;
  total_cotacoes?: number;
}

// ---------------- Seção 2: Pós-ganho ----------------

export interface ExecucaoResumo {
  id: number;
  etapa: string;
  posicao: number;
  numero_empenho: string | null;
  data_empenho: string | null;
  data_limite: string | null;
  prazo_dias: number | null;
  prazo_tipo: "corridos" | "uteis";
  registro_preco: number;
  licitacao_id: number;
  licitacao_numero: string | null;
  orgao: string | null;
  uasg: string | null;
  modalidade: string | null;
  nicho: string | null;
  total_itens: number;
  valor_total: number;
}

export interface Execucao {
  id: number;
  licitacao_id: number;
  etapa: string;
  posicao: number;
  numero_empenho: string | null;
  data_empenho: string | null;
  prazo_dias: number | null;
  prazo_tipo: "corridos" | "uteis";
  data_limite: string | null;
  registro_preco: number;
  fat_razao_social: string | null;
  fat_cnpj: string | null;
  fat_endereco: string | null;
  fat_email: string | null;
  fat_telefone: string | null;
  observacoes: string | null;
}

export interface ItemExecucao {
  id?: number;
  item_id: number | null;
  item_numero: string | null;
  produto: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  custo_unitario: number | null;
}

export interface AtaItem {
  id?: number;
  item_numero: string | null;
  produto: string | null;
  unidade: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
}

export interface Ata {
  id: number;
  nome: string | null;
  licitacao_id: number | null;
  numero_licitacao: string | null;
  numero_ata: string | null;
  orgao_gerenciador: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  prazo_entrega: number | null;
  prazo_tipo: "corridos" | "uteis";
  observacoes: string | null;
  licitacao_numero_vinculada?: string | null;
  licitacao_orgao?: string | null;
  itens: AtaItem[];
}

export interface AnaliseIA {
  tipo: "edital" | "empenho";
  resultado: Record<string, unknown> & {
    resumo?: string;
    itens?: Record<string, unknown>[];
    pontos_atencao?: string[];
    documentos_habilitacao?: string[];
    documento_cortado?: boolean;
  };
}
