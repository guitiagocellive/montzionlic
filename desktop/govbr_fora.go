package main

// Página que a janela do gov.br mostra quando o gov.br (sso.acesso.gov.br) não responde: explica o que houve,
// diz o resultado de um teste de conexão feito pelo aplicativo e tenta de novo sozinha, com espera crescente,
// sempre pela página de login (o endereço antigo do gov.br expira e o "Atualizar" do Edge não resolve).

import (
	"fmt"
	"html"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var (
	falhasCompras atomic.Int64
	paginaErroMu  sync.Mutex
	paginaErro    string
)

func guardarPaginaErro(h string) {
	paginaErroMu.Lock()
	paginaErro = h
	paginaErroMu.Unlock()
}

func lerPaginaErro() string {
	paginaErroMu.Lock()
	defer paginaErroMu.Unlock()
	return paginaErro
}

// esperaNovaTentativa: 5 s, 10 s, 20 s, 40 s e depois de minuto em minuto.
func esperaNovaTentativa(n int) int {
	espera := 5
	for i := 1; i < n && espera < 60; i++ {
		espera *= 2
	}
	return min(espera, 60)
}

type diagnosticoGovBr struct {
	Respondeu bool
	Segundos  float64
	Erro      string
	Proxy     string // proxy do Windows (a janela usa; o teste do aplicativo não)
	IPv4      int    // endereços do gov.br no DNS do Windows
	IPv6      int
}

// redeGovBr: o que pode fazer a janela (Edge WebView2) falhar enquanto o aplicativo consegue: proxy do Windows e
// endereços do gov.br (IPv6 quebrado na rede costuma travar só o navegador).
func redeGovBr(d *diagnosticoGovBr) {
	d.Proxy = proxyDoWindows()
	if ips, err := net.LookupIP("sso.acesso.gov.br"); err == nil {
		for _, ip := range ips {
			if ip.To4() != nil {
				d.IPv4++
			} else {
				d.IPv6++
			}
		}
	}
}

// testarGovBr: o próprio aplicativo tenta falar com o gov.br, para dizer se o problema é do gov.br/da internet
// ou só da janela (só abre a página inicial do login, sem enviar nada).
func testarGovBr() diagnosticoGovBr {
	cli := &http.Client{Timeout: 12 * time.Second, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment}}
	inicio := time.Now()
	r, err := cli.Get("https://sso.acesso.gov.br/")
	d := diagnosticoGovBr{Segundos: time.Since(inicio).Seconds()}
	redeGovBr(&d)
	rede := fmt.Sprintf("DNS: %d IPv4, %d IPv6; proxy do Windows: %s", d.IPv4, d.IPv6, textoOu(d.Proxy, "nenhum"))
	if err != nil {
		d.Erro = err.Error()
		if strings.Contains(d.Erro, "Timeout") || strings.Contains(d.Erro, "deadline") {
			d.Erro = "não respondeu em 12 segundos"
		}
		registrarLog("teste do gov.br pelo aplicativo: falhou em %.1f s (%s); %s", d.Segundos, mascararNumeros(d.Erro), mascararNumeros(rede))
		return d
	}
	r.Body.Close()
	d.Respondeu = r.StatusCode < 500
	if !d.Respondeu {
		d.Erro = fmt.Sprintf("respondeu com erro %d", r.StatusCode)
	}
	registrarLog("teste do gov.br pelo aplicativo: %d em %.1f s; %s", r.StatusCode, d.Segundos, mascararNumeros(rede))
	return d
}

func paginaGovForaDoAr(tentativa int, status int32, d diagnosticoGovBr, destino string) string {
	espera := esperaNovaTentativa(tentativa)
	diag := ""
	if d.Respondeu {
		espera = min(espera, 5) // o gov.br respondeu ao aplicativo: tenta logo
		diag = fmt.Sprintf("O aplicativo testou agora e o gov.br <b>respondeu</b> (em %s s). Deve ter sido uma demora momentânea: a janela já vai tentar de novo.",
			strings.Replace(fmt.Sprintf("%.1f", d.Segundos), ".", ",", 1))
		if tentativa >= 3 {
			// A janela falha seguidas vezes e o aplicativo consegue: o caminho da janela é diferente.
			if d.Proxy != "" {
				diag += "<br><br>O Windows está com um <b>proxy</b> configurado (" + html.EscapeString(d.Proxy) + "). A janela do gov.br passa por ele e o teste do aplicativo não: ele pode estar segurando o gov.br. Confira em Configurações do Windows › Rede e Internet › Proxy (ou com quem cuida da rede)."
			} else {
				diag += "<br><br>A janela está falhando seguidas vezes, mas o aplicativo chega ao gov.br. Abra o gov.br no Edge ou no Chrome deste computador: se lá também não abrir, pode ser antivírus ou firewall bloqueando o navegador. Se puder, copie o diagnóstico na página Disputas e mande para o suporte."
			}
		}
	} else {
		diag = "O aplicativo também testou agora e o gov.br <b>" + html.EscapeString(d.Erro) + "</b>. O problema está no gov.br (que costuma ficar lento) ou na sua internet — não no Montzion."
	}
	motivo := map[int32]string{7: "demorou demais para responder", 6: "não está respondendo", 13: "não foi encontrado (DNS)", 12: "recusou a conexão", 9: "interrompeu a conexão", 10: "reiniciou a conexão", 11: "a internet caiu"}[status]
	if motivo == "" {
		motivo = "não respondeu"
	}
	return strings.NewReplacer(
		"{{MOTIVO}}", html.EscapeString(motivo),
		"{{DIAG}}", diag,
		"{{TENTATIVA}}", fmt.Sprint(tentativa),
		"{{ESPERA}}", fmt.Sprint(espera),
		"{{DESTINO}}", jsTexto(destino),
	).Replace(htmlGovFora)
}

const htmlGovFora = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>gov.br não respondeu</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1d24;color:#e6eef2;font:15px/1.5 "Segoe UI",system-ui,sans-serif}
.c{max-width:560px;padding:32px;border-radius:20px;background:#16272f;border:1px solid #24414d;box-shadow:0 20px 60px rgba(0,0,0,.35)}
h1{font-size:22px;margin:0 0 6px}
p{margin:10px 0;color:#b9cbd3}
.d{padding:12px 14px;border-radius:12px;background:#0f1d24;border-left:3px solid #22d3ee}
.t{font-size:13px;color:#7f97a1}
.b{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}
button{font:inherit;font-weight:600;padding:10px 18px;border-radius:999px;border:0;cursor:pointer}
.p{background:#22d3ee;color:#062028}.s{background:transparent;color:#cfe3ea;border:1px solid #2e4f5c}
.n{font-variant-numeric:tabular-nums;color:#22d3ee;font-weight:700}
</style></head><body><div class="c">
<h1>O gov.br {{MOTIVO}}</h1>
<p>A página de login do gov.br (sso.acesso.gov.br) não carregou.</p>
<p class="d">{{DIAG}}</p>
<p id="msg">Tentando de novo em <span class="n" id="seg">{{ESPERA}}</span> s, pela página de login. Pode deixar esta janela aberta.</p>
<p class="t">Tentativa {{TENTATIVA}} · a janela continua tentando sozinha enquanto estiver aberta.</p>
<div class="b"><button class="p" id="agora">Tentar agora</button><button class="s" id="fechar">Fechar a janela</button></div>
</div><script>
var destino={{DESTINO}},s={{ESPERA}},el=document.getElementById("seg");
function ir(){document.getElementById("msg").textContent="Abrindo a página de login do gov.br…";location.href=destino}
document.getElementById("agora").onclick=ir;
document.getElementById("fechar").onclick=function(){window.close()};
setInterval(function(){if(document.hidden)return;s--;if(s<=0){ir();s=9999}else el.textContent=s},1000);
</script></body></html>`

func textoOu(s, padrao string) string {
	if s == "" {
		return padrao
	}
	return s
}
