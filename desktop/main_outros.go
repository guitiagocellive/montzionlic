//go:build !windows

package main

import (
	"fmt"
	"os"
	"strconv"
)

// Fora do Windows o aplicativo não instala nada. Para testar a ponte do robô com um Chromium já aberto
// com --remote-debugging-port: MONTZION_PONTE_PORTA=9222 MONTZION_ENDERECO=... MONTZION_COMPRAS=... ./montzion
func main() {
	porta, _ := strconv.Atoi(os.Getenv("MONTZION_PONTE_PORTA"))
	if porta == 0 {
		fmt.Println("O aplicativo Montzion é para Windows. Use https://montzion.com.br no navegador.")
		return
	}
	cfg := configPonte{Plataforma: valorOu("MONTZION_ENDERECO", "https://montzion.com.br"), Compras: valorOu("MONTZION_COMPRAS", "https://cnetmobile.estaleiro.serpro.gov.br"), Login: os.Getenv("MONTZION_LOGIN"), Portal: os.Getenv("MONTZION_PORTAL")}
	ws, err := enderecoDevTools(porta, 15e9)
	if err != nil {
		fmt.Println("erro:", err)
		os.Exit(1)
	}
	cdp, err := conectarCDP(ws)
	if err != nil {
		fmt.Println("erro:", err)
		os.Exit(1)
	}
	fmt.Println("ponte ligada")
	if err := novaPonte(cfg, cdp).Rodar(); err != nil {
		fmt.Println("erro:", err)
		os.Exit(1)
	}
}

func valorOu(nome, padrao string) string {
	if v := os.Getenv(nome); v != "" {
		return v
	}
	return padrao
}
