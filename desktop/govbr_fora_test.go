package main

import (
	"strings"
	"testing"
)

func TestEsperaNovaTentativa(t *testing.T) {
	esperado := []int{5, 10, 20, 40, 60, 60, 60}
	for i, e := range esperado {
		if g := esperaNovaTentativa(i + 1); g != e {
			t.Fatalf("tentativa %d: espera %d, queria %d", i+1, g, e)
		}
	}
}

func TestPaginaGovForaDoAr(t *testing.T) {
	h := paginaGovForaDoAr(3, 7, diagnosticoGovBr{Erro: "não respondeu em 12 segundos"}, `https://sso.acesso.gov.br/login?x="1"`)
	for _, trecho := range []string{"demorou demais para responder", "não respondeu em 12 segundos", "Tentativa 3", ">20<", `var destino="https://sso.acesso.gov.br/login?x=\"1\""`} {
		if !strings.Contains(h, trecho) {
			t.Fatalf("faltou %q na página", trecho)
		}
	}
	// gov.br respondeu ao aplicativo: tenta logo (5 s), mesmo depois de várias tentativas
	h = paginaGovForaDoAr(6, 7, diagnosticoGovBr{Respondeu: true, Segundos: 2.34}, "https://x.gov.br")
	if !strings.Contains(h, ">5<") || !strings.Contains(h, "2,3 s") {
		t.Fatal("com o gov.br respondendo, deveria tentar em 5 s e mostrar o tempo")
	}
	if strings.Contains(h, "{{") {
		t.Fatal("sobrou marcador sem trocar")
	}
}
