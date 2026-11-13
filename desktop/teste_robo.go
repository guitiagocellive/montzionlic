package main

// Teste do robô (botão na página Disputas), feito com a sessão da própria pessoa: mede a velocidade de cada parte
// do caminho do lance, procura erros de configuração e sugere ajustes. NÃO envia lance nenhum. São poucos pedidos
// ao Compras.gov.br (3 leituras leves, 1 captcha e, se houver item em disputa, 1 leitura da classificação) e o teste
// não roda com item na reta final nem com o freio do 429 ligado — para não tirar captcha de quem está disputando.

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

type itemTesteRobo struct {
	Grupo  string `json:"grupo"`
	Nome   string `json:"nome"`
	Estado string `json:"estado"` // ok | atencao | erro | info
	Valor  string `json:"valor"`
	Dica   string `json:"dica,omitempty"`
}

var testandoRobo atomic.Bool

func msOuTraco(v int64) string {
	if v < 0 {
		return "—"
	}
	return fmt.Sprintf("%d ms", v)
}

func decimal(v float64) string { return strings.Replace(fmt.Sprintf("%.1f", v), ".", ",", 1) }

func mediana(v []int64) int64 {
	if len(v) == 0 {
		return -1
	}
	c := append([]int64(nil), v...)
	sort.Slice(c, func(i, j int) bool { return c[i] < c[j] })
	return c[len(c)/2]
}

func (m *motor) TestarRobo() any {
	m.mu.Lock()
	logado := m.token != ""
	final := m.algumaRetaFinal(time.Now())
	m.mu.Unlock()
	if !logado {
		return mapa{"erro": "Entre no Compras.gov.br primeiro (botão Entrar com gov.br) e rode o teste de novo."}
	}
	if final {
		return mapa{"erro": "Há item com o robô na reta final agora: o teste fica para depois, para não tirar captcha nem conexão da disputa."}
	}
	if !testandoRobo.CompareAndSwap(false, true) {
		return mapa{"erro": "O teste já está rodando."}
	}
	defer testandoRobo.Store(false)

	var itens []itemTesteRobo
	add := func(grupo, nome, estado, valor, dica string) {
		itens = append(itens, itemTesteRobo{grupo, nome, estado, valor, dica})
	}

	// ---- Sessão e conexão ----
	m.mu.Lock()
	expira, tempoReal, fase, diretoAte := m.expira, m.tempoReal, m.fase, m.diretoAte
	compraTeste := ""
	for _, chave := range m.ordem {
		if c := m.compras[chave]; c != nil && m.compraEmDisputa(c) {
			compraTeste = chave
			break
		}
	}
	if compraTeste == "" && len(m.ordem) > 0 {
		compraTeste = m.ordem[0]
	}
	m.mu.Unlock()
	if !expira.IsZero() {
		min := time.Until(expira).Minutes()
		est, dica := "ok", ""
		if min < 3 {
			est, dica = "atencao", "A sessão está perto de expirar; o aplicativo renova sozinho. Se cair, clique em Entrar com gov.br."
		}
		add("Sessão", "Sessão do Compras.gov.br", est, fmt.Sprintf("renova em %.0f min", min), dica)
	}
	if tempoReal {
		add("Sessão", "Tempo real (avisos de lance)", "ok", "ligado", "")
	} else {
		add("Sessão", "Tempo real (avisos de lance)", "erro", "desligado",
			"Sem o tempo real o robô fica sabendo dos lances por consultas (até 0,5 s de atraso). Costuma voltar sozinho em segundos; se continuar, clique em Entrar com gov.br.")
	}
	if time.Now().Before(diretoAte) {
		add("Sessão", "Caminho dos pedidos", "atencao", "pela janela do Compras.gov.br",
			"O pedido direto foi recusado há pouco e o aplicativo está usando a janela oficial (mais lenta) por alguns minutos.")
	} else {
		add("Sessão", "Caminho dos pedidos", "ok", "direto (o mais rápido)", "")
	}
	_ = fase

	// ---- Velocidade da conexão com o Compras.gov.br ----
	m.mu.Lock()
	token := m.token
	m.mu.Unlock()
	caminho := "/comprasnet-fase-externa/v1/enums"
	if compraTeste != "" {
		caminho = "/comprasnet-disputa/v1/compras/" + url.PathEscape(compraTeste) + "/itens/em-disputa"
	}
	base := strings.TrimRight(m.p.cfg.Compras, "/")
	// 1) Conexão nova (como depois de ficar parado): DNS, TCP, TLS e resposta.
	{
		var tcp, tlsMs int64 = -1, -1
		inicio := time.Now()
		trace := &httptrace.ClientTrace{
			ConnectDone: func(_, _ string, err error) {
				if err == nil {
					tcp = time.Since(inicio).Milliseconds()
				}
			},
			TLSHandshakeDone: func(_ tls.ConnectionState, err error) {
				if err == nil {
					tlsMs = time.Since(inicio).Milliseconds()
				}
			},
		}
		cli := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, DisableKeepAlives: true}}
		req, _ := http.NewRequest("GET", base+caminho, nil)
		m.cabecalhos(req, token)
		req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))
		envio := time.Now()
		r, err := cli.Do(req)
		total := time.Since(inicio).Milliseconds()
		if err != nil {
			add("Conexão", "Conexão nova com o Compras.gov.br", "erro", mascararNumeros(err.Error()), "Verifique a internet. O robô depende dessa conexão para enviar o lance.")
		} else {
			amostraRelogio(r.Header.Get("Date"), envio, time.Now())
			r.Body.Close()
			est := "ok"
			if total > 1500 {
				est = "atencao"
			}
			add("Conexão", "Conexão nova com o Compras.gov.br", est, fmt.Sprintf("%d ms (TCP %s, TLS %s)", total, msOuTraco(tcp), msOuTraco(tlsMs)),
				"Só acontece quando a conexão fica parada; perto do fim de uma disputa o aplicativo mantém a conexão aberta.")
		}
	}
	// 2) Pela conexão já aberta (o caminho do lance): 3 pedidos, mediana.
	var tempos []int64
	for i := 0; i < 3; i++ {
		if i > 0 {
			time.Sleep(300 * time.Millisecond)
		}
		inicio := time.Now()
		st, _, err := m.pedir("GET", caminho, nil)
		if err == nil && st > 0 && st < 500 {
			tempos = append(tempos, time.Since(inicio).Milliseconds())
		}
	}
	if md := mediana(tempos); md < 0 {
		add("Conexão", "Resposta do Compras.gov.br (caminho do lance)", "erro", "sem resposta", "O Compras.gov.br não respondeu agora. Tente de novo em instantes.")
	} else {
		est, dica := "ok", "É o tempo que um lance leva para ser aceito. Vale igual para todas as empresas."
		if md > 400 {
			est, dica = "atencao", "O Compras.gov.br (ou a internet) está lento agora: cada lance demora isso para ser aceito. O robô continua decidindo na hora."
		}
		add("Conexão", "Resposta do Compras.gov.br (caminho do lance)", est, fmt.Sprintf("%d ms (mediana de %d)", md, len(tempos)), dica)
	}

	// ---- Relógio ----
	if margem, n := precisaoRelogio(); n > 0 {
		d := desvioRelogio()
		lado := "adiantado"
		if d > 0 {
			lado = "atrasado"
		}
		est, dica := "ok", "O robô usa o relógio do Compras.gov.br para os 10 s finais (corrigido sozinho)."
		abs := d
		if abs < 0 {
			abs = -abs
		}
		if abs > 2*time.Second {
			est, dica = "atencao", "O robô já corrige sozinho, mas vale acertar o relógio do Windows (Configurações › Hora e idioma › Sincronizar agora): a tela e os avisos sonoros também usam ele."
		}
		valor := fmt.Sprintf("%s s %s (±%s s, %d respostas)", decimal(abs.Seconds()), lado, decimal(margem.Seconds()), n)
		if abs < 300*time.Millisecond {
			valor = fmt.Sprintf("certo (diferença menor que 0,3 s; ±%s s, %d respostas)", decimal(margem.Seconds()), n)
		}
		add("Relógio", "Relógio do computador × Compras.gov.br", est, valor, dica)
	}

	// ---- Captcha ----
	if freado() {
		add("Captcha", "Captcha", "info", "não testado", fmt.Sprintf("O freio do 429 está ligado (%.0f s): o teste não gasta captcha agora.", freioRestante().Seconds()))
	} else {
		inicio := time.Now()
		codigo, err := m.gerarCaptcha()
		ms := time.Since(inicio).Milliseconds()
		if err != nil || codigo == "" {
			add("Captcha", "Captcha (para a classificação)", "erro", "falhou", "Sem captcha o robô não lê a classificação (melhor colocação). Clique em Recarregar janela do gov.br e rode o teste de novo.")
		} else {
			captchaPoolMu.Lock()
			captchaPool = append(captchaPool, captchaGuardado{codigo, time.Now()}) // não desperdiça: fica pronto para o robô
			captchaPoolMu.Unlock()
			est, dica := "ok", "Perto do fim das disputas o robô deixa captchas prontos: na hora ele não espera isso."
			if ms > 3000 {
				est, dica = "atencao", "O captcha está lento. Perto do fim o robô deixa captchas prontos, mas se ficar sempre assim recarregue a janela do gov.br."
			}
			add("Captcha", "Captcha (para a classificação)", est, fmt.Sprintf("%d ms", ms), dica)
		}
	}
	add("Captcha", "Captchas prontos agora", "info", strconv.Itoa(captchasProntos()), "")

	// ---- Classificação (se houver item em disputa) ----
	m.mu.Lock()
	var itemClass string
	var numClass int
	agora := time.Now()
	for k, cfg := range m.config {
		compra, numTxt, ok := strings.Cut(k, ":")
		c := m.compras[compra]
		if !ok || c == nil {
			continue
		}
		n, _ := strconv.Atoi(numTxt)
		if it := c.itens[n]; it != nil && fasesDeLance[m.estadoAgora(it, agora).Fase] {
			itemClass, numClass = compra, n
			if cfg.Ligado {
				break
			}
		}
	}
	m.mu.Unlock()
	if itemClass != "" && !freado() {
		inicio := time.Now()
		ci, err := m.lerClassificacao(itemClass, numClass)
		ms := time.Since(inicio).Milliseconds()
		if err != nil {
			add("Captcha", "Leitura da classificação", "erro", "falhou", mascararNumeros(err.Error()))
		} else {
			m.mu.Lock()
			n := len(ci.concorrentes)
			m.mu.Unlock()
			est := "ok"
			if ms > 800 {
				est = "atencao"
			}
			add("Captcha", "Leitura da classificação", est, fmt.Sprintf("%d ms (%d concorrentes)", ms, n), "")
		}
	}

	// ---- Freio e últimos lances ----
	if r := freioRestante(); r > 0 {
		add("Limites", "Freio do 429 (pedidos demais)", "atencao", fmt.Sprintf("ligado por mais %.0f s", r.Seconds()),
			"O Compras.gov.br pediu para ir mais devagar. Só o lance e a reta final continuam. Evite abrir muitas licitações ao mesmo tempo no Acompanhamento.")
	} else {
		add("Limites", "Freio do 429 (pedidos demais)", "ok", "desligado", "")
	}
	m.mu.Lock()
	var pedidos []int64
	recusados := 0
	for _, l := range m.lances {
		if l.PedidoMs > 0 {
			pedidos = append(pedidos, l.PedidoMs)
		}
		if !l.OK {
			recusados++
		}
	}
	total := len(m.lances)
	m.mu.Unlock()
	if total > 0 {
		valor := fmt.Sprintf("%d lance(s), %d recusado(s)", total, recusados)
		if md := mediana(pedidos); md >= 0 {
			valor += fmt.Sprintf(", aceite em %d ms (mediana)", md)
		}
		est, dica := "ok", ""
		if recusados*3 > total {
			est, dica = "atencao", "Muitos lances recusados: confira as mensagens dos lances na tela (intervalo mínimo, valor igual a outro, mínimo acima do seu lance)."
		}
		add("Limites", "Lances desta sessão", est, valor, dica)
	}

	// ---- Configuração de cada item com o robô ligado ----
	m.mu.Lock()
	type cfgItem struct {
		k   string
		cfg configItem
		e   *estadoItem
	}
	var ligados []cfgItem
	for k, cfg := range m.config {
		if !cfg.Ligado {
			continue
		}
		var est *estadoItem
		if compra, numTxt, ok := strings.Cut(k, ":"); ok {
			if c := m.compras[compra]; c != nil {
				n, _ := strconv.Atoi(numTxt)
				if it := c.itens[n]; it != nil {
					x := m.estadoAgora(it, agora)
					est = &x
				}
			}
		}
		ligados = append(ligados, cfgItem{k, cfg, est})
	}
	m.mu.Unlock()
	sort.Slice(ligados, func(i, j int) bool { return ligados[i].k < ligados[j].k })
	if len(ligados) == 0 {
		add("Itens", "Itens com o robô ligado", "info", "nenhum", "")
	}
	for _, l := range ligados {
		nome := rotuloItem(l.k)
		cfg, e := l.cfg, l.e
		var problemas []string
		estado := "ok"
		if cfg.Minimo == nil || *cfg.Minimo <= 0 {
			problemas = append(problemas, "sem lance mínimo: o robô não age")
			estado = "erro"
		}
		if e == nil {
			add("Itens", nome, "info", "fora da etapa de lances agora", "")
			continue
		}
		if cfg.Minimo != nil && e.Nosso != nil && *cfg.Minimo > *e.Nosso {
			problemas = append(problemas, "o mínimo está acima do seu lance atual: o robô não vai baixar")
			estado = "atencao"
		}
		if e.Variacao != nil && *e.Variacao > 0 && cfg.Desconto > 0 {
			tipoEdital := "V"
			if e.TipoVariacao == "P" {
				tipoEdital = "P"
			}
			tipoCfg := cfg.TipoDesconto
			if tipoCfg == "" {
				tipoCfg = "P"
			}
			if tipoEdital != tipoCfg {
				problemas = append(problemas, "o desconto está em "+map[string]string{"P": "%", "V": "R$"}[tipoCfg]+" e o edital pede o intervalo em "+map[string]string{"P": "%", "V": "R$"}[tipoEdital]+" — pare, confira o campo e ligue de novo")
				if estado == "ok" {
					estado = "atencao"
				}
			}
		}
		if !cfg.QuatroCasas && e.Variacao != nil && e.TipoVariacao != "P" && *e.Variacao > 0 && *e.Variacao < 0.01 {
			problemas = append(problemas, "o intervalo do edital tem mais de 2 casas: marque \"Permitir lances com 4 casas decimais\"")
			if estado == "ok" {
				estado = "atencao"
			}
		}
		if cfg.NaoAguardar && e.Fase == "LA" && e.RestanteSeg != nil && *e.RestanteSeg > 3600 {
			problemas = append(problemas, fmt.Sprintf("\"Não esperar\" com %.0f h pela frente: o robô age a qualquer momento (é isso mesmo?)", *e.RestanteSeg/3600))
			if estado == "ok" {
				estado = "info"
			}
		}
		valor := "configuração ok"
		if len(problemas) > 0 {
			valor = strings.Join(problemas, "; ")
		}
		add("Itens", nome, estado, valor, "")
	}

	// ---- Resumo ----
	erros, atencoes := 0, 0
	for _, it := range itens {
		switch it.Estado {
		case "erro":
			erros++
		case "atencao":
			atencoes++
		}
	}
	resumo := "Tudo certo: o robô está pronto para disputar."
	switch {
	case erros > 0:
		resumo = fmt.Sprintf("%d problema(s) que atrapalham o robô e %d ponto(s) de atenção.", erros, atencoes)
	case atencoes > 0:
		resumo = fmt.Sprintf("Funcionando, com %d ponto(s) de atenção.", atencoes)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Teste do robô (Montzion %s, %s): %s\n", versao, time.Now().Format("02/01 15:04:05"), resumo)
	for _, it := range itens {
		fmt.Fprintf(&b, "[%s] %s — %s: %s\n", it.Estado, it.Grupo, it.Nome, it.Valor)
	}
	texto := mascararNumeros(b.String())
	registrarLog("%s", strings.ReplaceAll(strings.TrimSpace(texto), "\n", " | "))
	return mapa{"itens": itens, "resumo": resumo, "texto": texto}
}
