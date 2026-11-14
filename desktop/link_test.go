package main

import (
	"net"
	"testing"
	"time"
)

func TestCaminhoDoLink(t *testing.T) {
	casos := map[string]string{
		"montzion://abrir?caminho=%2Flicitacoes%2Fbuscar%3Fpncp%3D07615750000117-1-000118%252F2026": "/licitacoes/buscar?pncp=07615750000117-1-000118%2F2026",
		`"montzion://abrir?caminho=/licitacoes/12"`:                                                 "/licitacoes/12",
		"MONTZION://abrir?caminho=/":                                                                "/",
		"montzion://abrir?caminho=https://outro.site":                                               "",
		"montzion://abrir?caminho=//outro.site/x":                                                   "",
		"montzion://abrir?caminho=/x%22%20onload":                                                   "",
		"montzion://abrir":                                                                          "",
		"https://montzion.com.br/":                                                                  "",
	}
	for arg, quer := range casos {
		if got := caminhoDoLink([]string{"--qualquer", arg}); got != quer {
			t.Errorf("%q: veio %q, queria %q", arg, got, quer)
		}
	}
	if caminhoDoLink(nil) != "" {
		t.Error("sem argumentos deveria vir vazio")
	}
}

func TestPedidoAbrir(t *testing.T) {
	c := "/licitacoes/buscar?pncp=1"
	if lerPedidoAbrir(pedidoAbrir(c)) != c {
		t.Error("ida e volta do pedido")
	}
	for _, ruim := range []string{"fechar /x\n", "abrir https://x\n", "abrir //x\n", ""} {
		if lerPedidoAbrir(ruim) != "" {
			t.Errorf("aceitou %q", ruim)
		}
	}
}

func TestPedidoPelaTrava(t *testing.T) {
	trava, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skip("sem rede local:", err)
	}
	recebido := make(chan string, 2)
	go atenderPedidos(trava, func(c string) { recebido <- c })
	if !enviarPedido(trava.Addr().String(), "/licitacoes/buscar?pncp=07615750000117-1-000118%2F2026") {
		t.Fatal("não entregou o pedido")
	}
	select {
	case c := <-recebido:
		if c != "/licitacoes/buscar?pncp=07615750000117-1-000118%2F2026" {
			t.Fatalf("chegou %q", c)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("pedido não chegou")
	}
	// Pedido inválido não chega.
	c, _ := net.Dial("tcp", trava.Addr().String())
	_, _ = c.Write([]byte("abrir https://outro.site\n"))
	c.Close()
	select {
	case c := <-recebido:
		t.Fatalf("aceitou pedido inválido: %q", c)
	case <-time.After(500 * time.Millisecond):
	}
	trava.Close()
}
