package main

// Regra de decisão do robô (a mesma de src/shared/robo.ts, rodando dentro do aplicativo para responder na hora).
//
// Cobre na hora: assim que alguém passa na frente, dá o menor lance que coloca a empresa em 1º; se não der sem
// passar do lance mínimo, vai no lance mínimo. Nunca envia abaixo do mínimo.
// "Esperar os segundos finais" (opcional) só cobre nos últimos 10 segundos do cronômetro.

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

const segundosFinais = 10

type configItem struct {
	Ligado         bool     `json:"ligado"`
	Minimo         *float64 `json:"minimo"`
	Desconto       float64  `json:"desconto"`
	NaoAguardar    bool     `json:"naoAguardar"` // antigo (a regra agora cobre na hora por padrão)
	AguardarFinais bool     `json:"aguardarFinais"`
	QuatroCasas    bool     `json:"quatroCasas"`
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
}

type decisao struct {
	Enviar bool
	Tipo   string
	Valor  float64
	Motivo string
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
	if c.AguardarFinais && e.Fase == "LA" && e.RestanteSeg != nil && *e.RestanteSeg > segundosFinais {
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
		return decisao{Enviar: true, Tipo: "lance", Valor: alvo, Motivo: "Cobrindo o melhor lance (" + reaisTexto(melhor, q) + ") com " + reaisTexto(alvo, q)}
	}
	if minimo <= arredondarAbaixo(nosso-passoMinimo(nosso, e, q), q) {
		return decisao{Enviar: true, Tipo: "minimo", Valor: minimo, Motivo: "Não dá para ser 1º acima do mínimo: lance no mínimo (" + reaisTexto(minimo, q) + ")"}
	}
	return decisao{Tipo: "no-minimo", Motivo: "No lance mínimo: melhor colocação possível"}
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
	// A situação vem do tópico do fornecedor; quando o aviso geral chega antes, deduz pelos valores
	// (perdendo assim que alguém cobre: é aí que o robô precisa agir na hora).
	if e.Melhor != nil && e.Nosso != nil && *e.Melhor < *e.Nosso-1e-9 {
		e.Situacao = "P"
	}
	return e
}
