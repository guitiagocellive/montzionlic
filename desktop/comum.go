package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"
)

const (
	nomeApp = "Montzion"
	versao  = "3.1.23"
)

func pastaInstalacao() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, nomeApp)
}

// Registro do que aconteceu (para descobrir erros em computadores de clientes):
// %LOCALAPPDATA%\Montzion\montzion.log
func registrarLog(formato string, args ...any) {
	pasta := pastaInstalacao()
	_ = os.MkdirAll(pasta, 0o755)
	f, err := os.OpenFile(filepath.Join(pasta, "montzion.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s v%s  %s\r\n", time.Now().Format("2006-01-02 15:04:05"), versao, fmt.Sprintf(formato, args...))
}

// Janela do gov.br/Compras: pedidos de recarregar vindos da ponte (lidos por abrirCompras no Windows).
var (
	recarregarComprasForcado   atomic.Bool // "Recarregar a janela do gov.br" (botão da plataforma)
	recarregarComprasSeFechada atomic.Bool // "Entrar com gov.br" sem login: se a janela estava fechada/parada, recarrega
)

func marcarRecarregarCompras(forcar bool) {
	if forcar {
		recarregarComprasForcado.Store(true)
	} else {
		recarregarComprasSeFechada.Store(true)
	}
}
