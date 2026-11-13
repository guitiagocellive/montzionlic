package main

// Teste de leitura do Compras.gov.br, feito com a sessão da própria pessoa e a pedido dela: mede quanto tempo
// a lista de participações leva com páginas de 10, 25, 50 e 100, se o Compras aceita páginas maiores, e quanto
// leva para abrir uma licitação. Poucos pedidos (um por tamanho, com pausa entre eles), só das participações dela.
// O maior tamanho que o Compras aceitar (até 50) passa a ser usado na leitura do Acompanhamento.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

var tamanhoPagina atomic.Int32

func arquivoTamanhoPagina() string {
	// v2: o Compras.gov.br devolve no máximo 20 por página (pedindo 25, 50 ou 100 vêm 20); quem guardou 10 testa de novo.
	return filepath.Join(pastaInstalacao(), "pagina-acompanhamento-v2.txt")
}

// tamanhoPaginaAcomp: quantas participações pedir por página (10, como o site, até o teste mostrar que dá mais).
func tamanhoPaginaAcomp() int {
	if t := tamanhoPagina.Load(); t > 0 {
		return int(t)
	}
	t := 10
	if b, err := os.ReadFile(arquivoTamanhoPagina()); err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil && n >= 10 && n <= 50 {
			t = n
		}
	}
	tamanhoPagina.Store(int32(t))
	return t
}

func guardarTamanhoPagina(t int) {
	tamanhoPagina.Store(int32(t))
	_ = os.WriteFile(arquivoTamanhoPagina(), []byte(strconv.Itoa(t)), 0o644)
}

// paginasPara: quantas páginas de tam cobrem n participações.
func paginasPara(n, tam int) int {
	if tam <= 0 {
		tam = 10
	}
	return max(1, (n+tam-1)/tam)
}

type medidaLeitura struct {
	Teste   string `json:"teste"`
	Tamanho int    `json:"tamanho,omitempty"`
	Status  int    `json:"status"`
	Ms      int64  `json:"ms"`
	Veio    int    `json:"veio"`
	Total   int    `json:"total"`
	Paginas int    `json:"paginas"`
	Kb      int    `json:"kb"`
	Aceitou bool   `json:"aceitou"`
	Limite  int    `json:"limite,omitempty"` // o Compras cortou a página neste tamanho
	Erro    string `json:"erro,omitempty"`
}

var testandoLeitura atomic.Bool

func (m *motor) TestarLeitura() any {
	m.mu.Lock()
	logado := m.token != ""
	m.mu.Unlock()
	if !logado {
		return mapa{"erro": "Entre no Compras.gov.br primeiro (botão Entrar com gov.br) e rode o teste de novo."}
	}
	if !testandoLeitura.CompareAndSwap(false, true) {
		return mapa{"erro": "O teste já está rodando."}
	}
	defer testandoLeitura.Store(false)
	marcarUso() // pausa a leitura de fundo para não atrapalhar a medida

	var medidas []medidaLeitura
	var primeira, reserva string // uma em andamento (de preferência) ou, se não vier, uma finalizada
	lista := func(teste, filtro string, tam int) medidaLeitura {
		md := medidaLeitura{Teste: teste, Tamanho: tam}
		inicio := time.Now()
		r, err := m.consultarDiretoOpc("GET", fe+"/v1/compras/participacoes", fmt.Sprintf("filtro=%s&pagina=0&tamanhoPagina=%d", filtro, tam), true, nil, "", true)
		md.Ms = time.Since(inicio).Milliseconds()
		if err != nil {
			md.Erro = mascararNumeros(err.Error())
			return md
		}
		md.Status, md.Kb = r.Status, (len(r.Corpo)+1023)/1024
		if !okHTTP(r.Status) {
			md.Erro = mascararNumeros(mensagemErro(r.Corpo))
			return md
		}
		l := listaQualquer(r.Corpo)
		md.Veio = len(l)
		fmt.Sscan(r.Cab.Get("register-count"), &md.Total)
		fmt.Sscan(r.Cab.Get("pages-count"), &md.Paginas)
		if md.Total == 0 && md.Paginas <= 1 {
			md.Total = md.Veio
		}
		md.Aceitou = md.Veio == min(tam, md.Total) && md.Veio > 0
		// Veio menos que o pedido e menos que o total: é o limite do Compras por página (ex.: 20).
		if md.Veio > 10 && md.Veio < min(tam, md.Total) {
			md.Limite = md.Veio
		}
		if len(l) > 0 {
			var x map[string]any
			if json.Unmarshal(l[0], &x) == nil {
				if filtro == "2" && primeira == "" {
					primeira = chaveDaParticipacao(x)
				} else if reserva == "" {
					reserva = chaveDaParticipacao(x)
				}
			}
		}
		return md
	}
	for i, tam := range []int{10, 20, 50, 100} {
		if i > 0 {
			time.Sleep(time.Second)
		}
		medidas = append(medidas, lista("Finalizadas", "6", tam))
	}
	time.Sleep(time.Second)
	medidas = append(medidas, lista("Em andamento", "2", 50))

	// Abrir uma licitação (participação, itens e mensagens), como quando a pessoa clica nela.
	if primeira == "" {
		primeira = reserva
	}
	if primeira != "" {
		time.Sleep(time.Second)
		inicio := time.Now()
		d := m.detalharDireto(compraAcomp{Chave: primeira})
		md := medidaLeitura{Teste: "Abrir uma licitação", Ms: time.Since(inicio).Milliseconds(), Status: 200, Veio: len(listaQualquer(d.Itens))}
		if len(d.Erros) > 0 {
			md.Erro = mascararNumeros(strings.Join(d.Erros, " | "))
		}
		medidas = append(medidas, md)
	}

	// Conclusão: maior tamanho aceito (até 50) ou o limite que o Compras impõe por página, e estimativa para ler
	// todas as finalizadas.
	base, melhor := medidas[0], medidas[0]
	for _, md := range medidas[:4] {
		if md.Erro != "" {
			continue
		}
		efetivo := 0
		if md.Aceitou && md.Tamanho <= 50 {
			efetivo = md.Tamanho
		} else if md.Limite > 0 && md.Limite <= 50 {
			efetivo = md.Limite
		}
		if efetivo > melhor.Tamanho {
			melhor = md
			melhor.Tamanho = efetivo
		}
	}
	total := base.Total
	estimativa := func(md medidaLeitura) (int, int64) {
		p := paginasPara(total, md.Tamanho)
		return p, int64(p) * md.Ms
	}
	pb, tb := estimativa(base)
	pm, tm := estimativa(melhor)
	usar := 10
	if base.Erro == "" && melhor.Tamanho > 10 {
		usar = melhor.Tamanho
	}
	guardarTamanhoPagina(usar)
	registrarLog("teste de leitura: %s; usando %d por página", resumoMedidas(medidas), usar)
	return mapa{
		"medidas":     medidas,
		"total":       total,
		"usar":        usar,
		"antes":       mapa{"pedidos": pb, "ms": tb},
		"depois":      mapa{"pedidos": pm, "ms": tm},
		"diagnostico": "Teste de leitura (Montzion " + versao + "): " + resumoMedidas(medidas) + fmt.Sprintf("; usando %d por página", usar),
	}
}

func resumoMedidas(ms []medidaLeitura) string {
	partes := make([]string, 0, len(ms))
	for _, md := range ms {
		t := fmt.Sprintf("%s", md.Teste)
		if md.Tamanho > 0 {
			t += fmt.Sprintf(" %d", md.Tamanho)
		}
		t += fmt.Sprintf(": %d, %d ms, veio %d de %d, %d KB", md.Status, md.Ms, md.Veio, md.Total, md.Kb)
		if md.Erro != "" {
			t += " (" + md.Erro + ")"
		}
		partes = append(partes, t)
	}
	return strings.Join(partes, " | ")
}

// tamanhoPaginaTestado: já se sabe se o Compras aceita páginas maiores (o arquivo do tamanho existe).
func tamanhoPaginaTestado() bool {
	_, err := os.Stat(arquivoTamanhoPagina())
	return err == nil
}

// testarTamanhoPagina: uma vez só, pede a lista "em andamento" com 50 por página. Se o Compras devolver as 50 (ou
// todas, quando há menos de 50 e mais de 10), passa a ler de 50 em 50; se cortar a página (hoje em 20), lê nesse
// tamanho — menos páginas, menos captchas.
func (m *motor) testarTamanhoPagina() int {
	r, err := m.consultarDiretoOpc("GET", fe+"/v1/compras/participacoes", "filtro=2&pagina=0&tamanhoPagina=50", true, nil, "", true)
	if err != nil || !okHTTP(r.Status) {
		return 10 // não deu para testar agora: tenta na próxima leitura
	}
	total := 0
	fmt.Sscan(r.Cab.Get("register-count"), &total)
	veio := len(listaQualquer(r.Corpo))
	if veio == 0 && r.Cab.Get("register-count") == "" {
		guardarTamanhoPagina(10) // recusou a página de 50 (veio vazia, sem totais): fica de 10 em 10
		registrarLog("acompanhamento: o Compras não aceitou 50 por página; lendo de 10 em 10")
		return 10
	}
	if total <= 10 {
		return 10 // com até 10 não dá para saber: testa de novo quando houver mais
	}
	usar := 10
	switch {
	case veio == min(50, total):
		usar = 50
	case veio > 10 && veio < 50:
		usar = veio // o Compras corta a página (hoje em 20): pede exatamente esse tamanho
	}
	guardarTamanhoPagina(usar)
	registrarLog("acompanhamento: o Compras devolveu %d de %d com 50 por página; lendo de %d em %d", veio, total, usar, usar)
	return usar
}
