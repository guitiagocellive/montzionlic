package main

// Cliente STOMP 1.2 mínimo sobre WebSocket: é por ele que a sala de disputa do Compras.gov.br avisa, na hora,
// cada lance novo (tópicos /topic/compra/{chave} e /topic/disputa/fornec/{chave}/{cnpj}).

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

type quadroStomp struct {
	Comando    string
	Cabecalhos map[string]string
	Corpo      string
}

type clienteStomp struct {
	ws        *conexaoWS
	mu        sync.Mutex
	seq       int
	Mensagens chan quadroStomp
	Fechado   chan struct{}
	erro      error
}

func escaparStomp(s string) string {
	return strings.NewReplacer(`\`, `\\`, "\r", `\r`, "\n", `\n`, ":", `\c`).Replace(s)
}

func desescaparStomp(s string) string {
	return strings.NewReplacer(`\\`, `\`, `\r`, "\r", `\n`, "\n", `\c`, ":").Replace(s)
}

func montarQuadro(comando string, cab map[string]string, corpo string) []byte {
	var b strings.Builder
	b.WriteString(comando + "\n")
	for k, v := range cab {
		b.WriteString(escaparStomp(k) + ":" + escaparStomp(v) + "\n")
	}
	b.WriteString("\n" + corpo + "\x00")
	return []byte(b.String())
}

func lerQuadro(dados string) (quadroStomp, bool) {
	dados = strings.TrimLeft(dados, "\r\n") // batidas de coração (linhas vazias)
	if dados == "" {
		return quadroStomp{}, false
	}
	cabecalho, corpo, _ := strings.Cut(dados, "\n\n")
	corpo = strings.TrimRight(corpo, "\x00\r\n")
	linhas := strings.Split(strings.ReplaceAll(cabecalho, "\r\n", "\n"), "\n")
	q := quadroStomp{Comando: strings.TrimSpace(linhas[0]), Cabecalhos: map[string]string{}, Corpo: corpo}
	for _, l := range linhas[1:] {
		if k, v, ok := strings.Cut(l, ":"); ok {
			k = desescaparStomp(k)
			if _, existe := q.Cabecalhos[k]; !existe { // STOMP: vale o primeiro
				q.Cabecalhos[k] = desescaparStomp(v)
			}
		}
	}
	return q, true
}

// conectarStomp abre o WebSocket e faz o CONNECT com o token da sessão.
func conectarStomp(endereco string, cabecalhosWS map[string]string, token string) (*clienteStomp, error) {
	ws, err := conectarWSCom(endereco, cabecalhosWS)
	if err != nil {
		return nil, err
	}
	c := &clienteStomp{ws: ws, Mensagens: make(chan quadroStomp, 1024), Fechado: make(chan struct{})}
	host := strings.TrimPrefix(strings.TrimPrefix(endereco, "wss://"), "ws://")
	host, _, _ = strings.Cut(host, "/")
	if err := ws.Enviar(montarQuadro("CONNECT", map[string]string{
		"accept-version": "1.2,1.1,1.0",
		"heart-beat":     "20000,0",
		"host":           host,
		"Authorization":  token,
	}, "")); err != nil {
		ws.Fechar()
		return nil, err
	}
	// Espera o CONNECTED (ou ERROR).
	resposta := make(chan error, 1)
	go func() {
		for {
			dados, err := ws.Receber()
			if err != nil {
				resposta <- err
				return
			}
			q, ok := lerQuadro(string(dados))
			if !ok {
				continue
			}
			switch q.Comando {
			case "CONNECTED":
				resposta <- nil
			case "ERROR":
				resposta <- fmt.Errorf("tempo real recusado: %s", q.Cabecalhos["message"])
			}
			return
		}
	}()
	select {
	case err := <-resposta:
		if err != nil {
			ws.Fechar()
			return nil, err
		}
	case <-time.After(10 * time.Second):
		ws.Fechar()
		return nil, errors.New("tempo real não respondeu")
	}
	go c.ler()
	go c.bater()
	return c, nil
}

func (c *clienteStomp) ler() {
	defer close(c.Fechado)
	for {
		dados, err := c.ws.Receber()
		if err != nil {
			c.mu.Lock()
			c.erro = err
			c.mu.Unlock()
			return
		}
		// Um quadro WebSocket pode trazer mais de um quadro STOMP.
		for _, parte := range strings.Split(string(dados), "\x00") {
			q, ok := lerQuadro(parte)
			if !ok {
				continue
			}
			if q.Comando == "ERROR" {
				registrarLog("tempo real: erro do servidor: %s %s", q.Cabecalhos["message"], q.Corpo)
				continue
			}
			select {
			case c.Mensagens <- q:
			default: // fila cheia: descarta (o próximo aviso traz o estado atualizado)
			}
		}
	}
}

// Batida de coração a cada 20 s (o servidor fecha conexões caladas).
func (c *clienteStomp) bater() {
	t := time.NewTicker(20 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-c.Fechado:
			return
		case <-t.C:
			_ = c.ws.Enviar([]byte("\n"))
		}
	}
}

// Inscrever num tópico; devolve o id da inscrição.
func (c *clienteStomp) Inscrever(destino string) (string, error) {
	c.mu.Lock()
	c.seq++
	id := fmt.Sprintf("sub-%d", c.seq)
	c.mu.Unlock()
	return id, c.ws.Enviar(montarQuadro("SUBSCRIBE", map[string]string{"id": id, "destination": destino, "ack": "auto"}, ""))
}

func (c *clienteStomp) Cancelar(id string) {
	_ = c.ws.Enviar(montarQuadro("UNSUBSCRIBE", map[string]string{"id": id}, ""))
}

func (c *clienteStomp) Fechar() {
	_ = c.ws.Enviar(montarQuadro("DISCONNECT", map[string]string{}, ""))
	c.ws.Fechar()
}
