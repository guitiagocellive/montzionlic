package main

import (
	"io"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Links "montzion://abrir?caminho=/licitacoes/buscar?pncp=…": a página da plataforma, aberta no navegador, entrega
// a licitação ao aplicativo por esse endereço (o Windows abre o Montzion com ele). Só caminhos dentro da própria
// plataforma são aceitos: o aplicativo nunca navega para outro site por um link.

// ProtocoloLink é o esquema registrado no Windows para o Montzion.
const protocoloLink = "montzion"

var caminhoSeguro = regexp.MustCompile(`^/[A-Za-z0-9/_\-?=&%.~+:,]*$`)

// caminhoValido devolve o caminho se for uma página da plataforma (começa com "/", sem "//" nem esquema).
func caminhoValido(c string) string {
	c = strings.TrimSpace(c)
	if len(c) == 0 || len(c) > 600 || strings.HasPrefix(c, "//") || strings.Contains(c, "\\") || !caminhoSeguro.MatchString(c) {
		return ""
	}
	return c
}

// caminhoDoLink procura nos argumentos um link montzion:// e devolve o caminho da plataforma que ele pede ("" se
// não houver ou não for válido).
func caminhoDoLink(args []string) string {
	for _, a := range args {
		a = strings.Trim(strings.TrimSpace(a), `"`)
		if !strings.HasPrefix(strings.ToLower(a), protocoloLink+":") {
			continue
		}
		u, err := url.Parse(a)
		if err != nil {
			return ""
		}
		return caminhoValido(u.Query().Get("caminho"))
	}
	return ""
}

// pedidoAbrir é a linha que uma segunda abertura do Montzion manda para a janela já aberta.
func pedidoAbrir(caminho string) string { return "abrir " + caminho + "\n" }

// lerPedidoAbrir confere a linha recebida e devolve o caminho ("" se não for um pedido válido).
func lerPedidoAbrir(linha string) string {
	linha = strings.TrimRight(linha, "\r\n")
	if !strings.HasPrefix(linha, "abrir ") {
		return ""
	}
	return caminhoValido(strings.TrimPrefix(linha, "abrir "))
}

// enviarPedido manda para o Montzion já aberto abrir uma página (link montzion://). Devolve true se ele recebeu.
func enviarPedido(endereco, caminho string) bool {
	c, err := net.DialTimeout("tcp", endereco, 2*time.Second)
	if err != nil {
		return false
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(2 * time.Second))
	_, err = io.WriteString(c, pedidoAbrir(caminho))
	return err == nil
}

// atenderPedidos: o Montzion aberto escuta, pela mesma trava que impede abrir dois, os pedidos de uma segunda
// abertura (link montzion:// clicado no navegador) e leva a janela até a página pedida.
func atenderPedidos(trava net.Listener, aoPedir func(caminho string)) {
	for {
		c, err := trava.Accept()
		if err != nil {
			return // a trava fechou: o Montzion está saindo
		}
		go func(c net.Conn) {
			defer c.Close()
			_ = c.SetDeadline(time.Now().Add(2 * time.Second))
			buf := make([]byte, 1024)
			n, _ := io.ReadAtLeast(c, buf, 1)
			if caminho := lerPedidoAbrir(string(buf[:n])); caminho != "" {
				registrarLog("link montzion:// recebido: %s", caminho)
				aoPedir(caminho)
			}
		}(c)
	}
}
