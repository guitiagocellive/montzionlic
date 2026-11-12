package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Acesso às telas do fornecedor no Compras.gov.br a partir da plataforma (aba Acompanhamento → item):
// propostas de todas as empresas, anexos, lances, chat do item, diligências e fase recursal, e as ações do
// fornecedor (enviar anexo, intenção de recurso, recurso, contrarrazão). Tudo pela sessão que a própria pessoa
// abriu no gov.br, dentro da página oficial (com o captcha invisível dela), como se ela clicasse nas telas.
//
// Só passam os endereços desta lista fechada (nada de órgão/pregoeiro) e há limite de leituras por minuto.

const (
	ce  = `^/comprasnet-fase-externa(?:/public)?`
	cmp = `/compras/\d{17}`
	it  = `/itens/\d{1,5}`
	id  = `[\w-][\w.-]{0,39}`
)

var leiturasPermitidas = []*regexp.Regexp{
	regexp.MustCompile(ce + `/v1` + cmp + it + `/(?:propostas|propostas-iniciais)$`),
	regexp.MustCompile(ce + `/v1` + cmp + it + `/participacoes/` + id + `/(?:anexos|diligencias|diligencias/` + id + `)$`),
	regexp.MustCompile(ce + `/v2` + cmp + it + `/participacoes/` + id + `/anexos/` + id + `$`),
	regexp.MustCompile(ce + `/v2` + cmp + it + `/participacoes/` + id + `/diligencias/anexos-(?:governo|participante)/` + id + `$`),
	regexp.MustCompile(ce + `/v1` + cmp + it + `/participacao/` + id + `/anexos$`),
	regexp.MustCompile(ce + `/v2` + cmp + it + `/participacao/` + id + `/anexos/` + id + `$`),
	regexp.MustCompile(ce + `/v1` + cmp + it + `/fase-recursal(?:-fornecedor)?/\d{1,4}$`),
	regexp.MustCompile(ce + `/v1` + cmp + it + `/fase-recursal/\d{1,4}/recursos/` + id + `$`),
	regexp.MustCompile(ce + `/v2` + cmp + it + `/fase-recursal/\d{1,4}(?:/recursos/` + id + `(?:/contrarrazoes/` + id + `)?)?/arquivos$`),
	regexp.MustCompile(ce + `/v2` + cmp + it + `/relatorio-diligencias$`),
	regexp.MustCompile(`^/comprasnet-mensagem/v2/chat/\d{17}/itens/\d{1,5}$`),
	regexp.MustCompile(`^/comprasnet-disputa/v1` + cmp + it + `/lances(?:/por-participante)?$`),
}

// Ações do fornecedor (cada uma confirmada pela pessoa na plataforma antes de vir para cá).
var acoesPermitidas = map[string][]*regexp.Regexp{
	"POST": {
		regexp.MustCompile(`^/comprasnet-fase-externa/v1` + cmp + it + `/participacao/` + id + `/anexos$`),
		regexp.MustCompile(`^/comprasnet-fase-externa/v1` + cmp + it + `/participacoes/` + id + `/diligencias/anexos-participante$`),
		regexp.MustCompile(`^/comprasnet-fase-externa/v1` + cmp + it + `/intencoes-recurso$`),
		regexp.MustCompile(`^/comprasnet-fase-externa/v1` + cmp + it + `/recursos$`),
		regexp.MustCompile(`^/comprasnet-fase-externa/v1` + cmp + it + `/recursos/` + id + `/contrarrazoes$`),
	},
	"PUT": { // concluir o envio do recurso / da contrarrazão
		regexp.MustCompile(`^/comprasnet-fase-externa/v1` + cmp + it + `/recursos$`),
		regexp.MustCompile(`^/comprasnet-fase-externa/v1` + cmp + it + `/recursos/` + id + `/contrarrazoes$`),
	},
	"DELETE": { // excluir um anexo seu / desistir da intenção de recurso
		regexp.MustCompile(`^/comprasnet-fase-externa/v1` + cmp + it + `/participacao/` + id + `/anexos/` + id + `$`),
		regexp.MustCompile(`^/comprasnet-fase-externa/v1` + cmp + it + `/intencoes-recurso$`),
		regexp.MustCompile(`^/comprasnet-fase-externa/v1` + cmp + it + `/recursos/` + id + `/arquivos$`),
		regexp.MustCompile(`^/comprasnet-fase-externa/v1` + cmp + it + `/recursos/` + id + `/contrarrazoes/` + id + `/arquivos$`),
	},
}

var consultaQuery = regexp.MustCompile(`^[\w=&.,%:-]{0,300}$`)

const maxArquivo = 30 << 20 // o Compras.gov.br aceita até 30 MB

type pedidoCompras struct {
	Metodo  string          `json:"metodo"`
	Caminho string          `json:"caminho"`
	Query   string          `json:"query,omitempty"`
	Captcha bool            `json:"captcha"`
	Corpo   json.RawMessage `json:"corpo,omitempty"`
	Arquivo *arquivoEnvio   `json:"arquivo,omitempty"`
	Baixar  bool            `json:"baixar,omitempty"`
	URL     string          `json:"url,omitempty"` // arquivo já apontado pelo Compras.gov.br (endereço do armazenamento)
}

type arquivoEnvio struct {
	Nome   string `json:"nome"`
	Tipo   string `json:"tipo"`
	Base64 string `json:"base64"`
}

type limiteLeituras struct {
	mu     sync.Mutex
	vezes  []time.Time
	limite int
}

func (l *limiteLeituras) permitir() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	agora := time.Now()
	novas := l.vezes[:0]
	for _, t := range l.vezes {
		if agora.Sub(t) < time.Minute {
			novas = append(novas, t)
		}
	}
	l.vezes = novas
	if len(l.vezes) >= l.limite {
		return false
	}
	l.vezes = append(l.vezes, agora)
	return true
}

var leiturasPorMinuto = &limiteLeituras{limite: 40}

func caminhoPermitido(lista []*regexp.Regexp, caminho string) bool {
	for _, r := range lista {
		if r.MatchString(caminho) {
			return true
		}
	}
	return false
}

// Endereço de arquivo devolvido pelo próprio Compras.gov.br (armazenamento de objetos do governo).
func urlArquivoPermitida(endereco, base string) bool {
	u, err := url.Parse(endereco)
	if err != nil || u.User != nil {
		return false
	}
	if u.Host == "" {
		return strings.HasPrefix(u.Path, "/storage-api/")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && mesmoSite(endereco, base)) {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return mesmoSite(endereco, base) || strings.HasSuffix(h, ".serpro.gov.br") || strings.HasSuffix(h, ".compras.gov.br") || h == "compras.gov.br"
}

func validarPedido(p *pedidoCompras, base string) error {
	p.Metodo = strings.ToUpper(strings.TrimSpace(p.Metodo))
	if p.Metodo == "" {
		p.Metodo = "GET"
	}
	if !consultaQuery.MatchString(p.Query) || strings.Contains(strings.ToLower(p.Query), "captcha") {
		return fmt.Errorf("consulta inválida")
	}
	if p.URL != "" {
		if p.Metodo != "GET" || !urlArquivoPermitida(p.URL, base) {
			return fmt.Errorf("endereço de arquivo não permitido")
		}
		p.Baixar = true
		return nil
	}
	if strings.Contains(p.Caminho, "..") || strings.Contains(p.Caminho, "//") {
		return fmt.Errorf("consulta inválida")
	}
	if p.Metodo == "GET" {
		if !caminhoPermitido(leiturasPermitidas, p.Caminho) {
			return fmt.Errorf("consulta não permitida")
		}
		return nil
	}
	if !caminhoPermitido(acoesPermitidas[p.Metodo], p.Caminho) {
		return fmt.Errorf("ação não permitida")
	}
	if p.Arquivo != nil {
		if p.Metodo != "POST" || p.Arquivo.Nome == "" || len([]rune(p.Arquivo.Nome)) > 150 {
			return fmt.Errorf("arquivo inválido (o nome pode ter até 150 caracteres)")
		}
		if len(p.Arquivo.Base64)*3/4 > maxArquivo {
			return fmt.Errorf("o Compras.gov.br aceita arquivos de até 30 MB")
		}
	}
	return nil
}

const scriptPedidoCompras = `(async (e) => {
  const token = sessionStorage.getItem("accessToken");
  if (!token) return JSON.stringify({ status: 401, corpo: "" });
  const captcha = async () => {
    try {
      if (window.hcaptcha && hcaptcha.execute) { const r = await hcaptcha.execute({ async: true }); return (r && r.response) || ""; }
      if (window.grecaptcha && grecaptcha.execute) return (await grecaptcha.execute()) || "";
    } catch (x) { return ""; }
    return "";
  };
  const emBase64 = async (blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
    return btoa(s);
  };
  const baixarDe = async (alvo, nome) => {
    const tentativas = [alvo];
    try { const u = new URL(alvo, location.href); if (u.origin !== location.origin) tentativas.push("/storage-api" + u.pathname + u.search); } catch (x) {}
    for (const t of tentativas) {
      try {
        const b = await fetch(t);
        if (!b.ok) continue;
        const blob = await b.blob();
        if (blob.size > 30 * 1024 * 1024) return { status: 413, corpo: "Arquivo maior que 30 MB." };
        const cd = b.headers.get("content-disposition") || "";
        const m = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(cd);
        return { status: 200, nome: nome || (m ? decodeURIComponent(m[1]) : "arquivo"), tipo: blob.type, base64: await emBase64(blob) };
      } catch (x) {}
    }
    return { status: 502, corpo: "Não consegui baixar o arquivo do Compras.gov.br." };
  };
  if (e.url) return JSON.stringify(await baixarDe(e.url, ""));
  let url = e.caminho + (e.query ? "?" + e.query : "");
  if (e.captcha) url += (url.includes("?") ? "&" : "?") + "captcha=" + encodeURIComponent(await captcha());
  const h = { "Authorization": "Bearer " + token, "Accept": "application/json, text/plain, */*", "X-Device-Platform": "WEB" };
  let body;
  if (e.arquivo) {
    const bin = Uint8Array.from(atob(e.arquivo.base64), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append("file", new Blob([bin], { type: e.arquivo.tipo || "application/octet-stream" }), e.arquivo.nome);
    body = fd;
  } else if (e.corpo !== undefined && e.corpo !== null) {
    h["Content-Type"] = "application/json";
    body = JSON.stringify(e.corpo);
  }
  const r = await fetch(url, { method: e.metodo, headers: h, body });
  const cabecalhos = {};
  for (const k of ["page", "page-size", "pages-count", "register-count"]) { const v = r.headers.get(k); if (v) cabecalhos[k] = v; }
  const tipo = r.headers.get("content-type") || "";
  if (e.baixar && r.ok && !tipo.includes("json")) {
    const blob = await r.blob();
    if (blob.size > 30 * 1024 * 1024) return JSON.stringify({ status: 413, corpo: "Arquivo maior que 30 MB." });
    return JSON.stringify({ status: 200, nome: "arquivo", tipo: blob.type, base64: await emBase64(blob) });
  }
  const texto = await r.text();
  if (e.baixar && r.ok) {
    let info = null;
    try { info = JSON.parse(texto); } catch (x) {}
    const lista = Array.isArray(info) ? info : [info];
    const a = lista.find((x) => x && (x.url || x.conteudo || x.arquivo));
    if (a && (a.conteudo || a.arquivo) && typeof (a.conteudo || a.arquivo) === "string") return JSON.stringify({ status: 200, nome: a.nomeOriginal || a.nome || "arquivo", tipo: a.tipo || a.contentType || "", base64: a.conteudo || a.arquivo });
    if (a && a.url) return JSON.stringify(await baixarDe(a.url, a.nomeOriginal || a.nome || ""));
    return JSON.stringify({ status: 404, corpo: "O Compras.gov.br não devolveu o arquivo." });
  }
  return JSON.stringify({ status: r.status, corpo: texto.length > 6000000 ? texto.slice(0, 6000000) : texto, cabecalhos });
})`

// PedidoCompras faz uma consulta ou ação permitida na janela do Compras.gov.br e devolve a resposta.
func (m *motor) PedidoCompras(p pedidoCompras) any {
	if err := validarPedido(&p, m.p.cfg.Compras); err != nil {
		return mapa{"erro": err.Error()}
	}
	if p.Metodo == "GET" && !leiturasPorMinuto.permitir() {
		return mapa{"erro": "Muitas consultas seguidas ao Compras.gov.br: espere alguns segundos e tente de novo."}
	}
	s := m.p.sessaoLogada(false)
	if s == nil {
		return mapa{"erro": "Entre no Compras.gov.br para ver isso."}
	}
	if p.Captcha {
		if err := m.p.garantirSala(s); err != nil {
			return mapa{"erro": err.Error()}
		}
	}
	entrada, _ := json.Marshal(p)
	saida, err := m.p.avaliar(s.sessao, scriptPedidoCompras+"("+string(entrada)+")", 2*time.Minute)
	if err != nil {
		return mapa{"erro": "O Compras.gov.br não respondeu: " + err.Error()}
	}
	var v struct {
		Status     int               `json:"status"`
		Corpo      string            `json:"corpo"`
		Cabecalhos map[string]string `json:"cabecalhos"`
		Nome       string            `json:"nome"`
		Tipo       string            `json:"tipo"`
		Base64     string            `json:"base64"`
	}
	if json.Unmarshal([]byte(saida), &v) != nil {
		return mapa{"erro": "Resposta estranha do Compras.gov.br."}
	}
	alvo := p.Caminho
	if p.URL != "" {
		alvo = "arquivo"
	}
	registrarLog("compras: %s %s → %d", p.Metodo, mascararNumeros(alvo), v.Status)
	if p.Metodo != "GET" && v.Status >= 200 && v.Status < 300 {
		// Depois de uma ação, relê a compra no acompanhamento.
		if partes := strings.Split(p.Caminho, "/"); len(partes) > 4 {
			for i, x := range partes {
				if x == "compras" && i+1 < len(partes) {
					m.acomp.mu.Lock()
					m.acomp.pedidos = append(m.acomp.pedidos, partes[i+1])
					m.acomp.mu.Unlock()
					break
				}
			}
		}
	}
	if v.Base64 != "" {
		return mapa{"status": v.Status, "nome": v.Nome, "tipo": v.Tipo, "base64": v.Base64}
	}
	resposta := mapa{"status": v.Status, "cabecalhos": v.Cabecalhos}
	if json.Valid([]byte(v.Corpo)) {
		resposta["dados"] = json.RawMessage(v.Corpo)
	} else {
		resposta["texto"] = v.Corpo
	}
	if v.Status == 401 || v.Status == 403 {
		resposta["mensagem"] = "Sessão do Compras.gov.br expirada ou sem permissão: entre de novo."
	} else if v.Status >= 400 {
		resposta["mensagem"] = mensagemErro(json.RawMessage(v.Corpo))
	}
	return resposta
}
