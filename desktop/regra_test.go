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
		{"segundos finais sem classificação: NÃO vai ao mínimo", estadoItem{Fase: "LA", RestanteSeg: f(3), Melhor: f(850), Nosso: f(1000), Situacao: "P"}, false, 0, "precisa-classificacao"},
		{"sem classificação e com tempo: não desce ao mínimo", estadoItem{Fase: "LA", Melhor: f(850), Nosso: f(1000), Situacao: "P"}, false, 0, "precisa-classificacao"},
		{"no mínimo para", estadoItem{Fase: "LA", RestanteSeg: f(3), Melhor: f(890), Nosso: f(900), Situacao: "P"}, false, 0, "no-minimo"},
		{"fechada: não envia sozinho, sugere o mínimo", estadoItem{Fase: "LF", Melhor: f(950), Nosso: f(1000)}, false, 0, "fechada-manual"},
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

func TestDescontoEmReais(t *testing.T) {
	// Edital com intervalo de R$ 0,01: o campo vem "desconto (R$) 0,01" e o robô cobre por 1 centavo.
	cfg := &configItem{Ligado: true, Minimo: f(900), Desconto: 0.01, TipoDesconto: "V", NaoAguardar: true}
	e := estadoItem{Fase: "LA", RestanteSeg: f(60), Melhor: f(980), Nosso: f(1000), Situacao: "P", Variacao: f(0.01), TipoVariacao: "V"}
	if d := decidir(e, cfg); !d.Enviar || d.Valor != 979.99 {
		t.Errorf("R$ 0,01: veio %+v", d)
	}
	// R$ 5 de desconto (acima do intervalo do edital).
	cfg.Desconto = 5
	if d := decidir(e, cfg); !d.Enviar || d.Valor != 975 {
		t.Errorf("R$ 5: veio %+v", d)
	}
	// Em %: 1% de 980 = 9,80.
	pct := &configItem{Ligado: true, Minimo: f(900), Desconto: 1, TipoDesconto: "P", NaoAguardar: true}
	if d := decidir(e, pct); !d.Enviar || d.Valor != 970.20 {
		t.Errorf("1%%: veio %+v", d)
	}
}

func TestLancePertoDoFimDeixaCaptchaPronto(t *testing.T) {
	agora := time.Now()
	m := &motor{token: "x", compras: map[string]*compraMotor{}, config: map[string]configItem{}}
	item := func(fase string, restante float64, situacao string) *itemMotor {
		return &itemMotor{bruto: map[string]any{"numero": 1.0, "fase": fase, "tempoRestanteEmSegundos": restante,
			"melhorValorGeral": map[string]any{"valorCalculado": 950.0}, "melhorValorFornecedor": map[string]any{"valorCalculado": 1000.0},
			"situacaoParticipanteDisputa": situacao}, recebidoEm: agora}
	}
	m.compras["c"] = &compraMotor{itens: map[int]*itemMotor{1: item("LA", 600, "P")}}
	if m.precisaCaptchaPronto() {
		t.Error("10 min antes do fim e robô parado: não precisa de captcha pronto")
	}
	m.compras["c"].itens[1] = item("LA", 90, "P")
	if !m.precisaCaptchaPronto() {
		t.Error("1,5 min do fim, perdendo, robô parado: o captcha deveria ficar pronto para quando ligar o robô")
	}
	m.compras["c"].itens[1] = item("LA", 90, "G")
	m.compras["c"].itens[1].bruto["melhorValorGeral"] = map[string]any{"valorCalculado": 1000.0}
	if m.precisaCaptchaPronto() {
		t.Error("ganhando: não precisa de captcha pronto")
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
	if !d.Enviar || d.Tipo != "colocacao" || d.Valor != 1099.99 {
		t.Fatalf("deveria cobrir 1.100 com 1.099,99 e ficar em 2º: %+v", d)
	}
	if !strings.Contains(d.Motivo, "2º lugar") {
		t.Errorf("motivo deveria dizer 2º lugar: %s", d.Motivo)
	}
	// Já à frente do de 1.100: não mexe.
	e.Nosso = f(1099.99)
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

// O exemplo do usuário: 1º 500, 2º 800, nós 1.000, mínimo 700 → 799,99 (2º), nunca 700.
func TestColocacaoExemploUsuario(t *testing.T) {
	cfg := &configItem{Ligado: true, Minimo: f(700), Desconto: 0.5}
	base := estadoItem{Fase: "LA", RestanteSeg: f(5), Melhor: f(500), Nosso: f(1000), Situacao: "P"}
	// Sem a classificação: não dá lance (antes ia direto a 700).
	if d := decidir(base, cfg); d.Enviar {
		t.Fatalf("sem classificação não pode ir ao mínimo: %+v", d)
	}
	e := base
	e.Concorrentes = []float64{500, 800}
	d := decidir(e, cfg)
	if !d.Enviar || d.Valor != 799.99 || !strings.Contains(d.Motivo, "2º lugar") {
		t.Fatalf("deveria dar 799,99 e ficar em 2º: %+v", d)
	}
	// A lista da sala não diz qual é o nosso: o valor igual ao nosso lance é o nosso (não cobre a si mesmo).
	e.Concorrentes = []float64{500, 800, 1000}
	if d := decidir(e, cfg); !d.Enviar || d.Valor != 799.99 {
		t.Fatalf("com o nosso na lista: deveria dar 799,99: %+v", d)
	}
	// Depois do lance: fica parado em 2º.
	e.Nosso = f(799.99)
	if d := decidir(e, cfg); d.Enviar {
		t.Fatalf("já em 2º: não deveria dar outro lance: %+v", d)
	}
	// O de 800 desceu para 780: cobre de novo (779,99).
	e.Concorrentes = []float64{500, 780}
	if d := decidir(e, cfg); !d.Enviar || d.Valor != 779.99 {
		t.Fatalf("deveria cobrir 780 com 779,99: %+v", d)
	}
	// O de 780 desceu para 690 (abaixo do mínimo): para no 3º, sem ir ao mínimo.
	e.Nosso = f(779.99)
	e.Concorrentes = []float64{500, 690}
	if d := decidir(e, cfg); d.Enviar {
		t.Fatalf("concorrentes abaixo do mínimo: não deveria dar lance: %+v", d)
	}
	// Intervalo do edital de R$ 5 sobre o nosso lance: de 1.000 para 799,99 cabe; de 801 não (fica 796).
	e = base
	e.Nosso, e.Variacao, e.TipoVariacao = f(801), f(5), "V"
	e.Concorrentes = []float64{500, 800}
	if d := decidir(e, cfg); !d.Enviar || d.Valor != 796 {
		t.Fatalf("intervalo de R$ 5 sobre o nosso: deveria dar 796: %+v", d)
	}
	// Classificação lida antes e alguém cobriu com 650 depois (só o melhor geral mudou): o 650 entra na conta.
	e = base
	e.Melhor = f(650)
	e.Concorrentes = []float64{800}
	if d := decidir(e, cfg); !d.Enviar || d.Valor != 799.99 || !strings.Contains(d.Motivo, "2º lugar") {
		t.Fatalf("com o melhor geral novo (650): deveria dar 799,99 em 2º: %+v", d)
	}
}

func TestFimDaContagem(t *testing.T) {
	fim := time.Now().Add(90 * time.Second).In(time.FixedZone("BRT", -3*3600)).Format("2006-01-02T15:04:05")
	e := lerItem(map[string]any{"numero": 1.0, "fase": "LA", "dataHoraFimContagem": fim})
	if e.RestanteSeg == nil || *e.RestanteSeg < 85 || *e.RestanteSeg > 91 {
		t.Fatalf("restante pela hora de término deveria ser ~90 s: %v", e.RestanteSeg)
	}
}

func TestRitmoClassificacao(t *testing.T) {
	cfg := &configItem{Ligado: true, Minimo: f(900)}
	nao := &configItem{Ligado: true, Minimo: f(900), NaoAguardar: true}
	casos := []struct {
		nome string
		e    estadoItem
		c    *configItem
		quer time.Duration
	}{
		{"últimos segundos: 0,7 s", estadoItem{Fase: "LA", RestanteSeg: f(8)}, cfg, 700 * time.Millisecond},
		{"aleatório: 1 s", estadoItem{Fase: "AL"}, cfg, time.Second},
		{"1,5 min do fim: 2 s", estadoItem{Fase: "LA", RestanteSeg: f(90)}, cfg, 2 * time.Second},
		{"não esperar, 50 s do fim: 0,7 s", estadoItem{Fase: "LA", RestanteSeg: f(50)}, nao, 700 * time.Millisecond},
		{"não esperar com 3,5 h pela frente: 15 s (antes 2 s)", estadoItem{Fase: "LA", RestanteSeg: f(12830)}, nao, 15 * time.Second},
	}
	for _, c := range casos {
		if r := ritmoClassificacao(c.e, c.c); r != c.quer {
			t.Errorf("%s: veio %v", c.nome, r)
		}
	}
}

func TestReconheceOProprioLance(t *testing.T) {
	agora := time.Now()
	m := &motor{meusValores: map[string][]valorEnviado{"c:1": {{979.99, agora.Add(-time.Second)}}}}
	// O aviso do tempo real trouxe o melhor lance (o nosso, 979,99) mas ainda o nosso lance antigo (1.000).
	e := estadoItem{Fase: "LA", RestanteSeg: f(5), Melhor: f(979.99), Nosso: f(1000), Situacao: "P"}
	m.reconhecerMeuLance("c:1", &e, agora)
	cfg := &configItem{Ligado: true, Minimo: f(900)}
	if d := decidir(e, cfg); d.Enviar || e.Situacao != "G" || *e.Nosso != 979.99 {
		t.Errorf("o melhor lance é o que acabamos de mandar: não pode cobrir a si mesmo (veio %+v, %+v)", d, e)
	}
	// Recusado: o valor deixa de ser nosso e o mesmo valor passa a ser de um concorrente.
	m.esquecerMeuValor("c:1", 979.99)
	e2 := estadoItem{Fase: "LA", RestanteSeg: f(5), Melhor: f(979.99), Nosso: f(1000), Situacao: "P"}
	m.reconhecerMeuLance("c:1", &e2, agora)
	if d := decidir(e2, cfg); !d.Enviar || d.Valor != 979.98 {
		t.Errorf("valor recusado (é do concorrente): deveria cobrir com 979,98, veio %+v", d)
	}
}

func TestGanharTempo(t *testing.T) {
	// Exemplo do usuário: intervalo de R$ 0,01, mínimo R$ 100, ganhando com R$ 500 → nos 10 s finais dá 499,99.
	cfg := &configItem{Ligado: true, Minimo: f(100), GanharTempo: true}
	e := estadoItem{Fase: "LA", RestanteSeg: f(9), Melhor: f(500), Nosso: f(500), Situacao: "G", Variacao: f(0.01), TipoVariacao: "V", PodeGanharTempo: true}
	if d := decidir(e, cfg); !d.Enviar || d.Tipo != "ganhar-tempo" || d.Valor != 499.99 {
		t.Errorf("deveria dar 499,99 para ganhar tempo, veio %+v", d)
	}
	e2 := e
	e2.RestanteSeg = f(40)
	if d := decidir(e2, cfg); d.Enviar {
		t.Errorf("fora dos 10 s finais não dá lance para ganhar tempo: %+v", d)
	}
	e3 := e
	e3.PodeGanharTempo = false
	if d := decidir(e3, cfg); d.Enviar {
		t.Errorf("já deu o lance desta rodada (o cronômetro ainda não reiniciou): não dá outro, veio %+v", d)
	}
	e4 := e
	e4.Nosso, e4.Melhor = f(100), f(100)
	if d := decidir(e4, cfg); d.Enviar {
		t.Errorf("no mínimo: para de ganhar tempo, veio %+v", d)
	}
	sem := &configItem{Ligado: true, Minimo: f(100)}
	if d := decidir(e, sem); d.Enviar || d.Tipo != "ganhando" {
		t.Errorf("sem a opção: ganhando, sem lance, veio %+v", d)
	}
	e5 := e
	e5.Fase = "AL"
	if d := decidir(e5, cfg); d.Enviar {
		t.Errorf("aleatório não tem cronômetro para prorrogar: %+v", d)
	}
	if !ehDispensa("17000706000392026") || ehDispensa("98765405000392026") {
		t.Error("modalidade 06 na chave = dispensa (sem ganhar tempo); 05 = pregão")
	}
}

func TestQuatroCasasSozinho(t *testing.T) {
	if precisaQuatroCasas(estadoItem{Variacao: f(0.01), TipoVariacao: "V", Melhor: f(980), Nosso: f(1000)}) {
		t.Error("tudo com 2 casas: não precisa de 4")
	}
	if !precisaQuatroCasas(estadoItem{Variacao: f(0.0001), TipoVariacao: "V"}) {
		t.Error("intervalo de R$ 0,0001: precisa de 4 casas")
	}
	if !precisaQuatroCasas(estadoItem{Melhor: f(0.6831)}) {
		t.Error("lance com 4 casas (0,6831): precisa de 4 casas")
	}
	if precisaQuatroCasas(estadoItem{Variacao: f(0.5), TipoVariacao: "P"}) {
		t.Error("intervalo em % não conta como casas decimais do valor")
	}
}
