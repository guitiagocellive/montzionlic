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
	"math"
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
	qtdLog   int // última quantidade de itens em disputa registrada no log (para o diagnóstico)
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
	Posicao  int     `json:"posicao,omitempty"` // colocação que o lance buscava
	Tipo     string  `json:"tipo,omitempty"`
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

	acomp acompanhamento // aba Acompanhamento (participações, itens, mensagens)

	ranking  map[string]*classificacaoItem // classificação (melhor lance de cada participante) por item
	recentes map[string][]registroLance
	// Resultado de cada disputa que acabou (para a tela mostrar em que posição ficamos em cada item).
	resultados  []resultadoDisputa
	fimVisto    map[string]bool
	enumsRodada map[string]string        // situacaoParticipacaoRodada: valor -> nome (CONVOCADO, PARTICIPANTE_NAO_CONVOCADO_FASE_FECHADA...)
	passoConc   map[string]bool          // itens em que o Compras exigiu o intervalo também sobre o concorrente
	ultimos     map[string]registroLance // último lance enviado por item (com a resposta do Compras.gov.br)
}

func novoMotor(p *ponte) *motor {
	m := &motor{
		p: p, compras: map[string]*compraMotor{}, config: map[string]configItem{}, mensagens: map[string]mensagemItem{},
		enviando: map[string]time.Time{}, fechadaOK: map[string]bool{}, inscricoes: map[string]string{}, ranking: map[string]*classificacaoItem{}, ultimos: map[string]registroLance{}, recentes: map[string][]registroLance{}, fimVisto: map[string]bool{}, passoConc: map[string]bool{},
		fase: "sem-login", versaoSistema: "6.4.4", plataforma: "WEB",
		// HTTP/2 (quando o Compras.gov.br aceita): o lance vai pela conexão já aberta, mesmo com outras leituras em
		// andamento, sem esperar um aperto de mão TLS novo (100–300 ms a mais justamente nos segundos finais).
		httpc: &http.Client{Timeout: 8 * time.Second, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, ForceAttemptHTTP2: true, MaxIdleConnsPerHost: 8, IdleConnTimeout: 5 * time.Minute}},
	}
	m.carregarConfig()
	m.carregarCacheAcomp()
	return m
}

func (m *motor) Rodar() {
	go m.cicloSessao()
	go m.cicloTempoReal()
	go m.cicloLeitura()
	go m.cicloRobo()
	go m.cicloCaptchaPronto()
	go m.cicloAcompanhamento()
	go m.cicloCacheAcomp()
	go m.cicloColetorPropostas()
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
		// O portal pediu para escolher a empresa/perfil: mostra a janela na hora (escondida, ninguém escolhe).
		m.p.mu.Lock()
		pedeEscolha := m.p.portalPedeEscolha
		m.p.mu.Unlock()
		if pedeEscolha {
			if !mostrou && m.p.abrirCompras != nil {
				m.mu.Lock()
				m.mostrouPortal = true
				m.mu.Unlock()
				m.p.abrirCompras()
				registrarLog("robô: o portal pede para escolher a empresa/perfil; janela do Compras.gov.br mostrada")
			}
			m.definirFase("entrando", "O Compras.gov.br está pedindo para escolher a empresa (ou perfil). Escolha na janela que abriu: o robô segue sozinho depois.")
			return
		}
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
	uasg := soDigitos(textoDe(numeroInteiro(firstNonNil(b["numeroUasg"], b["uasg"], b["codigoUasg"], b["codigoUnidade"]))))
	mod := soDigitos(textoDe(numeroInteiro(firstNonNil(b["modalidade"], b["codigoModalidade"]))))
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
	// Direto do aplicativo (segundos); a página do Compras.gov.br só se o direto falhar.
	bruto, err := m.buscarListaDireta()
	if err != nil {
		registrarLog("robô: lista direta falhou (%v); usando a página", err)
		bruto, err = m.p.buscarLista(a)
	}
	if err != nil {
		m.definirFase("erro-lista", err.Error())
		m.mu.Lock()
		m.listaEm = time.Now() // tenta de novo no próximo ciclo
		m.mu.Unlock()
		return
	}
	var lista []map[string]any
	_ = json.Unmarshal(bruto, &lista)
	// Junta as participações que o Acompanhamento sabe que estão na etapa Disputa (3) ou com disputa agendada
	// (99): a lista "em disputa" do Compras.gov.br às vezes não traz todas.
	extras := m.comprasEmDisputaDoAcompanhamento()
	ja := map[string]bool{}
	for _, info := range lista {
		ja[chaveDaCompraInfo(info)] = true
	}
	somadas := 0
	for _, info := range extras {
		if k := chaveDaCompraInfo(info); k != "" && !ja[k] {
			ja[k] = true
			lista = append(lista, info)
			somadas++
		}
	}
	if somadas > 0 {
		registrarLog("robô: %d compra(s) em disputa vieram do Acompanhamento (não estavam na lista do Compras.gov.br)", somadas)
	}
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
			c = &compraMotor{chave: chave, itens: map[int]*itemMotor{}, qtdLog: -1}
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
	m.mu.Lock()
	semEnums := m.enumsRodada == nil
	m.mu.Unlock()
	if semEnums {
		go m.carregarEnumsRodada()
	}
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
	faseAntes := textoDe(it.bruto["fase"])
	for k, v := range novo {
		it.bruto[k] = v
	}
	if fasesDeLance[faseAntes] && textoDe(it.bruto["fase"]) == "E" {
		m.fimDaDisputa(c.chave, int(*n))
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
		if len(itens) != c.qtdLog {
			c.qtdLog = len(itens)
			registrarLog("robô: compra %s: %d item(ns) em disputa agora", mascararNumeros(chave), len(itens))
		}
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
				m.fimDaDisputa(chave, n)
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
		// Folga entre leituras: 300 ms (para não levar 429); na primeira leitura de cada compra, 80 ms, para a
		// lista de disputas ficar pronta em 1 a 2 s em vez de ir aparecendo uma a uma.
		if m.token == "" || m.fase != "pronto" || agora.Sub(m.ultimoPedido) < 80*time.Millisecond {
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
		if melhor != "" && prioridade != 3 && agora.Sub(m.ultimoPedido) < 300*time.Millisecond {
			m.mu.Unlock()
			continue
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

// precisaCaptchaPronto: há item com robô ligado em fase de lances perto do fim (≤ 2,5 min, aleatório ou "não esperar").
func (m *motor) precisaCaptchaPronto() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.token == "" {
		return false
	}
	agora := time.Now()
	for k, cfg := range m.config {
		if !cfg.Ligado {
			continue
		}
		compra, numTxt, ok := strings.Cut(k, ":")
		if !ok {
			continue
		}
		c := m.compras[compra]
		if c == nil {
			continue
		}
		n, _ := strconv.Atoi(numTxt)
		it := c.itens[n]
		if it == nil {
			continue
		}
		e := m.estadoAgora(it, agora)
		if !fasesDeLance[e.Fase] || e.Fase == "LF" || e.Situacao == "G" {
			continue
		}
		if e.Fase != "LA" || cfg.NaoAguardar || e.RestanteSeg == nil || *e.RestanteSeg <= 150 {
			return true
		}
	}
	return false
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
	// Só desconta o tempo desde a leitura quando veio "tempo restante" (a hora de término já é absoluta).
	if _, temRestante := it.bruto["tempoRestanteEmSegundos"]; temRestante && e.RestanteSeg != nil && !it.recebidoEm.IsZero() {
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
	// Classificação lida há pouco: a regra usa para a melhor colocação. Lances só descem, então uma leitura de
	// alguns segundos atrás ainda serve (a regra junta o melhor lance atual, e a próxima leitura corrige o resto).
	r := m.ranking[k]
	if r != nil && !r.em.IsZero() && agora.Sub(r.em) < 20*time.Second {
		e.Concorrentes = append([]float64{}, r.concorrentes...)
	}
	e.PassoNoConcorrente = m.passoConc[k]
	d := decidir(e, &cfg)
	// Mantém a classificação em dia sempre que não dá para ser 1º acima do mínimo, já antes dos 10 s finais,
	// para o lance sair na hora certa e no valor certo (nunca o mínimo às cegas).
	if intervalo := intervaloClassificacao(e, &cfg, d, r != nil && !r.em.IsZero()); intervalo > 0 {
		m.pedirClassificacao(compra, numero, k, intervalo)
	}
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
	reg := registroLance{ID: m.seqLance, Compra: compra, Item: numero, Valor: d.Valor, OK: ok, Mensagem: msg, Em: agora.UnixMilli(), ReacaoMs: reacao + agora.Sub(inicio).Milliseconds(), Posicao: d.Posicao, Tipo: d.Tipo}
	m.ultimos[chaveItem(compra, numero)] = reg
	// Os 3 últimos lances de cada item (o mais novo primeiro), para a tela mostrar o que o robô fez.
	rec := append([]registroLance{reg}, m.recentes[chaveItem(compra, numero)]...)
	if len(rec) > 3 {
		rec = rec[:3]
	}
	m.recentes[chaveItem(compra, numero)] = rec
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
		// Recusado pelo intervalo mínimo ao cobrir um concorrente: daqui em diante aplica o intervalo também
		// sobre o lance dele.
		if d.Tipo == "colocacao" && strings.Contains(strings.ToLower(msg), "interval") {
			m.passoConc[k] = true
		}
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

// ---------- fim da disputa: em que posição ficamos ----------

type resultadoDisputa struct {
	Compra    string   `json:"compra"`
	Item      int      `json:"item"`
	Descricao string   `json:"descricao"`
	Posicao   int      `json:"posicao"` // 0 = não deu para saber
	Total     int      `json:"total"`
	Nosso     *float64 `json:"nosso"`
	Primeiro  *float64 `json:"primeiro"`
	Robo      bool     `json:"robo"`
	Em        int64    `json:"em"`
}

// fimDaDisputa (com m.mu travado): a etapa do item acabou; lê a classificação final em segundo plano.
func (m *motor) fimDaDisputa(compra string, numero int) {
	k := chaveItem(compra, numero)
	if m.fimVisto[k] {
		return
	}
	c := m.compras[compra]
	if c == nil || c.itens[numero] == nil {
		return
	}
	e := lerItem(c.itens[numero].bruto)
	if e.Nosso == nil { // sem proposta nossa neste item
		return
	}
	m.fimVisto[k] = true
	robo := m.config[k].Ligado
	go func() {
		time.Sleep(1500 * time.Millisecond) // o último lance assenta no Compras.gov.br
		r := resultadoDisputa{Compra: compra, Item: numero, Descricao: e.Descricao, Nosso: e.Nosso, Primeiro: e.Melhor, Robo: robo, Em: time.Now().UnixMilli()}
		if ci, err := m.lerClassificacao(compra, numero); err == nil && len(ci.todos) > 0 {
			m.mu.Lock()
			r.Total = len(ci.todos)
			for i, p := range ci.todos {
				if p.Nosso {
					r.Posicao = i + 1
					v := p.Valor
					r.Nosso = &v
				}
			}
			v := ci.todos[0].Valor
			r.Primeiro = &v
			m.mu.Unlock()
		} else if e.Situacao == "G" {
			r.Posicao = 1
		}
		m.mu.Lock()
		m.resultados = append(m.resultados, r)
		if len(m.resultados) > 60 {
			m.resultados = m.resultados[len(m.resultados)-60:]
		}
		m.mu.Unlock()
		registrarLog("robô: disputa encerrada compra %s item %d: posição %d de %d", mascararNumeros(compra), numero, r.Posicao, r.Total)
	}()
}

// carregarEnumsRodada: nomes das situações do fornecedor na rodada (convocado para a etapa fechada etc.).
func (m *motor) carregarEnumsRodada() {
	status, dados, err := m.pedir("GET", "/comprasnet-disputa/v1/enums", nil)
	if err != nil || status != 200 {
		return
	}
	var lista []struct {
		Name   string `json:"name"`
		Values []struct {
			Value    any    `json:"value"`
			EnumName string `json:"enumName"`
		} `json:"values"`
	}
	if json.Unmarshal(dados, &lista) != nil {
		return
	}
	mapa := map[string]string{}
	for _, e := range lista {
		if e.Name != "SituacaoParticipacaoFaseDisputaEnum" {
			continue
		}
		for _, v := range e.Values {
			mapa[textoDe(v.Value)] = v.EnumName
		}
	}
	if len(mapa) > 0 {
		m.mu.Lock()
		m.enumsRodada = mapa
		m.mu.Unlock()
	}
}

// LanceManual: lance digitado pela pessoa (etapa fechada), registrado como os do robô.
func (m *motor) LanceManual(compra string, numero int, valor float64, fase string) mapa {
	k := chaveItem(compra, numero)
	m.enviarLance(compra, numero, k, decisao{Enviar: true, Tipo: "fechada", Valor: valor}, fase, false, 0)
	m.mu.Lock()
	defer m.mu.Unlock()
	r := m.ultimos[k]
	if !r.OK {
		return mapa{"ok": false, "mensagem": r.Mensagem}
	}
	return mapa{"ok": true}
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
			if e.FimEm != nil {
				copia["fimEm"] = e.FimEm.UnixMilli()
			}
			// Colocação pela última classificação lida (melhor lance de cada participante).
			if r := m.ranking[chaveItem(chave, n)]; r != nil && len(r.todos) > 0 {
				pos := 0
				for i, p := range r.todos {
					if p.Nosso {
						pos = i + 1
					}
				}
				copia["classificacaoRobo"] = mapa{"posicao": pos, "total": len(r.todos), "em": r.em.UnixMilli()}
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
		"compras": compras, "mensagens": mensagens, "lances": lances, "ultimoLance": m.ultimo, "agora": agora.UnixMilli(), "ultimosPorItem": m.ultimos, "recentesPorItem": m.recentes,
		"resultados": m.resultados, "enumsRodada": m.enumsRodada,
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

// comprasEmDisputaDoAcompanhamento: participações em andamento na etapa Disputa, no formato da lista do robô.
func (m *motor) comprasEmDisputaDoAcompanhamento() []map[string]any {
	a := &m.acomp
	a.mu.Lock()
	bruto := a.andamento
	a.mu.Unlock()
	var saida []map[string]any
	for _, x := range listaDe(bruto) {
		c, _ := x["compra"].(map[string]any)
		if c == nil {
			c = x
		}
		fase := textoDe(numeroInteiro(c["faseCompraFaseExterna"]))
		if fase != "3" && fase != "99" {
			continue
		}
		k := chaveDaParticipacao(x)
		if k == "" {
			continue
		}
		info := map[string]any{"legadoAsp": legadoDaParticipacao(x)}
		for chave, v := range c {
			info[chave] = v
		}
		info["chaveCompra"] = k
		// A participação não traz modalidade/número/ano: saem da chave (UASG 6 + modalidade 2 + número 5 + ano 4).
		if _, ok := info["modalidade"]; !ok && len(k) == 17 {
			mod, _ := strconv.Atoi(k[6:8])
			num, _ := strconv.Atoi(k[8:13])
			info["modalidade"] = float64(mod)
			info["numeroCompra"] = float64(num)
			info["anoCompra"] = k[13:]
		}
		saida = append(saida, info)
	}
	return saida
}

// ---------- classificação do item (melhor lance de cada participante) ----------

type posicaoClassificacao struct {
	Valor float64 `json:"valor"`
	Nosso bool    `json:"nosso"`
}

type classificacaoItem struct {
	concorrentes []float64
	todos        []posicaoClassificacao
	melhor       float64 // melhor lance do item quando a classificação foi lida
	em           time.Time
	pedidaEm     time.Time
	buscando     bool
	erro         string
}

// intervaloClassificacao: de quanto em quanto tempo reler a classificação do item (0 = não precisa agora).
func intervaloClassificacao(e estadoItem, c *configItem, d decisao, temLeitura bool) time.Duration {
	if !fasesDeLance[e.Fase] || e.Fase == "LF" || e.Situacao == "G" || e.Nosso == nil || c.Minimo == nil || e.Melhor == nil {
		return 0
	}
	if d.Tipo == "precisa-classificacao" {
		if temLeitura {
			return 1200 * time.Millisecond
		}
		return 800 * time.Millisecond
	}
	// Dá para ser 1º acima do mínimo? Então a classificação não muda a decisão.
	q := c.QuatroCasas
	minimo := arredondarAcima(*c.Minimo, q)
	if arredondarAbaixo(*e.Melhor-passoMinimo(*e.Melhor, e, q), q) >= minimo || *e.Nosso <= minimo {
		return 0
	}
	perto := c.NaoAguardar || e.Fase != "LA" || e.RestanteSeg == nil || *e.RestanteSeg <= 45
	if !perto {
		return 0
	}
	return 2 * time.Second
}

// pedirClassificacao lê a classificação em segundo plano (no máximo uma vez a cada "intervalo" por item) e reavalia.
func (m *motor) pedirClassificacao(compra string, numero int, k string, intervalo time.Duration) {
	r := m.ranking[k]
	if r == nil {
		r = &classificacaoItem{}
		m.ranking[k] = r
	}
	if r.buscando || time.Since(r.pedidaEm) < intervalo {
		return
	}
	r.buscando, r.pedidaEm = true, time.Now()
	go func() {
		_, _ = m.lerClassificacao(compra, numero)
		m.avaliar(k)
	}()
}

func valorDoLance(o map[string]any) *float64 {
	for _, k := range []string{"valorInformado", "valorCalculado", "valor", "melhorValor", "valorLance", "melhorLance"} {
		if v := valorDe(o[k]); v != nil {
			return v
		}
	}
	return nil
}

// lerClassificacao: melhor lance de cada participante no item (a mesma lista de "melhores lances" da sala).
func (m *motor) lerClassificacao(compra string, numero int) (*classificacaoItem, error) {
	k := chaveItem(compra, numero)
	caminho := fmt.Sprintf("/comprasnet-disputa/v1/compras/%s/itens/%d/lances/por-participante", url.PathEscape(compra), numero)
	r, err := m.consultarDireto("GET", caminho, "tamanhoPagina=100&pagina=0", true, nil, "")
	m.mu.Lock()
	defer m.mu.Unlock()
	ci := m.ranking[k]
	if ci == nil {
		ci = &classificacaoItem{}
		m.ranking[k] = ci
	}
	ci.buscando = false
	if err == nil && !okHTTP(r.Status) {
		err = fmt.Errorf("o Compras.gov.br respondeu %d: %s", r.Status, mensagemErro(r.Corpo))
	}
	if err != nil {
		ci.erro = err.Error()
		registrarLog("robô: classificação do item %d da compra %s: %v", numero, mascararNumeros(compra), err)
		return ci, err
	}
	var nosso *float64
	var melhor *float64
	if c := m.compras[compra]; c != nil {
		if it := c.itens[numero]; it != nil {
			e := lerItem(it.bruto)
			nosso, melhor = e.Nosso, e.Melhor
		}
	}
	todos := []posicaoClassificacao{}
	achouNosso := false
	for _, bruto := range listaQualquer(r.Corpo) {
		var o map[string]any
		if json.Unmarshal(bruto, &o) != nil {
			continue
		}
		if o["excluido"] == true { // lance excluído pelo pregoeiro: não conta
			continue
		}
		v := valorDoLance(o)
		if v == nil {
			continue
		}
		part, _ := o["participante"].(map[string]any)
		ident := soDigitos(textoDe(firstNonNil(o["identificacaoParticipante"], o["identificacao"], func() any {
			if part != nil {
				return part["identificacao"]
			}
			return nil
		}())))
		meu := (m.cnpj != "" && ident == soDigitos(m.cnpj)) || o["proprio"] == true || o["lanceProprio"] == true || o["meuLance"] == true || o["participanteLogado"] == true
		if meu {
			achouNosso = true
		}
		todos = append(todos, posicaoClassificacao{Valor: *v, Nosso: meu})
	}
	// Sem identificação na lista: o nosso é o de valor igual ao nosso lance atual.
	if !achouNosso && nosso != nil {
		for i := range todos {
			if math.Abs(todos[i].Valor-*nosso) < 0.00005 {
				todos[i].Nosso = true
				break
			}
		}
	}
	sort.SliceStable(todos, func(i, j int) bool { return todos[i].Valor < todos[j].Valor })
	conc := []float64{}
	for _, p := range todos {
		if !p.Nosso {
			conc = append(conc, p.Valor)
		}
	}
	ci.todos, ci.concorrentes, ci.em, ci.erro = todos, conc, time.Now(), ""
	if melhor != nil {
		ci.melhor = *melhor
	}
	return ci, nil
}

// Classificacao para o botão "Classificação" da página Disputas (lê na hora).
func (m *motor) Classificacao(compra string, numero int) any {
	ci, err := m.lerClassificacao(compra, numero)
	if err != nil {
		return mapa{"erro": "Não consegui a classificação agora: " + err.Error()}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return mapa{"posicoes": ci.todos, "em": ci.em.UnixMilli()}
}
