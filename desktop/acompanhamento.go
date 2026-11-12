package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Acompanhamento das participações (aba "Acompanhamento" da plataforma).
//
// Lê, com a sessão que a própria pessoa abriu no Compras.gov.br, as mesmas listas que a Área do Fornecedor
// mostra em "Minhas participações": compras em andamento e finalizadas, os itens com a colocação da proposta
// e as mensagens do pregoeiro. Cada leitura que o Compras.gov.br protege com captcha usa o captcha invisível
// da própria página, como acontece quando a pessoa abre essas telas; por isso as leituras são poucas e
// espaçadas (a lista a cada 8 minutos e no máximo 6 compras detalhadas por vez).

const (
	intervaloAcompanhamento = 3 * time.Minute
	intervaloFinalizadas    = 30 * time.Minute
	detalhesPorVez          = 6
)

type detalheCompra struct {
	Participacao json.RawMessage `json:"participacao,omitempty"`
	Itens        json.RawMessage `json:"itens,omitempty"`
	OrigemItens  string          `json:"origemItens,omitempty"`
	Mensagens    json.RawMessage `json:"mensagens,omitempty"`
	Erros        []string        `json:"erros,omitempty"`
	Em           int64           `json:"em"`
}

type acompanhamento struct {
	mu            sync.Mutex
	andamento     json.RawMessage
	finalizadas   json.RawMessage
	detalhes      map[string]*detalheCompra
	em            time.Time
	finalizadasEm time.Time
	erro          string
	buscando      bool
	forcar        bool
	pedidos       []string // compras que a página pediu para ler já
	viuCampos     bool     // já registrou no log os nomes dos campos (para o diagnóstico)
}

// Compra da lista de participações (chave e se é do sistema legado).
type compraAcomp struct {
	Chave  string `json:"chave"`
	Legado bool   `json:"legado"`
}

var chave17 = regexp.MustCompile(`^\d{17}$`)

func chaveDaParticipacao(x map[string]any) string {
	if c := chaveDaCompraInfo(x); c != "" {
		return c
	}
	for _, k := range []string{"compra", "compraFaseExterna", "dadosCompra"} {
		if compra, ok := x[k].(map[string]any); ok {
			if c := chaveDaCompraInfo(compra); c != "" {
				return c
			}
			if c := chave17Em(compra); c != "" {
				return c
			}
		}
	}
	return chave17Em(x)
}

// Qualquer campo com a chave da compra (UASG + modalidade + número + ano = 17 dígitos).
func chave17Em(x map[string]any) string {
	for _, k := range []string{"chaveCompra", "idCompra", "identificadorCompra", "chave", "id", "codigoCompra"} {
		if v := textoDe(numeroInteiro(x[k])); chave17.MatchString(v) {
			return v
		}
	}
	return ""
}

func legadoDaParticipacao(x map[string]any) bool {
	for _, k := range []string{"compraNaBaseLegada", "legadoAsp", "legado"} {
		if b, ok := x[k].(bool); ok {
			return b
		}
	}
	if compra, ok := x["compra"].(map[string]any); ok {
		if b, ok := compra["compraNaBaseLegada"].(bool); ok {
			return b
		}
	}
	return false
}

func listaDe(bruto json.RawMessage) []map[string]any {
	var lista []map[string]any
	_ = json.Unmarshal(bruto, &lista)
	return lista
}

func nomesDosCampos(x map[string]any) string {
	nomes := make([]string, 0, len(x))
	for k := range x {
		nomes = append(nomes, k)
	}
	sort.Strings(nomes)
	return strings.Join(nomes, ",")
}

const scriptAcompanhamento = `(async (entrada) => {
  const token = sessionStorage.getItem("accessToken");
  if (!token) return JSON.stringify({ erro: "sem sessão" });
  const captcha = async () => {
    try {
      if (window.hcaptcha && hcaptcha.execute) { const r = await hcaptcha.execute({ async: true }); return (r && r.response) || ""; }
      if (window.grecaptcha && grecaptcha.execute) return (await grecaptcha.execute()) || "";
    } catch (e) { return ""; }
    return "";
  };
  const H = { "Authorization": "Bearer " + token, "Accept": "application/json", "X-Device-Platform": "WEB" };
  const pegar = async (url, comCaptcha) => {
    let u = url;
    if (comCaptcha) u += (u.includes("?") ? "&" : "?") + "captcha=" + encodeURIComponent(await captcha());
    try {
      const r = await fetch(u, { headers: H });
      const t = await r.text();
      let d = null;
      try { d = t ? JSON.parse(t) : null; } catch (e) {}
      return { status: r.status, ok: r.ok, dados: d, texto: r.ok ? "" : t.slice(0, 160), paginas: r.headers.get("pages-count"), total: r.headers.get("register-count") };
    } catch (e) { return { status: 0, ok: false, dados: null, texto: String(e).slice(0, 160) }; }
  };
  // A resposta pode ser a lista ou um objeto com a lista dentro (o nome do campo varia entre as telas).
  const lista = (d) => {
    if (Array.isArray(d)) return d;
    if (!d || typeof d !== "object") return [];
    for (const k of ["content", "itens", "compras", "participacoes", "mensagens", "resultado", "registros", "data", "lista", "elementos"]) {
      if (Array.isArray(d[k])) return d[k];
      if (d[k] && typeof d[k] === "object") { const dentro = lista(d[k]); if (dentro.length) return dentro; }
    }
    const qualquer = Object.values(d).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object");
    return qualquer || [];
  };
  const formato = (d) => Array.isArray(d) ? "lista(" + d.length + ")" : d && typeof d === "object" ? "objeto{" + Object.keys(d).slice(0, 15).join(",") + "}" : typeof d;
  const saida = { erros: [], detalhes: {} };
  // Como a página "Minhas participações": 10 por página, uma página de cada vez (até 8 páginas).
  saida.formatos = [];
  const participacoes = async (filtro, maxPaginas) => {
    const todas = [];
    for (let pagina = 0; pagina < maxPaginas; pagina++) {
      const r = await pegar("/comprasnet-fase-externa/v1/compras/participacoes?filtro=" + filtro + "&pagina=" + pagina + "&tamanhoPagina=10", true);
      // 200 ou 206 (o Compras.gov.br responde listas paginadas com 206 "conteúdo parcial").
      if (!r.ok) {
        saida.erros.push("participações (" + filtro + ", página " + (pagina + 1) + "): " + r.status + " " + r.texto);
        return pagina === 0 ? null : todas;
      }
      const l = lista(r.dados);
      if (pagina === 0) saida.formatos.push("filtro " + filtro + ": " + formato(r.dados) + " páginas=" + (r.paginas || "?") + " total=" + (r.total || "?"));
      todas.push(...l);
      const paginas = Number(r.paginas || 0);
      if (!l.length || l.length < 10 || (paginas && pagina + 1 >= paginas)) break;
    }
    return todas;
  };
  if (entrada.lista) saida.andamento = await participacoes(2, 8);
  if (entrada.lista && entrada.finalizadas) saida.finalizadas = await participacoes(6, 3);
  for (const c of entrada.detalhar) {
    const d = { erros: [] };
    const e = encodeURIComponent(c.chave);
    const p = await pegar("/comprasnet-fase-externa/v1/compras/" + e + "/participacao", false);
    if (p.ok) d.participacao = p.dados; else d.erros.push("participação: " + p.status);
    const it = await pegar("/comprasnet-fase-externa/v1/compras/" + e + "/itens/em-selecao-fornecedores?filtro=2&pagina=0&tamanhoPagina=100", true);
    if (it.ok && lista(it.dados).length) { d.itens = lista(it.dados).slice(0, 150); d.origemItens = "selecao"; }
    else {
      const it2 = await pegar("/comprasnet-fase-externa/v1/compras/" + e + "/itens?pagina=0&tamanhoPagina=100", true);
      if (it2.ok) { d.itens = lista(it2.dados).slice(0, 150); d.origemItens = "itens"; }
      else d.erros.push("itens: " + it.status + "/" + it2.status + " " + it2.texto);
    }
    const m = await pegar("/comprasnet-mensagem/v2/chat/" + e + "?legadoAsp=" + !!c.legado + "&size=50&page=0", true);
    if (m.ok) d.mensagens = lista(m.dados).slice(0, 80); else d.erros.push("mensagens: " + m.status);
    saida.detalhes[c.chave] = d;
  }
  return JSON.stringify(saida);
})`

// cicloAcompanhamento lê as participações de tempos em tempos enquanto a pessoa está logada.
func (m *motor) cicloAcompanhamento() {
	for {
		time.Sleep(5 * time.Second)
		m.mu.Lock()
		pronto := m.token != "" && m.fase == "pronto"
		robo := false
		for chave, c := range m.compras {
			if m.roboNaCompra(chave) && m.compraEmDisputa(c) {
				robo = true
				break
			}
		}
		m.mu.Unlock()
		if !pronto {
			continue
		}
		a := &m.acomp
		a.mu.Lock()
		faltam := false
		for _, x := range listaDe(a.andamento) {
			if k := chaveDaParticipacao(x); k != "" && a.detalhes[k] == nil {
				faltam = true
				break
			}
		}
		desde := time.Since(a.em)
		precisa := a.forcar || len(a.pedidos) > 0 || desde > intervaloAcompanhamento || (faltam && desde > 20*time.Second)
		// Durante a disputa com o robô ligado, só lê quando a pessoa pede (o captcha fica para a sala).
		if robo && !a.forcar && len(a.pedidos) == 0 {
			precisa = false
		}
		a.mu.Unlock()
		if precisa {
			m.coletarAcompanhamento()
		}
	}
}

func (m *motor) coletarAcompanhamento() {
	a := &m.acomp
	a.mu.Lock()
	if a.buscando {
		a.mu.Unlock()
		return
	}
	a.buscando = true
	forcar := a.forcar
	// Só a compra que a pessoa abriu: não precisa reler a lista inteira (fica bem mais rápido).
	soPedidos := !forcar && len(a.pedidos) > 0 && a.andamento != nil && time.Since(a.em) < intervaloAcompanhamento
	quantosPedidos := len(a.pedidos)
	finalizadas := forcar || a.finalizadas == nil || time.Since(a.finalizadasEm) > intervaloFinalizadas
	// Escolhe as compras a detalhar: as pedidas pela página e, depois, as lidas há mais tempo.
	escolhidas := []compraAcomp{}
	vistas := map[string]bool{}
	legado := map[string]bool{}
	for _, lista := range []json.RawMessage{a.andamento, a.finalizadas} {
		for _, x := range listaDe(lista) {
			if k := chaveDaParticipacao(x); k != "" {
				legado[k] = legadoDaParticipacao(x)
			}
		}
	}
	for _, k := range a.pedidos {
		if !vistas[k] && len(escolhidas) < detalhesPorVez {
			vistas[k] = true
			escolhidas = append(escolhidas, compraAcomp{k, legado[k]})
		}
	}
	a.pedidos = nil
	candidatas := []string{}
	for _, x := range listaDe(a.andamento) {
		if k := chaveDaParticipacao(x); k != "" && !vistas[k] {
			vistas[k] = true
			candidatas = append(candidatas, k)
		}
	}
	idade := func(k string) int64 {
		if d := a.detalhes[k]; d != nil {
			return d.Em
		}
		return 0
	}
	sort.SliceStable(candidatas, func(i, j int) bool { return idade(candidatas[i]) < idade(candidatas[j]) })
	for _, k := range candidatas {
		if len(escolhidas) >= detalhesPorVez {
			break
		}
		// Já lida há pouco: espera a próxima volta.
		if time.Since(time.UnixMilli(idade(k))) < intervaloAcompanhamento-time.Minute {
			continue
		}
		escolhidas = append(escolhidas, compraAcomp{k, legado[k]})
	}
	a.forcar = false
	a.mu.Unlock()

	if soPedidos && len(escolhidas) > quantosPedidos {
		escolhidas = escolhidas[:quantosPedidos]
	}
	erro := m.lerAcompanhamento(!soPedidos, finalizadas, escolhidas)

	a.mu.Lock()
	a.buscando = false
	if !soPedidos {
		a.em = time.Now() // hora da última leitura da lista
	}
	a.erro = ""
	if erro != nil {
		a.erro = erro.Error()
		registrarLog("acompanhamento: %v", erro)
	}
	a.mu.Unlock()
}

func (m *motor) lerAcompanhamento(lista, finalizadas bool, escolhidas []compraAcomp) error {
	s := m.p.sessaoLogada(false)
	if s == nil {
		return fmt.Errorf("entre no Compras.gov.br para acompanhar as participações")
	}
	if err := m.p.garantirSala(s); err != nil {
		return err
	}
	entrada, _ := json.Marshal(mapa{"lista": lista, "finalizadas": finalizadas, "detalhar": escolhidas})
	saida, err := m.p.avaliar(s.sessao, scriptAcompanhamento+"("+string(entrada)+")", 3*time.Minute)
	if err != nil {
		return fmt.Errorf("não foi possível ler as participações: %v", err)
	}
	var v struct {
		Erro        string                    `json:"erro"`
		Erros       []string                  `json:"erros"`
		Andamento   json.RawMessage           `json:"andamento"`
		Finalizadas json.RawMessage           `json:"finalizadas"`
		Detalhes    map[string]*detalheCompra `json:"detalhes"`
		Formatos    []string                  `json:"formatos"`
	}
	if json.Unmarshal([]byte(saida), &v) != nil {
		return fmt.Errorf("resposta estranha do Compras.gov.br")
	}
	if v.Erro != "" {
		return fmt.Errorf("sessão do Compras.gov.br expirada: entre de novo")
	}
	agora := time.Now()
	a := &m.acomp
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.detalhes == nil {
		a.detalhes = map[string]*detalheCompra{}
	}
	if len(v.Andamento) > 0 && string(v.Andamento) != "null" {
		a.andamento = v.Andamento
	}
	if len(v.Finalizadas) > 0 && string(v.Finalizadas) != "null" {
		a.finalizadas, a.finalizadasEm = v.Finalizadas, agora
	}
	for k, d := range v.Detalhes {
		if d == nil {
			continue
		}
		d.Em = agora.UnixMilli()
		// Se esta leitura falhou numa parte, mantém o que já tinha sido lido.
		if velho := a.detalhes[k]; velho != nil {
			if len(d.Participacao) == 0 {
				d.Participacao = velho.Participacao
			}
			if len(d.Itens) == 0 {
				d.Itens, d.OrigemItens = velho.Itens, velho.OrigemItens
			}
			if len(d.Mensagens) == 0 {
				d.Mensagens = velho.Mensagens
			}
		}
		a.detalhes[k] = d
		if len(d.Erros) > 0 {
			registrarLog("acompanhamento: compra %s: %s", mascararNumeros(k), strings.Join(d.Erros, " | "))
		}
	}
	// Remove detalhes de compras que saíram das duas listas.
	todas := map[string]bool{}
	for _, lista := range []json.RawMessage{a.andamento, a.finalizadas} {
		for _, x := range listaDe(lista) {
			if k := chaveDaParticipacao(x); k != "" {
				todas[k] = true
			}
		}
	}
	for k := range a.detalhes {
		if !todas[k] {
			delete(a.detalhes, k)
		}
	}
	registrarLog("acompanhamento: %d em andamento, %d finalizadas, %d detalhadas agora", len(listaDe(a.andamento)), len(listaDe(a.finalizadas)), len(v.Detalhes))
	if len(v.Erros) > 0 {
		registrarLog("acompanhamento: %s", strings.Join(v.Erros, " | "))
	}
	if len(v.Formatos) > 0 {
		registrarLog("acompanhamento: formato da resposta: %s", strings.Join(v.Formatos, " | "))
	}
	// Só os nomes dos campos (sem valores), para ajustar a tela se o Compras.gov.br mudar algo.
	if !a.viuCampos {
		if l := listaDe(a.andamento); len(l) > 0 {
			a.viuCampos = true
			registrarLog("acompanhamento: campos da participação: %s", nomesDosCampos(l[0]))
			if c, ok := l[0]["compra"].(map[string]any); ok {
				registrarLog("acompanhamento: campos da compra na participação: %s", nomesDosCampos(c))
			}
			if chaveDaParticipacao(l[0]) == "" {
				registrarLog("acompanhamento: não achei a chave da compra na participação")
			}
			for _, d := range v.Detalhes {
				if it := listaDe(d.Itens); len(it) > 0 {
					registrarLog("acompanhamento: campos do item (%s): %s", d.OrigemItens, nomesDosCampos(it[0]))
					if p, ok := it[0]["propostaItem"].(map[string]any); ok {
						registrarLog("acompanhamento: campos da proposta do item: %s", nomesDosCampos(p))
					}
					break
				}
			}
		}
	}
	if v.Andamento == nil && len(v.Erros) > 0 {
		return fmt.Errorf("o Compras.gov.br não devolveu as participações (%s)", strings.Join(v.Erros, " | "))
	}
	return nil
}

// Acompanhamento devolve o que já foi lido. compra: a página quer essa compra lida agora; atualizar: ler tudo já.
func (m *motor) Acompanhamento(compra string, atualizar bool) any {
	a := &m.acomp
	a.mu.Lock()
	if atualizar {
		a.forcar = true
	}
	if compra != "" {
		if d := a.detalhes[compra]; d == nil || time.Since(time.UnixMilli(d.Em)) > time.Minute {
			a.pedidos = append(a.pedidos, compra)
		}
	}
	resposta := mapa{
		"andamento":   a.andamento,
		"finalizadas": a.finalizadas,
		"detalhes":    a.detalhes,
		"em":          a.em.UnixMilli(),
		"problema":    a.erro,
		"buscando":    a.buscando || a.forcar || len(a.pedidos) > 0,
		"agora":       time.Now().UnixMilli(),
	}
	if a.em.IsZero() {
		resposta["em"] = 0
	}
	a.mu.Unlock()
	m.mu.Lock()
	resposta["conectado"] = m.token != ""
	resposta["fase"] = m.fase
	resposta["cnpj"] = m.cnpj // a própria empresa (para achar as suas propostas e anexos)
	m.mu.Unlock()
	return resposta
}

// EnviarMensagem manda uma mensagem ao pregoeiro, como o campo de mensagens da sala de disputa.
// O Compras.gov.br só aceita quando o pregoeiro abriu a conversa para o fornecedor (ex.: convocação).
func (m *motor) EnviarMensagem(compra string, item int, texto string) any {
	texto = strings.TrimSpace(texto)
	if compra == "" || texto == "" {
		return mapa{"erro": "Escreva a mensagem."}
	}
	if len([]rune(texto)) > 2000 {
		return mapa{"erro": "A mensagem pode ter no máximo 2.000 caracteres."}
	}
	corpo := mapa{"texto": texto}
	if item > 0 {
		corpo["identificadorItem"] = fmt.Sprint(item)
	}
	status, dados, err := m.pedir("POST", "/comprasnet-fase-externa/v1/sistema/compras/"+url.PathEscape(compra)+"/mensagens", corpo)
	if err != nil {
		return mapa{"erro": err.Error()}
	}
	registrarLog("acompanhamento: mensagem ao pregoeiro na compra %s → %d", mascararNumeros(compra), status)
	if status < 200 || status >= 300 {
		motivo := mensagemErro(dados)
		if motivo == "" {
			motivo = fmt.Sprintf("o Compras.gov.br respondeu %d", status)
		}
		return mapa{"erro": "A mensagem não foi enviada: " + motivo}
	}
	a := &m.acomp
	a.mu.Lock()
	a.pedidos = append(a.pedidos, compra)
	a.mu.Unlock()
	return mapa{"ok": true}
}
