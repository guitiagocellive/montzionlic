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

const scriptCaptcha = `(async () => {
  try {
    if (window.hcaptcha && hcaptcha.execute) { const r = await hcaptcha.execute({ async: true }); return (r && r.response) || ""; }
    if (window.grecaptcha && grecaptcha.execute) return (await grecaptcha.execute()) || "";
  } catch (e) {}
  return "";
})()`

func contextoPerdido(err error) bool {
	if err == nil {
		return false
	}
	t := strings.ToLower(err.Error())
	return strings.Contains(t, "context was destroyed") || strings.Contains(t, "sem resposta") || strings.Contains(t, "cannot find context") || strings.Contains(t, "target closed")
}

// captcha pede um código do captcha invisível à página oficial (um por vez).
func (m *motor) captcha() (string, error) {
	captchaMu.Lock()
	defer captchaMu.Unlock()
	var ultimo error
	for tentativa := 0; tentativa < 3; tentativa++ {
		s := m.p.sessaoLogada(tentativa > 0)
		if s == nil {
			return "", fmt.Errorf("entre no Compras.gov.br para ver isso")
		}
		if err := m.p.garantirSala(s); err != nil {
			ultimo = err
			continue
		}
		codigo, err := m.p.avaliar(s.sessao, scriptCaptcha, 40*time.Second)
		if err == nil && codigo != "" {
			return codigo, nil
		}
		ultimo = err
		if err == nil {
			ultimo = fmt.Errorf("o captcha da página não respondeu")
		}
		time.Sleep(time.Duration(800*(tentativa+1)) * time.Millisecond) // a página pode estar recarregando
	}
	return "", fmt.Errorf("não consegui o captcha do Compras.gov.br (%v)", ultimo)
}

type respostaDireta struct {
	Status int
	Corpo  []byte
	Cab    http.Header
}

var clienteLongo = &http.Client{Timeout: 90 * time.Second, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, MaxIdleConnsPerHost: 8, IdleConnTimeout: 90 * time.Second}}

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
	if (r.StatusCode == 403 || r.StatusCode == 0) && len(dados) > 0 && !json.Valid(dados) && bytes.Contains(bytes.ToLower(dados), []byte("<html")) {
		return respostaDireta{}, fmt.Errorf("bloqueado (%d)", r.StatusCode)
	}
	return respostaDireta{Status: r.StatusCode, Corpo: dados, Cab: r.Header}, nil
}

func recusouSemCaptcha(r respostaDireta) bool {
	if r.Status != 400 && r.Status != 403 && r.Status != 412 && r.Status != 422 && r.Status != 428 {
		return false
	}
	return bytes.Contains(bytes.ToLower(r.Corpo), []byte("captcha"))
}

// consultarDireto: tenta sem captcha nas telas que ainda não se sabe se exigem; se o Compras.gov.br pedir,
// anota a tela e repete com o captcha da página.
func (m *motor) consultarDireto(metodo, caminho, query string, captcha bool, corpo []byte, tipo string) (respostaDireta, error) {
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
	if codigo == "" && recusouSemCaptcha(r) {
		captchaExigido.Store(padrao, true)
		c, err := m.captcha()
		if err != nil {
			return respostaDireta{}, err
		}
		r, err = m.requisicao(metodo, caminho, query, c, corpo, tipo)
	}
	if r.Status == 401 {
		// Token vencido: o aplicativo renova pela página e tenta uma vez.
		if s := m.p.sessaoLogada(true); s != nil {
			m.renovarToken(s)
			return m.requisicao(metodo, caminho, query, codigo, corpo, tipo)
		}
	}
	return r, err
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
