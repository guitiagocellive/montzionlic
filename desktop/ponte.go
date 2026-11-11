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
	Compras    string // ex.: https://cnetmobile.estaleiro.serpro.gov.br
}

func (c configPonte) paginaDisputas() string {
	return strings.TrimRight(c.Compras, "/") + "/comprasnet-web/seguro/fornecedor/disputa"
}

type sessaoAlvo struct {
	tipo   string // "plataforma" ou "compras"
	sessao string
	alvo   string
	url    string
}

type ponte struct {
	cfg       configPonte
	cdp       *clienteCDP
	mu        sync.Mutex
	alvos     map[string]*sessaoAlvo // targetId -> sessão
	ligando   map[string]bool
	pedidos   map[string]bool // requestId da lista de disputas
	lista     json.RawMessage
	listaEm   time.Time
	novaLista chan struct{}
}

var (
	rotaLista   = regexp.MustCompile(`/comprasnet-fase-externa/v1/compras/(em-disputa|participacoes)(\?|$)`)
	chaveValida = regexp.MustCompile(`^[\w.-]{1,80}$`)
)

func novaPonte(cfg configPonte, cdp *clienteCDP) *ponte {
	return &ponte{cfg: cfg, cdp: cdp, alvos: map[string]*sessaoAlvo{}, ligando: map[string]bool{}, pedidos: map[string]bool{}, novaLista: make(chan struct{}, 1)}
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
	}
	return ""
}

// Rodar acompanha as janelas do navegador até ele fechar.
func (p *ponte) Rodar() error {
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
	}()
}

func (p *ponte) prepararSessao(sessao, tipo string) {
	_, _ = p.cdp.Chamar(sessao, "Runtime.enable", nil, 10*time.Second)
	if tipo == "plataforma" {
		if _, err := p.cdp.Chamar(sessao, "Runtime.addBinding", map[string]any{"name": "montzionRobo"}, 10*time.Second); err != nil {
			registrarLog("ponte: não ligou a função do robô: %v", err)
		}
	} else {
		_, _ = p.cdp.Chamar(sessao, "Network.enable", map[string]any{"maxResourceBufferSize": 8 << 20, "maxTotalBufferSize": 32 << 20}, 10*time.Second)
	}
}

func (p *ponte) sessaoCompras() *sessaoAlvo {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, a := range p.alvos {
		if a.tipo == "compras" {
			return a
		}
	}
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
	a := p.sessaoCompras()
	if a == nil {
		return 0, nil, fmt.Errorf("a janela do Compras.gov.br está fechada: clique em Entrar no Compras.gov.br")
	}
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
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

// atender responde um pedido da página Disputas.
func (p *ponte) atender(sessao, payload string) {
	var pedido struct {
		ID        int64   `json:"id"`
		Tipo      string  `json:"tipo"`
		Compra    string  `json:"compra"`
		Item      int     `json:"item"`
		Valor     float64 `json:"valor"`
		Fase      string  `json:"fase"`
		Atualizar bool    `json:"atualizar"`
	}
	if json.Unmarshal([]byte(payload), &pedido) != nil {
		return
	}
	resposta := p.executar(pedido.Tipo, pedido.Compra, pedido.Item, pedido.Valor, pedido.Fase, pedido.Atualizar)
	dados, _ := json.Marshal(resposta)
	script := fmt.Sprintf("window.__montzionRoboResposta && window.__montzionRoboResposta(%d, %s)", pedido.ID, string(dados))
	_, _ = p.cdp.Chamar(sessao, "Runtime.evaluate", map[string]any{"expression": script}, 10*time.Second)
}

type mapa = map[string]any

func (p *ponte) executar(tipo, compra string, item int, valor float64, fase string, atualizar bool) any {
	switch tipo {
	case "estado":
		a := p.sessaoCompras()
		conectado := false
		if a != nil {
			s, err := p.avaliar(a.sessao, `String(!!sessionStorage.getItem("accessToken"))`, 5*time.Second)
			conectado = err == nil && s == "true"
		}
		return mapa{"conectado": conectado, "janela": a != nil, "versao": versao}

	case "entrar":
		if a := p.sessaoCompras(); a != nil {
			_, _ = p.cdp.Chamar("", "Target.activateTarget", mapa{"targetId": a.alvo}, 5*time.Second)
			return mapa{"ok": true}
		}
		if _, err := p.cdp.Chamar("", "Target.createTarget", mapa{"url": p.cfg.paginaDisputas(), "newWindow": true}, 10*time.Second); err != nil {
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
		a := p.sessaoCompras()
		if a == nil {
			return mapa{"erro": "A janela do Compras.gov.br está fechada: clique em Entrar no Compras.gov.br."}
		}
		inicio := time.Now()
		select {
		case <-p.novaLista: // descarta aviso antigo
		default:
		}
		if _, err := p.cdp.Chamar(a.sessao, "Page.navigate", mapa{"url": p.cfg.paginaDisputas()}, 15*time.Second); err != nil {
			return mapa{"erro": "Não foi possível abrir as disputas no Compras.gov.br: " + err.Error()}
		}
		limite := time.After(40 * time.Second)
		for {
			select {
			case <-p.novaLista:
				p.mu.Lock()
				lista, em = p.lista, p.listaEm
				p.mu.Unlock()
				if em.After(inicio) {
					return mapa{"compras": lista, "capturadaEm": em.UnixMilli()}
				}
			case <-limite:
				if lista != nil {
					return mapa{"compras": lista, "capturadaEm": em.UnixMilli()}
				}
				return mapa{"erro": "O Compras.gov.br não mostrou a lista de disputas. Confira se você entrou na conta e tente atualizar."}
			}
		}

	case "itens":
		if !chaveValida.MatchString(compra) {
			return mapa{"erro": "Compra inválida."}
		}
		status, corpo, err := p.api("GET", "/comprasnet-disputa/v1/compras/"+url.PathEscape(compra)+"/itens/em-disputa", nil)
		if err != nil {
			return mapa{"erro": err.Error()}
		}
		if status == 401 || status == 403 {
			return mapa{"erro": "Sessão do Compras.gov.br expirada: entre de novo na janela do Compras.gov.br."}
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
