//go:build windows

// Montzion para Windows: instala o atalho do aplicativo e abre a plataforma numa janela própria.
//
// Na primeira vez (rodando o arquivo baixado), copia-se para %LOCALAPPDATA%\Montzion, cria atalhos
// na área de trabalho e no menu Iniciar e registra em "Aplicativos instalados" (sem pedir administrador).
// Depois, cada vez que é aberto, mostra a plataforma na janela própria do Montzion (motor WebView2 do
// Windows, sem barra de endereço). Sem WebView2, cai para o modo aplicativo do Edge (ou Chrome).
package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	endereco   = "https://montzion.com.br"
	mbOK       = 0x00000000
	mbIconInfo = 0x00000040
	mbYesNo    = 0x00000004
	mbIconQ    = 0x00000020
	idYes      = 6
)

var (
	user32  = syscall.NewLazyDLL("user32.dll")
	shell32 = syscall.NewLazyDLL("shell32.dll")
	ole32   = syscall.NewLazyDLL("ole32.dll")
)

type guid struct {
	d1     uint32
	d2, d3 uint16
	d4     [8]byte
}

var (
	pastaDesktop   = guid{0xB4BFCC3A, 0xDB2C, 0x424C, [8]byte{0xB0, 0x29, 0x7F, 0xE9, 0x9A, 0x87, 0xC6, 0x41}}
	pastaProgramas = guid{0xA77F5D77, 0x2E2B, 0x44C3, [8]byte{0xA6, 0xA2, 0xAB, 0xA6, 0x01, 0x05, 0x4A, 0x51}}
)

// Pasta especial do Windows (área de trabalho de verdade, mesmo quando está no OneDrive).
func pastaConhecida(id guid, reserva string) string {
	var p *uint16
	r, _, _ := shell32.NewProc("SHGetKnownFolderPath").Call(uintptr(unsafe.Pointer(&id)), 0, 0, uintptr(unsafe.Pointer(&p)))
	if r != 0 || p == nil {
		return reserva
	}
	defer ole32.NewProc("CoTaskMemFree").Call(uintptr(unsafe.Pointer(p)))
	return syscall.UTF16ToString((*[1 << 15]uint16)(unsafe.Pointer(p))[:])
}

func mensagem(texto string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(texto)
	c, _ := syscall.UTF16PtrFromString(nomeApp)
	r, _, _ := user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags)
	return int(r)
}

func atalhos() []string {
	inicio := pastaConhecida(pastaProgramas, filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs"))
	desktop := pastaConhecida(pastaDesktop, filepath.Join(os.Getenv("USERPROFILE"), "Desktop"))
	return []string{
		filepath.Join(desktop, nomeApp+".lnk"),
		filepath.Join(inicio, nomeApp+".lnk"),
	}
}

func copiar(origem, destino string) error {
	in, err := os.Open(origem)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := destino + ".novo"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err = io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err = out.Close(); err != nil {
		return err
	}
	// Se o Montzion estiver aberto, o Windows não deixa apagar o .exe, mas deixa renomear:
	// o antigo vira .antigo (apagado na próxima vez) e o novo entra no lugar.
	if _, err := os.Stat(destino); err == nil {
		antigo := destino + ".antigo"
		_ = os.Remove(antigo)
		if err := os.Rename(destino, antigo); err != nil {
			_ = os.Remove(tmp)
			return fmt.Errorf("feche o Montzion e tente de novo (%v)", err)
		}
	}
	return os.Rename(tmp, destino)
}

// Cria um atalho .lnk pelo próprio Windows. Se não der, cria um atalho de internet simples (.url).
func criarAtalho(lnk, alvo, args string) error {
	err := criarAtalhoNativo(lnk, alvo, args, "Montzion - gestão de licitações")
	if err == nil {
		return nil
	}
	registrarLog("atalho %s falhou: %v", lnk, err)
	url := strings.TrimSuffix(lnk, ".lnk") + ".url"
	conteudo := "[InternetShortcut]\r\nURL=file:///" + strings.ReplaceAll(alvo, `\`, "/") + "\r\nIconFile=" + alvo + "\r\nIconIndex=0\r\n"
	return os.WriteFile(url, []byte(conteudo), 0o644)
}

// Registra em "Aplicativos instalados" do Windows (só para este usuário, sem administrador).
func registrar(exe string) {
	err := gravarRegistro(subchaveDesinstalar, map[string]any{
		"DisplayName":     nomeApp,
		"DisplayVersion":  versao,
		"Publisher":       "Montzion",
		"DisplayIcon":     exe + ",0",
		"InstallLocation": filepath.Dir(exe),
		"UninstallString": `"` + exe + `" --desinstalar`,
		"URLInfoAbout":    endereco,
		"NoModify":        uint32(1),
		"NoRepair":        uint32(1),
	})
	if err != nil {
		registrarLog("não registrou em Aplicativos instalados: %v", err)
	}
}

func instalar(atual string) (string, error) {
	pasta := pastaInstalacao()
	if err := os.MkdirAll(pasta, 0o755); err != nil {
		return "", err
	}
	destino := filepath.Join(pasta, nomeApp+".exe")
	if err := copiar(atual, destino); err != nil {
		return "", err
	}
	for _, lnk := range atalhos() {
		if err := criarAtalho(lnk, destino, ""); err != nil {
			registrarLog("não criou o atalho %s: %v", lnk, err)
		}
	}
	registrar(destino)
	registrarLog("instalado em %s", destino)
	return destino, nil
}

func desinstalar() {
	if mensagem("Remover o Montzion deste computador?\n\nSeus dados continuam na plataforma (montzion.com.br).", mbYesNo|mbIconQ) != idYes {
		return
	}
	for _, lnk := range atalhos() {
		_ = os.Remove(lnk)
		_ = os.Remove(strings.TrimSuffix(lnk, ".lnk") + ".url")
	}
	apagarRegistro(subchaveDesinstalar)
	// Apaga tudo da pasta, menos o próprio .exe (o Windows não deixa apagar um programa aberto).
	pasta := pastaInstalacao()
	eu, _ := os.Executable()
	itens, _ := os.ReadDir(pasta)
	sobrou := false
	for _, it := range itens {
		caminho := filepath.Join(pasta, it.Name())
		if strings.EqualFold(filepath.Clean(caminho), filepath.Clean(eu)) {
			sobrou = true
			continue
		}
		if os.RemoveAll(caminho) != nil {
			sobrou = true
		}
	}
	if sobrou {
		if mensagem("O Montzion foi removido deste computador.\n\nFalta só apagar o arquivo do programa. Abrir a pasta agora para apagá-la?\n("+pasta+")", mbYesNo|mbIconQ) == idYes {
			abrirNoNavegador(pasta)
		}
		return
	}
	mensagem("O Montzion foi removido deste computador.", mbOK|mbIconInfo)
}

func procurar(caminhos ...string) string {
	for _, c := range caminhos {
		if c == "" {
			continue
		}
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

func procurarNavegador() string {
	pf, pf86, local := os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")
	return procurar(
		filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(local, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(local, `Google\Chrome\Application\chrome.exe`),
	)
}

// Trava: só um Montzion aberto por vez (e só uma ponte do robô).
const portaTrava = "127.0.0.1:47811"

func portaLivre() int {
	for p := 9333; p < 9400; p++ {
		l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			l.Close()
			return p
		}
	}
	return 9333
}

func configuracao() configPonte {
	return configPonte{
		Plataforma: endereco,
		Compras:    "https://cnetmobile.estaleiro.serpro.gov.br",
		// Login de fornecedor direto no gov.br (o mesmo do botão "Entrar com Gov.br" do Compras.gov.br).
		Login:  "https://sso.acesso.gov.br/authorize?response_type=code&client_id=comprasnet.gov.br&scope=openid+profile+email+phone+govbr_confiabilidades&state=F&redirect_uri=https://www.comprasnet.gov.br/seguro/landing_sso.asp",
		Portal: "https://www.comprasnet.gov.br",
	}
}

// Liga a ponte do robô de lances ao motor das janelas. Na janela própria fica tentando (e se religa se
// cair) enquanto o aplicativo estiver aberto; no modo navegador para quando o navegador fecha.
func ligarPonte(arquivoPorta string, porta int, abrirCompras func() bool, esconderCompras func(), sempre bool) {
	for tentativa := 0; ; tentativa++ {
		ws, real, err := esperarDevTools(arquivoPorta, porta, 60*time.Second)
		if err != nil {
			registrarLog("robô de lances: %v (tentativa %d)", err, tentativa+1)
		} else if cdp, err := conectarCDP(ws); err != nil {
			registrarLog("robô de lances: não conectou: %v", err)
		} else {
			registrarLog("ponte do robô ligada (porta %d)", real)
			p := novaPonte(configuracao(), cdp)
			p.abrirCompras = abrirCompras
			p.esconderCompras = esconderCompras
			if err := p.Rodar(); err != nil {
				registrarLog("ponte do robô parou: %v", err)
			} else {
				registrarLog("ponte do robô desligada")
			}
		}
		if !sempre {
			return
		}
		time.Sleep(3 * time.Second)
	}
}

// Abre o Montzion na janela própria do aplicativo. Só se o Windows não tiver o motor WebView2
// (raro: vem no Windows 10 e 11) cai para o modo aplicativo do Edge/Chrome.
// fecharMotorOrfao pede ao motor antigo (pela porta de controle dele) para fechar e espera ele sair.
func fecharMotorOrfao(ws string, porta int) bool {
	c, err := conectarCDP(ws)
	if err != nil {
		return false
	}
	_, _ = c.Chamar("", "Browser.close", nil, 3*time.Second)
	c.Fechar()
	limite := time.Now().Add(8 * time.Second)
	for time.Now().Before(limite) {
		if _, err := enderecoDevTools(porta, 0); err != nil {
			time.Sleep(500 * time.Millisecond) // termina de soltar a pasta de dados
			return true
		}
		time.Sleep(300 * time.Millisecond)
	}
	return false
}

// fecharVersaoAberta fecha o Montzion que estiver aberto (pedido de fechar; se em 10 s não fechar, encerra o
// processo dele) e espera ele soltar a trava. Devolve true se havia um aberto.
func fecharVersaoAberta() bool {
	if l, err := net.Listen("tcp", portaTrava); err == nil {
		l.Close()
		return false // nenhum aberto
	}
	if !fecharJanelaAberta() {
		return false
	}
	livre := func(espera time.Duration) bool {
		limite := time.Now().Add(espera)
		for time.Now().Before(limite) {
			if l, err := net.Listen("tcp", portaTrava); err == nil {
				l.Close()
				return true
			}
			time.Sleep(200 * time.Millisecond)
		}
		return false
	}
	if !livre(10 * time.Second) {
		registrarLog("atualização: a janela aberta não fechou em 10 s; encerrando o Montzion antigo")
		encerrarMontzionAberto()
		livre(5 * time.Second)
	}
	time.Sleep(700 * time.Millisecond) // o motor da janela (WebView2) termina de sair
	return true
}

func abrir() {
	trava, err := net.Listen("tcp", portaTrava)
	if err != nil {
		// Já está aberto: traz a janela para a frente.
		for i := 0; i < 15; i++ {
			if focarJanelaAberta() {
				return
			}
			time.Sleep(200 * time.Millisecond)
		}
		registrarLog("outro Montzion segura a trava, mas sem janela; abrindo sem o robô")
	} else {
		defer trava.Close()
	}
	comPonte := trava != nil
	arquivoPorta := filepath.Join(pastaInstalacao(), "Dados", "EBWebView", "DevToolsActivePort")
	porta := 0
	if comPonte {
		// Se o motor de uma abertura anterior ainda está vivo, usa a mesma porta (com outra, o Windows
		// recusaria criar a janela e a ligação do robô não aconteceria).
		if p := portaAtiva(arquivoPorta); p > 0 {
			if ws, err := enderecoDevTools(p, 0); err == nil {
				// Motor (WebView2) de uma abertura anterior ainda vivo, sem o Montzion dele (ex.: depois de atualizar).
				// Reaproveitá-lo deixava janelas do sistema presas à janela antiga, que não existe mais — como a
				// escolha do certificado digital / PIN do token no login do gov.br, que ficava invisível.
				// Agora ele é encerrado e o motor começa limpo; só se não fechar, é reaproveitado como antes.
				if fecharMotorOrfao(ws, p) {
					registrarLog("motor antigo da janela encerrado (porta %d); abrindo um novo", p)
				} else {
					porta = p
					registrarLog("motor da janela já estava aberto (porta %d)", p)
				}
			}
		}
		if porta == 0 {
			porta = portaLivre()
		}
	}
	err = janelaNativa(configuracao(), porta, func() {
		registrarLog("janela própria aberta")
		if comPonte {
			go ligarPonte(arquivoPorta, porta, pedirJanelaCompras, pedirEsconderCompras, true)
		}
	})
	if err == nil {
		return
	}
	registrarLog("janela própria indisponível: %v", err)
	avisarWebView2()
	abrirModoNavegador(comPonte)
}

// Avisa (uma vez só) que falta o WebView2 e oferece o download gratuito da Microsoft.
func avisarWebView2() {
	marca := filepath.Join(pastaInstalacao(), "aviso-webview2")
	if _, err := os.Stat(marca); err == nil {
		return
	}
	_ = os.WriteFile(marca, []byte(time.Now().Format(time.RFC3339)), 0o644)
	if mensagem("Para abrir o Montzion na janela própria, o Windows precisa do componente gratuito \"Microsoft Edge WebView2\".\n\nDeseja baixar agora? (Depois de instalar, abra o Montzion de novo.)\n\nEnquanto isso, a plataforma abre numa janela do Edge.", mbYesNo|mbIconQ) == idYes {
		abrirNoNavegador(linkWebView2)
	}
}

// Plano B: abre a plataforma no modo aplicativo do Edge/Chrome (perfil só do Montzion).
func abrirModoNavegador(comPonte bool) {
	navegador := procurarNavegador()
	if navegador == "" {
		registrarLog("Edge/Chrome não encontrados; abrindo no navegador padrão")
		abrirNoNavegador(endereco)
		return
	}
	perfil := filepath.Join(pastaInstalacao(), "Navegador")
	if !comPonte {
		if err := exec.Command(navegador, "--user-data-dir="+perfil, "--app="+endereco).Start(); err != nil {
			registrarLog("não abriu outra janela: %v", err)
		}
		return
	}
	porta := portaLivre()
	cmd := exec.Command(navegador,
		fmt.Sprintf("--remote-debugging-port=%d", porta),
		"--disable-quic",
		"--user-data-dir="+perfil,
		"--no-first-run",
		"--no-default-browser-check",
		"--app="+endereco,
		"--start-maximized",
	)
	if err := cmd.Start(); err != nil {
		registrarLog("não abriu %s: %v", navegador, err)
		_ = exec.Command(navegador, "--app="+endereco, "--start-maximized").Start()
		return
	}
	ligarPonte(filepath.Join(perfil, "DevToolsActivePort"), porta, nil, nil, false)
}

func main() {
	for _, a := range os.Args[1:] {
		if a == "--desinstalar" {
			desinstalar()
			return
		}
	}
	defer func() {
		if r := recover(); r != nil {
			registrarLog("erro inesperado: %v", r)
			mensagem(fmt.Sprintf("Erro inesperado no Montzion: %v\n\nA plataforma vai abrir no navegador.", r), mbOK|mbIconInfo)
			abrirNoNavegador(endereco)
		}
	}()
	// Limpa a versão antiga que ficou de uma atualização.
	_ = os.Remove(filepath.Join(pastaInstalacao(), nomeApp+".exe.antigo"))
	atual, err := os.Executable()
	if err != nil {
		registrarLog("não achou o próprio arquivo: %v", err)
	}
	if err == nil {
		atual, _ = filepath.EvalSymlinks(atual)
		destino := filepath.Join(pastaInstalacao(), nomeApp+".exe")
		if !strings.EqualFold(filepath.Clean(atual), filepath.Clean(destino)) {
			_, erroJa := os.Stat(destino)
			atualizacao := erroJa == nil
			// Atualização com o Montzion aberto: fecha a janela aberta antes, para a versão nova abrir no lugar.
			if fecharVersaoAberta() {
				registrarLog("atualização: a janela aberta foi fechada para abrir a versão nova")
			}
			if _, err := instalar(atual); err != nil {
				registrarLog("instalação falhou: %v", err)
				mensagem("Não foi possível instalar o Montzion: "+err.Error()+"\n\nA plataforma vai abrir mesmo assim.\nDetalhes em "+filepath.Join(pastaInstalacao(), "montzion.log"), mbOK|mbIconInfo)
			} else if !atualizacao {
				mensagem("Montzion instalado!\n\nCriamos um atalho na área de trabalho e no menu Iniciar.\nAgora o Montzion vai abrir.", mbOK|mbIconInfo)
			}
		}
	}
	abrir()
}
