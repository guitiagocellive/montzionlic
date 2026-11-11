package main

import (
	"encoding/json"
	"os"
	"testing"
)

// A página "Aplicativo" avisa sobre versão nova lendo public/downloads/versao.json:
// ele precisa ter a mesma versão do instalador publicado.
func TestVersaoPublicadaIgualAoPrograma(t *testing.T) {
	dados, err := os.ReadFile("../public/downloads/versao.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Versao string `json:"versao"`
	}
	if err := json.Unmarshal(dados, &v); err != nil {
		t.Fatal(err)
	}
	if v.Versao != versao {
		t.Fatalf("public/downloads/versao.json diz %q, mas o programa é %q: atualize os dois ao gerar o instalador", v.Versao, versao)
	}
}
