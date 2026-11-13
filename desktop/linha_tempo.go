package main

// Linha do tempo do robô (para o "Copiar diagnóstico" da página Disputas): o que o robô viu e fez, com a hora em
// milissegundos e quanto tempo passou desde o evento anterior. Fica só na memória (os últimos 300 eventos) e sai
// no diagnóstico sem chaves, tokens ou CPF/CNPJ (os números longos são mascarados).
//
// Serve para achar o gargalo com números: do clique em "ligar" até o lance sair, quanto foi esperando o captcha,
// a classificação, o pedido ao Compras.gov.br ou a própria regra (ex.: aguardando os 10 s finais).

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ultimaChegadaConfig: quanto (ms) o último "configurar" levou da página até o aplicativo.
var (
	ultimaChegadaConfig atomic.Int64
	temChegadaConfig    atomic.Bool
)

// marcarMudancasConfig (com m.mu travado): ligar/desligar e opções mudadas em cada item.
func marcarMudancasConfig(antes, depois map[string]configItem) {
	chegada := ""
	if temChegadaConfig.Load() {
		ms := ultimaChegadaConfig.Load()
		chegada = fmt.Sprintf(" (da página ao aplicativo em %d ms)", ms)
	}
	chaves := make([]string, 0, len(depois))
	for k := range depois {
		chaves = append(chaves, k)
	}
	sort.Strings(chaves)
	for _, k := range chaves {
		n, a := depois[k], antes[k]
		if n.Ligado != a.Ligado {
			marcarLigado(k, n.Ligado)
			if n.Ligado {
				minimo := "—"
				if n.Minimo != nil {
					minimo = reaisTexto(*n.Minimo, true)
				}
				tipo := "%"
				if n.TipoDesconto == "V" {
					tipo = "R$"
				}
				marcarRobo("%s: robô LIGADO%s — mínimo %s, desconto %g %s, não esperar: %v, 4 casas: %v", rotuloItem(k), chegada, minimo, n.Desconto, tipo, n.NaoAguardar, n.QuatroCasas)
			} else {
				marcarRobo("%s: robô desligado%s", rotuloItem(k), chegada)
			}
			continue
		}
		if n.NaoAguardar != a.NaoAguardar {
			marcarRobo("%s: \"não esperar os 10 s finais\" = %v (robô ligado: %v)%s", rotuloItem(k), n.NaoAguardar, n.Ligado, chegada)
		}
		if n.GanharTempo != a.GanharTempo {
			marcarRobo("%s: \"ganhar tempo\" = %v (robô ligado: %v)%s", rotuloItem(k), n.GanharTempo, n.Ligado, chegada)
		}
		if n.QuatroCasas != a.QuatroCasas {
			marcarRobo("%s: \"4 casas decimais\" = %v (robô ligado: %v)%s", rotuloItem(k), n.QuatroCasas, n.Ligado, chegada)
		}
	}
}

type eventoRobo struct {
	em    time.Time
	texto string
	tipo  string // para o relatório da disputa: melhor-conc, enviando, lance-ok, lance-recusado…
	ms    int64  // tempo do pedido ao Compras.gov.br (nos eventos de lance)
}

var linhaTempo struct {
	mu       sync.Mutex
	eventos  []eventoRobo
	decisao  map[string]string    // último tipo de decisão por item (só registra quando muda)
	ligadoEm map[string]time.Time // quando o robô foi ligado em cada item
	melhor   map[string]float64   // último melhor lance visto por item
	classif  map[string]string    // última classificação lida por item (para registrar só quando muda)
	// Para o relatório de cada disputa: a linha do tempo completa de cada item (até 5.000 eventos) e os eventos
	// gerais (captcha, freio) das últimas horas.
	porItem map[string][]eventoRobo
	gerais  []eventoRobo
}

const (
	maxEventosItem   = 5000
	maxEventosGerais = 3000
)

// mudouClassificacao: a classificação lida é diferente da anterior do item.
func mudouClassificacao(k, resumo string) bool {
	linhaTempo.mu.Lock()
	defer linhaTempo.mu.Unlock()
	if linhaTempo.classif == nil {
		linhaTempo.classif = map[string]string{}
	}
	antes, ok := linhaTempo.classif[k]
	linhaTempo.classif[k] = resumo
	return !ok || antes != resumo
}

const maxEventosRobo = 300

// MONTZION_LINHA_NO_REGISTRO=1 (só para testes): a linha do tempo também vai para o registro.
var linhaNoRegistro = os.Getenv("MONTZION_LINHA_NO_REGISTRO") == "1"

func marcarRobo(formato string, args ...any) { marcarRoboT("", 0, formato, args...) }

// marcarRoboT: evento com tipo (e o tempo do pedido, nos lances), para as contas do relatório da disputa.
func marcarRoboT(tipo string, ms int64, formato string, args ...any) {
	if linhaNoRegistro {
		registrarLog("linha: "+formato, args...)
	}
	ev := eventoRobo{time.Now(), fmt.Sprintf(formato, args...), tipo, ms}
	linhaTempo.mu.Lock()
	defer linhaTempo.mu.Unlock()
	linhaTempo.eventos = append(linhaTempo.eventos, ev)
	if n := len(linhaTempo.eventos); n > maxEventosRobo {
		linhaTempo.eventos = append([]eventoRobo(nil), linhaTempo.eventos[n-maxEventosRobo:]...)
	}
	// Eventos de um item ("compra …392026 item 1: …") vão também para a linha do tempo completa dele.
	if rotulo, _, ok := strings.Cut(ev.texto, ": "); ok && strings.HasPrefix(rotulo, "compra ") {
		if linhaTempo.porItem == nil {
			linhaTempo.porItem = map[string][]eventoRobo{}
		}
		l := append(linhaTempo.porItem[rotulo], ev)
		if len(l) > maxEventosItem {
			l = l[len(l)-maxEventosItem:]
		}
		linhaTempo.porItem[rotulo] = l
	} else {
		linhaTempo.gerais = append(linhaTempo.gerais, ev)
		if n := len(linhaTempo.gerais); n > maxEventosGerais {
			linhaTempo.gerais = append([]eventoRobo(nil), linhaTempo.gerais[n-maxEventosGerais:]...)
		}
	}
}

// rotuloItem: "compra …392026 item 1" (só o fim da chave, para diferenciar as compras sem mostrar a chave toda).
func rotuloItem(k string) string {
	compra, item, _ := strings.Cut(k, ":")
	if len(compra) > 6 {
		compra = "…" + compra[len(compra)-6:]
	}
	return "compra " + compra + " item " + item
}

// marcarLigado: guarda quando o robô foi ligado no item (para medir "desde ligar" no lance).
func marcarLigado(k string, ligado bool) {
	linhaTempo.mu.Lock()
	defer linhaTempo.mu.Unlock()
	if linhaTempo.ligadoEm == nil {
		linhaTempo.ligadoEm = map[string]time.Time{}
	}
	if ligado {
		linhaTempo.ligadoEm[k] = time.Now()
	} else {
		delete(linhaTempo.ligadoEm, k)
	}
	delete(linhaTempo.decisao, k) // a próxima decisão aparece de novo na linha do tempo
}

// desdeLigar: ms desde que o robô foi ligado no item (-1 = não se sabe).
func desdeLigar(k string) int64 {
	linhaTempo.mu.Lock()
	defer linhaTempo.mu.Unlock()
	if t, ok := linhaTempo.ligadoEm[k]; ok {
		return time.Since(t).Milliseconds()
	}
	return -1
}

// marcarDecisao: registra a decisão do robô no item só quando o tipo muda (ex.: aguardando-final → lance).
func marcarDecisao(k string, d decisao) {
	linhaTempo.mu.Lock()
	if linhaTempo.decisao == nil {
		linhaTempo.decisao = map[string]string{}
	}
	antes, ok := linhaTempo.decisao[k]
	linhaTempo.decisao[k] = d.Tipo
	linhaTempo.mu.Unlock()
	if ok && antes == d.Tipo {
		return
	}
	marcarRobo("%s: decisão %s — %s", rotuloItem(k), d.Tipo, d.Motivo)
}

// marcarMelhor: o melhor lance do item mudou (aviso do tempo real ou leitura).
func marcarMelhor(k string, it *itemMotor, meu bool) {
	e := lerItem(it.bruto)
	if !fasesDeLance[e.Fase] || e.Melhor == nil {
		return
	}
	linhaTempo.mu.Lock()
	if linhaTempo.melhor == nil {
		linhaTempo.melhor = map[string]float64{}
	}
	antes, ok := linhaTempo.melhor[k]
	linhaTempo.melhor[k] = *e.Melhor
	linhaTempo.mu.Unlock()
	if ok && antes == *e.Melhor {
		return
	}
	nosso := "—"
	if e.Nosso != nil {
		nosso = reaisTexto(*e.Nosso, true)
	}
	tipo := "melhor"
	if meu {
		nosso += " — é o nosso lance que acabou de entrar"
	} else if e.Nosso != nil && *e.Melhor < *e.Nosso-1e-9 {
		tipo = "melhor-conc" // um concorrente está à frente: lance de concorrente (para o tempo de reação do relatório)
	}
	marcarRoboT(tipo, 0, "%s: melhor lance %s (nosso %s, situação %s, fase %s)", rotuloItem(k), reaisTexto(*e.Melhor, true), nosso, e.Situacao, e.Fase)
}

func textoLinhaTempo() string {
	linhaTempo.mu.Lock()
	ev := append([]eventoRobo(nil), linhaTempo.eventos...)
	linhaTempo.mu.Unlock()
	if len(ev) == 0 {
		return "(nada ainda: ligue o robô em um item ou espere uma disputa começar)"
	}
	var b strings.Builder
	var antes time.Time
	for _, e := range ev {
		delta := ""
		if !antes.IsZero() {
			delta = fmt.Sprintf("+%d ms", e.em.Sub(antes).Milliseconds())
		}
		fmt.Fprintf(&b, "%s %10s  %s\n", e.em.Format("15:04:05.000"), delta, e.texto)
		antes = e.em
	}
	return b.String()
}

// estadoRoboTexto: um retrato de agora (conexão, captchas prontos e cada item em disputa ou com o robô ligado).
func (m *motor) estadoRoboTexto() string {
	if m == nil {
		return ""
	}
	prontos := captchasProntos()
	precisa := m.precisaCaptchaPronto()
	agora := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	var b strings.Builder
	modo := "direto"
	if agora.Before(m.diretoAte) {
		modo = "pela janela do Compras.gov.br"
	}
	fmt.Fprintf(&b, "Fase: %s · logado: %v · tempo real: %v · pedidos: %s · captchas prontos: %d (deixar prontos agora: %v)\n",
		m.fase, m.token != "", m.tempoReal, modo, prontos, precisa)
	if r := freioRestante(); r > 0 {
		fmt.Fprintf(&b, "Freio do 429 ligado por mais %.0f s (só lance e reta final)\n", r.Seconds())
	}
	testeGovBr.mu.Lock()
	if !testeGovBr.em.IsZero() {
		g := testeGovBr.resultado
		res := "respondeu"
		if !g.Respondeu {
			res = "falhou (" + g.Erro + ", parou em: " + textoOu(g.Parou, "?") + ")"
		}
		fmt.Fprintf(&b, "Último teste do gov.br (há %.0f s): %s em %.1f s · %s · tentativas seguidas da janela: %d\n",
			time.Since(testeGovBr.em).Seconds(), res, g.Segundos, g.Etapas, falhasCompras.Load())
	}
	testeGovBr.mu.Unlock()
	var linhas []string
	for chave, c := range m.compras {
		for n, it := range c.itens {
			k := chaveItem(chave, n)
			cfg, temCfg := m.config[k]
			e := m.estadoAgora(it, agora)
			if !fasesDeLance[e.Fase] && !(temCfg && cfg.Ligado) {
				continue
			}
			t := fmt.Sprintf("- %s: fase %s", rotuloItem(k), e.Fase)
			if e.RestanteSeg != nil {
				t += fmt.Sprintf(", faltam %.0f s", *e.RestanteSeg)
			}
			if e.Melhor != nil {
				t += ", melhor " + reaisTexto(*e.Melhor, true)
			}
			if e.Nosso != nil {
				t += ", nosso " + reaisTexto(*e.Nosso, true)
			}
			t += ", situação " + e.Situacao
			if e.Variacao != nil {
				t += fmt.Sprintf(", intervalo do edital %g (%s)", *e.Variacao, e.TipoVariacao)
			}
			if !it.atualizadoEm.IsZero() {
				t += fmt.Sprintf(", dados de %.1f s atrás", agora.Sub(it.atualizadoEm).Seconds())
			}
			if temCfg {
				tipo := "%"
				if cfg.TipoDesconto == "V" {
					tipo = "R$"
				}
				minimo := "—"
				if cfg.Minimo != nil {
					minimo = reaisTexto(*cfg.Minimo, true)
				}
				t += fmt.Sprintf(" | robô ligado: %v, mínimo %s, desconto %g %s, não esperar: %v, 4 casas: %v", cfg.Ligado, minimo, cfg.Desconto, tipo, cfg.NaoAguardar, cfg.QuatroCasas)
			}
			if r := m.ranking[k]; r != nil && !r.em.IsZero() {
				t += fmt.Sprintf(" | classificação de %.1f s atrás", agora.Sub(r.em).Seconds())
			}
			if msg := m.mensagens[k].Texto; msg != "" {
				t += " | " + msg
			}
			linhas = append(linhas, t)
		}
	}
	sort.Strings(linhas)
	if len(linhas) == 0 {
		b.WriteString("(nenhum item em etapa de lances agora)\n")
	}
	for _, l := range linhas {
		b.WriteString(l + "\n")
	}
	return b.String()
}
