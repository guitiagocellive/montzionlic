package main

import (
	"math"
	"testing"
	"time"
)

func TestDistribuirReducao(t *testing.T) {
	itens := []linhaGrupo{
		{Numero: 1, Quantidade: 60, Nosso: 160.53, Minimo: 150, Passo: 0.01},
		{Numero: 2, Quantidade: 15, Nosso: 161.50, Minimo: 160, Passo: 0.01},
		{Numero: 3, Quantidade: 30, Nosso: 305.00, Minimo: 290, Passo: 0.01},
	}
	// Baixar R$ 100 no grupo: só o item com mais folga (item 1), 1,67 por unidade.
	l, b := distribuirReducao(itens, 100, false)
	if len(l) != 1 || l[0].Numero != 1 || l[0].Valor != 158.86 || math.Abs(b-100.2) > 1e-6 {
		t.Errorf("R$ 100: item 1 a 158,86 (baixou 100,20), veio %+v %.2f", l, b)
	}
	// Baixar R$ 1.000: item 1 vai ao mínimo (631,80) e o resto (368,20) sai do item 3: 12,28 por unidade.
	l, b = distribuirReducao(itens, 1000, false)
	if len(l) != 2 || l[0] != (lanceGrupo{1, 150}) || l[1] != (lanceGrupo{3, 292.72}) || b < 1000-1e-6 {
		t.Errorf("R$ 1.000: item 1 a 150 e item 3 a 292,72, veio %+v %.2f", l, b)
	}
	// Desconto do item (R$ 5 por unidade) vale mesmo quando precisa de menos.
	itens[0].Desconto = 5
	l, _ = distribuirReducao(itens, 10, false)
	if len(l) != 1 || l[0].Valor != 155.53 {
		t.Errorf("com desconto de R$ 5 no item 1: 155,53, veio %+v", l)
	}
	// Todos no mínimo: nenhum lance.
	if l, _ := distribuirReducao([]linhaGrupo{{Numero: 1, Quantidade: 2, Nosso: 10, Minimo: 10, Passo: 0.01}}, 5, false); len(l) != 0 {
		t.Errorf("no mínimo: sem lance, veio %+v", l)
	}
}

func TestSubitensDoGrupo(t *testing.T) {
	m := &motor{config: map[string]configItem{}, mensagens: map[string]mensagemItem{}}
	c := &compraMotor{chave: "20033806001152026", itens: map[int]*itemMotor{}}
	agora := time.Now()
	// Item comum continua item; subitem de grupo desconhecido não vira item solto.
	if k := m.mesclar(c, map[string]any{"numero": 5.0, "fase": "LA"}, agora); k != "20033806001152026:5" || c.itens[5] == nil {
		t.Fatalf("item comum: %q", k)
	}
	if k := m.mesclar(c, map[string]any{"numero": 1.0, "isSubItem": true}, agora); k != "" || c.itens[1] != nil {
		t.Errorf("subitem sem grupo conhecido não vira item solto: %q", k)
	}
	c.subGrupo = map[int]int{1: -1}
	if k := m.mesclar(c, map[string]any{"numero": 1.0, "melhorValorFornecedor": map[string]any{"valorInformado": 160.53}, "quantidade": 60.0}, agora); k != "20033806001152026:-1" {
		t.Errorf("aviso do subitem reavalia o grupo: %q", k)
	}
	if c.itens[1] != nil || c.subitens[-1][1] == nil {
		t.Error("subitem guardado no grupo, não como item")
	}
	p := subitensPainel(c, -1, "LA")
	if len(p) != 1 || p[0]["nossoUnitario"] != 160.53 || p[0]["quantidadeGrupo"] != 60.0 || p[0]["fase"] != "LA" {
		t.Errorf("painel do subitem: %+v", p)
	}
}
