package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Consultas ao Compras.gov.br direto do aplicativo, com a sessão (token) que a pessoa abriu no gov.br.
// Antes tudo rodava dentro da página oficial: se ela recarregava, a consulta morria ("Execution context was
// destroyed") e as consultas ficavam numa fila só. Agora a página só é usada para gerar o captcha invisível,
// um por vez e só nas telas que o Compras.gov.br exige (o aplicativo aprende quais são).

var (
	captchaMu      sync.Mutex
	captchaExigido sync.Map // padrão do caminho -> true
	digitos        = regexp.MustCompile(`\d+`)
)

func padraoDoCaminho(caminho string) string { return digitos.ReplaceAllString(caminho, "#") }

// scriptCaptcha pede um código ao captcha invisível da página. Logo depois do login a página da sala ainda está
// carregando o hCaptcha: espera até 6 s ele aparecer (antes devolvia vazio na hora). Se o execute ficar preso,
// desiste em LIMITE ms, reinicia o widget e avisa ("__tempo__"), para a próxima tentativa sair limpa — antes a
// tentativa presa esperava 40 s e todos os captchas (lista, acompanhamento, robô) ficavam na fila atrás dela.
const scriptCaptchaModelo = `(async () => {
  const fim = Date.now() + 6000;
  const pronto = () => (window.hcaptcha && hcaptcha.execute) || (window.grecaptcha && grecaptcha.execute);
  while (!pronto() && Date.now() < fim) await new Promise((r) => setTimeout(r, 100));
  if (!pronto()) return "__sem_captcha__";
  const tempo = new Promise((r) => setTimeout(() => r("__tempo__"), LIMITE));
  try {
    if (window.hcaptcha && hcaptcha.execute) {
      const r = await Promise.race([hcaptcha.execute({ async: true }), tempo]);
      if (r === "__tempo__") { try { hcaptcha.reset(); } catch (e) {} return r; }
      return (r && r.response) || "";
    }
    const r = await Promise.race([grecaptcha.execute(), tempo]);
    return r || "";
  } catch (e) {
    return "__erro__:" + String((e && e.message) || e).slice(0, 80);
  }
})()`

func scriptCaptcha(limite time.Duration) string {
	return strings.Replace(scriptCaptchaModelo, "LIMITE", fmt.Sprint(limite.Milliseconds()), 1)
}

func contextoPerdido(err error) bool {
	if err == nil {
		return false
	}
	t := strings.ToLower(err.Error())
	return strings.Contains(t, "context was destroyed") || strings.Contains(t, "sem resposta") || strings.Contains(t, "cannot find context") || strings.Contains(t, "target closed")
}

// Captchas gerados de antemão nos minutos finais das disputas com robô: a leitura da classificação (que exige
// captcha) sai na hora, sem esperar o hCaptcha da página (que leva de 1 a 3 s). Um código vale ~2 min e uma vez.
type captchaGuardado struct {
	codigo string
	em     time.Time
}

var (
	captchaPoolMu sync.Mutex
	captchaPool   []captchaGuardado
)

const validadeCaptcha = 90 * time.Second

func pegarCaptchaPronto() string {
	captchaPoolMu.Lock()
	defer captchaPoolMu.Unlock()
	for len(captchaPool) > 0 {
		c := captchaPool[0]
		captchaPool = captchaPool[1:]
		if time.Since(c.em) < validadeCaptcha {
			return c.codigo
		}
	}
	return ""
}

// cicloCaptchaPronto mantém 2 captchas prontos enquanto alguma disputa com robô está perto do fim.
func (m *motor) cicloCaptchaPronto() {
	for {
		time.Sleep(700 * time.Millisecond)
		if !m.precisaCaptchaPronto() {
			continue
		}
		captchaPoolMu.Lock()
		vivos := captchaPool[:0]
		for _, c := range captchaPool {
			if time.Since(c.em) < validadeCaptcha {
				vivos = append(vivos, c)
			}
		}
		captchaPool = vivos
		falta := len(captchaPool) < 2
		captchaPoolMu.Unlock()
		if !falta {
			continue
		}
		if codigo, err := m.gerarCaptcha(); err == nil && codigo != "" {
			captchaPoolMu.Lock()
			captchaPool = append(captchaPool, captchaGuardado{codigo, time.Now()})
			captchaPoolMu.Unlock()
		}
	}
}

// captchasProntos: quantos captchas prontos (ainda válidos) há agora.
func captchasProntos() int {
	captchaPoolMu.Lock()
	defer captchaPoolMu.Unlock()
	n := 0
	for _, c := range captchaPool {
		if time.Since(c.em) < validadeCaptcha {
			n++
		}
	}
	return n
}

// captcha: um captcha pronto (se houver) ou um novo, pedido à página oficial.
func (m *motor) captcha() (string, error) {
	if c := pegarCaptchaPronto(); c != "" {
		return c, nil
	}
	return m.gerarCaptcha()
}

// gerarCaptcha pede um código do captcha invisível à página oficial (um por vez).
func (m *motor) gerarCaptcha() (string, error) {
	pediu := time.Now()
	captchaMu.Lock()
	defer captchaMu.Unlock()
	esperou := time.Since(pediu)
	var ultimo error
	for tentativa := 0; tentativa < 3; tentativa++ {
		s := m.p.sessaoLogada(tentativa > 0)
		if s == nil {
			return "", fmt.Errorf("entre no Compras.gov.br para ver isso")
		}
		inicioSala := time.Now()
		if err := m.p.garantirSala(s); err != nil {
			ultimo = err
			marcarRobo("captcha: tentativa %d — sala de disputa não abriu em %d ms: %v", tentativa+1, time.Since(inicioSala).Milliseconds(), err)
			continue
		}
		sala := time.Since(inicioSala)
		inicio := time.Now()
		// O captcha normal sai em 0,2 a 2 s: as duas primeiras tentativas desistem em 5 s; a última espera mais
		// (a página pode estar pedindo um desafio visível).
		limite := 5 * time.Second
		if tentativa == 2 {
			limite = 30 * time.Second
		}
		codigo, err := m.p.avaliar(s.sessao, scriptCaptcha(limite), limite+8*time.Second)
		if err == nil && codigo != "" && !strings.HasPrefix(codigo, "__") {
			// Tempos do captcha (para achar demora): fila, sala de disputa aberta e o captcha em si.
			marcarRobo("captcha pronto em %d ms (fila %d ms, sala %d ms, captcha %d ms, tentativa %d)", time.Since(pediu).Milliseconds(), esperou.Milliseconds(), sala.Milliseconds(), time.Since(inicio).Milliseconds(), tentativa+1)
			if total := time.Since(pediu); total > 2*time.Second {
				registrarLog("captcha: %.1f s (fila %.1f s, sala %.1f s, captcha %.1f s, tentativa %d)", total.Seconds(), esperou.Seconds(), sala.Seconds(), time.Since(inicio).Seconds(), tentativa+1)
			}
			return codigo, nil
		}
		motivo := ""
		switch {
		case err != nil:
			motivo = err.Error()
		case codigo == "__sem_captcha__":
			motivo = "a página ainda não tinha o captcha (carregando)"
		case codigo == "__tempo__":
			motivo = fmt.Sprintf("o captcha da página ficou preso por %d s; reiniciado", int(limite.Seconds()))
		case strings.HasPrefix(codigo, "__erro__:"):
			motivo = "erro do captcha da página: " + strings.TrimPrefix(codigo, "__erro__:")
		default:
			motivo = "o captcha da página não respondeu"
		}
		ultimo = fmt.Errorf("%s", motivo)
		marcarRobo("captcha: tentativa %d falhou em %d ms — %s", tentativa+1, time.Since(inicio).Milliseconds(), motivo)
		registrarLog("captcha: tentativa %d falhou em %.1f s — %s", tentativa+1, time.Since(inicio).Seconds(), mascararNumeros(motivo))
		time.Sleep(time.Duration(300*(tentativa+1)) * time.Millisecond) // a página pode estar recarregando
	}
	return "", fmt.Errorf("não consegui o captcha do Compras.gov.br (%v)", ultimo)
}

type respostaDireta struct {
	Status int
	Corpo  []byte
	Cab    http.Header
}

var clienteLongo = &http.Client{Timeout: 90 * time.Second, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, ForceAttemptHTTP2: true, MaxIdleConnsPerHost: 8, IdleConnTimeout: 5 * time.Minute}}

func (m *motor) requisicao(metodo, caminho, query string, captcha string, corpo []byte, tipo string) (respostaDireta, error) {
	m.mu.Lock()
	token := m.token
	m.mu.Unlock()
	if token == "" {
		return respostaDireta{}, fmt.Errorf("sem sessão no Compras.gov.br")
	}
	endereco := strings.TrimRight(m.p.cfg.Compras, "/") + caminho
	q := query
	if captcha != "" {
		if q != "" {
			q += "&"
		}
		q += "captcha=" + url.QueryEscape(captcha)
	}
	if q != "" {
		endereco += "?" + q
	}
	var leitor io.Reader
	if corpo != nil {
		leitor = bytes.NewReader(corpo)
	}
	req, err := http.NewRequest(metodo, endereco, leitor)
	if err != nil {
		return respostaDireta{}, err
	}
	m.cabecalhos(req, token)
	if tipo != "" {
		req.Header.Set("Content-Type", tipo)
	}
	r, err := clienteLongo.Do(req)
	if err != nil {
		return respostaDireta{}, err
	}
	defer r.Body.Close()
	dados, _ := io.ReadAll(io.LimitReader(r.Body, 40<<20))
	if len(dados) > 0 && !json.Valid(dados) && bytes.Contains(bytes.ToLower(dados), []byte("<html")) {
		// Página HTML no lugar da resposta da API (login, bloqueio): quem chamou usa a página oficial.
		return respostaDireta{}, fmt.Errorf("bloqueado (%d, resposta não-JSON)", r.StatusCode)
	}
	return respostaDireta{Status: r.StatusCode, Corpo: dados, Cab: r.Header}, nil
}

// consultarDireto: tenta sem captcha nas telas que ainda não se sabe se exigem. Se o Compras.gov.br recusar
// (qualquer resposta de erro) ou devolver uma lista vazia suspeita, repete com o captcha da página e anota a
// tela como "exige captcha" quando a segunda tentativa der certo.
func (m *motor) consultarDireto(metodo, caminho, query string, captcha bool, corpo []byte, tipo string) (respostaDireta, error) {
	// Nas telas com captcha o Compras.gov.br responde "ok" e VAZIO quando o captcha falta (visto no diagnóstico
	// real): resposta vazia nessas telas sempre ganha uma segunda tentativa com captcha.
	return m.consultarDiretoOpc(metodo, caminho, query, captcha, corpo, tipo, captcha && metodo == "GET")
}

// respostaVazia: sem conteúdo útil ("", [], {}, null ou um objeto só com listas vazias).
func respostaVazia(corpo []byte) bool {
	t := strings.TrimSpace(string(corpo))
	if t == "" || t == "[]" || t == "{}" || t == "null" {
		return true
	}
	var o map[string]json.RawMessage
	if json.Unmarshal(corpo, &o) != nil {
		return false
	}
	temLista := false
	for _, v := range o {
		x := strings.TrimSpace(string(v))
		if strings.HasPrefix(x, "[") {
			temLista = true
			if x != "[]" {
				return false
			}
		}
	}
	return temLista && len(listaQualquer(corpo)) == 0
}

func (m *motor) consultarDiretoOpc(metodo, caminho, query string, captcha bool, corpo []byte, tipo string, vazioSuspeito bool) (respostaDireta, error) {
	padrao := metodo + " " + padraoDoCaminho(caminho)
	_, exigido := captchaExigido.Load(padrao)
	codigo := ""
	if captcha && exigido {
		c, err := m.captcha()
		if err != nil {
			return respostaDireta{}, err
		}
		codigo = c
	}
	r, err := m.requisicao(metodo, caminho, query, codigo, corpo, tipo)
	if err != nil {
		return r, err
	}
	if captcha && codigo == "" {
		recusou := !okHTTP(r.Status) && r.Status != 404
		vazio := vazioSuspeito && okHTTP(r.Status) && respostaVazia(r.Corpo)
		if recusou || vazio {
			if c, errC := m.captcha(); errC == nil {
				if r2, err2 := m.requisicao(metodo, caminho, query, c, corpo, tipo); err2 == nil {
					if okHTTP(r2.Status) && (recusou || !respostaVazia(r2.Corpo)) {
						captchaExigido.Store(padrao, true)
						registrarLog("compras: %s exige captcha", padrao)
					}
					r, codigo = r2, c
				}
			}
		}
	}
	if r.Status == 401 {
		// Token vencido: o aplicativo renova pela página e tenta uma vez (com captcha novo se precisar).
		if s := m.p.sessaoLogada(true); s != nil {
			m.renovarToken(s)
			if codigo != "" {
				if c, errC := m.captcha(); errC == nil {
					codigo = c
				}
			}
			return m.requisicao(metodo, caminho, query, codigo, corpo, tipo)
		}
	}
	return r, nil
}

func corpoMultipart(a *arquivoEnvio) ([]byte, string, error) {
	bin, err := base64.StdEncoding.DecodeString(a.Base64)
	if err != nil {
		return nil, "", fmt.Errorf("arquivo inválido")
	}
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, a.Nome))
	tipo := a.Tipo
	if tipo == "" {
		tipo = "application/octet-stream"
	}
	h.Set("Content-Type", tipo)
	parte, _ := w.CreatePart(h)
	_, _ = parte.Write(bin)
	_ = w.Close()
	return buf.Bytes(), w.FormDataContentType(), nil
}

// baixarArquivo busca o arquivo apontado pelo Compras.gov.br (armazenamento do governo).
func (m *motor) baixarArquivo(endereco, nome string) (mapa, error) {
	base := strings.TrimRight(m.p.cfg.Compras, "/")
	tentativas := []string{}
	if u, err := url.Parse(endereco); err == nil {
		if u.Host == "" {
			tentativas = append(tentativas, base+u.RequestURI())
		} else {
			if !urlArquivoPermitida(endereco, base) {
				return nil, fmt.Errorf("endereço de arquivo não permitido")
			}
			tentativas = append(tentativas, endereco, base+"/storage-api"+u.RequestURI())
		}
	}
	var ultimo error
	for _, t := range tentativas {
		r, err := clienteLongo.Get(t)
		if err != nil {
			ultimo = err
			continue
		}
		dados, _ := io.ReadAll(io.LimitReader(r.Body, maxArquivo+1))
		r.Body.Close()
		if r.StatusCode != 200 {
			ultimo = fmt.Errorf("o armazenamento respondeu %d", r.StatusCode)
			continue
		}
		if len(dados) > maxArquivo {
			return nil, fmt.Errorf("arquivo maior que 30 MB")
		}
		if nome == "" {
			nome = "arquivo"
			if cd := r.Header.Get("Content-Disposition"); cd != "" {
				if i := strings.Index(strings.ToLower(cd), "filename="); i >= 0 {
					nome = strings.Trim(cd[i+9:], `"; `)
				}
			}
		}
		return mapa{"status": 200, "nome": nome, "tipo": r.Header.Get("Content-Type"), "base64": base64.StdEncoding.EncodeToString(dados)}, nil
	}
	return nil, fmt.Errorf("não consegui baixar o arquivo (%v)", ultimo)
}

// pedidoDireto atende um pedido da plataforma direto do aplicativo.
func (m *motor) pedidoDireto(p pedidoCompras) (mapa, error) {
	if p.URL != "" {
		return m.baixarArquivo(p.URL, "")
	}
	var corpo []byte
	tipo := ""
	if p.Arquivo != nil {
		c, t, err := corpoMultipart(p.Arquivo)
		if err != nil {
			return nil, err
		}
		corpo, tipo = c, t
	} else if len(p.Corpo) > 0 && string(p.Corpo) != "null" {
		corpo, tipo = p.Corpo, "application/json"
	} else if p.Metodo == "PUT" || p.Metodo == "POST" {
		corpo, tipo = []byte{}, "application/json"
	}
	r, err := m.consultarDireto(p.Metodo, p.Caminho, p.Query, p.Captcha, corpo, tipo)
	if err != nil {
		return nil, err
	}
	if p.Baixar && r.Status >= 200 && r.Status < 300 {
		if !json.Valid(r.Corpo) {
			return mapa{"status": 200, "nome": "arquivo", "tipo": r.Cab.Get("Content-Type"), "base64": base64.StdEncoding.EncodeToString(r.Corpo)}, nil
		}
		var info any
		_ = json.Unmarshal(r.Corpo, &info)
		lista, _ := info.([]any)
		if o, ok := info.(map[string]any); ok {
			lista = []any{o}
		}
		for _, x := range lista {
			o, _ := x.(map[string]any)
			nome := textoDe(firstNonNil(o["nomeOriginal"], o["nome"]))
			for _, k := range []string{"conteudo", "arquivo"} {
				if b, ok := o[k].(string); ok && b != "" {
					return mapa{"status": 200, "nome": nome, "tipo": textoDe(firstNonNil(o["tipo"], o["contentType"])), "base64": b}, nil
				}
			}
			if u := textoDe(o["url"]); u != "" {
				return m.baixarArquivo(u, nome)
			}
		}
		return nil, fmt.Errorf("o Compras.gov.br não devolveu o arquivo")
	}
	cab := map[string]string{}
	for _, k := range []string{"page", "page-size", "pages-count", "register-count"} {
		if v := r.Cab.Get(k); v != "" {
			cab[k] = v
		}
	}
	resposta := mapa{"status": r.Status, "cabecalhos": cab}
	if json.Valid(r.Corpo) {
		resposta["dados"] = json.RawMessage(r.Corpo)
	} else {
		resposta["texto"] = string(r.Corpo)
	}
	if r.Status == 401 || r.Status == 403 {
		resposta["mensagem"] = "Sessão do Compras.gov.br expirada ou sem permissão: entre de novo."
	} else if r.Status >= 400 {
		resposta["mensagem"] = mensagemErro(json.RawMessage(r.Corpo))
	}
	return resposta, nil
}

// listaQualquer acha a lista dentro da resposta (a lista ou um objeto com a lista em algum campo).
func listaQualquer(corpo []byte) []json.RawMessage {
	var l []json.RawMessage
	if json.Unmarshal(corpo, &l) == nil {
		return l
	}
	var o map[string]json.RawMessage
	if json.Unmarshal(corpo, &o) != nil {
		return nil
	}
	for _, k := range []string{"content", "itens", "compras", "participacoes", "mensagens", "resultado", "registros", "data", "lista", "elementos"} {
		if v, ok := o[k]; ok {
			if x := listaQualquer(v); len(x) > 0 {
				return x
			}
		}
	}
	for _, v := range o {
		if json.Unmarshal(v, &l) == nil && len(l) > 0 && len(l[0]) > 0 && l[0][0] == '{' {
			return l
		}
	}
	return nil
}

func juntarLista(l []json.RawMessage) json.RawMessage {
	if l == nil {
		l = []json.RawMessage{}
	}
	b, _ := json.Marshal(l)
	return b
}

// buscarListaDireta: compras em disputa (Lei 14.133 e sistema legado), como a sala de disputa pede.
func (m *motor) buscarListaDireta() (json.RawMessage, error) {
	todas := []map[string]any{}
	falhas := 0
	for _, legado := range []bool{false, true} {
		r, err := m.consultarDiretoOpc("GET", "/comprasnet-fase-externa/v1/compras/em-disputa", fmt.Sprintf("legadoAsp=%v&tamanhoPagina=100&pagina=0", legado), true, nil, "", true)
		if err != nil {
			return nil, err
		}
		if !okHTTP(r.Status) {
			falhas++
			registrarLog("robô: lista direta (legado=%v): %d %s", legado, r.Status, mensagemErro(r.Corpo))
			continue
		}
		for _, x := range listaQualquer(r.Corpo) {
			var o map[string]any
			if json.Unmarshal(x, &o) == nil {
				o["legadoAsp"] = legado
				todas = append(todas, o)
			}
		}
	}
	if falhas == 2 {
		return nil, fmt.Errorf("o Compras.gov.br recusou a lista de disputas")
	}
	b, _ := json.Marshal(todas)
	return b, nil
}
