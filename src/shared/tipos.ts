// Tipos compartilhados entre o backend (Worker) e o frontend (React).

import type { Permissoes } from "./permissoes";

export type Papel = "admin" | "membro";
export type Tema = "claro" | "escuro" | "sistema";

/** Variações de cor. As claras valem no modo claro; as escuras, no escuro. */
export const TEMAS_CLAROS = [
  { chave: "ceu", nome: "Céu", descricao: "Azul com toque de pêssego", cores: ["#7dd3fc", "#fdba74", "#2563eb"] },
  { chave: "lavanda", nome: "Lavanda", descricao: "Lilás, azul e rosa pastel", cores: ["#c4b5fd", "#f9a8d4", "#7c3aed"] },
] as const;

export const TEMAS_ESCUROS = [
  { chave: "oceano", nome: "Oceano", descricao: "Azul profundo com ciano", cores: ["#0e7490", "#1d4ed8", "#22d3ee"] },
  { chave: "grafite", nome: "Grafite", descricao: "Neutro e minimalista", cores: ["#27272a", "#3f3f46", "#8b5cf6"] },
] as const;

export type TemaClaro = (typeof TEMAS_CLAROS)[number]["chave"];
export type TemaEscuro = (typeof TEMAS_ESCUROS)[number]["chave"];

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
  temaClaro: TemaClaro;
  temaEscuro: TemaEscuro;
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
  tipo: "sessao" | "sessao_sem_orcamento" | "entrega_atrasada" | "entrega" | "ata" | "documento" | "saldo_ata" | "certificado";
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
  alerta_documento_dias: number;
  empresa_endereco: string;
  empresa_cidade: string;
  empresa_telefone: string;
  empresa_email: string;
  empresa_ie: string;
  representante_nome: string;
  representante_cpf: string;
  representante_cargo: string;
  validade_proposta_padrao: number;
  empresa_logo_chave: string;
  proposta_declaracao: string;
}

export interface CertificadoInfo {
  configurado: boolean;
  titular?: string;
  documento?: string | null;
  emissor?: string;
  valido_de?: string;
  valido_ate?: string;
  dias_restantes?: number;
  enviado_por_nome?: string | null;
  criado_em?: string;
  /** Tamanho aproximado (base64) dos certificados, para reservar espaço no PDF. */
  tamanho_certificados?: number;
  /** false quando o segredo CHAVE_CERTIFICADO não foi configurado no Worker. */
  segredo_configurado: boolean;
}

export interface Documento {
  id: number;
  empresa_id: number | null;
  nome: string;
  categoria: string;
  emissao: string | null;
  validade: string | null;
  observacoes: string | null;
  arquivo_nome: string | null;
  arquivo_tipo: string | null;
  arquivo_tamanho: number | null;
  atualizado_por_nome: string | null;
  atualizado_em: string;
}

export interface ContaBancaria {
  id: number;
  apelido: string;
  banco: string;
  codigo_banco: string | null;
  agencia: string | null;
  conta: string | null;
  tipo: string | null;
  pix: string | null;
  titular: string | null;
  padrao: number;
  /** Conta de uma empresa específica (vazio = qualquer empresa). */
  empresa_id: number | null;
}

export interface Empresa {
  id: number;
  nome: string;
  cnpj: string | null;
  ie: string | null;
  endereco: string | null;
  cidade: string | null;
  telefone: string | null;
  email: string | null;
  representante_nome: string | null;
  representante_cpf: string | null;
  representante_rg: string | null;
  representante_cargo: string | null;
  marca_dagua: number;
  modelo_pdf: string;
  cor_pdf: string;
  padrao: number;
  tem_logo: number;
}

export interface Declaracao {
  id: number;
  tipo: "declaracao" | "condicao";
  titulo: string;
  texto: string;
  padrao: number;
  ordem: number;
}

/** O que foi preenchido na aba Proposta de uma licitação (fica salvo). */
export interface RascunhoProposta {
  empresa_id: number | null;
  conta_id: number | null;
  modelo_id: number | null;
  /** Modelo visual e cor do PDF desta proposta (vazio = o padrão da empresa). */
  modelo_pdf?: string;
  cor_pdf?: string;
  contratacao: string;
  numero: string;
  data: string;
  validade_dias: string;
  prazo_entrega: string;
  garantia: string;
  observacoes: string;
  declaracoes: number[];
  extras: { titulo: string; texto: string }[];
  itens: Record<string, { incluir: boolean; marca: string; valor: string; descricao: string }>;
}

export interface ModeloProposta {
  id: number;
  nome: string;
  arquivo_nome: string;
  tamanho: number | null;
  padrao: number;
  criado_em: string;
}

export interface Atividade {
  id: number;
  tipo: "comentario" | "evento";
  texto: string;
  criado_em: number;
  usuario_id: number | null;
  usuario_nome: string | null;
  usuario_cor: string | null;
  usuario_foto: string | null;
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
  responsavel_cor: string | null;
  responsavel_foto: string | null;
  total_itens: number;
  total_arquivos: number;
  total_cotacoes: number;
  itens_ganhos: number;
  itens_perdidos: number;
  itens_acompanhando: number;
  acompanhar: number;
  colocacao: number | null;
  data_reabertura: string | null;
  hora_reabertura: string | null;
  pncp_id: string | null;
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
  data_resultado: string | null;
  motivo_perda: string | null;
  observacao_resultado: string | null;
  acompanhar: number;
  colocacao: number | null;
  situacao_disputa: string | null;
  data_reabertura: string | null;
  hora_reabertura: string | null;
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
  resultado: "ganho" | "perdido" | "cancelado" | "acompanhando" | null;
  colocacao: number | null;
  nosso_lance: number | null;
  vencedor: string | null;
  valor_vencedor: number | null;
  motivo_perda: string | null;
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
  licitacao_id?: number | null;
  execucao_id?: number | null;
  assinado_em?: number | null;
  assinatura_titular?: string | null;
  assinado_por_nome?: string | null;
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
  responsavel_nome: string | null;
  responsavel_cor: string | null;
  responsavel_foto: string | null;
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
  ata_id: number | null;
  nota_fiscal: string | null;
  data_nota: string | null;
  frete: number | null;
  outras_despesas: number | null;
  data_pagamento: string | null;
  valor_recebido: number | null;
}

export interface ItemExecucao {
  id?: number;
  ata_item_id?: number | null;
  item_id: number | null;
  item_numero: string | null;
  produto: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  custo_unitario: number | null;
}

export interface AtaItem {
  id?: number;
  empenhado?: number;
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
  total_empenhos?: number;
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
