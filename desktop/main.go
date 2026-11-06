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
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const (
	endereco   = "https://montzion.com.br"
	nomeApp    = "Montzion"
	chaveReg   = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Montzion`
	semJanela  = 0x08000000 // CREATE_NO_WINDOW
	versao     = "1.0.0"
	mbOK       = 0x00000000
	mbIconInfo = 0x00000040
	mbYesNo    = 0x00000004
	mbIconQ    = 0x00000020
	idYes      = 6
)

var user32 = syscall.NewLazyDLL("user32.dll")

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

func pastaInstalacao() string {
	return filepath.Join(os.Getenv("LOCALAPPDATA"), nomeApp)
}

func atalhos() []string {
	inicio := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs")
	return []string{
		filepath.Join(os.Getenv("USERPROFILE"), "Desktop", nomeApp+".lnk"),
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
	out.Close()
	_ = os.Remove(destino)
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
	return oculto("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script).Run()
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
		_ = criarAtalho(lnk, destino, "")
	}
	registrar(destino)
	return destino, nil
}

func desinstalar() {
	if mensagem("Remover o Montzion deste computador?\n\nSeus dados continuam na plataforma (montzion.com.br).", mbYesNo|mbIconQ) != idYes {
		return
	}
	for _, lnk := range atalhos() {
		_ = os.Remove(lnk)
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
func abrir() {
	pf, pf86, local := os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")
	navegador := procurar(
		filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(local, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(local, `Google\Chrome\Application\chrome.exe`),
	)
	if navegador != "" {
		if err := exec.Command(navegador, "--app="+endereco, "--start-maximized").Start(); err == nil {
			return
		}
	}
	// Sem Edge/Chrome: abre no navegador padrão.
	_ = oculto("rundll32.exe", "url.dll,FileProtocolHandler", endereco).Start()
}

func main() {
	for _, a := range os.Args[1:] {
		if a == "--desinstalar" {
			desinstalar()
			return
		}
	}
	atual, err := os.Executable()
	if err == nil {
		atual, _ = filepath.EvalSymlinks(atual)
		destino := filepath.Join(pastaInstalacao(), nomeApp+".exe")
		if !strings.EqualFold(filepath.Clean(atual), filepath.Clean(destino)) {
			if _, err := instalar(atual); err != nil {
				mensagem("Não foi possível instalar o Montzion: "+err.Error()+"\n\nA plataforma vai abrir mesmo assim.", mbOK|mbIconInfo)
			} else {
				mensagem("Montzion instalado!\n\nCriamos um atalho na área de trabalho e no menu Iniciar.\nAgora a plataforma vai abrir.", mbOK|mbIconInfo)
			}
		}
	}
	abrir()
}
