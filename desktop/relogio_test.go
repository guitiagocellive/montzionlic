package main

import (
	"net/http"
	"testing"
	"time"
)

func TestRelogioDoCompras(t *testing.T) {
	relogio.mu.Lock()
	relogio.ok = false
	relogio.mu.Unlock()
	desvio := 3*time.Second + 400*time.Millisecond // o Compras está 3,4 s à frente do computador
	base := time.Now()
	for i := 0; i < 40; i++ {
		envio := base.Add(time.Duration(i*137) * time.Millisecond)
		gerou := envio.Add(40 * time.Millisecond).Add(desvio) // hora do Compras ao responder
		data := gerou.UTC().Format(http.TimeFormat)           // truncado no segundo, como o real
		amostraRelogio(data, envio, envio.Add(90*time.Millisecond))
	}
	d := desvioRelogio()
	margem, n := precisaoRelogio()
	if diff := d - desvio; diff < -250*time.Millisecond || diff > 250*time.Millisecond || n != 40 {
		t.Fatalf("mediu %v (±%v, %d respostas), real %v", d, margem, n, desvio)
	}
	// O cronômetro do robô usa o relógio corrigido: fim daqui a 20 s no relógio do Compras = ~16,6 s aqui.
	fim := time.Now().Add(desvio).Add(20 * time.Second)
	e := lerItem(map[string]any{"numero": 1.0, "fase": "LA", "dataHoraFimContagem": fim.Format(time.RFC3339Nano)})
	if e.RestanteSeg == nil || *e.RestanteSeg < 19.5 || *e.RestanteSeg > 20.5 {
		t.Fatalf("restante deveria ser ~20 s pelo relógio do Compras, veio %v", e.RestanteSeg)
	}
	relogio.mu.Lock()
	relogio.ok = false
	relogio.mu.Unlock()
}
