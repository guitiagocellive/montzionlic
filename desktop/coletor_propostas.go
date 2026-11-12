package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Base própria de propostas (Análise de empresas). Lê, devagar e em segundo plano, a tela "Todas as propostas"
// dos itens em que a SUA empresa participou (as mesmas que você vê no Compras.gov.br) e guarda as propostas de
// todas as empresas: valor, colocação, situação e motivo de desclassificação/inabilitação. A plataforma junta isso
// para mostrar participações, vitórias, derrotas e desclassificações de cada concorrente.
//
// Ritmo: uma leitura a cada 4 s, nunca durante disputa com robô ligado; o que já foi lido não é lido de novo
// (compras em andamento são relidas depois de 1 dia).

type propostaColetada struct {
	ID         string   `json:"id"`
	Compra     string   `json:"compra"`
	Item       int      `json:"item"`
	CNPJ       string   `json:"cnpj"`
	Empresa    string   `json:"empresa"`
	UF         string   `json:"uf,omitempty"`
	MeEpp      *bool    `json:"meEpp,omitempty"`
	Descricao  string   `json:"descricao,omitempty"`
	Quantidade *float64 `json:"quantidade,omitempty"`
	Valor      *float64 `json:"valor,omitempty"`
	Colocacao  int      `json:"colocacao,omitempty"`
	Situacao   string   `json:"situacao,omitempty"`
	Resultado  string   `json:"resultado"`
	Motivo     string   `json:"motivo,omitempty"`
	Orgao      string   `json:"orgao,omitempty"`
}

type coletorPropostas struct {
	mu        sync.Mutex
	feitos    map[string]int64 // "compra:item" -> quando foi lido (ms)
	pendentes []propostaColetada
	fila      []string // "compra:item:legado"
	paginaFin int      // próxima página de "Finalizadas" a ler (filtro 6)
	fimFin    bool
	carregado bool
}

var coletor = &coletorPropostas{feitos: map[string]int64{}}

func arquivoColetor() string { return filepath.Join(pastaInstalacao(), "propostas-coletadas.json") }

func (c *coletorPropostas) carregar() {
	if c.carregado {
		return
	}
	c.carregado = true
	dados, err := os.ReadFile(arquivoColetor())
	if err != nil {
		return
	}
	var v struct {
		Feitos    map[string]int64   `json:"feitos"`
		Pendentes []propostaColetada `json:"pendentes"`
		PaginaFin int                `json:"paginaFin"`
		FimFin    bool               `json:"fimFin"`
	}
	if json.Unmarshal(dados, &v) == nil {
		if v.Feitos != nil {
			c.feitos = v.Feitos
		}
		c.pendentes, c.paginaFin, c.fimFin = v.Pendentes, v.PaginaFin, v.FimFin
	}
}

func (c *coletorPropostas) gravar() {
	dados, err := json.Marshal(map[string]any{"feitos": c.feitos, "pendentes": c.pendentes, "paginaFin": c.paginaFin, "fimFin": c.fimFin})
	if err != nil {
		return
	}
	tmp := arquivoColetor() + ".tmp"
	if os.WriteFile(tmp, dados, 0o600) == nil {
		_ = os.Rename(tmp, arquivoColetor())
	}
}

// itensDaParticipacao: itens em que a empresa tem proposta, pelo detalhe que o Acompanhamento já leu.
func itensDoDetalhe(d *detalheCompra) []int {
	var nums []int
	for _, x := range listaDe(d.Itens) {
		if n := numeroDe(x["numero"]); n != nil {
			nums = append(nums, int(*n))
		}
	}
	return nums
}

func (m *motor) cicloColetorPropostas() {
	time.Sleep(40 * time.Second) // deixa o login e o Acompanhamento começarem primeiro
	for {
		time.Sleep(4 * time.Second)
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
		if !pronto || robo {
			continue
		}
		m.passoColetor()
	}
}

// passoColetor faz UMA leitura: um item da fila, ou monta a fila, ou lê mais uma página de Finalizadas.
func (m *motor) passoColetor() {
	c := coletor
	c.mu.Lock()
	c.carregar()
	if len(c.fila) == 0 {
		c.mu.Unlock()
		if !m.montarFilaColetor() {
			m.lerMaisFinalizadas()
		}
		return
	}
	alvo := c.fila[0]
	c.fila = c.fila[1:]
	c.mu.Unlock()
	partes := strings.Split(alvo, ":")
	if len(partes) < 2 {
		return
	}
	compra := partes[0]
	if partes[1] == "detalhe" {
		// Compra finalizada sem detalhe: lê os itens em que a empresa participou.
		d := m.detalharDireto(compraAcomp{Chave: compra, Legado: len(partes) > 2 && partes[2] == "1"})
		_ = m.aplicarLeitura(leituraAcomp{Detalhes: map[string]*detalheCompra{compra: d}}, false)
		return
	}
	var item int
	fmt.Sscan(partes[1], &item)
	registros, andamento, err := m.lerPropostasDoItem(compra, item)
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		registrarLog("coletor: item %d da compra %s: %v", item, mascararNumeros(compra), err)
		return
	}
	marca := time.Now().UnixMilli()
	if andamento {
		marca -= 6 * 86400000 // em andamento: lê de novo depois de 1 dia (7 dias de validade - 6)
	}
	c.feitos[compra+":"+fmt.Sprint(item)] = marca
	c.pendentes = append(c.pendentes, registros...)
	if len(c.pendentes) > 5000 {
		c.pendentes = c.pendentes[len(c.pendentes)-5000:]
	}
	c.gravar()
}

// montarFilaColetor: itens (já detalhados) das compras do Acompanhamento ainda não lidos; compras finalizadas
// sem detalhe entram como "detalhe". Devolve false se não achou nada para fazer.
func (m *motor) montarFilaColetor() bool {
	a := &m.acomp
	a.mu.Lock()
	type comp struct {
		chave  string
		legado bool
		fase   string
	}
	var compras []comp
	for _, lista := range []json.RawMessage{a.andamento, a.finalizadas} {
		for _, x := range listaDe(lista) {
			k := chaveDaParticipacao(x)
			if k == "" {
				continue
			}
			cx, _ := x["compra"].(map[string]any)
			if cx == nil {
				cx = x
			}
			compras = append(compras, comp{k, legadoDaParticipacao(x), textoDe(numeroInteiro(cx["faseCompraFaseExterna"]))})
		}
	}
	detalhes := map[string][]int{}
	for k, d := range a.detalhes {
		detalhes[k] = itensDoDetalhe(d)
	}
	a.mu.Unlock()

	c := coletor
	c.mu.Lock()
	defer c.mu.Unlock()
	agora := time.Now().UnixMilli()
	vistos := map[string]bool{}
	semDetalhe := 0
	for _, cp := range compras {
		if vistos[cp.chave] {
			continue
		}
		vistos[cp.chave] = true
		// Só compras em que já dá para ver as propostas (seleção de fornecedores em diante).
		if cp.fase == "1" || cp.fase == "2" || cp.fase == "3" || cp.fase == "99" {
			continue
		}
		itens, ok := detalhes[cp.chave]
		if !ok {
			if semDetalhe < 3 {
				legado := "0"
				if cp.legado {
					legado = "1"
				}
				c.fila = append(c.fila, cp.chave+":detalhe:"+legado)
				semDetalhe++
			}
			continue
		}
		for _, n := range itens {
			if t, ok := c.feitos[cp.chave+":"+fmt.Sprint(n)]; ok && agora-t < 7*86400000 {
				continue
			}
			c.fila = append(c.fila, cp.chave+":"+fmt.Sprint(n))
		}
	}
	return len(c.fila) > 0
}

// lerMaisFinalizadas: mais uma página das suas participações finalizadas (para a base ir além das 30 recentes).
func (m *motor) lerMaisFinalizadas() {
	c := coletor
	c.mu.Lock()
	if c.fimFin {
		c.mu.Unlock()
		return
	}
	pagina := c.paginaFin
	if pagina < 3 {
		pagina = 3 // as 3 primeiras o Acompanhamento já lê
	}
	c.mu.Unlock()
	r, err := m.consultarDiretoOpc("GET", fe+"/v1/compras/participacoes", fmt.Sprintf("filtro=6&pagina=%d&tamanhoPagina=10", pagina), true, nil, "", true)
	if err != nil || !okHTTP(r.Status) {
		return
	}
	l := listaQualquer(r.Corpo)
	a := &m.acomp
	a.mu.Lock()
	atuais := listaDe(a.finalizadas)
	ja := map[string]bool{}
	for _, x := range atuais {
		ja[chaveDaParticipacao(x)] = true
	}
	var novas []json.RawMessage
	_ = json.Unmarshal(a.finalizadas, &novas)
	for _, x := range l {
		var o map[string]any
		if json.Unmarshal(x, &o) == nil && !ja[chaveDaParticipacao(o)] {
			novas = append(novas, x)
		}
	}
	a.finalizadas = juntarLista(novas)
	a.mu.Unlock()
	c.mu.Lock()
	c.paginaFin = pagina + 1
	paginas := 0
	fmt.Sscan(r.Cab.Get("pages-count"), &paginas)
	if len(l) < 10 || (paginas > 0 && pagina+1 >= paginas) || pagina > 60 {
		c.fimFin = true
	}
	c.gravar()
	c.mu.Unlock()
}

// lerPropostasDoItem: "Todas as propostas" do item, como a tela oficial da seleção de fornecedores.
func (m *motor) lerPropostasDoItem(compra string, item int) ([]propostaColetada, bool, error) {
	k := url.PathEscape(compra)
	r, err := m.consultarDireto("GET", fmt.Sprintf("%s/v1/compras/%s/em-selecao-fornecedores/itens/%d/propostas", fe, k, item), "ordenacao-propostas=P", false, nil, "")
	if err != nil {
		return nil, false, err
	}
	corpo := r.Corpo
	if !okHTTP(r.Status) || respostaVazia(corpo) {
		r2, err := m.consultarDireto("GET", fmt.Sprintf("%s/v1/compras/%s/itens/%d/propostas", fe, k, item), "", true, nil, "")
		if err != nil {
			return nil, false, err
		}
		if !okHTTP(r2.Status) {
			return nil, false, fmt.Errorf("o Compras.gov.br respondeu %d/%d", r.Status, r2.Status)
		}
		corpo = r2.Corpo
	}
	// Item com as propostas: objeto, ou lista com o item na primeira posição.
	var obj map[string]any
	if json.Unmarshal(corpo, &obj) != nil {
		var l []map[string]any
		if json.Unmarshal(corpo, &l) == nil && len(l) > 0 {
			obj = l[0]
		}
	}
	if obj == nil {
		return nil, false, nil
	}
	props, _ := obj["propostasItem"].([]any)
	descricao := textoDe(firstNonNil(obj["descricao"], obj["descricaoDetalhada"]))
	if len(descricao) > 300 {
		descricao = descricao[:300]
	}
	qtd := numeroDe(firstNonNil(obj["quantidadeSolicitada"], obj["quantidade"]))
	orgao := ""
	m.acomp.mu.Lock()
	for _, lista := range []json.RawMessage{m.acomp.andamento, m.acomp.finalizadas} {
		for _, x := range listaDe(lista) {
			if chaveDaParticipacao(x) == compra {
				if cx, ok := x["compra"].(map[string]any); ok {
					orgao = textoDe(cx["nomeUasg"])
				}
			}
		}
	}
	m.acomp.mu.Unlock()

	type cand struct {
		p   propostaColetada
		sit string
	}
	var lista []cand
	for i, b := range props {
		p, _ := b.(map[string]any)
		if p == nil {
			continue
		}
		part, _ := p["participante"].(map[string]any)
		cnpj := soDigitos(textoDe(firstNonNil(func() any {
			if part != nil {
				return part["identificacao"]
			}
			return nil
		}(), p["identificacaoParticipante"])))
		if len(cnpj) != 14 {
			continue
		}
		valores, _ := p["valores"].(map[string]any)
		var valor *float64
		if valores != nil {
			for _, kk := range []string{"valorNegociado", "valorPropostaInicialOuLances", "valorPropostaInicial"} {
				if v := valorDe(valores[kk]); v != nil {
					valor = v
					break
				}
			}
		}
		col := i + 1
		if n := numeroDe(p["classificacao"]); n != nil {
			col = int(*n)
		}
		uf := ""
		if part != nil {
			if end, ok := part["endereco"].(map[string]any); ok {
				uf = textoDe(end["uf"])
			}
		}
		var meEpp *bool
		if b, ok := p["declaracaoMeEpp"].(bool); ok {
			meEpp = &b
		}
		sit := textoDe(numeroInteiro(p["situacao"]))
		motivo := textoDe(firstNonNil(p["motivoDesclassificacao"], p["justificativaDesclassificacao"]))
		if len(motivo) > 500 {
			motivo = motivo[:500]
		}
		nome := ""
		if part != nil {
			nome = textoDe(part["nome"])
		}
		lista = append(lista, cand{propostaColetada{
			ID: compra + ":" + fmt.Sprint(item) + ":" + cnpj, Compra: compra, Item: item, CNPJ: cnpj, Empresa: nome, UF: uf, MeEpp: meEpp,
			Descricao: descricao, Quantidade: qtd, Valor: valor, Colocacao: col, Situacao: sit, Motivo: motivo, Orgao: orgao,
		}, sit})
	}
	// Resultado de cada proposta: desclassificada/inabilitada pela situação; vencedora = adjudicada, ou a mais bem
	// colocada entre as aceitas/habilitadas quando o item já foi decidido. Sem decisão ainda: "andamento".
	vencedor := -1
	melhorCol := math.MaxInt32
	for i, x := range lista {
		if x.sit == "6" {
			vencedor = i
			break
		}
		if (x.sit == "4") && x.p.Colocacao < melhorCol {
			vencedor, melhorCol = i, x.p.Colocacao
		}
	}
	andamento := vencedor < 0
	saida := make([]propostaColetada, 0, len(lista))
	for i, x := range lista {
		p := x.p
		switch {
		case x.sit == "1" || x.sit == "2" || x.sit == "9":
			p.Resultado = "desclassificada"
		case x.sit == "5":
			p.Resultado = "inabilitada"
		case vencedor == i:
			p.Resultado = "vitoria"
		case vencedor >= 0:
			p.Resultado = "derrota"
		default:
			p.Resultado = "andamento"
		}
		saida = append(saida, p)
	}
	sort.SliceStable(saida, func(i, j int) bool { return saida[i].Colocacao < saida[j].Colocacao })
	return saida, andamento, nil
}

// PropostasColetadas entrega à plataforma o que ainda não foi enviado (até 300 por vez).
func (m *motor) PropostasColetadas() any {
	c := coletor
	c.mu.Lock()
	defer c.mu.Unlock()
	c.carregar()
	n := len(c.pendentes)
	if n > 300 {
		n = 300
	}
	return mapa{"propostas": append([]propostaColetada{}, c.pendentes[:n]...), "restantes": len(c.pendentes) - n, "itensLidos": len(c.feitos), "naFila": len(c.fila)}
}

// PropostasEnviadas tira da fila as que a plataforma já gravou.
func (m *motor) PropostasEnviadas(ids []string) any {
	c := coletor
	c.mu.Lock()
	defer c.mu.Unlock()
	tirar := map[string]bool{}
	for _, id := range ids {
		tirar[id] = true
	}
	resto := c.pendentes[:0]
	for _, p := range c.pendentes {
		if !tirar[p.ID] {
			resto = append(resto, p)
		}
	}
	c.pendentes = resto
	c.gravar()
	return mapa{"ok": true}
}
