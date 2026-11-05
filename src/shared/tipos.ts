// Tipos compartilhados entre o backend (Worker) e o frontend (React).

export type Papel = "admin" | "membro";

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  trocarSenha: boolean;
  criadoEm: string;
}

export const SENHA_MINIMA = 8;
