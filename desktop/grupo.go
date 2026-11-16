package main

// Disputa por grupo: no Compras.gov.br o lance é dado em CADA ITEM do grupo (valor unitário) e o valor do grupo é
// a soma de unitário × quantidade. A sala oficial lê os itens do grupo em
// /comprasnet-disputa/v1/compras/{compra}/itens/em-disputa/{grupo}/itens-grupo e manda o lance de cada item pela
// mesma rota de lance de item (POST .../itens/{item}/lances), com a fase do grupo.
//
// O robô decide no total do grupo (a mesma regra de um item: cobrir o 1º, melhor colocação, aberto-fechado...),
// com o mínimo do grupo = soma de mínimo × quantidade de cada item, e reparte a redução entre os itens: começa pelo
// item com mais folga até o mínimo dele, respeitando o desconto e o intervalo do edital de cada item.

import (
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// subitemMotor: um item de dentro de um grupo.
type subitemMotor struct {
	bruto map[string]any
	em    time.Time
}

// unitarioDe: valor unitário de um campo de valor de item de grupo ({valorInformado, valorCalculado:{valorUnitario,
// valorTotal}} ou número).
func unitarioDe(v any) *float64 {
	if m, ok := v.(map[string]any); ok {
		if f := numeroDe(m["valorInformado"]); f != nil {
			return f
		}
		if vc, ok := m["valorCalculado"].(map[string]any); ok {
			return numeroDe(vc["valorUnitario"])
		}
		return numeroDe(m["valorCalculado"])
	}
	return numeroDe(v)
}

func quantidadeDe(b map[string]any) float64 {
	for _, k := range []string{"quantidade", "quantidadeSolicitada", "quantidadeItem"} {
		if q := numeroDe(b[k]); q != nil && *q > 0 {
			return *q
		}
	}
	return 0
}

// grupoDoSubitem: o grupo de um aviso de subitem (pelo próprio aviso ou por já ter lido os itens do grupo).
func (c *compraMotor) grupoDoSubitem(b map[string]any, numero int) (int, bool) {
	for _, k := range []string{"numeroGrupo", "grupo"} {
		switch g := b[k].(type) {
		case float64:
			if g < 0 {
				return int(g), true
			}
		case map[string]any:
			if n := numeroDe(g["numero"]); n != nil && *n < 0 {
				return int(*n), true
			}
		}
	}
	g, ok := c.subGrupo[numero]
	return g, ok
}

// mesclarSub guarda um item de grupo; devolve a chave do grupo (para o robô reavaliar) ou "" se não é subitem.
func (m *motor) mesclarSub(c *compraMotor, novo map[string]any, agora time.Time) (string, bool) {
	n := numeroDe(novo["numero"])
	if n == nil || *n < 0 {
		return "", false
	}
	numero := int(*n)
	sub, _ := novo["isSubItem"].(bool)
	grupo, conhecido := c.grupoDoSubitem(novo, numero)
	if !sub && !conhecido {
		return "", false
	}
	if !conhecido {
		return "", true // subitem de grupo ainda não lido: a próxima leitura dos itens do grupo traz
	}
	if c.subitens == nil {
		c.subitens = map[int]map[int]*subitemMotor{}
	}
	if c.subitens[grupo] == nil {
		c.subitens[grupo] = map[int]*subitemMotor{}
	}
	s := c.subitens[grupo][numero]
	if s == nil {
		s = &subitemMotor{bruto: map[string]any{}}
		c.subitens[grupo][numero] = s
	}
	for k, v := range novo {
		s.bruto[k] = v
	}
	s.em = agora
	if c.subGrupo == nil {
		c.subGrupo = map[int]int{}
	}
	c.subGrupo[numero] = grupo
	return chaveItem(c.chave, grupo), true
}

// lerSubitens: os itens de dentro de um grupo em disputa (sem captcha, como a sala oficial).
func (m *motor) lerSubitens(compra string, grupo int) {
	status, dados, err := m.pedir("GET", fmt.Sprintf("/comprasnet-disputa/v1/compras/%s/itens/em-disputa/%d/itens-grupo", url.PathEscape(compra), grupo), nil)
	agora := time.Now()
	m.mu.Lock()
	c := m.compras[compra]
	if c == nil {
		m.mu.Unlock()
		return
	}
	if c.subLidos == nil {
		c.subLidos = map[int]time.Time{}
	}
	c.subLidos[grupo] = agora
	if err != nil || status != 200 {
		if c.subErro == nil {
			c.subErro = map[int]string{}
		}
		if c.subErro[grupo] == "" {
			registrarLog("robô: itens do grupo %d da compra %s: %d %v", grupo, mascararNumeros(compra), status, err)
		}
		c.subErro[grupo] = fmt.Sprintf("erro %d", status)
		m.mu.Unlock()
		return
	}
	if c.subErro != nil {
		delete(c.subErro, grupo)
	}
	if c.subGrupo == nil {
		c.subGrupo = map[int]int{}
	}
	lista := listaJSON(string(dados))
	if len(lista) == 1 {
		if itens, ok := lista[0]["itens"].([]any); ok { // resposta paginada {itens: [...]}
			lista = nil
			for _, x := range itens {
				if mm, ok := x.(map[string]any); ok {
					lista = append(lista, mm)
				}
			}
		}
	}
	antes := len(c.subitens[grupo])
	for _, b := range lista {
		if n := numeroDe(b["numero"]); n != nil && *n > 0 {
			c.subGrupo[int(*n)] = grupo
			b["isSubItem"] = true
			m.mesclarSub(c, b, agora)
		}
	}
	if antes == 0 && len(c.subitens[grupo]) > 0 {
		registrarLog("robô: grupo %d da compra %s: %d itens", grupo, mascararNumeros(compra), len(c.subitens[grupo]))
		marcarRobo("%s: %d itens no grupo — campos de valor do 1º: %s", rotuloItem(chaveItem(compra, grupo)), len(c.subitens[grupo]), camposDeValor(lista[0]))
	}
	m.mu.Unlock()
	m.avaliar(chaveItem(compra, grupo))
}

// talvezLerSubitens (com m.mu travado): relê os itens dos grupos da compra de tempos em tempos (2 s na reta final
// com o robô ligado; 15 s no resto). O tempo real atualiza no meio.
func (m *motor) talvezLerSubitens(c *compraMotor, agora time.Time) {
	for n, it := range c.itens {
		if n >= 0 {
			continue
		}
		e := m.estadoAgora(it, agora)
		if e.Fase == "E" {
			continue
		}
		cfg := m.config[chaveItem(c.chave, n)]
		intervalo := 15 * time.Second
		if cfg.Ligado && retaFinal(e, &cfg) {
			intervalo = 2 * time.Second
		}
		if c.subLendo == nil {
			c.subLendo = map[int]bool{}
		}
		if c.subLendo[n] || agora.Sub(c.subLidos[n]) < intervalo {
			continue
		}
		c.subLendo[n] = true
		go func(compra string, grupo int) {
			m.lerSubitens(compra, grupo)
			m.mu.Lock()
			if c := m.compras[compra]; c != nil && c.subLendo != nil {
				c.subLendo[grupo] = false
			}
			m.mu.Unlock()
		}(c.chave, n)
	}
}

// linhaGrupo: um item do grupo para a regra.
type linhaGrupo struct {
	Numero     int
	Quantidade float64
	Nosso      float64
	Minimo     float64
	Desconto   float64 // R$ por unidade
	Passo      float64 // intervalo do edital (R$ por unidade) sobre o próprio lance
}

type lanceGrupo struct {
	Numero int
	Valor  float64
}

// distribuirReducao reparte "reducao" (R$ no total do grupo) entre os itens: começa pelo item com mais folga
// (R$ até o mínimo × quantidade); em cada item baixa pelo menos o desconto/intervalo; nunca abaixo do mínimo.
// Devolve os lances e quanto o total baixou de fato.
func distribuirReducao(itens []linhaGrupo, reducao float64, quatro bool) ([]lanceGrupo, float64) {
	ordem := append([]linhaGrupo{}, itens...)
	sort.SliceStable(ordem, func(a, b int) bool {
		return (ordem[a].Nosso-ordem[a].Minimo)*ordem[a].Quantidade > (ordem[b].Nosso-ordem[b].Minimo)*ordem[b].Quantidade
	})
	falta := reducao
	baixou := 0.0
	var lances []lanceGrupo
	for _, it := range ordem {
		if falta <= 1e-9 {
			break
		}
		if it.Quantidade <= 0 || it.Nosso <= it.Minimo+1e-9 {
			continue
		}
		porUnidade := arredondarAcima(falta/it.Quantidade, quatro)
		porUnidade = math.Max(porUnidade, math.Max(it.Desconto, it.Passo))
		novo := arredondarAbaixo(it.Nosso-porUnidade, quatro)
		if novo < it.Minimo {
			novo = it.Minimo
		}
		// O intervalo do edital vale sobre o nosso lance anterior: no mínimo, se não couber o intervalo, não dá lance.
		if novo > arredondarAbaixo(it.Nosso-it.Passo, quatro)+1e-9 || !(novo < it.Nosso-1e-9) {
			continue
		}
		d := (it.Nosso - novo) * it.Quantidade
		baixou += d
		falta -= d
		lances = append(lances, lanceGrupo{Numero: it.Numero, Valor: novo})
	}
	return lances, baixou
}

// avaliarGrupo: a regra do robô num grupo (chamada por avaliar quando o número do item é negativo).
func (m *motor) avaliarGrupo(compra string, grupo int, k string) {
	agora := time.Now()
	m.mu.Lock()
	cfg, temCfg := m.config[k]
	c := m.compras[compra]
	if !temCfg || !cfg.Ligado || c == nil || m.token == "" || c.itens[grupo] == nil {
		m.mu.Unlock()
		return
	}
	e := m.estadoAgora(c.itens[grupo], agora)
	subs := c.subitens[grupo]
	msg := func(t string) {
		if m.mensagens[k].Texto != t {
			m.mensagens[k] = mensagemItem{Texto: t}
		}
		marcarDecisao(k, decisao{Tipo: "grupo", Motivo: t})
		m.mu.Unlock()
	}
	if len(subs) == 0 {
		msg("Lendo os itens do grupo…")
		return
	}
	numeros := make([]int, 0, len(subs))
	for n := range subs {
		numeros = append(numeros, n)
	}
	sort.Ints(numeros)
	var linhas []linhaGrupo
	total, minimoTotal := 0.0, 0.0
	semMinimo, semLance := []string{}, []string{}
	for _, n := range numeros {
		b := subs[n].bruto
		ci := m.config[chaveItem(compra, n)]
		q := quantidadeDe(b)
		nosso := unitarioDe(b["melhorValorFornecedor"])
		if nosso == nil {
			semLance = append(semLance, strconv.Itoa(n))
			continue
		}
		if ci.Minimo == nil || !(*ci.Minimo > 0) {
			semMinimo = append(semMinimo, strconv.Itoa(n))
			continue
		}
		if q <= 0 {
			msg(fmt.Sprintf("Item %d do grupo sem quantidade: o robô não calcula o total do grupo", n))
			return
		}
		ei := lerItem(b)
		if ei.Variacao == nil {
			ei.Variacao, ei.TipoVariacao = e.Variacao, e.TipoVariacao // intervalo do grupo vale para os itens
		}
		minimo := arredondarAcima(*ci.Minimo, false)
		linhas = append(linhas, linhaGrupo{Numero: n, Quantidade: q, Nosso: *nosso, Minimo: minimo,
			Desconto: arredondarAcima(valorDoDesconto(*nosso, &ci), false), Passo: passoMinimo(*nosso, ei, false)})
		total += *nosso * q
		minimoTotal += minimo * q
	}
	if len(semLance) > 0 {
		msg("Sem lance nosso nos itens " + strings.Join(semLance, ", ") + " do grupo")
		return
	}
	if len(semMinimo) > 0 {
		msg("Informe o lance mínimo de cada item do grupo (falta: item " + strings.Join(semMinimo, ", ") + ")")
		return
	}
	total = math.Round(total*100) / 100
	// O total do grupo que o Compras.gov.br mostra precisa bater com a soma dos itens: senão não sabemos em que base
	// vem o melhor lance e o robô não dá lance.
	if e.Nosso != nil && math.Abs(*e.Nosso-total) > math.Max(0.05, total*0.002) {
		if agora.Sub(c.grupoEnviado[grupo]) < 6*time.Second {
			msg("Aguardando o Compras.gov.br atualizar o total do grupo…") // logo depois dos nossos lances
			return
		}
		msg(fmt.Sprintf("Os valores do grupo não batem: o Compras mostra %s e a soma dos itens dá %s — o robô não dá lance aqui", reaisTexto(*e.Nosso, false), reaisTexto(total, false)))
		return
	}
	e.Nosso = &total
	um := 0.01
	e.Variacao, e.TipoVariacao = &um, "V"
	e.AbertoFechado = m.abertoFechado(compra)
	if r := m.ranking[k]; r != nil && !r.em.IsZero() && agora.Sub(r.em) < 20*time.Second {
		e.Concorrentes = append([]float64{}, r.concorrentes...)
	}
	m.reconhecerMeuLance(k, &e, agora)
	sint := configItem{Ligado: true, Minimo: &minimoTotal, TipoDesconto: "V", NaoAguardar: cfg.NaoAguardar, LutarPrimeiro: cfg.LutarPrimeiro}
	d := decidir(e, &sint)
	if intervalo := intervaloClassificacao(e, &sint, d, m.ranking[k] != nil && !m.ranking[k].em.IsZero()); intervalo > 0 && (!freado() || retaFinal(e, &sint)) {
		m.pedirClassificacao(compra, grupo, k, intervalo)
	}
	if !d.Enviar {
		msg(d.Motivo)
		return
	}
	if agora.Before(m.enviando[k]) {
		m.mu.Unlock()
		return
	}
	lances, baixou := distribuirReducao(linhas, total-d.Valor, false)
	if len(lances) == 0 {
		msg("Grupo: não dá para baixar nenhum item sem passar do mínimo dele")
		return
	}
	novoTotal := math.Round((total-baixou)*100) / 100
	marcarDecisao(k, decisao{Tipo: d.Tipo, Motivo: fmt.Sprintf("%s — grupo de %s para %s em %d item(ns)", d.Motivo, reaisTexto(total, false), reaisTexto(novoTotal, false), len(lances))})
	m.enviando[k] = agora.Add(5 * time.Second)
	m.meusValores[k] = append(m.meusValores[k], valorEnviado{novoTotal, agora})
	m.mensagens[k] = mensagemItem{Texto: fmt.Sprintf("Enviando lances em %d item(ns) do grupo (total %s)…", len(lances), reaisTexto(novoTotal, false))}
	reacao := agora.Sub(c.itens[grupo].atualizadoEm).Milliseconds()
	fase := e.Fase
	m.mu.Unlock()
	go func() {
		recusou := ""
		for _, l := range lances {
			dl := decisao{Enviar: true, Tipo: d.Tipo, Valor: l.Valor, Posicao: d.Posicao}
			// Um lance por item, um depois do outro (o Compras.gov.br recalcula o grupo a cada um).
			m.enviarLance(compra, l.Numero, chaveItem(compra, l.Numero), dl, fase, false, reacao)
			m.mu.Lock()
			if r := m.ultimos[chaveItem(compra, l.Numero)]; !r.OK && recusou == "" {
				recusou = fmt.Sprintf("item %d: %s", l.Numero, r.Mensagem)
			}
			if c := m.compras[compra]; c != nil && c.subitens[grupo] != nil && c.subitens[grupo][l.Numero] != nil && m.ultimos[chaveItem(compra, l.Numero)].OK {
				c.subitens[grupo][l.Numero].bruto["melhorValorFornecedor"] = map[string]any{"valorInformado": l.Valor}
			}
			m.mu.Unlock()
		}
		m.mu.Lock()
		m.enviando[k] = time.Time{}
		if c := m.compras[compra]; c != nil {
			if c.grupoEnviado == nil {
				c.grupoEnviado = map[int]time.Time{}
			}
			c.grupoEnviado[grupo] = time.Now()
			// Já conta o novo total do grupo (o aviso do tempo real confirma logo em seguida).
			if it := c.itens[grupo]; it != nil && recusou == "" {
				v := map[string]any{"valorCalculado": novoTotal, "valorInformado": novoTotal}
				it.bruto["melhorValorFornecedor"] = v
				if melhor := valorDe(it.bruto["melhorValorGeral"]); melhor == nil || novoTotal < *melhor {
					it.bruto["melhorValorGeral"] = v
					it.bruto["situacaoParticipanteDisputa"] = "G"
				}
			}
		}
		if recusou != "" {
			m.mensagens[k] = mensagemItem{Texto: "Grupo: lance recusado no " + recusou, Erro: true}
		} else {
			m.mensagens[k] = mensagemItem{Texto: "Lances do grupo enviados (total " + reaisTexto(novoTotal, false) + ")"}
		}
		m.mu.Unlock()
		go m.lerItens(compra) // confere o grupo no Compras.gov.br
		m.avaliar(k)
	}()
}

// subitensPainel (com m.mu travado): os itens do grupo para a tela, com a fase do grupo.
func subitensPainel(c *compraMotor, grupo int, fase string) []map[string]any {
	subs := c.subitens[grupo]
	numeros := make([]int, 0, len(subs))
	for n := range subs {
		numeros = append(numeros, n)
	}
	sort.Ints(numeros)
	lista := make([]map[string]any, 0, len(numeros))
	for _, n := range numeros {
		copia := make(map[string]any, len(subs[n].bruto)+3)
		for k, v := range subs[n].bruto {
			copia[k] = v
		}
		copia["fase"] = fase
		if u := unitarioDe(subs[n].bruto["melhorValorFornecedor"]); u != nil {
			copia["nossoUnitario"] = *u
		}
		if u := unitarioDe(subs[n].bruto["melhorValorGeral"]); u != nil {
			copia["melhorUnitario"] = *u
		}
		copia["quantidadeGrupo"] = quantidadeDe(subs[n].bruto)
		lista = append(lista, copia)
	}
	return lista
}
