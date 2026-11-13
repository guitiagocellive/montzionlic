package main

import (
	"testing"
	"time"
)

func TestFreio(t *testing.T) {
	freio.mu.Lock()
	freio.ate, freio.nivel = time.Time{}, 0
	freio.mu.Unlock()
	if freado() {
		t.Fatal("sem 429, sem freio")
	}
	acionarFreio("/x")
	if r := freioRestante(); !freado() || r < 19*time.Second || r > 21*time.Second {
		t.Fatalf("1º 429: 20 s de freio, veio %v", r)
	}
	acionarFreio("/x")
	if r := freioRestante(); r < 39*time.Second || r > 41*time.Second {
		t.Fatalf("2º 429 seguido: 40 s, veio %v", r)
	}
	for i := 0; i < 5; i++ {
		acionarFreio("/x")
	}
	if r := freioRestante(); r > 2*time.Minute+time.Second {
		t.Fatalf("no máximo 2 min, veio %v", r)
	}
	freio.mu.Lock()
	freio.ate, freio.nivel = time.Time{}, 0
	freio.mu.Unlock()
}
