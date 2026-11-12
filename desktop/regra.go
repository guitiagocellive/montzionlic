package main

// Regra de decisão do robô (a mesma de src/shared/robo.ts, rodando dentro do aplicativo para responder na hora).
//
// Espera os 10 segundos finais do cronômetro (como o Siga Pregão); "Não esperar" cobre na hora.
// Na hora de agir: se dá para ser 1º acima do mínimo, cobre o melhor lance. Se não dá, busca a MELHOR
// COLOCAÇÃO POSSÍVEL pela classificação dos concorrentes: cobre o concorrente mais barato que ainda está acima
// do mínimo (ex.: 1º com 500, 2º com 800, nós com 1.000 e mínimo 700 → lance 799,99 e fica em 2º). O mínimo é só
// o limite: o robô NUNCA vai direto ao mínimo sem saber a classificação, e nunca envia abaixo dele.

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

const segundosFinais = 10

type configItem struct {
	Ligado      bool     `json:"ligado"`
	Minimo      *float64 `json:"minimo"`
	Desconto    float64  `json:"desconto"`
	NaoAguardar bool     `json:"naoAguardar"` // cobrir na hora, sem esperar os 10 s finais
	QuatroCasas bool     `json:"quatroCasas"`
}

type estadoItem struct {
	Fase          string
	RestanteSeg   *float64
	Melhor        *float64
	Nosso         *float64
	Situacao      string
	Variacao      *float64
	TipoVariacao  string
	Numero        int
	Descricao     string
	ValorEstimado *float64
	FimEm         *time.Time
	// Melhor lance de cada concorrente (sem o nosso), pela classificação do item; nil = ainda não lida.
	Concorrentes []float64
	// O Compras.gov.br recusou um lance intermediário pelo intervalo mínimo: aplica o intervalo também sobre o
	// lance do concorrente que vamos cobrir (e não só sobre o nosso).
	PassoNoConcorrente bool
}

type decisao struct {
	Enviar bool
	Tipo   string
	Valor  float64
	Motivo string
	// Colocação que o lance busca (1 = cobrir o melhor; 0 = não se sabe, ex.: etapa fechada).
	Posicao int
}

var nomesFases = map[string]string{
	"AS": "Aguardando abertura da sessão", "AP": "Pendente da análise de propostas", "F": "Aguardando disputa",
	"AA": "Aguardando abertura", "LS": "Abertura suspensa", "LA": "Etapa aberta", "AL": "Etapa aberta (encerramento aleatório)",
	"LF": "Etapa fechada", "AF": "Aguardando disputa fechada", "FE": "Aguardando encerramento", "RA": "Aguardando decisão sobre reinício",
	"AM": "Aguardando desempate ME/EPP", "DM": "Em desempate ME/EPP", "DF": "Em disputa final", "E": "Disputa encerrada",
}

var fasesDeLance = map[string]bool{"LA": true, "AL": true, "DF": true, "LF": true}

func fatorCasas(quatro bool) float64 {
	if quatro {
		return 10000
	}
	return 100
}

func arredondarAbaixo(v float64, quatro bool) float64 {
	f := fatorCasas(quatro)
	return math.Floor(v*f+1e-6) / f
}

func arredondarAcima(v float64, quatro bool) float64 {
	f := fatorCasas(quatro)
	return math.Ceil(v*f-1e-6) / f
}

func reaisTexto(v float64, quatro bool) string {
	casas := 2
	if quatro {
		casas = 4
	}
	s := strconv.FormatFloat(v, 'f', casas, 64)
	inteiro, frac, _ := strings.Cut(s, ".")
	var b strings.Builder
	for i, c := range inteiro {
		if i > 0 && (len(inteiro)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return "R$ " + b.String() + "," + frac
}

// Quanto precisa baixar a partir de um valor, respeitando o intervalo mínimo do edital.
func passoMinimo(base float64, e estadoItem, quatro bool) float64 {
	menor := 1 / fatorCasas(quatro)
	if e.Variacao == nil || *e.Variacao <= 0 {
		return menor
	}
	v := *e.Variacao
	if e.TipoVariacao == "P" {
		v = base * *e.Variacao / 100
	}
	return math.Max(arredondarAcima(v, quatro), menor)
}

func decidir(e estadoItem, c *configItem) decisao {
	if c == nil || !c.Ligado {
		return decisao{Tipo: "desligado", Motivo: "Robô parado neste item"}
	}
	if c.Minimo == nil || !(*c.Minimo > 0) {
		return decisao{Tipo: "sem-minimo", Motivo: "Informe o lance mínimo para o robô agir"}
	}
	q := c.QuatroCasas
	minimo := arredondarAcima(*c.Minimo, q)
	if !fasesDeLance[e.Fase] {
		motivo := nomesFases[e.Fase]
		if motivo == "" {
			motivo = "Aguardando a fase de lances"
		}
		return decisao{Tipo: "aguardando-fase", Motivo: motivo}
	}
	if e.Nosso == nil {
		return decisao{Tipo: "sem-proposta", Motivo: "Sem lance nosso neste item"}
	}
	nosso := *e.Nosso
	if e.Fase == "LF" {
		if minimo >= nosso {
			return decisao{Tipo: "fechada", Motivo: "Etapa fechada: nosso lance já está no mínimo"}
		}
		return decisao{Enviar: true, Tipo: "fechada", Valor: minimo, Motivo: "Etapa fechada: lance único no mínimo (" + reaisTexto(minimo, q) + ")"}
	}
	if e.Situacao == "G" {
		return decisao{Tipo: "ganhando", Motivo: "Ganhando"}
	}
	if !c.NaoAguardar && e.Fase == "LA" && e.RestanteSeg != nil && *e.RestanteSeg > segundosFinais {
		return decisao{Tipo: "aguardando-final", Motivo: fmt.Sprintf("Aguardando entrar nos últimos %d segundos para enviar lance", segundosFinais)}
	}
	if nosso <= minimo {
		return decisao{Tipo: "no-minimo", Motivo: "No lance mínimo: melhor colocação possível"}
	}
	melhor := nosso
	if e.Melhor != nil {
		melhor = *e.Melhor
	}
	desconto := arredondarAcima(melhor*math.Max(c.Desconto, 0)/100, q)
	alvo := arredondarAbaixo(melhor-math.Max(desconto, passoMinimo(melhor, e, q)), q)
	if alvo >= minimo && alvo < nosso {
		return decisao{Enviar: true, Tipo: "lance", Valor: alvo, Posicao: 1, Motivo: "Cobrindo o melhor lance (" + reaisTexto(melhor, q) + ") com " + reaisTexto(alvo, q)}
	}
	// Não dá para ser 1º sem passar do mínimo: melhor colocação possível pela classificação.
	if e.Concorrentes != nil {
		return melhorColocacao(e, c, minimo, nosso)
	}
	// Sem a classificação não sabemos onde estão os outros: NÃO vai ao mínimo às cegas.
	return decisao{Tipo: "precisa-classificacao", Motivo: "Não dá para ser 1º acima do mínimo: lendo a classificação para achar a melhor colocação"}
}

// ---------- leitura dos itens da sala de disputa ----------

func numeroDe(v any) *float64 {
	switch x := v.(type) {
	case float64:
		return &x
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil {
			return &f
		}
	}
	return nil
}

func valorDe(v any) *float64 {
	if m, ok := v.(map[string]any); ok {
		if f := numeroDe(m["valorCalculado"]); f != nil {
			return f
		}
		return numeroDe(m["valorInformado"])
	}
	return numeroDe(v)
}

func textoDe(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

// lerItem converte um item (lista em-disputa ou aviso do tempo real).
func lerItem(b map[string]any) estadoItem {
	e := estadoItem{
		Fase:          textoDe(b["fase"]),
		RestanteSeg:   numeroDe(b["tempoRestanteEmSegundos"]),
		Melhor:        valorDe(b["melhorValorGeral"]),
		Nosso:         valorDe(b["melhorValorFornecedor"]),
		Situacao:      textoDe(b["situacaoParticipanteDisputa"]),
		Variacao:      numeroDe(b["variacaoMinimaEntreLances"]),
		TipoVariacao:  strings.ToUpper(textoDe(b["tipoVariacaoMinimaEntreLances"])),
		Descricao:     textoDe(b["descricao"]),
		ValorEstimado: numeroDe(b["valorEstimado"]),
	}
	if n := numeroDe(b["numero"]); n != nil {
		e.Numero = int(*n)
	}
	// Na dispensa o Compras.gov.br manda a hora de término em vez do tempo restante.
	if fim := fimDaContagem(b["dataHoraFimContagem"]); fim != nil {
		e.FimEm = fim
		if e.RestanteSeg == nil {
			r := math.Max(0, time.Until(*fim).Seconds())
			e.RestanteSeg = &r
		}
	}
	// A situação vem do tópico do fornecedor; quando o aviso geral chega antes, deduz pelos valores
	// (perdendo assim que alguém cobre: é aí que o robô precisa agir na hora).
	if e.Melhor != nil && e.Nosso != nil && *e.Melhor < *e.Nosso-1e-9 {
		e.Situacao = "P"
	}
	return e
}

// concorrentesAtuais: os lances dos outros participantes, sem o nosso (mesmo que a lista não diga qual é o nosso,
// um valor igual ao nosso lance atual é o nosso) e com o melhor lance atual, caso alguém tenha coberto depois da
// leitura da classificação.
func concorrentesAtuais(e estadoItem, nosso float64) []float64 {
	conc := make([]float64, 0, len(e.Concorrentes)+1)
	tirouNosso := false
	for _, v := range e.Concorrentes {
		if !tirouNosso && math.Abs(v-nosso) < 0.00005 {
			tirouNosso = true
			continue
		}
		conc = append(conc, v)
	}
	if e.Melhor != nil && *e.Melhor < nosso-0.00005 {
		tem := false
		for _, v := range conc {
			if v <= *e.Melhor+0.00005 {
				tem = true
				break
			}
		}
		if !tem {
			conc = append(conc, *e.Melhor)
		}
	}
	return conc
}

// melhorColocacao: fica à frente de todo concorrente que está acima do mínimo, cobrindo o mais barato deles por
// um centavo (o desconto escolhido vale para cobrir o 1º; aqui basta passar à frente gastando o mínimo possível);
// os que estão abaixo do mínimo não dá para passar.
// Ex.: 1º 500, 2º 800, nós 1.000, mínimo 700 → 799,99 (2º lugar).
func melhorColocacao(e estadoItem, c *configItem, minimo, nosso float64) decisao {
	q := c.QuatroCasas
	conc := concorrentesAtuais(e, nosso)
	alvoConc := math.Inf(1)
	for _, v := range conc {
		if v > minimo+1e-9 && v < alvoConc {
			alvoConc = v
		}
	}
	posicao := func(lance float64) int {
		p := 1
		for _, v := range conc {
			if v <= lance+1e-9 { // empate: quem deu antes fica na frente
				p++
			}
		}
		return p
	}
	if math.IsInf(alvoConc, 1) {
		return decisao{Tipo: "melhor-possivel", Motivo: fmt.Sprintf("Melhor colocação possível com o seu mínimo: %dº lugar (quem está à frente está abaixo do mínimo)", posicao(nosso))}
	}
	if nosso < alvoConc-1e-9 {
		return decisao{Tipo: "melhor-possivel", Motivo: fmt.Sprintf("Na melhor colocação possível: %dº lugar (à frente do lance de %s)", posicao(nosso), reaisTexto(alvoConc, q))}
	}
	menor := 1 / fatorCasas(q)
	degrau := menor
	if e.PassoNoConcorrente {
		degrau = math.Max(degrau, passoMinimo(alvoConc, e, q))
	}
	lance := arredondarAbaixo(alvoConc-degrau, q)
	// O intervalo mínimo do edital vale sobre o nosso próprio lance anterior.
	if teto := arredondarAbaixo(nosso-passoMinimo(nosso, e, q), q); lance > teto {
		lance = teto
	}
	if lance < minimo {
		lance = minimo
	}
	if lance >= alvoConc-1e-9 || !(lance < nosso-1e-9) { // o degrau não cabe acima do mínimo
		return decisao{Tipo: "melhor-possivel", Motivo: fmt.Sprintf("Melhor colocação possível com o seu mínimo: %dº lugar", posicao(nosso))}
	}
	return decisao{Enviar: true, Tipo: "colocacao", Valor: lance, Posicao: posicao(lance), Motivo: fmt.Sprintf("Melhor colocação possível (%dº lugar): cobrindo %s com %s", posicao(lance), reaisTexto(alvoConc, q), reaisTexto(lance, q))}
}

// fimDaContagem lê a hora de término do item ("dataHoraFimContagem"), no horário de Brasília quando vem sem fuso.
func fimDaContagem(v any) *time.Time {
	s := strings.TrimSpace(textoDe(v))
	if s == "" {
		return nil
	}
	brasilia := time.FixedZone("BRT", -3*3600)
	for _, f := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.000", "2006-01-02T15:04:05", "2006-01-02 15:04:05", "02/01/2006 15:04:05"} {
		var t time.Time
		var err error
		if strings.Contains(f, "Z07") {
			t, err = time.Parse(f, s)
		} else {
			t, err = time.ParseInLocation(f, s, brasilia)
		}
		if err == nil {
			return &t
		}
	}
	return nil
}
