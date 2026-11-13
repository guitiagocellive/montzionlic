package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
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
	TodosItens   json.RawMessage `json:"todosItens,omitempty"` // todos os itens da compra (com e sem proposta sua)
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
	versao        int      // muda quando algo muda (a página só baixa tudo de novo nessa hora)
	sujo          bool     // mudou desde a última gravação em disco
	doCache       bool     // o que está na memória veio do disco (última sessão), ainda sem leitura nova
	cnpjCache     string
	// Totais que o Compras.gov.br informa (cabeçalho register-count), mesmo sem baixar todas as páginas.
	totalAndamento   int
	totalFinalizadas int
	// Páginas de finalizadas que a página pediu ("Carregar mais"); 1 = só as 10 mais recentes.
	paginasFinalizadas int
	detalhando         map[string]bool // compras abertas pela pessoa sendo lidas agora
	lendoMais          bool
}

// usoDaPessoa: última vez que a pessoa abriu uma compra ou mexeu no Compras.gov.br pela plataforma. Enquanto ela
// usa, as leituras de fundo (lista, coletor da Análise de empresas) esperam: o captcha e a conexão ficam para ela.
var usoDaPessoa atomic.Int64

func marcarUso() { usoDaPessoa.Store(time.Now().UnixMilli()) }

func pessoaUsando() bool { return time.Since(time.UnixMilli(usoDaPessoa.Load())) < 45*time.Second }

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
      const it2 = await pegar("/comprasnet-fase-externa/v1/compras/" + e + "/itens?situacoes=1,2,3,4,5,6,7,8,9,13,14&pagina=0&tamanhoPagina=100", true);
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
		_ = faltam // as compras sem detalhe são lidas quando a pessoa abre (não forçam leitura de fundo)
		precisa := a.forcar || desde > intervaloAcompanhamento || (a.doCache && desde > 20*time.Second)
		// A pessoa está usando (abriu uma compra, cadastrando...): a leitura de fundo espera, salvo se ela pediu.
		if !a.forcar && pessoaUsando() && a.andamento != nil {
			precisa = false
		}
		// Durante a disputa com o robô ligado, só lê quando a pessoa pede (o captcha fica para a sala).
		if robo && !a.forcar && len(a.pedidos) == 0 && a.andamento != nil && !a.doCache {
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
	// Detalhe automático só das compras com convocação ou diligência em andamento (para os avisos do sino),
	// no máximo 2 por volta e lidas há mais de 15 min. O resto só é lido quando a pessoa abre a compra.
	escolhidas := []compraAcomp{}
	for _, x := range listaDe(a.andamento) {
		if len(escolhidas) >= 2 {
			break
		}
		k := chaveDaParticipacao(x)
		if k == "" || (x["possuiDiligenciaEmAndamento"] != true && x["possuiConvRemanescentesEmAndamento"] != true) {
			continue
		}
		if d := a.detalhes[k]; d != nil && time.Since(time.UnixMilli(d.Em)) < 15*time.Minute {
			continue
		}
		escolhidas = append(escolhidas, compraAcomp{k, legadoDaParticipacao(x)})
	}
	a.pedidos = nil
	a.forcar = false
	a.mu.Unlock()

	if soPedidos {
		escolhidas = nil
	}
	_ = quantosPedidos
	erro := m.lerAcompanhamento(!soPedidos, finalizadas, escolhidas)

	a.mu.Lock()
	a.buscando = false
	a.versao++
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
	// Direto do aplicativo (rápido, publica a lista antes dos detalhes); a página só se o direto falhar ou vier vazio.
	err := m.lerAcompanhamentoDireto(lista, finalizadas, escolhidas)
	if err == nil {
		return nil
	}
	registrarLog("acompanhamento: leitura direta: %v; usando a página", err)
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
	var v leituraAcomp
	if json.Unmarshal([]byte(saida), &v) != nil {
		return fmt.Errorf("resposta estranha do Compras.gov.br")
	}
	if v.Erro != "" {
		return fmt.Errorf("sessão do Compras.gov.br expirada: entre de novo")
	}
	return m.aplicarLeitura(v, lista)
}

// aplicarLeitura junta uma leitura (lista e/ou detalhes) ao que já foi lido e avisa a página (versão nova).
func (m *motor) aplicarLeitura(v leituraAcomp, comLista bool) error {
	m.mu.Lock()
	cnpj := m.cnpj
	m.mu.Unlock()
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
	if v.TotalAndamento > 0 {
		a.totalAndamento = v.TotalAndamento
	}
	if v.TotalFinalizadas > 0 {
		a.totalFinalizadas = v.TotalFinalizadas
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
	a.versao++
	a.sujo = true
	if !comLista {
		return nil
	}
	a.doCache = false
	a.cnpjCache = cnpj
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
	// Compra na etapa Disputa que o robô ainda não conhece: o robô relê a lista já (sem esperar 5 min).
	go m.roboConfereDisputas()
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
func (m *motor) Acompanhamento(compra string, atualizar bool, desde int, mais bool) any {
	m.mu.Lock()
	cnpjAgora := m.cnpj
	m.mu.Unlock()
	a := &m.acomp
	a.mu.Lock()
	if a.doCache && a.cnpjCache != "" && cnpjAgora != "" && a.cnpjCache != cnpjAgora {
		// Guardado de outra empresa: descarta.
		a.andamento, a.finalizadas, a.detalhes, a.doCache = nil, nil, map[string]*detalheCompra{}, false
		a.versao++
	}
	cnpjGuardado := a.cnpjCache
	if atualizar {
		a.forcar = true
	}
	if compra != "" {
		marcarUso()
		if d := a.detalhes[compra]; (d == nil || time.Since(time.UnixMilli(d.Em)) > time.Minute) && !a.detalhando[compra] {
			if a.detalhando == nil {
				a.detalhando = map[string]bool{}
			}
			a.detalhando[compra] = true
			go m.detalharAberta(compra)
		}
	}
	if mais {
		a.paginasFinalizadas = max(1, a.paginasFinalizadas) + 3
		go m.lerMaisFinalizadasAcomp()
	}
	buscando := a.buscando || a.forcar || len(a.detalhando) > 0
	if desde > 0 && desde == a.versao {
		resposta := mapa{"igual": true, "versao": a.versao, "buscando": buscando, "lendo": a.detalhando, "em": a.em.UnixMilli(), "agora": time.Now().UnixMilli(), "problema": a.erro}
		a.mu.Unlock()
		m.mu.Lock()
		resposta["conectado"] = m.token != ""
		resposta["fase"] = m.fase
		resposta["cnpj"] = m.cnpj
		m.mu.Unlock()
		if resposta["cnpj"] == "" {
			resposta["cnpj"] = cnpjGuardado
		}
		return resposta
	}
	resposta := mapa{
		"deCache":          a.doCache,
		"versao":           a.versao,
		"andamento":        a.andamento,
		"finalizadas":      a.finalizadas,
		"detalhes":         a.detalhes,
		"em":               a.em.UnixMilli(),
		"problema":         a.erro,
		"buscando":         a.buscando || a.forcar || len(a.detalhando) > 0,
		"lendo":            a.detalhando,
		"totalAndamento":   a.totalAndamento,
		"totalFinalizadas": a.totalFinalizadas,
		"agora":            time.Now().UnixMilli(),
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
	if resposta["cnpj"] == "" {
		resposta["cnpj"] = cnpjGuardado // antes do login terminar: o da última leitura guardada
	}
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
	go m.detalharAberta(compra)
	return mapa{"ok": true}
}

type leituraAcomp struct {
	TotalAndamento   int                       `json:"-"`
	TotalFinalizadas int                       `json:"-"`
	Erro             string                    `json:"erro"`
	Erros            []string                  `json:"erros"`
	Andamento        json.RawMessage           `json:"andamento"`
	Finalizadas      json.RawMessage           `json:"finalizadas"`
	Detalhes         map[string]*detalheCompra `json:"detalhes"`
	Formatos         []string                  `json:"formatos"`
}

const fe = "/comprasnet-fase-externa"

func okHTTP(st int) bool { return st >= 200 && st < 300 }

// lerAcompanhamentoDireto lê direto do aplicativo: primeiro a lista (já publicada para a página), depois o
// detalhe das compras, 4 ao mesmo tempo, cada uma publicada assim que chega. Devolve erro (para usar a página)
// se não conseguir falar com o Compras.gov.br ou se a lista vier vazia.
func (m *motor) lerAcompanhamentoDireto(lista, finalizadas bool, escolhidas []compraAcomp) error {
	v := leituraAcomp{Detalhes: map[string]*detalheCompra{}}
	tam := tamanhoPaginaAcomp()
	participacoes := func(filtro string, maxPaginas int) (json.RawMessage, error) {
		var todas []json.RawMessage
		for pagina := 0; pagina < maxPaginas; pagina++ {
			r, err := m.consultarDiretoOpc("GET", fe+"/v1/compras/participacoes", fmt.Sprintf("filtro=%s&pagina=%d&tamanhoPagina=%d", filtro, pagina, tam), true, nil, "", pagina == 0)
			if err != nil {
				return nil, err
			}
			if !okHTTP(r.Status) {
				v.Erros = append(v.Erros, fmt.Sprintf("participações (%s, página %d): %d %s", filtro, pagina+1, r.Status, mensagemErro(r.Corpo)))
				if pagina == 0 {
					return nil, nil
				}
				break
			}
			l := listaQualquer(r.Corpo)
			if pagina == 0 {
				v.Formatos = append(v.Formatos, fmt.Sprintf("direto filtro %s: %d na 1ª página, páginas=%s total=%s", filtro, len(l), r.Cab.Get("pages-count"), r.Cab.Get("register-count")))
				total := 0
				fmt.Sscan(r.Cab.Get("register-count"), &total)
				if total == 0 {
					paginasTot := 0
					fmt.Sscan(r.Cab.Get("pages-count"), &paginasTot)
					if paginasTot <= 1 {
						total = len(l)
					}
				}
				if filtro == "2" {
					v.TotalAndamento = total
				} else {
					v.TotalFinalizadas = total
				}
			}
			todas = append(todas, l...)
			paginas := 0
			fmt.Sscan(r.Cab.Get("pages-count"), &paginas)
			if len(l) < tam || (paginas > 0 && pagina+1 >= paginas) {
				break
			}
		}
		return juntarLista(todas), nil
	}
	if lista {
		a, err := participacoes("2", paginasPara(80, tam))
		if err != nil {
			return err
		}
		var f json.RawMessage
		if finalizadas {
			m.acomp.mu.Lock()
			paginas := paginasPara(max(1, m.acomp.paginasFinalizadas)*10, tam)
			m.acomp.mu.Unlock()
			if f, err = participacoes("6", paginas); err != nil {
				return err
			}
		}
		if len(listaDe(a)) == 0 && len(listaDe(f)) == 0 {
			return fmt.Errorf("lista vazia (%s %s)", strings.Join(v.Erros, " | "), strings.Join(v.Formatos, " | "))
		}
		v.Andamento, v.Finalizadas = a, f
		if err := m.aplicarLeitura(v, true); err != nil {
			return err
		}
		v.Erros, v.Formatos = nil, nil
	}
	var wg sync.WaitGroup
	fila := make(chan compraAcomp)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for c := range fila {
				d := m.detalharDireto(c)
				_ = m.aplicarLeitura(leituraAcomp{Detalhes: map[string]*detalheCompra{c.Chave: d}}, false)
			}
		}()
	}
	for _, c := range escolhidas {
		fila <- c
	}
	close(fila)
	wg.Wait()
	return nil
}

// lerAcomp: direto do aplicativo; se o pedido direto falhar antes de chegar ao Compras.gov.br (rede, página de
// bloqueio, captcha), faz o mesmo pedido de dentro da janela oficial, que tem os cookies e o navegador de verdade.
func (m *motor) lerAcomp(caminho, query string, captcha bool) (respostaDireta, error) {
	r, err := m.consultarDireto("GET", caminho, query, captcha, nil, "")
	if err == nil {
		return r, nil
	}
	q := query
	if captcha {
		if codigo, errC := m.captcha(); errC == nil {
			if q != "" {
				q += "&"
			}
			q += "captcha=" + url.QueryEscape(codigo)
		}
	}
	endereco := caminho
	if q != "" {
		endereco += "?" + q
	}
	status, corpo, err2 := m.p.api("GET", endereco, nil)
	if err2 != nil {
		return respostaDireta{}, fmt.Errorf("%v; pela janela: %v", err, err2)
	}
	return respostaDireta{Status: status, Corpo: corpo}, nil
}

// leituraFalhou: o pedido não chegou ou o Compras.gov.br recusou (vazio com "ok" não é falha; 204 = sem conteúdo).
func leituraFalhou(r respostaDireta, err error) bool { return err != nil || !okHTTP(r.Status) }

func motivoLeitura(r respostaDireta, err error) string {
	if err != nil {
		t := mascararNumeros(err.Error())
		if len(t) > 140 {
			t = t[:140]
		}
		return "falhou (" + t + ")"
	}
	if okHTTP(r.Status) {
		return fmt.Sprintf("%d vazio", r.Status)
	}
	return fmt.Sprintf("%d %s", r.Status, mascararNumeros(mensagemErro(r.Corpo)))
}

// semDetalhe: ainda não lida, ou lida com erro e sem itens (tenta de novo na próxima volta).
func semDetalhe(d *detalheCompra) bool {
	return d == nil || (len(d.Erros) > 0 && len(listaQualquer(d.Itens)) == 0)
}

func (m *motor) detalharDireto(c compraAcomp) *detalheCompra {
	d := &detalheCompra{}
	k := url.PathEscape(c.Chave)
	if r, err := m.lerAcomp(fe+"/v1/compras/"+k+"/participacao", "", false); err == nil && okHTTP(r.Status) {
		d.Participacao = r.Corpo
	} else {
		d.Erros = append(d.Erros, "participação: "+motivoLeitura(r, err))
	}
	r, err := m.lerAcomp(fe+"/v1/compras/"+k+"/itens/em-selecao-fornecedores", "filtro=2&pagina=0&tamanhoPagina=100", true)
	if err == nil && okHTTP(r.Status) && len(listaQualquer(r.Corpo)) > 0 {
		d.Itens, d.OrigemItens = juntarLista(listaQualquer(r.Corpo)), "selecao"
		// Também todos os itens da compra (filtro "Todos os itens" da tela oficial), para ver os que você não disputa.
		if todos := m.todosItensSelecao(k); len(todos) > 0 {
			d.TodosItens = juntarLista(todos)
		}
	} else {
		r2, err2 := m.lerAcomp(fe+"/v1/compras/"+k+"/itens", "situacoes=1,2,3,4,5,6,7,8,9,13,14&pagina=0&tamanhoPagina=100", true)
		if err2 == nil && okHTTP(r2.Status) && len(listaQualquer(r2.Corpo)) > 0 {
			d.Itens, d.OrigemItens = juntarLista(listaQualquer(r2.Corpo)), "itens"
		} else {
			// Compra em disputa: os itens da sala de disputa (os mesmos que o robô usa).
			status, dados, err3 := m.pedir("GET", "/comprasnet-disputa/v1/compras/"+k+"/itens/em-disputa", nil)
			if err3 == nil && okHTTP(status) && len(listaQualquer(dados)) > 0 {
				d.Itens, d.OrigemItens = juntarLista(listaQualquer(dados)), "disputa"
			} else if leituraFalhou(r, err) || leituraFalhou(r2, err2) || leituraFalhou(respostaDireta{Status: status}, err3) {
				d.Erros = append(d.Erros, "itens: seleção "+motivoLeitura(r, err)+" / todos "+motivoLeitura(r2, err2)+" / disputa "+motivoLeitura(respostaDireta{Status: status, Corpo: dados}, err3))
			} else {
				d.Itens, d.OrigemItens = juntarLista(nil), "itens" // a compra respondeu, só que sem itens
			}
		}
	}
	if r, err := m.lerAcomp("/comprasnet-mensagem/v2/chat/"+k, fmt.Sprintf("legadoAsp=%v&size=200&page=0", c.Legado), true); err == nil && okHTTP(r.Status) {
		d.Mensagens = juntarLista(listaQualquer(r.Corpo))
	} else if err == nil && r.Status == 404 {
		d.Mensagens = juntarLista(nil) // compra sem mensagens
	} else {
		d.Erros = append(d.Erros, "mensagens: "+motivoLeitura(r, err))
	}
	return d
}

// detalharAberta lê já a compra que a pessoa abriu (itens, participação e chat), sem esperar a volta da lista.
func (m *motor) detalharAberta(chave string) {
	a := &m.acomp
	defer func() {
		a.mu.Lock()
		delete(a.detalhando, chave)
		a.versao++
		a.mu.Unlock()
	}()
	legado := false
	a.mu.Lock()
	for _, lista := range []json.RawMessage{a.andamento, a.finalizadas} {
		for _, x := range listaDe(lista) {
			if chaveDaParticipacao(x) == chave {
				legado = legadoDaParticipacao(x)
			}
		}
	}
	a.mu.Unlock()
	marcarUso()
	d := m.detalharDireto(compraAcomp{chave, legado})
	_ = m.aplicarLeitura(leituraAcomp{Detalhes: map[string]*detalheCompra{chave: d}}, false)
}

// lerMaisFinalizadasAcomp: "Carregar mais" das finalizadas (as próximas páginas, 10 por página).
func (m *motor) lerMaisFinalizadasAcomp() {
	a := &m.acomp
	a.mu.Lock()
	if a.lendoMais {
		a.mu.Unlock()
		return
	}
	a.lendoMais = true
	ja := listaDe(a.finalizadas)
	paginas := a.paginasFinalizadas
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.lendoMais = false
		a.versao++
		a.mu.Unlock()
	}()
	marcarUso()
	tam := tamanhoPaginaAcomp()
	if len(ja)%tam != 0 {
		ja = nil // lida com outro tamanho de página: lê de novo desde o começo
	}
	todas := make([]json.RawMessage, 0, len(ja)+30)
	for _, x := range ja {
		b, _ := json.Marshal(x)
		todas = append(todas, b)
	}
	for pagina := len(ja) / tam; pagina < paginasPara(paginas*10, tam); pagina++ {
		r, err := m.consultarDiretoOpc("GET", fe+"/v1/compras/participacoes", fmt.Sprintf("filtro=6&pagina=%d&tamanhoPagina=%d", pagina, tam), true, nil, "", true)
		if err != nil || !okHTTP(r.Status) {
			break
		}
		l := listaQualquer(r.Corpo)
		todas = append(todas, l...)
		if len(l) < tam {
			break
		}
	}
	a.mu.Lock()
	a.finalizadas = juntarLista(todas)
	a.sujo = true
	a.mu.Unlock()
}

// ---------- última leitura guardada no computador (a aba abre na hora, antes da leitura nova) ----------

type cacheAcomp struct {
	Andamento     json.RawMessage           `json:"andamento"`
	Finalizadas   json.RawMessage           `json:"finalizadas"`
	Detalhes      map[string]*detalheCompra `json:"detalhes"`
	Em            int64                     `json:"em"`
	FinalizadasEm int64                     `json:"finalizadasEm"`
	Cnpj          string                    `json:"cnpj"`
}

func arquivoCacheAcomp() string { return filepath.Join(pastaInstalacao(), "acompanhamento.json") }

func (m *motor) carregarCacheAcomp() {
	dados, err := os.ReadFile(arquivoCacheAcomp())
	if err != nil {
		return
	}
	var c cacheAcomp
	if json.Unmarshal(dados, &c) != nil || len(listaDe(c.Andamento))+len(listaDe(c.Finalizadas)) == 0 {
		return
	}
	a := &m.acomp
	a.mu.Lock()
	a.andamento, a.finalizadas, a.detalhes = c.Andamento, c.Finalizadas, c.Detalhes
	if a.detalhes == nil {
		a.detalhes = map[string]*detalheCompra{}
	}
	a.em, a.finalizadasEm, a.cnpjCache = time.UnixMilli(c.Em), time.UnixMilli(c.FinalizadasEm), c.Cnpj
	a.doCache, a.versao = true, 1
	a.mu.Unlock()
}

// cicloCacheAcomp grava a leitura no disco (no máximo a cada 5 s, só quando mudou).
func (m *motor) cicloCacheAcomp() {
	for {
		time.Sleep(5 * time.Second)
		a := &m.acomp
		a.mu.Lock()
		if !a.sujo || a.doCache {
			a.mu.Unlock()
			continue
		}
		a.sujo = false
		dados, err := json.Marshal(cacheAcomp{a.andamento, a.finalizadas, a.detalhes, a.em.UnixMilli(), a.finalizadasEm.UnixMilli(), a.cnpjCache})
		a.mu.Unlock()
		if err != nil {
			continue
		}
		tmp := arquivoCacheAcomp() + ".tmp"
		if os.WriteFile(tmp, dados, 0o600) == nil {
			_ = os.Rename(tmp, arquivoCacheAcomp())
		}
	}
}

func (m *motor) roboConfereDisputas() {
	extras := m.comprasEmDisputaDoAcompanhamento()
	m.mu.Lock()
	falta := false
	for _, info := range extras {
		if m.compras[chaveDaCompraInfo(info)] == nil {
			falta = true
			break
		}
	}
	pronto := m.token != "" && m.fase == "pronto"
	m.mu.Unlock()
	if falta && pronto {
		m.atualizarLista()
	}
}

var codigoTodosItens atomic.Value // código do filtro "TODOS_ITENS" (lido em /v1/enums)

// filtroTodosItens: código oficial do filtro "Todos os itens" da seleção de fornecedores (1 se não der para ler).
func (m *motor) filtroTodosItens() string {
	if v, ok := codigoTodosItens.Load().(string); ok && v != "" {
		return v
	}
	codigo := ""
	if r, err := m.lerAcomp(fe+"/v1/enums", "", false); err == nil && okHTTP(r.Status) {
		var lista []struct {
			Name   string `json:"name"`
			Values []struct {
				Value    any    `json:"value"`
				EnumName string `json:"enumName"`
			} `json:"values"`
		}
		if json.Unmarshal(r.Corpo, &lista) == nil {
			for _, e := range lista {
				if e.Name != "FiltroItensParaSelecaoFornecedoresEnum" {
					continue
				}
				for _, v := range e.Values {
					if v.EnumName == "TODOS_ITENS" {
						codigo = textoDe(numeroInteiro(v.Value))
					}
				}
			}
		}
	}
	if codigo == "" {
		return "1"
	}
	codigoTodosItens.Store(codigo)
	return codigo
}

// todosItensSelecao: todos os itens da compra na seleção de fornecedores (em páginas de 100, até 500 itens).
func (m *motor) todosItensSelecao(chave string) []json.RawMessage {
	filtro := m.filtroTodosItens()
	var todos []json.RawMessage
	for pagina := 0; pagina < 5; pagina++ {
		r, err := m.lerAcomp(fe+"/v1/compras/"+chave+"/itens/em-selecao-fornecedores", fmt.Sprintf("filtro=%s&pagina=%d&tamanhoPagina=100", filtro, pagina), true)
		if err != nil || !okHTTP(r.Status) {
			break
		}
		l := listaQualquer(r.Corpo)
		todos = append(todos, l...)
		if len(l) < 100 {
			break
		}
	}
	return todos
}
