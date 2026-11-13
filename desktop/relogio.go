package main

// Relógio do Compras.gov.br: o robô calcula "faltam X segundos" pela hora de término que o Compras manda
// (dataHoraFimContagem) comparada com o relógio do computador. Se o relógio do Windows estiver alguns segundos
// errado, os "10 s finais" ficam deslocados — atrasado, o robô entra tarde. Aqui o aplicativo mede a diferença
// pelo cabeçalho Date de cada resposta e corrige o cronômetro sozinho.
//
// O Date tem resolução de 1 s, mas cada resposta limita a diferença a um intervalo; cruzando os intervalos de
// várias respostas a medida fica com erro de poucos décimos de segundo.

import (
	"net/http"
	"sync"
	"time"
)

var relogio struct {
	mu       sync.Mutex
	min, max time.Duration // a diferença (Compras − computador) está entre min e max
	ok       bool
	desde    time.Time
	amostras int
}

func amostraRelogio(data string, envio, recebido time.Time) {
	t, err := http.ParseTime(data)
	if err != nil {
		return
	}
	lo := t.Sub(recebido)                  // o Compras gerou a resposta antes de ela chegar aqui
	hi := t.Add(time.Second).Sub(envio)    // e depois de o pedido sair daqui (o Date é truncado no segundo)
	if lo > time.Hour || hi < -time.Hour { // relógio absurdo: não mexe
		return
	}
	relogio.mu.Lock()
	defer relogio.mu.Unlock()
	if !relogio.ok || time.Since(relogio.desde) > 10*time.Minute {
		relogio.min, relogio.max, relogio.ok, relogio.desde, relogio.amostras = lo, hi, true, time.Now(), 1
		return
	}
	nmin, nmax := max(relogio.min, lo), min(relogio.max, hi)
	if nmin > nmax { // o relógio do computador mudou (acertado pelo Windows): recomeça
		relogio.min, relogio.max, relogio.desde, relogio.amostras = lo, hi, time.Now(), 1
		return
	}
	relogio.min, relogio.max = nmin, nmax
	relogio.amostras++
}

// desvioRelogio: quanto o relógio do Compras.gov.br está à frente do computador (negativo = computador adiantado).
func desvioRelogio() time.Duration {
	relogio.mu.Lock()
	defer relogio.mu.Unlock()
	if !relogio.ok {
		return 0
	}
	return (relogio.min + relogio.max) / 2
}

// precisaoRelogio: margem da medida (±) e quantas respostas entraram nela.
func precisaoRelogio() (time.Duration, int) {
	relogio.mu.Lock()
	defer relogio.mu.Unlock()
	if !relogio.ok {
		return 0, 0
	}
	return (relogio.max - relogio.min) / 2, relogio.amostras
}
