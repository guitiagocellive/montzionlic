package main

// Freio automático: quando o Compras.gov.br responde 429 ("Too Many Requests — você mandou pedidos demais"), o
// aplicativo pausa o que não é urgente (leitura de fundo do Acompanhamento, classificação de itens longe do fim)
// por 20 s, 40 s, 80 s… até 2 min se o 429 se repetir. O lance e as leituras da reta final nunca param: é
// justamente para eles não serem recusados nos segundos finais que o resto espera.

import (
	"sync"
	"time"
)

var freio struct {
	mu    sync.Mutex
	ate   time.Time
	nivel int
}

func acionarFreio(onde string) {
	freio.mu.Lock()
	agora := time.Now()
	if agora.Sub(freio.ate) > 5*time.Minute {
		freio.nivel = 0 // passou um tempo sem 429: começa de novo do freio curto
	}
	freio.nivel++
	espera := 20 * time.Second << min(freio.nivel-1, 3)
	if espera > 2*time.Minute {
		espera = 2 * time.Minute
	}
	freio.ate = agora.Add(espera)
	n := freio.nivel
	freio.mu.Unlock()
	registrarLog("freio: o Compras.gov.br pediu para ir mais devagar (429 em %s); leituras não urgentes pausadas por %d s (vez %d)", mascararNumeros(onde), int(espera.Seconds()), n)
	marcarRobo("freio: 429 do Compras.gov.br em %s — leituras não urgentes pausadas por %d s (lance e reta final continuam)", mascararNumeros(onde), int(espera.Seconds()))
}

// freado: está no período de freio (pular o que não é urgente).
func freado() bool {
	freio.mu.Lock()
	defer freio.mu.Unlock()
	return time.Now().Before(freio.ate)
}

func freioRestante() time.Duration {
	freio.mu.Lock()
	defer freio.mu.Unlock()
	return time.Until(freio.ate)
}
