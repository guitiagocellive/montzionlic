import {
  BellRing,
  CalendarDays,
  FileSignature,
  FolderLock,
  Gauge,
  Gavel,
  KanbanSquare,
  LayoutDashboard,
  type LucideIcon,
  PackageCheck,
  Truck,
} from "lucide-react";
import { type Modulo, podeVer, type Permissoes } from "../shared/permissoes";

// Áreas do menu horizontal (balão do topo) e as funções de cada uma (menu lateral).

export interface Funcao {
  caminho: string;
  rotulo: string;
  icone: LucideIcon;
  modulo?: Modulo;
}

export interface Area {
  chave: string;
  rotulo: string;
  icone: LucideIcon;
  funcoes: Funcao[];
}

export const AREAS: Area[] = [
  {
    chave: "geral",
    rotulo: "Visão geral",
    icone: Gauge,
    funcoes: [
      { caminho: "/", rotulo: "Dashboard", icone: LayoutDashboard },
      { caminho: "/calendario", rotulo: "Calendário", icone: CalendarDays },
      { caminho: "/alertas", rotulo: "Alertas", icone: BellRing },
    ],
  },
  {
    chave: "licitacoes",
    rotulo: "Licitações",
    icone: Gavel,
    funcoes: [
      { caminho: "/licitacoes", rotulo: "Quadro de licitações", icone: KanbanSquare, modulo: "licitacoes" },
      { caminho: "/fornecedores", rotulo: "Fornecedores", icone: Truck, modulo: "fornecedores" },
    ],
  },
  {
    chave: "posganho",
    rotulo: "Pós-ganho",
    icone: PackageCheck,
    funcoes: [
      { caminho: "/pos-ganho", rotulo: "Empenhos e entregas", icone: PackageCheck, modulo: "posganho" },
      { caminho: "/atas", rotulo: "Atas vigentes", icone: FileSignature, modulo: "atas" },
    ],
  },
  {
    chave: "documentacao",
    rotulo: "Documentação",
    icone: FolderLock,
    funcoes: [{ caminho: "/documentacao", rotulo: "Documentos da empresa", icone: FolderLock, modulo: "documentacao" }],
  },
];

/** Áreas e funções que a pessoa pode ver. */
export function areasPermitidas(p: Permissoes): Area[] {
  return AREAS.map((a) => ({ ...a, funcoes: a.funcoes.filter((f) => !f.modulo || podeVer(p, f.modulo)) })).filter(
    (a) => a.funcoes.length > 0,
  );
}

const corresponde = (caminho: string, destino: string) =>
  destino === "/" ? caminho === "/" : caminho === destino || caminho.startsWith(`${destino}/`);

export function funcaoAtiva(caminho: string, f: Funcao) {
  return corresponde(caminho, f.caminho);
}

export function areaDoCaminho(caminho: string, areas: Area[]): Area | null {
  return areas.find((a) => a.funcoes.some((f) => corresponde(caminho, f.caminho))) ?? null;
}
