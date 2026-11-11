package main

// Motor do robô de lances (roda dentro do aplicativo, não na página).
//
//   - Sessão: lê o token da sala de disputa na janela do Compras.gov.br (escondida depois do login) e
//     renova se ele vencer.
//   - Tempo real: conecta no mesmo canal STOMP/WebSocket da sala oficial e recebe cada lance novo na hora.
//   - Robô: a cada aviso (e a cada 100 ms, para o cronômetro) decide e envia o lance direto ao Compras.gov.br,
//     sem esperar a página. A página Disputas só mostra o painel e manda a configuração.
//   - Pedidos: direto do aplicativo (mais rápido); se falharem, pela própria janela do Compras.gov.br.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type itemMotor struct {
	bruto        map[string]any
	recebidoEm   time.Time // quando o tempo restante chegou
	atualizadoEm time.Time // último aviso/leitura (para medir o tempo de reação)
}

type compraMotor struct {
	chave    string
	info     map[string]any
	itens    map[int]*itemMotor
	lida     bool
	lidaEm   time.Time
	esperar  time.Time // depois de 429
	erro     string
	inscrita bool
}

type registroLance struct {
	ID       int64   `json:"id"`
	Compra   string  `json:"compra"`
	Item     int     `json:"item"`
	Valor    float64 `json:"valor"`
	OK       bool    `json:"ok"`
	Mensagem string  `json:"mensagem"`
	Em       int64   `json:"em"`
	ReacaoMs int64   `json:"reacaoMs"`
}

type mensagemItem struct {
	Texto string `json:"texto"`
	Erro  bool   `json:"erro,omitempty"`
}

type motor struct {
	p  *ponte
	mu sync.Mutex

	compras     map[string]*compraMotor
	ordem       []string
	descartadas int
	config      map[string]configItem
	mensagens   map[string]mensagemItem
	enviando    map[string]time.Time
	fechadaOK   map[string]bool
	lances      []registroLance
	seqLance    int64
	ultimo      *registroLance

	token, refresh, cnpj, userAgent string
	versaoSistema, plataforma       string
	expira                          time.Time
	tokenLidoEm                     time.Time

	fase, aviso    string
	listaEm        time.Time
	buscandoLista  bool
	entrandoDesde  time.Time
	escondeuPortal bool
	mostrouPortal  bool // já mostrou a janela do Compras para a pessoa abrir a sala sozinha

	httpc        *http.Client
	diretoAte    time.Time // até quando usar a janela em vez do pedido direto
	stomp        *clienteStomp
	inscricoes   map[string]string // destino -> compra
	tempoReal    bool
	ultimoPedido time.Time
}

func novoMotor(p *ponte) *motor {
	m := &motor{
		p: p, compras: map[string]*compraMotor{}, config: map[string]configItem{}, mensagens: map[string]mensagemItem{},
		enviando: map[string]time.Time{}, fechadaOK: map[string]bool{}, inscricoes: map[string]string{},
		fase: "sem-login", versaoSistema: "6.4.4", plataforma: "WEB",
		httpc: &http.Client{Timeout: 8 * time.Second, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, MaxIdleConnsPerHost: 4, IdleConnTimeout: 90 * time.Second}},
	}
	m.carregarConfig()
	return m
}

func (m *motor) Rodar() {
	go m.cicloSessao()
	go m.cicloTempoReal()
	go m.cicloLeitura()
	go m.cicloRobo()
}

func chaveItem(compra string, numero int) string { return compra + ":" + strconv.Itoa(numero) }

// ---------- configuração (vem da página; guardada no computador para o robô seguir sem a página) ----------

func (m *motor) arquivoConfig() string { return filepath.Join(pastaInstalacao(), "robo.json") }

func (m *motor) carregarConfig() {
	dados, err := os.ReadFile(m.arquivoConfig())
	if err == nil {
		_ = json.Unmarshal(dados, &m.config)
	}
}

func (m *motor) Configurar(itens map[string]configItem) {
	m.mu.Lock()
	m.config = itens
	for k, c := range itens {
		if !c.Ligado {
			delete(m.fechadaOK, k)
		}
	}
	dados, _ := json.Marshal(m.config)
	m.mu.Unlock()
	_ = os.MkdirAll(pastaInstalacao(), 0o755)
	_ = os.WriteFile(m.arquivoConfig(), dados, 0o644)
	m.avaliarTodos()
}

// ---------- sessão ----------

var paginaDeLoginOuRetorno = regexp.MustCompile(`(?i)/seguro/loginPortal|acesso\.gov\.br|landing_sso`)

func lerJWT(token string) (cnpj string, exp time.Time) {
	partes := strings.Split(token, ".")
	if len(partes) < 2 {
		return "", time.Time{}
	}
	dados, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(partes[1], "="))
	if err != nil {
		return "", time.Time{}
	}
	var v struct {
		Fornecedor any     `json:"identificacao_fornecedor"`
		Exp        float64 `json:"exp"`
	}
	_ = json.Unmarshal(dados, &v)
	if v.Exp > 0 {
		exp = time.Unix(int64(v.Exp), 0)
	}
	return textoDe(v.Fornecedor), exp
}

func (m *motor) definirFase(fase, aviso string) {
	m.mu.Lock()
	if m.fase != fase {
		registrarLog("robô: %s %s", fase, aviso)
	}
	m.fase, m.aviso = fase, aviso
	m.mu.Unlock()
}

func (m *motor) cicloSessao() {
	for {
		m.verSessao()
		m.mu.Lock()
		logado := m.token != ""
		m.mu.Unlock()
		if logado {
			time.Sleep(5 * time.Second)
		} else {
			time.Sleep(time.Second)
		}
	}
}

func (m *motor) verSessao() {
	a := m.p.sessaoLogada(true)
	if a == nil {
		m.mu.Lock()
		tinha := m.token != ""
		m.token, m.refresh = "", ""
		m.mu.Unlock()
		if tinha {
			registrarLog("robô: sessão da sala de disputa perdida")
		}
		m.verLogin()
		return
	}
	saida, err := m.p.avaliar(a.sessao, `JSON.stringify({a: sessionStorage.getItem("accessToken") || "", r: sessionStorage.getItem("refreshToken") || "", ua: navigator.userAgent})`, 3*time.Second)
	if err != nil {
		return
	}
	var v struct{ A, R, UA string }
	if json.Unmarshal([]byte(saida), &v) != nil || v.A == "" {
		return
	}
	cnpj, exp := lerJWT(v.A)
	m.mu.Lock()
	novoLogin := m.token == ""
	mudouToken := m.token != v.A
	m.token, m.refresh, m.userAgent, m.tokenLidoEm = v.A, v.R, v.UA, time.Now()
	if cnpj != "" {
		m.cnpj = cnpj
	}
	m.expira = exp
	precisaLista := novoLogin || (m.listaEm.IsZero() && !m.buscandoLista)
	m.mu.Unlock()
	if mudouToken && !novoLogin {
		registrarLog("robô: token renovado pela sala de disputa")
	}
	// Token vencido e a sala não renovou (janela escondida pode ficar lenta): renova aqui.
	if !exp.IsZero() && time.Now().After(exp.Add(5*time.Second)) && v.R != "" {
		m.renovarToken(a)
	}
	if precisaLista {
		m.definirFase("buscando", "Buscando suas disputas no Compras.gov.br…")
		go m.atualizarLista()
	}
}

// Ainda sem sessão na sala de disputa: acompanha o login e, quando o gov.br devolve para o Compras.gov.br,
// esconde a janela e entra sozinho na sala (como no Siga Pregão).
func (m *motor) verLogin() {
	portalLogado := false
	for _, a := range m.p.janelasCompras("portal") {
		if !paginaDeLoginOuRetorno.MatchString(a.url) {
			portalLogado = true
		}
	}
	janelas := len(m.p.janelasCompras("compras", "portal", "login")) > 0
	m.mu.Lock()
	esconder := portalLogado && !m.escondeuPortal && m.p.esconderCompras != nil
	if portalLogado {
		m.escondeuPortal = true
		if m.entrandoDesde.IsZero() {
			m.entrandoDesde = time.Now()
		}
	} else {
		m.entrandoDesde = time.Time{}
	}
	desde := m.entrandoDesde
	if !janelas {
		m.escondeuPortal = false
		m.mostrouPortal = false
	}
	mostrou := m.mostrouPortal
	m.mu.Unlock()
	switch {
	case portalLogado:
		if esconder {
			m.p.esconderCompras()
			registrarLog("robô: login no gov.br feito; janela escondida, entrando na sala de disputa")
		}
		m.p.abrirSalaPeloPortal()
		// Se a sala não abrir sozinha em 40 s, mostra a janela (uma vez) para a pessoa abrir pelo menu;
		// o robô continua tentando e segue sozinho assim que a sala tiver sessão.
		if !mostrou && time.Since(desde) > 40*time.Second && m.p.abrirCompras != nil {
			m.mu.Lock()
			m.mostrouPortal = true
			m.mu.Unlock()
			m.p.abrirCompras()
			registrarLog("robô: a sala de disputa não abriu sozinha em 40 s; janela do Compras.gov.br mostrada")
			mostrou = true
		}
		if mostrou {
			m.definirFase("entrando", "Não consegui abrir a sala de disputa sozinho. Na janela do Compras.gov.br, abra a sala de disputa (menu Compras → Acompanhar/Disputa): o robô segue sozinho assim que ela abrir.")
		} else {
			m.definirFase("entrando", "Login feito. Entrando na sala de disputa…")
		}
	case janelas:
		m.definirFase("aguardando-login", "Entre com a sua conta gov.br na janela que abriu.")
	default:
		m.definirFase("sem-login", "")
	}
}

func (m *motor) renovarToken(a *sessaoAlvo) {
	m.mu.Lock()
	refresh := m.refresh
	m.mu.Unlock()
	req, _ := http.NewRequest("PUT", strings.TrimRight(m.p.cfg.Compras, "/")+"/comprasnet-usuario/v2/sessao/fornecedor/retoken", nil)
	m.cabecalhos(req, refresh)
	r, err := m.httpc.Do(req)
	if err != nil {
		registrarLog("robô: não renovou o token: %v", err)
		return
	}
	defer r.Body.Close()
	var v struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
	}
	if r.StatusCode != 200 || json.NewDecoder(r.Body).Decode(&v) != nil || v.AccessToken == "" {
		registrarLog("robô: renovação do token recusada (%d)", r.StatusCode)
		return
	}
	_, _ = m.p.avaliar(a.sessao, fmt.Sprintf(`sessionStorage.setItem("accessToken", %s); %s; "ok"`, jsTexto(v.AccessToken),
		map[bool]string{true: fmt.Sprintf(`sessionStorage.setItem("refreshToken", %s)`, jsTexto(v.RefreshToken)), false: "0"}[v.RefreshToken != ""]), 3*time.Second)
	cnpj, exp := lerJWT(v.AccessToken)
	m.mu.Lock()
	m.token, m.expira = v.AccessToken, exp
	if v.RefreshToken != "" {
		m.refresh = v.RefreshToken
	}
	if cnpj != "" {
		m.cnpj = cnpj
	}
	m.mu.Unlock()
	registrarLog("robô: token renovado pelo aplicativo")
}

// ---------- pedidos ao Compras.gov.br ----------

func (m *motor) cabecalhos(req *http.Request, token string) {
	m.mu.Lock()
	ua, versao, plataforma := m.userAgent, m.versaoSistema, m.plataforma
	m.mu.Unlock()
	base := strings.TrimRight(m.p.cfg.Compras, "/")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Device-Platform", plataforma)
	req.Header.Set("X-Version-Number", versao)
	req.Header.Set("Origin", base)
	req.Header.Set("Referer", base+"/comprasnet-web/seguro/fornecedor/disputa")
	if ua != "" {
		req.Header.Set("User-Agent", ua)
	}
}

// pedir: direto do aplicativo; se o direto falhar (rede/bloqueio), usa a janela do Compras.gov.br.
func (m *motor) pedir(metodo, caminho string, corpo any) (int, []byte, error) {
	m.mu.Lock()
	token := m.token
	usarJanela := time.Now().Before(m.diretoAte)
	m.mu.Unlock()
	if token == "" {
		return 0, nil, fmt.Errorf("sem sessão no Compras.gov.br")
	}
	if !usarJanela {
		var leitor io.Reader
		if corpo != nil {
			b, _ := json.Marshal(corpo)
			leitor = bytes.NewReader(b)
		}
		req, _ := http.NewRequest(metodo, strings.TrimRight(m.p.cfg.Compras, "/")+caminho, leitor)
		m.cabecalhos(req, token)
		r, err := m.httpc.Do(req)
		if err == nil {
			dados, _ := io.ReadAll(io.LimitReader(r.Body, 8<<20))
			r.Body.Close()
			bloqueado := (r.StatusCode == 403 || r.StatusCode == 0) && !json.Valid(dados)
			if !bloqueado {
				return r.StatusCode, dados, nil
			}
			err = fmt.Errorf("bloqueado (%d)", r.StatusCode)
		}
		registrarLog("robô: pedido direto falhou (%v); usando a janela do Compras.gov.br por 5 min", err)
		m.mu.Lock()
		m.diretoAte = time.Now().Add(5 * time.Minute)
		m.mu.Unlock()
	}
	status, dados, err := m.p.api(metodo, caminho, corpo)
	return status, []byte(dados), err
}

// ---------- lista de compras ----------

var situacoesSemDisputa = map[string]bool{"RE": true, "AN": true, "FR": true, "DE": true}
var fasesCompraSemDisputa = map[string]bool{"4": true, "5": true, "6": true}

func soDigitos(s string) string {
	var b strings.Builder
	for _, c := range s {
		if c >= '0' && c <= '9' {
			b.WriteRune(c)
		}
	}
	return b.String()
}

func preencher(s string, n int) string {
	for len(s) < n {
		s = "0" + s
	}
	return s
}

func chaveDaCompraInfo(b map[string]any) string {
	if c := textoDe(b["chaveCompra"]); c != "" {
		return c
	}
	uasg := soDigitos(textoDe(numeroInteiro(b["numeroUasg"])))
	mod := soDigitos(textoDe(numeroInteiro(b["modalidade"])))
	numero := soDigitos(textoDe(numeroInteiro(firstNonNil(b["numeroCompra"], b["numero"]))))
	ano := soDigitos(textoDe(numeroInteiro(firstNonNil(b["anoCompra"], b["ano"]))))
	if uasg == "" || mod == "" || numero == "" || len(ano) != 4 {
		return ""
	}
	return preencher(uasg, 6) + preencher(mod, 2) + preencher(numero, 5) + ano
}

func firstNonNil(v ...any) any {
	for _, x := range v {
		if x != nil {
			return x
		}
	}
	return nil
}

// números do JSON vêm como float64 ("170007" e não "170007.000000").
func numeroInteiro(v any) any {
	if f, ok := v.(float64); ok {
		return strconv.FormatInt(int64(f), 10)
	}
	return v
}

func compraEncerrada(b map[string]any) bool {
	return situacoesSemDisputa[textoDe(b["situacaoCompraFaseExterna"])] || fasesCompraSemDisputa[textoDe(numeroInteiro(b["faseCompraFaseExterna"]))]
}

func (m *motor) atualizarLista() {
	m.mu.Lock()
	if m.buscandoLista {
		m.mu.Unlock()
		return
	}
	m.buscandoLista = true
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		m.buscandoLista = false
		m.mu.Unlock()
	}()
	a := m.p.sessaoLogada(false)
	if a == nil {
		return
	}
	bruto, err := m.p.buscarLista(a)
	if err != nil {
		m.definirFase("erro-lista", err.Error())
		m.mu.Lock()
		m.listaEm = time.Now() // tenta de novo no próximo ciclo
		m.mu.Unlock()
		return
	}
	var lista []map[string]any
	_ = json.Unmarshal(bruto, &lista)
	m.mu.Lock()
	vistas := map[string]bool{}
	ordem := []string{}
	descartadas := 0
	for _, info := range lista {
		chave := chaveDaCompraInfo(info)
		if chave == "" || vistas[chave] {
			continue
		}
		vistas[chave] = true
		if compraEncerrada(info) {
			descartadas++
			continue
		}
		c := m.compras[chave]
		if c == nil {
			c = &compraMotor{chave: chave, itens: map[int]*itemMotor{}}
			m.compras[chave] = c
		}
		c.info = info
		ordem = append(ordem, chave)
	}
	// Compras que saíram da lista: ficam só se houver robô ligado nelas.
	for chave := range m.compras {
		if vistas[chave] && !compraEncerrada(m.compras[chave].info) {
			continue
		}
		if !m.roboNaCompra(chave) {
			delete(m.compras, chave)
		} else if !vistas[chave] {
			ordem = append(ordem, chave)
		}
	}
	m.ordem, m.descartadas, m.listaEm = ordem, descartadas, time.Now()
	m.mu.Unlock()
	registrarLog("robô: %d compra(s) na lista (%d encerradas ficaram de fora)", len(ordem), descartadas)
	m.definirFase("pronto", "")
	m.inscreverTodas()
}

func (m *motor) roboNaCompra(chave string) bool {
	for k, c := range m.config {
		if c.Ligado && strings.HasPrefix(k, chave+":") {
			return true
		}
	}
	return false
}

// ---------- itens: leitura e avisos ----------

// mesclar aplica um item (lido ou recebido) na compra. Devolve a chave do item.
func (m *motor) mesclar(c *compraMotor, novo map[string]any, agora time.Time) string {
	n := numeroDe(novo["numero"])
	if n == nil {
		return ""
	}
	it := c.itens[int(*n)]
	if it == nil {
		it = &itemMotor{bruto: map[string]any{}}
		c.itens[int(*n)] = it
	}
	for k, v := range novo {
		it.bruto[k] = v
	}
	if _, ok := novo["tempoRestanteEmSegundos"]; ok {
		it.recebidoEm = agora
	}
	it.atualizadoEm = agora
	return chaveItem(c.chave, int(*n))
}

func (m *motor) lerItens(chave string) {
	status, dados, err := m.pedir("GET", "/comprasnet-disputa/v1/compras/"+url.PathEscape(chave)+"/itens/em-disputa", nil)
	agora := time.Now()
	m.mu.Lock()
	c := m.compras[chave]
	if c == nil {
		m.mu.Unlock()
		return
	}
	c.lidaEm = agora
	switch {
	case err != nil:
		c.erro = err.Error()
	case status == 429:
		espera := 10 * time.Second
		if m.roboNaCompra(chave) {
			espera = 2 * time.Second
		}
		c.esperar = agora.Add(espera)
		c.erro = "O Compras.gov.br pediu para ir mais devagar; tentando de novo em instantes."
	case status == 401 || status == 403:
		c.erro = "Sessão do Compras.gov.br expirada: clique em Entrar no Compras.gov.br."
	case status != 200:
		c.erro = fmt.Sprintf("O Compras.gov.br respondeu %d: %s", status, mensagemErro(dados))
	default:
		var itens []map[string]any
		if json.Unmarshal(dados, &itens) != nil {
			var obj struct {
				Itens []map[string]any `json:"itens"`
			}
			_ = json.Unmarshal(dados, &obj)
			itens = obj.Itens
		}
		c.erro, c.lida = "", true
		presentes := map[int]bool{}
		chaves := []string{}
		for _, it := range itens {
			if k := m.mesclar(c, it, agora); k != "" {
				chaves = append(chaves, k)
				presentes[int(*numeroDe(it["numero"]))] = true
			}
		}
		// Saiu da lista "em disputa": a disputa do item acabou.
		for n, it := range c.itens {
			if !presentes[n] && fasesDeLance[textoDe(it.bruto["fase"])] {
				it.bruto["fase"] = "E"
			}
		}
		m.mu.Unlock()
		for _, k := range chaves {
			m.avaliar(k)
		}
		return
	}
	m.mu.Unlock()
}

// Leituras pela API: no começo (para saber o que está em disputa), de segurança enquanto o tempo real
// funciona e no lugar dele se cair. Uma por vez, com folga, para não levar 429.
func (m *motor) cicloLeitura() {
	for {
		time.Sleep(150 * time.Millisecond)
		agora := time.Now()
		m.mu.Lock()
		if m.token == "" || m.fase != "pronto" || agora.Sub(m.ultimoPedido) < 300*time.Millisecond {
			m.mu.Unlock()
			continue
		}
		tempoReal := m.tempoReal
		melhor, prioridade := "", -1
		var atraso time.Duration
		for _, chave := range m.ordem {
			c := m.compras[chave]
			if c == nil || agora.Before(c.esperar) {
				continue
			}
			robo := m.roboNaCompra(chave)
			emDisputa := m.compraEmDisputa(c)
			perto := robo && m.pertoDoFim(c, agora)
			var intervalo time.Duration
			pri := 0
			switch {
			case !c.lida && c.lidaEm.IsZero():
				intervalo, pri = 0, 3
			case m.tempoAcabou(c, agora):
				intervalo, pri = 3*time.Second, 2 // cronômetro zerou: confere se a disputa acabou
			case perto && !tempoReal:
				intervalo, pri = 500*time.Millisecond, 4
			case robo && !tempoReal:
				intervalo, pri = 2*time.Second, 2
			case emDisputa && !tempoReal:
				intervalo, pri = 3*time.Second, 1
			case robo:
				intervalo, pri = 15*time.Second, 1
			case emDisputa:
				intervalo, pri = 30*time.Second, 0
			default:
				intervalo, pri = 2*time.Minute, 0
			}
			d := agora.Sub(c.lidaEm) - intervalo
			if d < 0 {
				continue
			}
			if pri > prioridade || (pri == prioridade && d > atraso) {
				melhor, prioridade, atraso = chave, pri, d
			}
		}
		if melhor == "" {
			if !m.listaEm.IsZero() && agora.Sub(m.listaEm) > 5*time.Minute && !m.buscandoLista {
				go m.atualizarLista()
			}
			m.mu.Unlock()
			continue
		}
		m.ultimoPedido = agora
		m.compras[melhor].lidaEm = agora
		m.mu.Unlock()
		go m.lerItens(melhor)
	}
}

func (m *motor) compraEmDisputa(c *compraMotor) bool {
	for _, it := range c.itens {
		f := textoDe(it.bruto["fase"])
		if f != "E" && f != "" {
			return true
		}
	}
	return false
}

func (m *motor) pertoDoFim(c *compraMotor, agora time.Time) bool {
	for _, it := range c.itens {
		e := m.estadoAgora(it, agora)
		if e.Fase == "AL" || e.Fase == "DF" || e.Fase == "LF" || (e.Fase == "LA" && e.RestanteSeg != nil && *e.RestanteSeg <= segundosFinais+5) {
			return true
		}
	}
	return false
}

func (m *motor) tempoAcabou(c *compraMotor, agora time.Time) bool {
	for _, it := range c.itens {
		e := m.estadoAgora(it, agora)
		if e.Fase == "LA" && e.RestanteSeg != nil && *e.RestanteSeg <= 0 && agora.Sub(it.recebidoEm) > 2*time.Second {
			return true
		}
	}
	return false
}

func (m *motor) estadoAgora(it *itemMotor, agora time.Time) estadoItem {
	e := lerItem(it.bruto)
	if e.RestanteSeg != nil && !it.recebidoEm.IsZero() {
		r := *e.RestanteSeg - agora.Sub(it.recebidoEm).Seconds()
		if r < 0 {
			r = 0
		}
		e.RestanteSeg = &r
	}
	return e
}

// ---------- tempo real (STOMP) ----------

func (m *motor) enderecoTempoReal() string {
	base := strings.TrimRight(m.p.cfg.Compras, "/")
	base = strings.Replace(strings.Replace(base, "https://", "wss://", 1), "http://", "ws://", 1)
	return base + "/comprasnet-websocket/socket/websocket"
}

func (m *motor) cicloTempoReal() {
	espera := 2 * time.Second
	for {
		m.mu.Lock()
		token, ua := m.token, m.userAgent
		pronto := m.fase == "pronto" || m.fase == "erro-lista"
		m.mu.Unlock()
		if token == "" || !pronto {
			time.Sleep(time.Second)
			continue
		}
		cab := map[string]string{"Origin": strings.TrimRight(m.p.cfg.Compras, "/"), "User-Agent": ua}
		cli, err := conectarStomp(m.enderecoTempoReal(), cab, token)
		if err != nil {
			cli, err = conectarStomp(m.enderecoTempoReal(), cab, "Bearer "+token)
		}
		if err != nil {
			registrarLog("robô: tempo real indisponível (%v); seguindo por consultas", err)
			time.Sleep(espera)
			if espera < 30*time.Second {
				espera *= 2
			}
			continue
		}
		espera = 2 * time.Second
		registrarLog("robô: tempo real ligado")
		m.mu.Lock()
		m.stomp = cli
		m.tempoReal = true
		m.inscricoes = map[string]string{}
		for _, c := range m.compras {
			c.inscrita = false
		}
		m.mu.Unlock()
		m.inscreverTodas()
		m.receber(cli)
		m.mu.Lock()
		m.stomp, m.tempoReal = nil, false
		m.mu.Unlock()
		registrarLog("robô: tempo real caiu; reconectando")
		time.Sleep(time.Second)
	}
}

func (m *motor) inscreverTodas() {
	m.mu.Lock()
	cli, cnpj := m.stomp, m.cnpj
	var novas []*compraMotor
	for _, chave := range m.ordem {
		if c := m.compras[chave]; c != nil && !c.inscrita {
			c.inscrita = true
			novas = append(novas, c)
		}
	}
	m.mu.Unlock()
	if cli == nil {
		return
	}
	for _, c := range novas {
		destinos := []string{"/topic/compra/" + c.chave}
		if cnpj != "" {
			destinos = append(destinos, "/topic/disputa/fornec/"+c.chave+"/"+cnpj)
		}
		for _, d := range destinos {
			if _, err := cli.Inscrever(d); err == nil {
				m.mu.Lock()
				m.inscricoes[d] = c.chave
				m.mu.Unlock()
			}
		}
	}
}

func (m *motor) receber(cli *clienteStomp) {
	for {
		select {
		case <-cli.Fechado:
			return
		case q := <-cli.Mensagens:
			if q.Comando != "MESSAGE" {
				continue
			}
			m.tratarAviso(q, time.Now())
		}
	}
}

func listaJSON(corpo string) []map[string]any {
	var lista []map[string]any
	if json.Unmarshal([]byte(corpo), &lista) == nil {
		return lista
	}
	var um map[string]any
	if json.Unmarshal([]byte(corpo), &um) == nil {
		return []map[string]any{um}
	}
	return nil
}

func (m *motor) tratarAviso(q quadroStomp, agora time.Time) {
	destino := q.Cabecalhos["destination"]
	m.mu.Lock()
	chave := m.inscricoes[destino]
	c := m.compras[chave]
	if c == nil {
		m.mu.Unlock()
		return
	}
	var chaves []string
	switch q.Cabecalhos["classe"] {
	case "ItemDisputaRepresentation":
		for _, it := range listaJSON(q.Corpo) {
			if k := m.mesclar(c, it, agora); k != "" {
				chaves = append(chaves, k)
			}
		}
	case "ItemComAlteracaoContadoresRepresentation":
		for _, x := range listaJSON(q.Corpo) {
			if it, ok := x["item"].(map[string]any); ok {
				if k := m.mesclar(c, it, agora); k != "" {
					chaves = append(chaves, k)
				}
			}
		}
	case "CompraFaseExternaRepresentation":
		for _, x := range listaJSON(q.Corpo) {
			if c.info == nil {
				c.info = map[string]any{}
			}
			for k, v := range x {
				c.info[k] = v
			}
		}
	}
	m.mu.Unlock()
	// Responde na hora: decide e, se for o caso, envia o lance já neste aviso.
	for _, k := range chaves {
		m.avaliar(k)
	}
}

// ---------- o robô ----------

func (m *motor) cicloRobo() {
	t := time.NewTicker(100 * time.Millisecond)
	defer t.Stop()
	for range t.C {
		m.avaliarTodos()
	}
}

func (m *motor) avaliarTodos() {
	m.mu.Lock()
	var chaves []string
	for k, c := range m.config {
		if c.Ligado {
			chaves = append(chaves, k)
		}
	}
	m.mu.Unlock()
	for _, k := range chaves {
		m.avaliar(k)
	}
}

func (m *motor) avaliar(k string) {
	compra, numTxt, ok := strings.Cut(k, ":")
	if !ok {
		return
	}
	numero, _ := strconv.Atoi(numTxt)
	agora := time.Now()
	m.mu.Lock()
	cfg, temCfg := m.config[k]
	c := m.compras[compra]
	if !temCfg || !cfg.Ligado || c == nil || m.token == "" {
		m.mu.Unlock()
		return
	}
	it := c.itens[numero]
	if it == nil {
		m.mu.Unlock()
		return
	}
	e := m.estadoAgora(it, agora)
	d := decidir(e, &cfg)
	if !d.Enviar {
		if m.mensagens[k].Texto != d.Motivo {
			m.mensagens[k] = mensagemItem{Texto: d.Motivo}
		}
		m.mu.Unlock()
		return
	}
	// Um lance por vez por item; na etapa fechada, um só.
	if agora.Before(m.enviando[k]) || (d.Tipo == "fechada" && m.fechadaOK[k]) {
		m.mu.Unlock()
		return
	}
	m.enviando[k] = agora.Add(5 * time.Second)
	reacao := agora.Sub(it.atualizadoEm).Milliseconds()
	m.mensagens[k] = mensagemItem{Texto: "Enviando " + reaisTexto(d.Valor, cfg.QuatroCasas) + "…"}
	m.mu.Unlock()
	go m.enviarLance(c.chave, numero, k, d, e.Fase, cfg.QuatroCasas, reacao)
}

func (m *motor) enviarLance(compra string, numero int, k string, d decisao, fase string, quatro bool, reacao int64) {
	inicio := time.Now()
	status, dados, err := m.pedir("POST", fmt.Sprintf("/comprasnet-disputa/v1/compras/%s/itens/%d/lances", url.PathEscape(compra), numero),
		map[string]any{"valorInformado": d.Valor, "faseItem": fase})
	ok := err == nil && status >= 200 && status < 300
	msg := ""
	switch {
	case err != nil:
		msg = err.Error()
	case !ok:
		msg = mensagemErro(dados)
		if msg == "" {
			msg = fmt.Sprintf("erro %d", status)
		}
	}
	registrarLog("robô: lance compra %s item %d valor %.4f -> %d em %d ms (%s) %s", compra, numero, d.Valor, status, time.Since(inicio).Milliseconds(), d.Tipo, msg)
	agora := time.Now()
	m.mu.Lock()
	m.seqLance++
	reg := registroLance{ID: m.seqLance, Compra: compra, Item: numero, Valor: d.Valor, OK: ok, Mensagem: msg, Em: agora.UnixMilli(), ReacaoMs: reacao + agora.Sub(inicio).Milliseconds()}
	m.lances = append(m.lances, reg)
	if ok {
		m.ultimo = &reg
	}
	if len(m.lances) > 500 {
		m.lances = m.lances[len(m.lances)-500:]
	}
	if ok {
		if d.Tipo == "fechada" {
			m.fechadaOK[k] = true
		}
		m.mensagens[k] = mensagemItem{Texto: "Lance de " + reaisTexto(d.Valor, quatro) + " enviado"}
		// O Compras.gov.br aceitou: já conta o lance (o aviso do tempo real confirma logo em seguida).
		if c := m.compras[compra]; c != nil {
			if it := c.itens[numero]; it != nil {
				v := map[string]any{"valorCalculado": d.Valor, "valorInformado": d.Valor}
				it.bruto["melhorValorFornecedor"] = v
				if melhor := valorDe(it.bruto["melhorValorGeral"]); melhor == nil || d.Valor < *melhor {
					it.bruto["melhorValorGeral"] = v
					it.bruto["situacaoParticipanteDisputa"] = "G"
				}
			}
			for _, it := range listaJSON(string(dados)) {
				m.mesclar(c, it, agora)
			}
		}
		// Já contamos o lance aceito: o próximo só sai se alguém cobrir (sem esperar nada).
		m.enviando[k] = time.Time{}
	} else {
		m.mensagens[k] = mensagemItem{Texto: "Lance recusado: " + msg, Erro: true}
		m.enviando[k] = agora.Add(700 * time.Millisecond)
		if c := m.compras[compra]; c != nil {
			c.lidaEm = time.Time{} // relê o item para corrigir o que o robô sabe
		}
	}
	m.mu.Unlock()
	if ok {
		m.avaliar(k)
	}
}

// ---------- painel para a página ----------

func (m *motor) Painel() any {
	agora := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	compras := []map[string]any{}
	for _, chave := range m.ordem {
		c := m.compras[chave]
		if c == nil {
			continue
		}
		numeros := make([]int, 0, len(c.itens))
		for n := range c.itens {
			numeros = append(numeros, n)
		}
		sort.Ints(numeros)
		itens := []map[string]any{}
		for _, n := range numeros {
			it := c.itens[n]
			copia := make(map[string]any, len(it.bruto)+2)
			for k, v := range it.bruto {
				copia[k] = v
			}
			e := m.estadoAgora(it, agora)
			if e.RestanteSeg != nil {
				copia["tempoRestanteEmSegundos"] = *e.RestanteSeg
			}
			if e.Situacao != "" {
				copia["situacaoParticipanteDisputa"] = e.Situacao
			}
			itens = append(itens, copia)
		}
		compras = append(compras, map[string]any{
			"chave": chave, "info": c.info, "lida": c.lida, "emDisputa": m.compraEmDisputa(c), "erro": c.erro, "itens": itens,
		})
	}
	lances := append([]registroLance(nil), m.lances...)
	if len(lances) > 100 {
		lances = lances[len(lances)-100:]
	}
	mensagens := make(map[string]mensagemItem, len(m.mensagens))
	for k, v := range m.mensagens {
		mensagens[k] = v
	}
	return mapa{
		"versao": versao, "fase": m.fase, "aviso": m.aviso, "conectado": m.token != "", "tempoReal": m.tempoReal,
		"direto": !agora.Before(m.diretoAte), "descartadas": m.descartadas, "listaEm": m.listaEm.UnixMilli(),
		"compras": compras, "mensagens": mensagens, "lances": lances, "ultimoLance": m.ultimo, "agora": agora.UnixMilli(),
	}
}

func (m *motor) ConfirmarLances(ids []int64) {
	apagar := map[int64]bool{}
	for _, id := range ids {
		apagar[id] = true
	}
	m.mu.Lock()
	resto := m.lances[:0]
	for _, l := range m.lances {
		if !apagar[l.ID] {
			resto = append(resto, l)
		}
	}
	m.lances = resto
	m.mu.Unlock()
}
