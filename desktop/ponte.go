package main

// Ponte do robô de lances.
//
// O aplicativo abre o navegador (perfil próprio do Montzion) com a plataforma. Quando a pessoa pede,
// abre também a janela do Compras.gov.br, onde ela mesma entra com o gov.br (certificado ou senha).
// A página Disputas da plataforma chama window.montzionRobo(...) e a ponte:
//   - lê a lista de disputas que a página oficial do Compras.gov.br carrega (ela resolve o captcha sozinha);
//   - pede os itens em disputa e envia lances usando a própria sessão logada daquela janela.
// A senha e o certificado nunca passam pelo Montzion: tudo acontece na janela logada.

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

type configPonte struct {
	Plataforma string // ex.: https://montzion.com.br
	Compras    string // ex.: https://cnetmobile.estaleiro.serpro.gov.br (sala de disputa)
	Login      string // onde o login começa (gov.br de fornecedor)
	Portal     string // portal antigo do Compras.gov.br (Área de Trabalho), ex.: https://www.comprasnet.gov.br
}

func (c configPonte) paginaDisputas() string {
	return strings.TrimRight(c.Compras, "/") + "/comprasnet-web/seguro/fornecedor/disputa"
}

// Onde a pessoa começa: o login de FORNECEDOR do Compras.gov.br. Abrir a sala de disputa direto, sem
// sessão, cai em "Acesso não autorizado", cujo botão leva ao login de governo (e nunca volta para a disputa).
func (c configPonte) paginaLogin() string {
	if c.Login != "" {
		return c.Login
	}
	return c.paginaDisputas()
}

// Página de "sem sessão" da sala de disputa: a ponte manda a janela para o login de fornecedor.
var semSessao = regexp.MustCompile(`/comprasnet-web/(acesso-nao-autorizado|sessao-encerrada)`)

type sessaoAlvo struct {
	tipo   string // "plataforma" ou "compras"
	sessao string
	alvo   string
	url    string
}

type ponte struct {
	cfg        configPonte
	cdp        *clienteCDP
	mu         sync.Mutex
	alvos      map[string]*sessaoAlvo // targetId -> sessão
	ligando    map[string]bool
	pedidos    map[string]bool // requestId da lista de disputas
	lista      json.RawMessage
	listaEm    time.Time
	novaLista  chan struct{}
	logada     string               // targetId da janela com a sessão da sala de disputa (o token fica em cada aba)
	tentouSala map[string]time.Time // portal -> última vez que a ponte tentou abrir a sala de disputa
	tentativas map[string]int       // portal -> quantas vezes tentou (no máximo 2, para não abrir janelas sem parar)
	menuVisto  map[string]bool      // endereços do portal cujo menu já foi anotado no registro
	// Janela própria do aplicativo: abre/foca a janela nativa do Compras.gov.br (nil = aba do navegador).
	abrirCompras func() bool
	// Esconde a janela do Compras.gov.br depois do login (nil = não dá para esconder).
	esconderCompras func()
	estavaLogado    bool // para esconder a janela só na hora em que o login acontece
	motor           *motor
}

var (
	rotaLista   = regexp.MustCompile(`/comprasnet-fase-externa/v1/compras/(em-disputa|participacoes)(\?|$)`)
	chaveValida = regexp.MustCompile(`^[\w.-]{1,80}$`)
)

func novaPonte(cfg configPonte, cdp *clienteCDP) *ponte {
	p := &ponte{cfg: cfg, cdp: cdp, alvos: map[string]*sessaoAlvo{}, ligando: map[string]bool{}, pedidos: map[string]bool{}, novaLista: make(chan struct{}, 1), tentouSala: map[string]time.Time{}, tentativas: map[string]int{}, menuVisto: map[string]bool{}}
	p.motor = novoMotor(p)
	return p
}

func mesmoSite(endereco, base string) bool {
	u, err := url.Parse(endereco)
	b, err2 := url.Parse(base)
	if err != nil || err2 != nil || u.Host == "" {
		return false
	}
	h := strings.TrimPrefix(u.Host, "www.")
	return strings.EqualFold(h, strings.TrimPrefix(b.Host, "www.")) && (u.Scheme == b.Scheme || b.Scheme == "")
}

func (p *ponte) tipoDe(endereco string) string {
	switch {
	case mesmoSite(endereco, p.cfg.Plataforma):
		return "plataforma"
	case mesmoSite(endereco, p.cfg.Compras):
		return "compras"
	case p.cfg.Portal != "" && mesmoSite(endereco, p.cfg.Portal):
		return "portal"
	case p.cfg.Login != "" && mesmoSite(endereco, p.cfg.Login):
		if p.cfg.Portal == "" {
			return "portal" // (testes) login e portal no mesmo endereço
		}
		return "login"
	}
	return ""
}

// Rodar acompanha as janelas do navegador até ele fechar.
func (p *ponte) Rodar() error {
	p.motor.Rodar()
	if _, err := p.cdp.Chamar("", "Target.setDiscoverTargets", map[string]any{"discover": true}, 10*time.Second); err != nil {
		return err
	}
	if r, err := p.cdp.Chamar("", "Target.getTargets", nil, 10*time.Second); err == nil {
		var v struct {
			TargetInfos []infoAlvo `json:"targetInfos"`
		}
		_ = json.Unmarshal(r, &v)
		for _, t := range v.TargetInfos {
			p.verAlvo(t)
		}
	}
	for {
		select {
		case <-p.cdp.Fechado:
			return nil
		case m := <-p.cdp.Eventos:
			p.tratarEvento(m)
		}
	}
}

type infoAlvo struct {
	TargetID string `json:"targetId"`
	Type     string `json:"type"`
	URL      string `json:"url"`
}

func (p *ponte) verAlvo(t infoAlvo) {
	if t.Type != "page" {
		return
	}
	tipo := p.tipoDe(t.URL)
	p.mu.Lock()
	atual := p.alvos[t.TargetID]
	if atual != nil && tipo == "compras" && semSessao.MatchString(t.URL) && p.cfg.Login != "" && atual.url != t.URL {
		go p.irParaLogin(atual.sessao)
	}
	if atual != nil {
		atual.url = t.URL
		if tipo != "" && atual.tipo != tipo {
			atual.tipo = tipo
			sessao := atual.sessao
			p.mu.Unlock()
			go p.prepararSessao(sessao, tipo)
			return
		}
		p.mu.Unlock()
		return
	}
	if tipo == "" || p.ligando[t.TargetID] {
		p.mu.Unlock()
		return
	}
	p.ligando[t.TargetID] = true
	p.mu.Unlock()
	go func() {
		defer func() {
			p.mu.Lock()
			delete(p.ligando, t.TargetID)
			p.mu.Unlock()
		}()
		r, err := p.cdp.Chamar("", "Target.attachToTarget", map[string]any{"targetId": t.TargetID, "flatten": true}, 10*time.Second)
		if err != nil {
			registrarLog("ponte: não conectou na janela %s: %v", t.URL, err)
			return
		}
		var v struct {
			SessionID string `json:"sessionId"`
		}
		_ = json.Unmarshal(r, &v)
		p.mu.Lock()
		p.alvos[t.TargetID] = &sessaoAlvo{tipo: tipo, sessao: v.SessionID, alvo: t.TargetID, url: t.URL}
		p.mu.Unlock()
		p.prepararSessao(v.SessionID, tipo)
		if tipo == "compras" && semSessao.MatchString(t.URL) && p.cfg.Login != "" {
			p.irParaLogin(v.SessionID)
		}
	}()
}

func (p *ponte) prepararSessao(sessao, tipo string) {
	_, _ = p.cdp.Chamar(sessao, "Runtime.enable", nil, 10*time.Second)
	if tipo == "plataforma" {
		if _, err := p.cdp.Chamar(sessao, "Runtime.addBinding", map[string]any{"name": "montzionRobo"}, 10*time.Second); err != nil {
			registrarLog("ponte: não ligou a função do robô: %v", err)
		}
	} else if tipo == "compras" {
		_, _ = p.cdp.Chamar(sessao, "Network.enable", map[string]any{"maxResourceBufferSize": 8 << 20, "maxTotalBufferSize": 32 << 20}, 10*time.Second)
	}
}

// Leva a janela sem sessão para o login de fornecedor (em vez do login de governo da página oficial).
func (p *ponte) irParaLogin(sessao string) {
	registrarLog("ponte: sala de disputa sem sessão; abrindo o login de fornecedor")
	_, _ = p.cdp.Chamar(sessao, "Page.navigate", mapa{"url": p.cfg.paginaLogin()}, 10*time.Second)
}

// Janelas do Compras.gov.br abertas (sala de disputa e portal de login).
func (p *ponte) janelasCompras(tipos ...string) []*sessaoAlvo {
	p.mu.Lock()
	defer p.mu.Unlock()
	var lista []*sessaoAlvo
	for _, a := range p.alvos {
		for _, t := range tipos {
			if a.tipo == t {
				lista = append(lista, a)
			}
		}
	}
	return lista
}

func (p *ponte) temToken(a *sessaoAlvo) bool {
	s, err := p.avaliar(a.sessao, `String(!!sessionStorage.getItem("accessToken"))`, 3*time.Second)
	return err == nil && s == "true"
}

// sessaoLogada acha a janela (ou aba/pop-up) onde a pessoa está logada na sala de disputa. O login do
// Compras.gov.br costuma abrir a área do fornecedor em outra janela, e o token só vale naquela aba.
// Com verificar=false usa a última janela achada sem conferir de novo (mais rápido para os lances).
func (p *ponte) sessaoLogada(verificar bool) *sessaoAlvo {
	p.mu.Lock()
	guardada := p.alvos[p.logada]
	p.mu.Unlock()
	if guardada != nil && (!verificar || p.temToken(guardada)) {
		return guardada
	}
	for _, a := range p.janelasCompras("compras") {
		if a != guardada && p.temToken(a) {
			p.mu.Lock()
			if p.logada != a.alvo {
				registrarLog("ponte: sessão da sala de disputa encontrada em %s", a.url)
			}
			p.logada = a.alvo
			esconder := !p.estavaLogado && p.esconderCompras != nil
			p.estavaLogado = true
			p.mu.Unlock()
			if esconder {
				// Login feito: a janela do Compras.gov.br sai da tela e o robô segue com ela escondida.
				p.esconderCompras()
				registrarLog("ponte: login feito; janela do Compras.gov.br escondida")
			}
			return a
		}
	}
	p.mu.Lock()
	p.logada = ""
	p.estavaLogado = false
	p.mu.Unlock()
	return nil
}

func (p *ponte) tratarEvento(m mensagemCDP) {
	switch m.Method {
	case "Target.targetCreated", "Target.targetInfoChanged":
		var v struct {
			TargetInfo infoAlvo `json:"targetInfo"`
		}
		if json.Unmarshal(m.Params, &v) == nil {
			p.verAlvo(v.TargetInfo)
		}
	case "Target.targetDestroyed", "Target.detachedFromTarget":
		var v struct {
			TargetID string `json:"targetId"`
		}
		if json.Unmarshal(m.Params, &v) == nil && v.TargetID != "" {
			p.mu.Lock()
			delete(p.alvos, v.TargetID)
			p.mu.Unlock()
		}
	case "Runtime.bindingCalled":
		var v struct {
			Name    string `json:"name"`
			Payload string `json:"payload"`
		}
		if json.Unmarshal(m.Params, &v) == nil && v.Name == "montzionRobo" {
			go p.atender(m.SessionID, v.Payload)
		}
	case "Network.requestWillBeSent":
		var v struct {
			Request struct {
				Headers map[string]any `json:"headers"`
			} `json:"request"`
		}
		if json.Unmarshal(m.Params, &v) == nil {
			versao, plataforma := textoDe(v.Request.Headers["X-Version-Number"]), textoDe(v.Request.Headers["X-Device-Platform"])
			if versao != "" || plataforma != "" {
				p.motor.mu.Lock()
				if versao != "" {
					p.motor.versaoSistema = versao
				}
				if plataforma != "" {
					p.motor.plataforma = plataforma
				}
				p.motor.mu.Unlock()
			}
		}
	case "Network.responseReceived":
		var v struct {
			RequestID string `json:"requestId"`
			Response  struct {
				URL    string `json:"url"`
				Status int    `json:"status"`
			} `json:"response"`
		}
		if json.Unmarshal(m.Params, &v) == nil && v.Response.Status == 200 && rotaLista.MatchString(v.Response.URL) {
			p.mu.Lock()
			p.pedidos[v.RequestID] = true
			p.mu.Unlock()
		}
	case "Network.loadingFinished":
		var v struct {
			RequestID string `json:"requestId"`
		}
		if json.Unmarshal(m.Params, &v) != nil {
			return
		}
		p.mu.Lock()
		ok := p.pedidos[v.RequestID]
		delete(p.pedidos, v.RequestID)
		p.mu.Unlock()
		if ok {
			go p.guardarLista(m.SessionID, v.RequestID)
		}
	}
}

func (p *ponte) guardarLista(sessao, pedido string) {
	r, err := p.cdp.Chamar(sessao, "Network.getResponseBody", map[string]any{"requestId": pedido}, 10*time.Second)
	if err != nil {
		return
	}
	var v struct {
		Body          string `json:"body"`
		Base64Encoded bool   `json:"base64Encoded"`
	}
	if json.Unmarshal(r, &v) != nil {
		return
	}
	corpo := []byte(v.Body)
	if v.Base64Encoded {
		if d, err := base64.StdEncoding.DecodeString(v.Body); err == nil {
			corpo = d
		}
	}
	if !json.Valid(corpo) {
		return
	}
	p.mu.Lock()
	p.lista = corpo
	p.listaEm = time.Now()
	p.mu.Unlock()
	select {
	case p.novaLista <- struct{}{}:
	default:
	}
}

// Executa um script na janela do Compras.gov.br e devolve o texto que ele retornar.
func (p *ponte) avaliar(sessao, script string, espera time.Duration) (string, error) {
	r, err := p.cdp.Chamar(sessao, "Runtime.evaluate", map[string]any{"expression": script, "awaitPromise": true, "returnByValue": true}, espera)
	if err != nil {
		return "", err
	}
	var v struct {
		Result struct {
			Value any `json:"value"`
		} `json:"result"`
		ExceptionDetails *struct {
			Text string `json:"text"`
		} `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(r, &v); err != nil {
		return "", err
	}
	if v.ExceptionDetails != nil {
		return "", fmt.Errorf("erro na janela do Compras.gov.br: %s", v.ExceptionDetails.Text)
	}
	s, _ := v.Result.Value.(string)
	return s, nil
}

func jsTexto(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// Chamada à API da sala de disputa com a sessão logada (o token fica na própria página oficial).
func (p *ponte) api(metodo, caminho string, corpo any) (int, json.RawMessage, error) {
	a := p.sessaoLogada(false)
	if a == nil {
		return 0, nil, fmt.Errorf("você ainda não entrou na sala de disputa do Compras.gov.br: clique em Entrar no Compras.gov.br")
	}
	status, resposta, err := p.apiEm(a, metodo, caminho, corpo)
	if err == nil && status == 401 {
		// A sessão pode ter passado para outra aba (novo login): procura de novo e tenta uma vez.
		if b := p.sessaoLogada(true); b != nil && b != a {
			return p.apiEm(b, metodo, caminho, corpo)
		}
	}
	return status, resposta, err
}

func (p *ponte) apiEm(a *sessaoAlvo, metodo, caminho string, corpo any) (int, json.RawMessage, error) {
	corpoJS := "undefined"
	if corpo != nil {
		b, _ := json.Marshal(corpo)
		corpoJS = jsTexto(string(b))
	}
	script := fmt.Sprintf(`(async () => {
  const token = sessionStorage.getItem("accessToken");
  if (!token) return JSON.stringify({ status: 401, corpo: "" });
  const r = await fetch(%s, { method: %s, headers: { "Authorization": "Bearer " + token, "Accept": "application/json", "Content-Type": "application/json", "X-Device-Platform": "WEB" }, body: %s });
  return JSON.stringify({ status: r.status, corpo: await r.text() });
})()`, jsTexto(caminho), jsTexto(metodo), corpoJS)
	saida, err := p.avaliar(a.sessao, script, 15*time.Second)
	if err != nil {
		return 0, nil, err
	}
	var v struct {
		Status int    `json:"status"`
		Corpo  string `json:"corpo"`
	}
	if err := json.Unmarshal([]byte(saida), &v); err != nil {
		return 0, nil, fmt.Errorf("resposta estranha do Compras.gov.br")
	}
	return v.Status, json.RawMessage(v.Corpo), nil
}

func mensagemErro(corpo json.RawMessage) string {
	var v map[string]any
	if json.Unmarshal(corpo, &v) == nil {
		for _, k := range []string{"message", "mensagem", "erro", "detail", "error"} {
			if s, ok := v[k].(string); ok && s != "" {
				return s
			}
		}
		if lista, ok := v["errors"].([]any); ok && len(lista) > 0 {
			if e, ok := lista[0].(map[string]any); ok {
				if s, ok := e["message"].(string); ok {
					return s
				}
			}
		}
	}
	s := strings.TrimSpace(string(corpo))
	if strings.HasPrefix(s, "<") { // página HTML de erro: fica só o texto
		s = strings.Join(strings.Fields(regexp.MustCompile(`<[^>]*>`).ReplaceAllString(s, " ")), " ")
	}
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

// atender responde um pedido da página Disputas.
func (p *ponte) atender(sessao, payload string) {
	var pedido struct {
		ID        int64                 `json:"id"`
		Tipo      string                `json:"tipo"`
		Compra    string                `json:"compra"`
		Item      int                   `json:"item"`
		Valor     float64               `json:"valor"`
		Fase      string                `json:"fase"`
		Atualizar bool                  `json:"atualizar"`
		Config    map[string]configItem `json:"config"`
		IDs       []int64               `json:"ids"`
	}
	if json.Unmarshal([]byte(payload), &pedido) != nil {
		return
	}
	var resposta any
	switch pedido.Tipo {
	case "painel":
		resposta = p.motor.Painel()
	case "configurar":
		p.motor.Configurar(pedido.Config)
		resposta = mapa{"ok": true}
	case "confirmar":
		p.motor.ConfirmarLances(pedido.IDs)
		resposta = mapa{"ok": true}
	case "atualizar":
		go p.motor.atualizarLista()
		resposta = mapa{"ok": true}
	default:
		resposta = p.executar(pedido.Tipo, pedido.Compra, pedido.Item, pedido.Valor, pedido.Fase, pedido.Atualizar)
	}
	dados, _ := json.Marshal(resposta)
	script := fmt.Sprintf("window.__montzionRoboResposta && window.__montzionRoboResposta(%d, %s)", pedido.ID, string(dados))
	_, _ = p.cdp.Chamar(sessao, "Runtime.evaluate", map[string]any{"expression": script}, 10*time.Second)
}

type mapa = map[string]any

func (p *ponte) executar(tipo, compra string, item int, valor float64, fase string, atualizar bool) any {
	switch tipo {
	case "estado":
		conectado := p.sessaoLogada(true) != nil
		janela := len(p.janelasCompras("compras", "portal")) > 0
		p.motor.mu.Lock()
		fase, aviso := p.motor.fase, p.motor.aviso
		p.motor.mu.Unlock()
		return mapa{"conectado": conectado, "janela": janela, "portal": fase == "entrando", "fase": fase, "aviso": aviso, "versao": versao, "motor": true}

	case "entrar":
		p.motor.mu.Lock()
		logado := p.motor.token != ""
		p.motor.mu.Unlock()
		if logado && !atualizar {
			return mapa{"ok": true, "jaLogado": true}
		}
		if p.abrirCompras != nil {
			if !p.abrirCompras() {
				return mapa{"erro": "Não foi possível abrir a janela do Compras.gov.br."}
			}
			return mapa{"ok": true}
		}
		a := p.sessaoLogada(true)
		if a == nil {
			if lista := p.janelasCompras("compras", "portal"); len(lista) > 0 {
				a = lista[0]
			}
		}
		if a != nil {
			_, _ = p.cdp.Chamar("", "Target.activateTarget", mapa{"targetId": a.alvo}, 5*time.Second)
			return mapa{"ok": true}
		}
		if _, err := p.cdp.Chamar("", "Target.createTarget", mapa{"url": p.cfg.paginaLogin(), "newWindow": true}, 10*time.Second); err != nil {
			return mapa{"erro": "Não foi possível abrir a janela do Compras.gov.br: " + err.Error()}
		}
		return mapa{"ok": true}

	case "compras":
		p.mu.Lock()
		lista, em := p.lista, p.listaEm
		p.mu.Unlock()
		if !atualizar && lista != nil && time.Since(em) < 2*time.Minute {
			return mapa{"compras": lista, "capturadaEm": em.UnixMilli()}
		}
		a := p.sessaoLogada(true)
		if a == nil {
			return mapa{"erro": "Você ainda não entrou na sala de disputa do Compras.gov.br: clique em Entrar no Compras.gov.br."}
		}
		lista, err := p.buscarLista(a)
		if err != nil {
			registrarLog("ponte: lista de disputas: %v", err)
			return mapa{"erro": err.Error()}
		}
		p.mu.Lock()
		p.lista, p.listaEm = lista, time.Now()
		em = p.listaEm
		p.mu.Unlock()
		return mapa{"compras": lista, "capturadaEm": em.UnixMilli()}

	case "itens":
		if !chaveValida.MatchString(compra) {
			return mapa{"erro": "Compra inválida."}
		}
		status, corpo, err := p.api("GET", "/comprasnet-disputa/v1/compras/"+url.PathEscape(compra)+"/itens/em-disputa", nil)
		if err != nil {
			return mapa{"erro": err.Error()}
		}
		if status == 401 || status == 403 {
			return mapa{"erro": "Sessão do Compras.gov.br expirada: clique em Entrar no Compras.gov.br."}
		}
		if status == 429 {
			return mapa{"erro": "O Compras.gov.br pediu para ir mais devagar (muitas consultas seguidas). Tentando de novo em instantes.", "devagar": true}
		}
		if status != 200 {
			return mapa{"erro": fmt.Sprintf("O Compras.gov.br respondeu %d: %s", status, mensagemErro(corpo))}
		}
		if !json.Valid(corpo) {
			return mapa{"erro": "Resposta inválida do Compras.gov.br."}
		}
		return corpo

	case "lance":
		if !chaveValida.MatchString(compra) || item <= 0 || !(valor > 0) || len(fase) > 4 {
			return mapa{"erro": "Lance inválido."}
		}
		status, corpo, err := p.api("POST", fmt.Sprintf("/comprasnet-disputa/v1/compras/%s/itens/%d/lances", url.PathEscape(compra), item), mapa{"valorInformado": valor, "faseItem": fase})
		if err != nil {
			return mapa{"erro": err.Error()}
		}
		registrarLog("lance compra %s item %d valor %.4f -> %d", compra, item, valor, status)
		ok := status >= 200 && status < 300
		resposta := mapa{"ok": ok, "status": status}
		if !ok {
			resposta["mensagem"] = mensagemErro(corpo)
		}
		return resposta
	}
	return mapa{"erro": "Pedido desconhecido: " + tipo}
}

// ---------- da Área de Trabalho do Fornecedor para a sala de disputa ----------

var paginaDeLogin = regexp.MustCompile(`(?i)/seguro/loginPortal|acesso\.gov\.br`)

// Lê os itens do menu da Área de Trabalho (o menu é montado em listas JavaScript "MenuN" nos quadros da
// página) e os links da página. Guarda em window.__montzionSala uma função para abrir cada um.
const scriptMenuPortal = `(() => {
  const itens = [], acoes = [];
  const add = (texto, link, f) => { itens.push({ texto: String(texto || "").replace(/\s+/g, " ").trim().slice(0, 90), link: String(link || "").slice(0, 300) }); acoes.push(f); };
  const visitar = (w, prof) => {
    let d;
    try { d = w.document; void d.body; } catch (e) { return; }
    try {
      for (const k of Object.keys(w)) {
        if (!/^Menu\d+(_\d+)*$/.test(k)) continue;
        const m = w[k];
        if (!m || typeof m.length !== "number") continue;
        const link = String(m[1] || "").trim();
        if (!link) continue;
        add(m[0], link, () => {
          if (/^javascript:/i.test(link)) { w.eval(link.slice(11)); return; }
          w.open(new URL(link, w.location.href).href, "_blank");
        });
      }
    } catch (e) {}
    try {
      for (const el of d.querySelectorAll("a[href], [onclick]")) {
        const link = el.getAttribute("href") || el.getAttribute("onclick") || "";
        add(el.innerText || el.title || el.value, link, () => el.click());
      }
    } catch (e) {}
    if (prof < 4) for (let i = 0; i < w.frames.length; i++) visitar(w.frames[i], prof + 1);
  };
  visitar(window, 0);
  window.__montzionSala = acoes;
  return JSON.stringify({ url: location.href, itens });
})()`

type itemMenu struct {
	Texto string `json:"texto"`
	Link  string `json:"link"`
}

// Nota de quanto um item do menu parece levar à sala de disputa (o sistema novo, cnetmobile).
func notaSala(it itemMenu) int {
	t, l := strings.ToLower(it.Texto), strings.ToLower(it.Link)
	if strings.Contains(l, "logout") || strings.Contains(l, "sair") || t == "sair" || strings.HasPrefix(l, "mailto:") {
		return -10
	}
	n := 0
	if strings.Contains(l, "comprasnet-web") || strings.Contains(l, "cnetmobile") {
		n += 4
	}
	if strings.Contains(t, "disputa") || strings.Contains(l, "disputa") {
		n += 3
	}
	for _, k := range []string{"acompanh", "proposta", "lance", "sele\u00e7\u00e3o do fornecedor", "selecao"} {
		if strings.Contains(t, k) {
			n++
		}
	}
	return n
}

// abrirSalaPeloPortal: a pessoa já entrou na Área de Trabalho do Fornecedor (portal antigo), mas a sala
// de disputa é outro sistema e só ganha sessão quando aberta pelo menu dela. A ponte procura o item certo
// e abre sozinha. Devolve true se há uma Área de Trabalho logada aberta.
func (p *ponte) abrirSalaPeloPortal() bool {
	logado := false
	for _, a := range p.janelasCompras("portal") {
		if paginaDeLogin.MatchString(a.url) {
			continue
		}
		logado = true
		p.mu.Lock()
		ultima, vezes := p.tentouSala[a.alvo], p.tentativas[a.alvo]
		p.mu.Unlock()
		if time.Since(ultima) < 30*time.Second || vezes >= 2 {
			continue
		}
		saida, err := p.avaliar(a.sessao, scriptMenuPortal, 5*time.Second)
		if err != nil {
			continue
		}
		var v struct {
			URL   string     `json:"url"`
			Itens []itemMenu `json:"itens"`
		}
		if json.Unmarshal([]byte(saida), &v) != nil {
			continue
		}
		melhor, nota := -1, 2
		for i, it := range v.Itens {
			if n := notaSala(it); n > nota {
				melhor, nota = i, n
			}
		}
		p.mu.Lock()
		visto := p.menuVisto[v.URL]
		p.menuVisto[v.URL] = true
		p.mu.Unlock()
		if !visto {
			var linhas []string
			for i, it := range v.Itens {
				if i >= 120 {
					break
				}
				linhas = append(linhas, it.Texto+" -> "+it.Link)
			}
			registrarLog("ponte: área do fornecedor em %s; itens do menu: %s", v.URL, strings.Join(linhas, " | "))
		}
		if melhor < 0 {
			continue
		}
		p.mu.Lock()
		p.tentouSala[a.alvo] = time.Now()
		p.tentativas[a.alvo]++
		p.mu.Unlock()
		registrarLog("ponte: abrindo a sala de disputa pelo menu: %s -> %s", v.Itens[melhor].Texto, v.Itens[melhor].Link)
		_, _ = p.avaliar(a.sessao, fmt.Sprintf("(window.__montzionSala && window.__montzionSala[%d] && window.__montzionSala[%d](), 'ok')", melhor, melhor), 5*time.Second)
	}
	return logado
}

// ---------- lista de disputas ----------

// Pede a lista "compras em que estou participando" como a própria sala de disputa faz (ela só pede quando
// alguém abre o painel "Demais compras"): com o captcha invisível da página (hCaptcha ou reCAPTCHA), uma
// vez para as compras novas (Lei 14.133) e outra para as do sistema legado.
const scriptLista = `(async () => {
  const token = sessionStorage.getItem("accessToken");
  if (!token) return JSON.stringify({ erro: "sem sessão" });
  const captcha = async () => {
    try {
      if (window.hcaptcha && hcaptcha.execute) { const r = await hcaptcha.execute({ async: true }); return (r && r.response) || ""; }
      if (window.grecaptcha && grecaptcha.execute) return (await grecaptcha.execute()) || "";
    } catch (e) { return ""; }
    return "";
  };
  const todas = [], erros = [];
  for (const legado of [false, true]) {
    const c = await captcha();
    const r = await fetch("/comprasnet-fase-externa/v1/compras/em-disputa?captcha=" + encodeURIComponent(c) + "&legadoAsp=" + legado + "&tamanhoPagina=100&pagina=0", {
      headers: { "Authorization": "Bearer " + token, "Accept": "application/json", "X-Device-Platform": "WEB" },
    });
    const texto = await r.text();
    if (!r.ok) { erros.push(r.status + " " + texto.slice(0, 200)); continue; }
    try {
      const d = JSON.parse(texto);
      const lista = Array.isArray(d) ? d : (d && (d.content || d.itens || d.compras || d.data)) || [];
      for (const x of lista) todas.push(Object.assign({ legadoAsp: legado }, x));
    } catch (e) { erros.push("resposta inválida"); }
  }
  return JSON.stringify({ compras: todas, erros, captcha: !!(window.hcaptcha || window.grecaptcha) });
})()`

func (p *ponte) buscarLista(a *sessaoAlvo) (json.RawMessage, error) {
	// O captcha só existe nas páginas da sala de disputa: se a aba logada estiver em outra, abre a sala.
	if s, _ := p.avaliar(a.sessao, `String(!!(window.hcaptcha || window.grecaptcha) && location.pathname.includes("/seguro/fornecedor"))`, 3*time.Second); s != "true" {
		if _, err := p.cdp.Chamar(a.sessao, "Page.navigate", mapa{"url": p.cfg.paginaDisputas()}, 15*time.Second); err != nil {
			return nil, fmt.Errorf("não foi possível abrir a sala de disputa: %v", err)
		}
		limite := time.Now().Add(20 * time.Second)
		for time.Now().Before(limite) {
			time.Sleep(500 * time.Millisecond)
			if s, _ := p.avaliar(a.sessao, `String(document.readyState === "complete" && !!(window.hcaptcha || window.grecaptcha))`, 2*time.Second); s == "true" {
				break
			}
		}
		time.Sleep(time.Second) // o widget invisível termina de montar
	}
	var ultimoErro string
	for tentativa := 0; tentativa < 2; tentativa++ {
		saida, err := p.avaliar(a.sessao, scriptLista, 90*time.Second)
		if err != nil {
			ultimoErro = err.Error()
			continue
		}
		var v struct {
			Compras json.RawMessage `json:"compras"`
			Erros   []string        `json:"erros"`
			Erro    string          `json:"erro"`
		}
		if json.Unmarshal([]byte(saida), &v) != nil {
			ultimoErro = "resposta estranha da sala de disputa"
			continue
		}
		if v.Erro != "" {
			return nil, fmt.Errorf("sessão do Compras.gov.br expirada: entre de novo")
		}
		if len(v.Erros) > 0 {
			registrarLog("ponte: lista de disputas com erro: %s", strings.Join(v.Erros, " | "))
		}
		if len(v.Erros) < 2 && v.Compras != nil {
			return v.Compras, nil
		}
		ultimoErro = strings.Join(v.Erros, " | ")
		time.Sleep(time.Second)
	}
	// Pode ser um desafio do captcha: mostra a janela do Compras.gov.br para a pessoa resolver.
	if p.abrirCompras != nil {
		p.abrirCompras()
	}
	return nil, fmt.Errorf("o Compras.gov.br não devolveu a lista de disputas (%s). Se aparecer um desafio do captcha na janela do Compras.gov.br, resolva e clique em atualizar", ultimoErro)
}
