package main

// Cliente WebSocket mínimo (RFC 6455), só o necessário para falar com o navegador (DevTools) em 127.0.0.1.

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"
)

type conexaoWS struct {
	conn    net.Conn
	leitor  *bufio.Reader
	escrita sync.Mutex
}

func conectarWS(endereco string) (*conexaoWS, error) {
	u, err := url.Parse(endereco)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "ws" {
		return nil, fmt.Errorf("endereço não suportado: %s", endereco)
	}
	host := u.Host
	if !strings.Contains(host, ":") {
		host += ":80"
	}
	conn, err := net.DialTimeout("tcp", host, 10*time.Second)
	if err != nil {
		return nil, err
	}
	chave := make([]byte, 16)
	_, _ = rand.Read(chave)
	pedido := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n",
		u.RequestURI(), u.Host, base64.StdEncoding.EncodeToString(chave))
	if _, err := conn.Write([]byte(pedido)); err != nil {
		conn.Close()
		return nil, err
	}
	leitor := bufio.NewReaderSize(conn, 1<<16)
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	linha, err := leitor.ReadString('\n')
	if err != nil {
		conn.Close()
		return nil, err
	}
	if !strings.Contains(linha, " 101 ") {
		conn.Close()
		return nil, fmt.Errorf("o navegador recusou a conexão: %s", strings.TrimSpace(linha))
	}
	for {
		l, err := leitor.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, err
		}
		if strings.TrimSpace(l) == "" {
			break
		}
	}
	_ = conn.SetReadDeadline(time.Time{})
	return &conexaoWS{conn: conn, leitor: leitor}, nil
}

func (c *conexaoWS) quadro(opcode byte, dados []byte) error {
	c.escrita.Lock()
	defer c.escrita.Unlock()
	cab := []byte{0x80 | opcode}
	n := len(dados)
	switch {
	case n < 126:
		cab = append(cab, 0x80|byte(n))
	case n <= 0xFFFF:
		cab = append(cab, 0x80|126, byte(n>>8), byte(n))
	default:
		var b [8]byte
		binary.BigEndian.PutUint64(b[:], uint64(n))
		cab = append(append(cab, 0x80|127), b[:]...)
	}
	mascara := make([]byte, 4)
	_, _ = rand.Read(mascara)
	cab = append(cab, mascara...)
	corpo := make([]byte, n)
	for i := 0; i < n; i++ {
		corpo[i] = dados[i] ^ mascara[i%4]
	}
	_, err := c.conn.Write(append(cab, corpo...))
	return err
}

func (c *conexaoWS) Enviar(texto []byte) error { return c.quadro(0x1, texto) }

// Receber devolve a próxima mensagem de texto (junta fragmentos, responde ping).
func (c *conexaoWS) Receber() ([]byte, error) {
	var mensagem []byte
	for {
		var cab [2]byte
		if _, err := io.ReadFull(c.leitor, cab[:]); err != nil {
			return nil, err
		}
		fim := cab[0]&0x80 != 0
		opcode := cab[0] & 0x0F
		mascarado := cab[1]&0x80 != 0
		tamanho := uint64(cab[1] & 0x7F)
		switch tamanho {
		case 126:
			var b [2]byte
			if _, err := io.ReadFull(c.leitor, b[:]); err != nil {
				return nil, err
			}
			tamanho = uint64(binary.BigEndian.Uint16(b[:]))
		case 127:
			var b [8]byte
			if _, err := io.ReadFull(c.leitor, b[:]); err != nil {
				return nil, err
			}
			tamanho = binary.BigEndian.Uint64(b[:])
		}
		if tamanho > 256<<20 {
			return nil, errors.New("mensagem grande demais")
		}
		var mascara [4]byte
		if mascarado {
			if _, err := io.ReadFull(c.leitor, mascara[:]); err != nil {
				return nil, err
			}
		}
		dados := make([]byte, tamanho)
		if _, err := io.ReadFull(c.leitor, dados); err != nil {
			return nil, err
		}
		if mascarado {
			for i := range dados {
				dados[i] ^= mascara[i%4]
			}
		}
		switch opcode {
		case 0x8: // fechar
			return nil, io.EOF
		case 0x9: // ping
			_ = c.quadro(0xA, dados)
			continue
		case 0xA: // pong
			continue
		}
		mensagem = append(mensagem, dados...)
		if fim {
			return mensagem, nil
		}
	}
}

func (c *conexaoWS) Fechar() { _ = c.conn.Close() }
