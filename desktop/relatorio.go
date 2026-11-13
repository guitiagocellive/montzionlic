package main

// Relatório de cada disputa: quando a disputa de um item termina, o aplicativo salva um arquivo com o resultado,
// um resumo em números (lances dos concorrentes, nossos lances, tempo de reação do robô, tempo de aceite do
// Compras.gov.br) e a linha do tempo completa do item. A pessoa abre pela página Disputas ("Relatórios das
// disputas") e copia para o suporte, mesmo horas depois. Sem chaves, tokens nem CPF/CNPJ (números longos
// mascarados). Guarda os 60 mais recentes.

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const maxRelatorios = 60

func pastaRelatorios() string { return filepath.Join(pastaInstalacao(), "relatorios") }

// estatisticasDisputa: as contas do resumo a partir dos eventos marcados do item.
type estatisticasDisputa struct {
	lancesConcorrentes int
	nossosOK           int
	nossosRecusados    int
	reacoes            []int64  // ms do lance de concorrente até o robô enviar o nosso
	semResposta        int      // lances de concorrente que o robô não respondeu (no mínimo, ganhar tempo, fora dos 10 s…)
	pedidos            []int64  // ms do pedido ao Compras.gov.br em cada lance nosso
	leituras           []int64  // ms de cada leitura da classificação registrada
	posicoes           []string // "Nº de M" em cada leitura da classificação (sua posição ao longo da disputa)
}

var posicaoNaLeitura = regexp.MustCompile(`você em (\d+º de \d+)`)

func calcularEstatisticas(ev []eventoRobo) estatisticasDisputa {
	var st estatisticasDisputa
	for i, e := range ev {
		switch e.tipo {
		case "melhor-conc":
			st.lancesConcorrentes++
			respondeu := false
			for _, d := range ev[i+1:] {
				if d.em.Sub(e.em) > 5*time.Second {
					break
				}
				if d.tipo == "melhor-conc" {
					break // outro lance de concorrente antes da nossa resposta
				}
				if d.tipo == "enviando" {
					st.reacoes = append(st.reacoes, d.em.Sub(e.em).Milliseconds())
					respondeu = true
					break
				}
			}
			if !respondeu {
				st.semResposta++
			}
		case "lance-ok":
			st.nossosOK++
			st.pedidos = append(st.pedidos, e.ms)
		case "lance-recusado":
			st.nossosRecusados++
			st.pedidos = append(st.pedidos, e.ms)
		case "classif":
			st.leituras = append(st.leituras, e.ms)
			if m := posicaoNaLeitura.FindStringSubmatch(e.texto); m != nil {
				st.posicoes = append(st.posicoes, m[1])
			}
		}
	}
	return st
}

func maximo(v []int64) int64 {
	var m int64 = -1
	for _, x := range v {
		if x > m {
			m = x
		}
	}
	return m
}

var naoArquivo = regexp.MustCompile(`[^\w\-]+`)

// salvarRelatorioDisputa: chamado quando a disputa do item termina (com o resultado já lido).
func salvarRelatorioDisputa(rotulo string, r resultadoDisputa) {
	linhaTempo.mu.Lock()
	ev := append([]eventoRobo(nil), linhaTempo.porItem[rotulo]...)
	delete(linhaTempo.porItem, rotulo) // a próxima disputa do mesmo item começa do zero
	var gerais []eventoRobo
	if len(ev) > 0 {
		inicio := ev[0].em.Add(-time.Minute)
		for _, g := range linhaTempo.gerais {
			if !g.em.Before(inicio) {
				gerais = append(gerais, g)
			}
		}
	}
	linhaTempo.mu.Unlock()
	if len(ev) == 0 {
		return
	}
	st := calcularEstatisticas(ev)
	agora := time.Now()
	var b strings.Builder
	fmt.Fprintf(&b, "Relatório da disputa — Montzion %s\n", versao)
	titulo := rotulo
	if r.Descricao != "" {
		titulo += " — " + r.Descricao
	}
	fmt.Fprintf(&b, "%s\nEncerrada em %s · robô ligado no fim: %v\n", titulo, agora.Format("02/01 15:04:05"), r.Robo)
	resultado := "posição não lida"
	if r.Posicao > 0 {
		resultado = fmt.Sprintf("%dº lugar", r.Posicao)
		if r.Total > 0 {
			resultado += fmt.Sprintf(" de %d", r.Total)
		}
	}
	if r.Nosso != nil {
		resultado += " · nosso lance " + reaisTexto(*r.Nosso, true)
	}
	if r.Primeiro != nil {
		resultado += " · 1º lugar " + reaisTexto(*r.Primeiro, true)
	}
	fmt.Fprintf(&b, "Resultado: %s\n\n== Resumo ==\n", resultado)
	fmt.Fprintf(&b, "Duração acompanhada: %s (de %s a %s)\n", agora.Sub(ev[0].em).Round(time.Second), ev[0].em.Format("15:04:05"), ev[len(ev)-1].em.Format("15:04:05"))
	fmt.Fprintf(&b, "Mudanças no 1º lugar com um concorrente à nossa frente: %d\n", st.lancesConcorrentes)
	fmt.Fprintf(&b, "Nossos lances: %d aceitos, %d recusados\n", st.nossosOK, st.nossosRecusados)
	if len(st.reacoes) > 0 {
		fmt.Fprintf(&b, "Reação do robô a lance de concorrente (aviso → nosso lance sair): mediana %d ms, pior %d ms (%d respostas)\n", mediana(st.reacoes), maximo(st.reacoes), len(st.reacoes))
	}
	if st.lancesConcorrentes > 0 {
		fmt.Fprintf(&b, "Respondidos pelo robô: %d de %d (os outros ficaram abaixo do seu mínimo, fora dos 10 s finais, ganhando tempo ou com o robô desligado — veja a decisão na linha do tempo)\n", len(st.reacoes), st.lancesConcorrentes)
	}
	if len(st.leituras) > 0 {
		fmt.Fprintf(&b, "Leituras da classificação registradas: %d (mediana %d ms, pior %d ms)\n", len(st.leituras), mediana(st.leituras), maximo(st.leituras))
	}
	if len(st.posicoes) > 0 {
		fmt.Fprintf(&b, "Sua posição pela classificação: começou em %s, terminou em %s\n", st.posicoes[0], st.posicoes[len(st.posicoes)-1])
	}
	if len(st.pedidos) > 0 {
		fmt.Fprintf(&b, "Aceite do Compras.gov.br (pedido do lance → resposta): mediana %d ms, pior %d ms\n", mediana(st.pedidos), maximo(st.pedidos))
	}
	b.WriteString("\n== Linha do tempo do item ==\n")
	var antes time.Time
	for _, e := range ev {
		delta := ""
		if !antes.IsZero() {
			delta = fmt.Sprintf("+%d ms", e.em.Sub(antes).Milliseconds())
		}
		texto := strings.TrimPrefix(e.texto, rotulo+": ")
		fmt.Fprintf(&b, "%s %11s  %s\n", e.em.Format("15:04:05.000"), delta, texto)
		antes = e.em
	}
	if len(gerais) > 0 {
		b.WriteString("\n== Eventos gerais no período (captcha, freio do 429) ==\n")
		for _, g := range gerais {
			fmt.Fprintf(&b, "%s  %s\n", g.em.Format("15:04:05.000"), g.texto)
		}
	}
	texto := mascararNumeros(b.String())
	_ = os.MkdirAll(pastaRelatorios(), 0o755)
	nome := agora.Format("2006-01-02_150405") + "_" + strings.Trim(naoArquivo.ReplaceAllString(strings.ReplaceAll(rotulo, "…", ""), "-"), "-") + ".txt"
	if err := os.WriteFile(filepath.Join(pastaRelatorios(), nome), []byte(texto), 0o644); err != nil {
		registrarLog("relatório da disputa: não salvou (%v)", err)
		return
	}
	registrarLog("relatório da disputa salvo: %s", nome)
	limparRelatoriosAntigos()
}

func limparRelatoriosAntigos() {
	arquivos, _ := filepath.Glob(filepath.Join(pastaRelatorios(), "*.txt"))
	if len(arquivos) <= maxRelatorios {
		return
	}
	sort.Strings(arquivos) // o nome começa com a data: os primeiros são os mais antigos
	for _, a := range arquivos[:len(arquivos)-maxRelatorios] {
		_ = os.Remove(a)
	}
}

type relatorioResumo struct {
	Nome   string `json:"nome"`
	Em     int64  `json:"em"`
	Titulo string `json:"titulo"`
	Result string `json:"resultado"`
}

// listarRelatorios: os relatórios salvos, do mais novo para o mais antigo.
func listarRelatorios() []relatorioResumo {
	arquivos, _ := filepath.Glob(filepath.Join(pastaRelatorios(), "*.txt"))
	sort.Sort(sort.Reverse(sort.StringSlice(arquivos)))
	lista := []relatorioResumo{}
	for _, a := range arquivos {
		info, err := os.Stat(a)
		if err != nil {
			continue
		}
		dados, _ := os.ReadFile(a)
		linhas := strings.SplitN(string(dados), "\n", 5)
		r := relatorioResumo{Nome: filepath.Base(a), Em: info.ModTime().UnixMilli()}
		if len(linhas) > 1 {
			r.Titulo = linhas[1]
		}
		if len(linhas) > 3 {
			r.Result = strings.TrimPrefix(linhas[3], "Resultado: ")
		}
		lista = append(lista, r)
	}
	return lista
}

var nomeRelatorio = regexp.MustCompile(`^[\w\-]+\.txt$`)

// lerRelatorio: o texto de um relatório (só pelo nome do arquivo, sem caminhos).
func lerRelatorio(nome string) (string, error) {
	if !nomeRelatorio.MatchString(nome) {
		return "", fmt.Errorf("relatório inválido")
	}
	dados, err := os.ReadFile(filepath.Join(pastaRelatorios(), nome))
	if err != nil {
		return "", fmt.Errorf("relatório não encontrado")
	}
	return string(dados), nil
}
