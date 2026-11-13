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

func TestPaginaGovForaComProxy(t *testing.T) {
	d := diagnosticoGovBr{Respondeu: true, Segundos: 0.4, Proxy: "servidor proxy 10.0.0.1:8080"}
	if p := paginaGovForaDoAr(2, 7, d, "https://x"); strings.Contains(p, "proxy") {
		t.Error("na 2ª tentativa ainda não fala do proxy")
	}
	p := paginaGovForaDoAr(3, 7, d, "https://x")
	if !strings.Contains(p, "<b>proxy</b>") || !strings.Contains(p, "10.0.0.1:8080") {
		t.Error("a partir da 3ª tentativa, com o aplicativo chegando ao gov.br, mostra o proxy do Windows")
	}
	d.Proxy = ""
	if p := paginaGovForaDoAr(3, 7, d, "https://x"); !strings.Contains(p, "Edge ou no Chrome") {
		t.Error("sem proxy: sugere testar no Edge/Chrome e mandar o diagnóstico")
	}
}
