package main

// Protocolo do DevTools (o mesmo que o navegador usa para depurar páginas): chamadas e eventos.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type mensagemCDP struct {
	ID        int64           `json:"id,omitempty"`
	Method    string          `json:"method,omitempty"`
	Params    json.RawMessage `json:"params,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Error     *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type clienteCDP struct {
	ws       *conexaoWS
	seq      int64
	mu       sync.Mutex
	pendente map[int64]chan mensagemCDP
	Eventos  chan mensagemCDP
	Fechado  chan struct{}
}

// Endereço do DevTools do navegador aberto com --remote-debugging-port.
func enderecoDevTools(porta int, espera time.Duration) (string, error) {
	limite := time.Now().Add(espera)
	cliente := &http.Client{Timeout: 2 * time.Second}
	for {
		r, err := cliente.Get(fmt.Sprintf("http://127.0.0.1:%d/json/version", porta))
		if err == nil {
			var v struct {
				WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
			}
			corpo, _ := io.ReadAll(r.Body)
			r.Body.Close()
			if json.Unmarshal(corpo, &v) == nil && v.WebSocketDebuggerURL != "" {
				return v.WebSocketDebuggerURL, nil
			}
		}
		if time.Now().After(limite) {
			return "", errors.New("o navegador não abriu a porta de controle")
		}
		time.Sleep(300 * time.Millisecond)
	}
}

// Porta que o navegador realmente abriu. Se já havia um processo do motor rodando (aberto há pouco),
// ele ignora a porta pedida e continua na antiga: o número fica no arquivo DevToolsActivePort.
func portaAtiva(arquivo string) int {
	dados, err := os.ReadFile(arquivo)
	if err != nil {
		return 0
	}
	linha, _, _ := strings.Cut(string(dados), "\n")
	n, _ := strconv.Atoi(strings.TrimSpace(linha))
	return n
}

// esperarDevTools tenta as portas candidatas (a do arquivo primeiro) até o navegador responder.
func esperarDevTools(arquivo string, pedida int, espera time.Duration) (string, int, error) {
	limite := time.Now().Add(espera)
	for {
		for _, porta := range []int{portaAtiva(arquivo), pedida} {
			if porta <= 0 {
				continue
			}
			if ws, err := enderecoDevTools(porta, 0); err == nil {
				return ws, porta, nil
			}
		}
		if time.Now().After(limite) {
			return "", 0, errors.New("o motor da janela não abriu a porta de controle")
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func conectarCDP(endereco string) (*clienteCDP, error) {
	ws, err := conectarWS(endereco)
	if err != nil {
		return nil, err
	}
	c := &clienteCDP{ws: ws, pendente: map[int64]chan mensagemCDP{}, Eventos: make(chan mensagemCDP, 4096), Fechado: make(chan struct{})}
	go c.ler()
	return c, nil
}

func (c *clienteCDP) ler() {
	defer close(c.Fechado)
	for {
		dados, err := c.ws.Receber()
		if err != nil {
			c.mu.Lock()
			for id, ch := range c.pendente {
				close(ch)
				delete(c.pendente, id)
			}
			c.mu.Unlock()
			return
		}
		var m mensagemCDP
		if json.Unmarshal(dados, &m) != nil {
			continue
		}
		if m.ID != 0 {
			c.mu.Lock()
			ch := c.pendente[m.ID]
			delete(c.pendente, m.ID)
			c.mu.Unlock()
			if ch != nil {
				ch <- m
			}
			continue
		}
		select {
		case c.Eventos <- m:
		default: // fila cheia: descarta evento antigo de rede
		}
	}
}

// Chamar envia um comando (sessao vazia = navegador) e espera a resposta.
func (c *clienteCDP) Chamar(sessao, metodo string, params any, espera time.Duration) (json.RawMessage, error) {
	id := atomic.AddInt64(&c.seq, 1)
	corpo := map[string]any{"id": id, "method": metodo}
	if params != nil {
		corpo["params"] = params
	}
	if sessao != "" {
		corpo["sessionId"] = sessao
	}
	dados, _ := json.Marshal(corpo)
	ch := make(chan mensagemCDP, 1)
	c.mu.Lock()
	c.pendente[id] = ch
	c.mu.Unlock()
	if err := c.ws.Enviar(dados); err != nil {
		c.mu.Lock()
		delete(c.pendente, id)
		c.mu.Unlock()
		return nil, err
	}
	select {
	case m, ok := <-ch:
		if !ok {
			return nil, errors.New("conexão com o navegador fechada")
		}
		if m.Error != nil {
			return nil, fmt.Errorf("%s: %s", metodo, m.Error.Message)
		}
		return m.Result, nil
	case <-time.After(espera):
		c.mu.Lock()
		delete(c.pendente, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("%s: sem resposta do navegador", metodo)
	}
}

func (c *clienteCDP) Fechar() { c.ws.Fechar() }
