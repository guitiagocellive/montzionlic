import {
  diasAte,
  ETAPAS_ANTES_DA_ENTREGA,
  ETAPAS_LICITACAO_ATIVAS,
} from "../shared/negocio";
import { type Modulo, podeVer, resolverPermissoes } from "../shared/permissoes";
import type { Alerta } from "../shared/tipos";
import { hojeBrasilia, lerConfiguracoes } from "./configuracoes";

const lista = (valores: string[]) => valores.map((v) => `'${v}'`).join(", ");

function quando(dias: number) {
  if (dias < 0) return `há ${-dias} dia(s)`;
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  return `em ${dias} dias`;
}

const formatarData = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Alertas do momento (calculados na hora, não ficam salvos):
 * sessões próximas, sessões ainda sem orçamento, entregas e atas vencendo.
 */
export async function calcularAlertas(
  db: D1Database,
  pode: (m: Modulo) => boolean,
): Promise<Alerta[]> {
  const config = await lerConfiguracoes(db);
  const hoje = hojeBrasilia();
  const alertas: Alerta[] = [];

  if (pode("licitacoes")) {
    const { results } = await db
      .prepare(
        `SELECT l.id, l.numero, l.orgao, l.modalidade, l.data_sessao, l.horario, l.portal, l.etapa,
                (SELECT COUNT(*) FROM cotacoes c WHERE c.licitacao_id = l.id) AS cotacoes
           FROM licitacoes l
          WHERE l.data_sessao BETWEEN ? AND ? AND l.etapa IN (${lista(ETAPAS_LICITACAO_ATIVAS)})
          ORDER BY l.data_sessao, l.horario`,
      )
      .bind(hoje, hojeBrasilia(config.alerta_sessao_dias))
      .all<{
        id: number;
        numero: string | null;
        orgao: string | null;
        modalidade: string | null;
        data_sessao: string;
        horario: string | null;
        portal: string | null;
        etapa: string;
        cotacoes: number;
      }>();
    for (const l of results) {
      const dias = diasAte(l.data_sessao, hoje);
      const nome = `${l.modalidade ?? "Licitação"} ${l.numero ?? ""}`.trim();
      alertas.push({
        tipo: "sessao",
        gravidade: dias <= 1 ? "urgente" : "atencao",
        titulo: `Sessão ${quando(dias)}${l.horario ? ` às ${l.horario}` : ""}`,
        detalhe: [nome, l.orgao, l.portal].filter(Boolean).join(" · "),
        data: l.data_sessao,
        link: `/licitacoes/${l.id}`,
      });
      if (l.cotacoes === 0 && pode("orcamento")) {
        alertas.push({
          tipo: "sessao_sem_orcamento",
          gravidade: "atencao",
          titulo: `Ainda sem orçamento — sessão ${quando(dias)}`,
          detalhe: [nome, l.orgao].filter(Boolean).join(" · "),
          data: l.data_sessao,
          link: `/licitacoes/${l.id}?aba=orcamento`,
        });
      }
    }
  }

  if (pode("posganho")) {
    const { results } = await db
      .prepare(
        `SELECT e.id, e.numero_empenho, e.data_limite, l.orgao, l.numero
           FROM execucoes e JOIN licitacoes l ON l.id = e.licitacao_id
          WHERE e.data_limite IS NOT NULL AND e.data_limite <= ?
            AND e.etapa IN (${lista(ETAPAS_ANTES_DA_ENTREGA)})
          ORDER BY e.data_limite`,
      )
      .bind(hojeBrasilia(config.alerta_entrega_dias))
      .all<{ id: number; numero_empenho: string | null; data_limite: string; orgao: string | null; numero: string | null }>();
    for (const e of results) {
      const dias = diasAte(e.data_limite, hoje);
      const nome = e.numero_empenho ? `Empenho ${e.numero_empenho}` : `Licitação ${e.numero ?? "—"}`;
      alertas.push({
        tipo: dias < 0 ? "entrega_atrasada" : "entrega",
        gravidade: dias < 0 ? "urgente" : dias <= 1 ? "urgente" : "atencao",
        titulo: dias < 0 ? `Entrega atrasada ${-dias} dia(s)` : `Entrega vence ${quando(dias)}`,
        detalhe: [nome, e.orgao].filter(Boolean).join(" · "),
        data: e.data_limite,
        link: `/pos-ganho/${e.id}`,
      });
    }
  }

  if (pode("atas")) {
    const { results } = await db
      .prepare(
        `SELECT id, nome, numero_ata, orgao_gerenciador, data_fim FROM atas
          WHERE data_fim BETWEEN ? AND ? ORDER BY data_fim`,
      )
      .bind(hoje, hojeBrasilia(config.alerta_ata_dias))
      .all<{ id: number; nome: string | null; numero_ata: string | null; orgao_gerenciador: string | null; data_fim: string }>();
    for (const a of results) {
      const dias = diasAte(a.data_fim, hoje);
      alertas.push({
        tipo: "ata",
        gravidade: dias <= 7 ? "atencao" : "info",
        titulo: `Ata vence ${quando(dias)} (${formatarData(a.data_fim)})`,
        detalhe: [a.nome || `Ata ${a.numero_ata ?? ""}`, a.orgao_gerenciador].filter(Boolean).join(" · "),
        data: a.data_fim,
        link: "/atas",
      });
    }
  }

  if (pode("atas")) {
    // Itens de atas vigentes com 80% ou mais da quantidade já empenhada.
    const { results } = await db
      .prepare(
        `SELECT a.id, a.nome, a.numero_ata, a.data_fim, ai.item_numero, ai.produto, ai.quantidade,
                COALESCE((SELECT SUM(ei.quantidade) FROM execucao_itens ei WHERE ei.ata_item_id = ai.id), 0) AS empenhado
           FROM ata_itens ai JOIN atas a ON a.id = ai.ata_id
          WHERE (a.data_fim IS NULL OR a.data_fim >= ?) AND ai.quantidade > 0`,
      )
      .bind(hoje)
      .all<{ id: number; nome: string | null; numero_ata: string | null; data_fim: string | null; item_numero: string | null; produto: string | null; quantidade: number; empenhado: number }>();
    for (const i of results) {
      const usado = i.empenhado / i.quantidade;
      if (usado < 0.8) continue;
      const saldo = Math.max(0, i.quantidade - i.empenhado);
      alertas.push({
        tipo: "saldo_ata",
        gravidade: saldo === 0 ? "atencao" : "info",
        titulo: saldo === 0 ? `Saldo esgotado no item ${i.item_numero ?? ""}` : `Saldo baixo no item ${i.item_numero ?? ""}: restam ${saldo}`,
        detalhe: [i.produto, i.nome || `Ata ${i.numero_ata ?? ""}`].filter(Boolean).join(" · "),
        data: i.data_fim ?? hoje,
        link: "/atas",
      });
    }
  }

  if (pode("documentacao")) {
    const { results } = await db
      .prepare("SELECT id, nome, categoria, validade FROM documentos WHERE validade IS NOT NULL AND validade <= ? ORDER BY validade")
      .bind(hojeBrasilia(config.alerta_documento_dias))
      .all<{ id: number; nome: string; categoria: string; validade: string }>();
    for (const d of results) {
      const dias = diasAte(d.validade, hoje);
      alertas.push({
        tipo: "documento",
        gravidade: dias < 0 ? "urgente" : dias <= 5 ? "urgente" : "atencao",
        titulo: dias < 0 ? `Documento vencido há ${-dias} dia(s)` : `Documento vence ${quando(dias)}`,
        detalhe: `${d.nome} · ${d.categoria}`,
        data: d.validade,
        link: "/documentacao",
      });
    }
  }

  if (pode("assinatura")) {
    // Certificado digital A1 vencendo em até 30 dias (ou já vencido).
    const cert = await db
      .prepare("SELECT titular, valido_ate FROM certificado_digital WHERE id = 1")
      .first<{ titular: string; valido_ate: string }>();
    if (cert) {
      const validade = cert.valido_ate.slice(0, 10);
      const dias = diasAte(validade, hoje);
      if (dias <= 30) {
        alertas.push({
          tipo: "certificado",
          gravidade: dias <= 7 ? "urgente" : "atencao",
          titulo: dias < 0 ? `Certificado digital vencido há ${-dias} dia(s)` : `Certificado digital vence ${quando(dias)}`,
          detalhe: `${cert.titular} · renove e cadastre o novo em Configurações`,
          data: validade,
          link: "/configuracoes/certificado",
        });
      }
    }
  }

  const peso = { urgente: 0, atencao: 1, info: 2 };
  return alertas.sort((a, b) => peso[a.gravidade] - peso[b.gravidade] || a.data.localeCompare(b.data));
}

const MODULOS_DO_ALERTA: Record<Alerta["tipo"], Modulo[]> = {
  sessao: ["licitacoes"],
  sessao_sem_orcamento: ["licitacoes", "orcamento"],
  entrega: ["posganho"],
  entrega_atrasada: ["posganho"],
  ata: ["atas"],
  saldo_ata: ["atas"],
  documento: ["documentacao"],
  certificado: ["assinatura"],
};

interface UsuarioAtivo {
  id: number;
  papel: string;
  permissoes: string | null;
}

/**
 * Transforma os alertas em notificações para cada pessoa (sem repetir a mesma).
 * Roda de hora em hora (cron) e também quando alguém abre o sino.
 */
export async function gerarNotificacoes(db: D1Database): Promise<void> {
  const { results: usuarios } = await db
    .prepare("SELECT id, papel, permissoes FROM usuarios WHERE ativo = 1")
    .all<UsuarioAtivo>();
  const agora = Date.now();
  const comandos: D1PreparedStatement[] = [];

  // Calcula tudo uma vez e filtra pelo acesso de cada pessoa (poucas consultas ao banco).
  const todos = await calcularAlertas(db, () => true);
  for (const u of usuarios) {
    const p = resolverPermissoes(u.papel, u.permissoes);
    const alertas = todos.filter((a) => MODULOS_DO_ALERTA[a.tipo].every((m) => podeVer(p, m)));
    for (const a of alertas) {
      // A chave inclui a data: se a data mudar, avisa de novo.
      const chave = `${a.tipo}:${a.link}:${a.data}`;
      comandos.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO notificacoes (usuario_id, tipo, titulo, mensagem, link, chave, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(u.id, a.tipo, a.titulo, a.detalhe, a.link, chave, agora),
      );
    }
  }

  // Limpa notificações lidas com mais de 60 dias.
  comandos.push(
    db.prepare("DELETE FROM notificacoes WHERE lida_em IS NOT NULL AND criado_em < ?").bind(agora - 60 * 86_400_000),
  );
  comandos.push(
    db
      .prepare(
        "INSERT INTO configuracoes (chave, valor) VALUES ('ultima_geracao_notificacoes', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
      )
      .bind(String(agora)),
  );
  for (let i = 0; i < comandos.length; i += 500) await db.batch(comandos.slice(i, i + 500));
}

/** Gera de novo só se a última geração tiver mais de 10 minutos. */
export async function gerarSeNecessario(db: D1Database): Promise<void> {
  const linha = await db
    .prepare("SELECT valor FROM configuracoes WHERE chave = 'ultima_geracao_notificacoes'")
    .first<{ valor: string }>();
  if (linha && Date.now() - Number(linha.valor) < 10 * 60 * 1000) return;
  await gerarNotificacoes(db);
}

/** Avisa pessoas específicas sobre um acontecimento (ex.: licitação ganha). */
export async function notificar(
  db: D1Database,
  destino: { modulo?: Modulo; usuarioIds?: number[]; exceto?: number; soAdmins?: boolean },
  aviso: { tipo: string; titulo: string; mensagem?: string; link?: string; chave: string },
): Promise<void> {
  const { results } = await db
    .prepare("SELECT id, papel, permissoes FROM usuarios WHERE ativo = 1")
    .all<UsuarioAtivo>();
  const alvos = results.filter((u) => {
    if (u.id === destino.exceto) return false;
    if (destino.soAdmins && u.papel !== "admin") return false;
    if (destino.usuarioIds && !destino.usuarioIds.includes(u.id)) return false;
    if (destino.modulo && !podeVer(resolverPermissoes(u.papel, u.permissoes), destino.modulo)) return false;
    return true;
  });
  if (alvos.length === 0) return;
  const agora = Date.now();
  await db.batch(
    alvos.map((u) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO notificacoes (usuario_id, tipo, titulo, mensagem, link, chave, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(u.id, aviso.tipo, aviso.titulo, aviso.mensagem ?? null, aviso.link ?? null, aviso.chave, agora),
    ),
  );
}
