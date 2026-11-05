import type { Configuracoes } from "../shared/tipos";

export const CONFIG_PADRAO: Configuracoes = {
  empresa_nome: "",
  empresa_cnpj: "",
  margem_padrao: 20,
  imposto_padrao: 0,
  alerta_sessao_dias: 3,
  alerta_entrega_dias: 3,
  alerta_ata_dias: 30,
};

/** Lê as configurações da empresa, completando com os valores padrão. */
export async function lerConfiguracoes(db: D1Database): Promise<Configuracoes> {
  const { results } = await db.prepare("SELECT chave, valor FROM configuracoes").all<{
    chave: string;
    valor: string;
  }>();
  const config = { ...CONFIG_PADRAO } as Record<string, unknown>;
  for (const { chave, valor } of results) {
    if (!(chave in CONFIG_PADRAO)) continue;
    try {
      config[chave] = JSON.parse(valor);
    } catch {
      // mantém o padrão
    }
  }
  return config as unknown as Configuracoes;
}

/** Data de hoje no horário de Brasília (AAAA-MM-DD), com deslocamento opcional em dias. */
export function hojeBrasilia(deslocamentoDias = 0): string {
  const agora = new Date(Date.now() - 3 * 60 * 60 * 1000 + deslocamentoDias * 86_400_000);
  return agora.toISOString().slice(0, 10);
}
