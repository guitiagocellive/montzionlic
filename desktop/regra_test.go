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
		{"cobre na hora (padrão)", estadoItem{Fase: "LA", RestanteSeg: f(30), Melhor: f(980), Nosso: f(1000), Situacao: "P"}, true, 975.10, "lance"},
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
	espera := &configItem{Ligado: true, Minimo: f(900), Desconto: 0.5, AguardarFinais: true}
	if d := decidir(estadoItem{Fase: "LA", RestanteSeg: f(60), Melhor: f(980), Nosso: f(1000), Situacao: "P"}, espera); d.Enviar || d.Tipo != "aguardando-final" {
		t.Errorf("esperar os segundos finais (opção): não deveria cobrir com 60 s, veio %+v", d)
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

func TestNotaSalaMenuReal(t *testing.T) {
	itens := []itemMenu{
		{"Alterar seus Dados Cadastrais", "/assinadas/Atualiza_Dados/Atualiza_Dados.asp"},
		{"Licitação e Dispensa (novo)", "/assinadas/dispensa_eletronica.asp"},
		{"Pregão e Concorrência (legado)", "/assinadas/pregao.asp"},
		{"Em que está Participando (Lances)", "/assinadas/cotacao.asp?filtro=1"},
		{"Consultar suas Propostas", "/assinadas/cotacao.asp?filtro=2"},
		{"Sair", "/logoff.asp"},
	}
	melhor, nota := -1, 2
	for i, it := range itens {
		if n := notaSala(it); n > nota {
			melhor, nota = i, n
		}
	}
	if melhor != 1 {
		t.Fatalf("esperava \"Licitação e Dispensa (novo)\", veio %d (nota %d)", melhor, nota)
	}
}
