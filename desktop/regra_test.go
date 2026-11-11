package main

import "testing"

func f(v float64) *float64 { return &v }

func TestDecidir(t *testing.T) {
	cfg := &configItem{Ligado: true, Minimo: f(900), Desconto: 0.5}
	casos := []struct {
		nome   string
		e      estadoItem
		enviar bool
		valor  float64
		tipo   string
	}{
		{"espera os 10 s finais", estadoItem{Fase: "LA", RestanteSeg: f(30), Melhor: f(980), Nosso: f(1000), Situacao: "P"}, false, 0, "aguardando-final"},
		{"cobre com 0,5%", estadoItem{Fase: "LA", RestanteSeg: f(9), Melhor: f(980), Nosso: f(1000), Situacao: "P"}, true, 975.10, "lance"},
		{"ganhando não dá lance", estadoItem{Fase: "LA", RestanteSeg: f(5), Melhor: f(970), Nosso: f(970), Situacao: "G"}, false, 0, "ganhando"},
		{"vai no mínimo", estadoItem{Fase: "LA", RestanteSeg: f(3), Melhor: f(902.13), Nosso: f(907.13), Situacao: "P"}, true, 900, "minimo"},
		{"no mínimo para", estadoItem{Fase: "LA", RestanteSeg: f(3), Melhor: f(890), Nosso: f(900), Situacao: "P"}, false, 0, "no-minimo"},
		{"fechada vai no mínimo", estadoItem{Fase: "LF", Melhor: f(950), Nosso: f(1000)}, true, 900, "fechada"},
		{"aleatório cobre sem esperar", estadoItem{Fase: "AL", Melhor: f(980), Nosso: f(1000), Situacao: "P"}, true, 975.10, "lance"},
		{"fora da fase", estadoItem{Fase: "F", Melhor: f(980), Nosso: f(1000)}, false, 0, "aguardando-fase"},
		{"intervalo do edital (R$ 10)", estadoItem{Fase: "LA", RestanteSeg: f(5), Melhor: f(980), Nosso: f(1000), Situacao: "P", Variacao: f(10), TipoVariacao: "V"}, true, 970, "lance"},
	}
	for _, c := range casos {
		d := decidir(c.e, cfg)
		if d.Enviar != c.enviar || d.Tipo != c.tipo || (c.enviar && d.Valor != c.valor) {
			t.Errorf("%s: veio %+v", c.nome, d)
		}
	}
	nao := &configItem{Ligado: true, Minimo: f(900), Desconto: 0.5, NaoAguardar: true}
	if d := decidir(estadoItem{Fase: "LA", RestanteSeg: f(60), Melhor: f(980), Nosso: f(1000), Situacao: "P"}, nao); !d.Enviar {
		t.Errorf("não aguardar: deveria cobrir na hora, veio %+v", d)
	}
}

func TestLerItemDeduzPerdendo(t *testing.T) {
	e := lerItem(map[string]any{"numero": 1.0, "fase": "LA", "melhorValorGeral": map[string]any{"valorCalculado": 950.0}, "melhorValorFornecedor": map[string]any{"valorCalculado": 960.0}, "situacaoParticipanteDisputa": "G"})
	if e.Situacao != "P" || e.Numero != 1 {
		t.Errorf("deveria deduzir perdendo: %+v", e)
	}
}

func TestStomp(t *testing.T) {
	q, ok := lerQuadro("\nMESSAGE\ndestination:/topic/compra/1\nclasse:ItemDisputaRepresentation\n\n[{\"numero\":1}]\x00")
	if !ok || q.Comando != "MESSAGE" || q.Cabecalhos["classe"] != "ItemDisputaRepresentation" || q.Corpo != `[{"numero":1}]` {
		t.Errorf("quadro: %+v", q)
	}
}
