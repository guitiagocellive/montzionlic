package main

import (
	"strings"
	"testing"
	"time"
)

func TestRelatorioDaDisputa(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	rotulo := "compra …392026 item 1"
	t0 := time.Now().Add(-time.Minute)
	ev := []eventoRobo{
		{t0, rotulo + ": robô LIGADO", "", 0},
		{t0.Add(10 * time.Second), rotulo + ": melhor lance R$ 980,0000 (nosso R$ 1.000,0000)", "melhor-conc", 0},
		{t0.Add(10*time.Second + 120*time.Millisecond), rotulo + ": enviando lance R$ 979,99 (lance)", "enviando", 0},
		{t0.Add(10*time.Second + 210*time.Millisecond), rotulo + ": lance R$ 979,99 aceito (201, lance)", "lance-ok", 90},
		{t0.Add(20 * time.Second), rotulo + ": melhor lance R$ 970,0000 (nosso R$ 979,9900)", "melhor-conc", 0},
		{t0.Add(20*time.Second + 300*time.Millisecond), rotulo + ": enviando lance R$ 969,99 (lance)", "enviando", 0},
		{t0.Add(20*time.Second + 380*time.Millisecond), rotulo + ": lance R$ 969,99 RECUSADO (422, lance)", "lance-recusado", 80},
		{t0.Add(30 * time.Second), rotulo + ": melhor lance R$ 960,0000 (nosso R$ 969,9900)", "melhor-conc", 0},
		{t0.Add(31 * time.Second), rotulo + ": classificação lida em 90 ms (captchas prontos antes: 2, 2 concorrente(s), você em 3º de 3)", "classif", 90},
		{t0.Add(32 * time.Second), rotulo + ": classificação lida em 110 ms (captchas prontos antes: 2, 2 concorrente(s), você em 2º de 3)", "classif", 110},
	}
	st := calcularEstatisticas(ev)
	if st.lancesConcorrentes != 3 || st.nossosOK != 1 || st.nossosRecusados != 1 || len(st.reacoes) != 2 || st.semResposta != 1 {
		t.Fatalf("contas erradas: %+v", st)
	}
	if mediana(st.reacoes) != 300 || maximo(st.reacoes) != 300 || st.reacoes[0] != 120 {
		t.Fatalf("reações: %v", st.reacoes)
	}
	linhaTempo.mu.Lock()
	linhaTempo.porItem = map[string][]eventoRobo{rotulo: ev}
	linhaTempo.mu.Unlock()
	nosso, primeiro := 969.99, 960.0
	salvarRelatorioDisputa(rotulo, resultadoDisputa{Descricao: "Carregador", Posicao: 2, Total: 3, Nosso: &nosso, Primeiro: &primeiro, Robo: true})
	lista := listarRelatorios()
	if len(lista) != 1 || !strings.Contains(lista[0].Result, "2º lugar de 3") {
		t.Fatalf("lista: %+v", lista)
	}
	texto, err := lerRelatorio(lista[0].Nome)
	if err != nil || !strings.Contains(texto, "Reação do robô a lance de concorrente") || !strings.Contains(texto, "mediana 300 ms, pior 300 ms (2 respostas)") || !strings.Contains(texto, "Respondidos pelo robô: 2 de 3") {
		t.Fatalf("relatório: %v\n%s", err, texto)
	}
	if !strings.Contains(texto, "Sua posição pela classificação: começou em 3º de 3, terminou em 2º de 3") || !strings.Contains(texto, "Leituras da classificação registradas: 2") {
		t.Fatalf("relatório sem a posição/leituras:\n%s", texto)
	}
	if _, err := lerRelatorio("../montzion.log"); err == nil {
		t.Fatal("nome com caminho deveria ser recusado")
	}
	linhaTempo.mu.Lock()
	_, ficou := linhaTempo.porItem[rotulo]
	linhaTempo.mu.Unlock()
	if ficou {
		t.Fatal("depois de salvar, a linha do tempo do item recomeça do zero")
	}
}
