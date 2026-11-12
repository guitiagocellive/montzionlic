package main

import (
	"strings"
	"testing"
	"time"
)

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
		{"espera os 10 s finais (padrão)", estadoItem{Fase: "LA", RestanteSeg: f(30), Melhor: f(980), Nosso: f(1000), Situacao: "P"}, false, 0, "aguardando-final"},
		{"cobre com 0,5%", estadoItem{Fase: "LA", RestanteSeg: f(9), Melhor: f(980), Nosso: f(1000), Situacao: "P"}, true, 975.10, "lance"},
		{"ganhando não dá lance", estadoItem{Fase: "LA", RestanteSeg: f(5), Melhor: f(970), Nosso: f(970), Situacao: "G"}, false, 0, "ganhando"},
		{"segundos finais sem classificação: mínimo", estadoItem{Fase: "LA", RestanteSeg: f(3), Melhor: f(902.13), Nosso: f(907.13), Situacao: "P"}, true, 900, "minimo"},
		{"sem classificação e com tempo: não desce ao mínimo", estadoItem{Fase: "LA", Melhor: f(850), Nosso: f(1000), Situacao: "P"}, false, 0, "precisa-classificacao"},
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
		t.Errorf("não esperar: deveria cobrir na hora, veio %+v", d)
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

// Exemplo da conversa: mínimo 760, concorrentes com 550 (1º) e 1.100 (2º), nós com 1.200.
// Não dá para passar o de 550; cobrir o de 1.100 já deixa em 2º — sem descer até 760.
func TestMelhorColocacao(t *testing.T) {
	cfg := &configItem{Ligado: true, Minimo: f(760), Desconto: 0.1, NaoAguardar: true}
	e := estadoItem{Fase: "LA", Melhor: f(550), Nosso: f(1200), Situacao: "P", Concorrentes: []float64{550, 1100}}
	d := decidir(e, cfg)
	if !d.Enviar || d.Tipo != "colocacao" || d.Valor != 1098.9 {
		t.Fatalf("deveria cobrir 1.100 (−0,1%% = 1.098,90) e ficar em 2º: %+v", d)
	}
	if !strings.Contains(d.Motivo, "2º lugar") {
		t.Errorf("motivo deveria dizer 2º lugar: %s", d.Motivo)
	}
	// Já à frente do de 1.100: não mexe.
	e.Nosso = f(1098.9)
	if d := decidir(e, cfg); d.Enviar || d.Tipo != "melhor-possivel" {
		t.Errorf("já na melhor colocação: não deveria dar lance: %+v", d)
	}
	// Todos os concorrentes abaixo do mínimo: não adianta descer.
	e = estadoItem{Fase: "LA", Melhor: f(500), Nosso: f(900), Situacao: "P", Concorrentes: []float64{500, 700}}
	if d := decidir(e, cfg); d.Enviar {
		t.Errorf("concorrentes abaixo do mínimo: não deveria dar lance: %+v", d)
	}
	// Dá para ser 1º acima do mínimo: cobre o melhor normalmente.
	e = estadoItem{Fase: "LA", Melhor: f(1000), Nosso: f(1100), Situacao: "P", Concorrentes: []float64{1000, 1050}}
	if d := decidir(e, cfg); !d.Enviar || d.Tipo != "lance" || d.Valor != 999 {
		t.Errorf("deveria cobrir o 1º (1.000 → 999,00): %+v", d)
	}
}

func TestFimDaContagem(t *testing.T) {
	fim := time.Now().Add(90 * time.Second).In(time.FixedZone("BRT", -3*3600)).Format("2006-01-02T15:04:05")
	e := lerItem(map[string]any{"numero": 1.0, "fase": "LA", "dataHoraFimContagem": fim})
	if e.RestanteSeg == nil || *e.RestanteSeg < 85 || *e.RestanteSeg > 91 {
		t.Fatalf("restante pela hora de término deveria ser ~90 s: %v", e.RestanteSeg)
	}
}
