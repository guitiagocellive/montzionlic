//go:build windows

// Montzion para Windows: instala o atalho do aplicativo e abre a plataforma numa janela própria.
//
// Na primeira vez (rodando o arquivo baixado), copia-se para %LOCALAPPDATA%\Montzion, cria atalhos
// na área de trabalho e no menu Iniciar e registra em "Aplicativos instalados" (sem pedir administrador).
// Depois, cada vez que é aberto, abre https://montzion.com.br no modo aplicativo do Edge (ou Chrome).
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
	chaveReg   = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Montzion`
	semJanela  = 0x08000000 // CREATE_NO_WINDOW
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

func oculto(nome string, args ...string) *exec.Cmd {
	cmd := exec.Command(nome, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: semJanela}
	return cmd
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

// Cria um atalho .lnk usando o próprio Windows (WScript.Shell).
func criarAtalho(lnk, alvo, args string) error {
	_ = os.MkdirAll(filepath.Dir(lnk), 0o755)
	aspas := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	script := fmt.Sprintf(
		"$s=(New-Object -ComObject WScript.Shell).CreateShortcut(%s);$s.TargetPath=%s;$s.Arguments=%s;$s.IconLocation=%s;$s.WorkingDirectory=%s;$s.Description='Montzion - gestão de licitações';$s.Save()",
		aspas(lnk), aspas(alvo), aspas(args), aspas(alvo+",0"), aspas(filepath.Dir(alvo)),
	)
	saida, err := oculto("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script).CombinedOutput()
	if err == nil {
		if _, e := os.Stat(lnk); e == nil {
			return nil
		}
		err = fmt.Errorf("atalho não foi criado")
	}
	registrarLog("atalho %s falhou: %v %s", lnk, err, strings.TrimSpace(string(saida)))
	// Sem PowerShell (bloqueado em algumas empresas): cria um atalho de internet simples.
	url := strings.TrimSuffix(lnk, ".lnk") + ".url"
	conteudo := "[InternetShortcut]\r\nURL=file:///" + strings.ReplaceAll(alvo, `\`, "/") + "\r\nIconFile=" + alvo + "\r\nIconIndex=0\r\n"
	return os.WriteFile(url, []byte(conteudo), 0o644)
}

func registrar(exe string) {
	valores := [][2]string{
		{"DisplayName", nomeApp},
		{"DisplayVersion", versao},
		{"Publisher", "Montzion"},
		{"DisplayIcon", exe + ",0"},
		{"InstallLocation", filepath.Dir(exe)},
		{"UninstallString", `"` + exe + `" --desinstalar`},
		{"URLInfoAbout", endereco},
	}
	for _, v := range valores {
		_ = oculto("reg.exe", "add", chaveReg, "/v", v[0], "/t", "REG_SZ", "/d", v[1], "/f").Run()
	}
	_ = oculto("reg.exe", "add", chaveReg, "/v", "NoModify", "/t", "REG_DWORD", "/d", "1", "/f").Run()
	_ = oculto("reg.exe", "add", chaveReg, "/v", "NoRepair", "/t", "REG_DWORD", "/d", "1", "/f").Run()
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
	_ = oculto("reg.exe", "delete", chaveReg, "/f").Run()
	// O próprio .exe está em uso: apaga a pasta alguns segundos depois de fechar.
	pasta := pastaInstalacao()
	_ = oculto("cmd.exe", "/c", "ping 127.0.0.1 -n 3 >nul & rmdir /s /q \""+pasta+"\"").Start()
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

// Abre a plataforma numa janela própria (modo aplicativo do Edge/Chrome).
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

// Trava: só um Montzion por vez controla o navegador (a ponte do robô).
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

// Abre a plataforma numa janela própria (Edge/Chrome com um perfil só do Montzion) e liga a ponte do
// robô de lances, que fica rodando enquanto o navegador estiver aberto.
func abrir() {
	navegador := procurarNavegador()
	if navegador == "" {
		registrarLog("Edge/Chrome não encontrados; abrindo no navegador padrão")
		if err := oculto("rundll32.exe", "url.dll,FileProtocolHandler", endereco).Start(); err != nil {
			registrarLog("não abriu o navegador padrão: %v", err)
			mensagem("Não foi possível abrir o navegador.\n\nAbra "+endereco+" no seu navegador.", mbOK|mbIconInfo)
		}
		return
	}
	perfil := filepath.Join(pastaInstalacao(), "Navegador")
	trava, err := net.Listen("tcp", portaTrava)
	if err != nil {
		// O Montzion já está aberto: só abre mais uma janela no mesmo navegador.
		if err := exec.Command(navegador, "--user-data-dir="+perfil, "--app="+endereco).Start(); err != nil {
			registrarLog("não abriu outra janela: %v", err)
		}
		return
	}
	defer trava.Close()
	porta := portaLivre()
	cmd := exec.Command(navegador,
		fmt.Sprintf("--remote-debugging-port=%d", porta),
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
	ws, err := enderecoDevTools(porta, 25*time.Second)
	if err != nil {
		registrarLog("robô de lances indisponível: %v", err)
		return
	}
	cdp, err := conectarCDP(ws)
	if err != nil {
		registrarLog("robô de lances indisponível: %v", err)
		return
	}
	registrarLog("ponte do robô ligada (porta %d)", porta)
	if err := novaPonte(configPonte{Plataforma: endereco, Compras: "https://cnetmobile.estaleiro.serpro.gov.br"}, cdp).Rodar(); err != nil {
		registrarLog("ponte do robô parou: %v", err)
	}
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
			_ = oculto("rundll32.exe", "url.dll,FileProtocolHandler", endereco).Start()
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
			if _, err := instalar(atual); err != nil {
				registrarLog("instalação falhou: %v", err)
				mensagem("Não foi possível instalar o Montzion: "+err.Error()+"\n\nA plataforma vai abrir mesmo assim.\nDetalhes em "+filepath.Join(pastaInstalacao(), "montzion.log"), mbOK|mbIconInfo)
			} else {
				mensagem("Montzion instalado!\n\nCriamos um atalho na área de trabalho e no menu Iniciar.\nAgora a plataforma vai abrir.", mbOK|mbIconInfo)
			}
		}
	}
	abrir()
}
