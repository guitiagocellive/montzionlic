//go:build windows

package main

// Janela própria do Montzion: uma janela do Windows com o motor do Edge (WebView2) dentro.
// Sem barra de endereço, sem abas, com ícone e nome do Montzion e dados guardados em
// %LOCALAPPDATA%\Montzion\Dados. A janela do Compras.gov.br (para o robô de lances) também é nativa.
//
// Tudo é feito com chamadas diretas ao Windows (sem bibliotecas externas): o WebView2Loader.dll da
// Microsoft vai embutido no .exe e é gravado na pasta do aplicativo.

import (
	_ "embed"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"unsafe"
)

//go:embed recursos/WebView2Loader.dll
var dllCarregador []byte

//go:embed recursos/WebView2Loader-LICENCA.txt
var licencaCarregador []byte

const (
	classeJanela  = "MontzionJanela"
	linkWebView2  = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
	wmDestroy     = 0x0002
	wmMove        = 0x0003
	wmSize        = 0x0005
	wmSetFocus    = 0x0007
	wmClose       = 0x0010
	wmGetMinMax   = 0x0024
	wmApp         = 0x8000
	wmAbrirCompra = wmApp + 1
	wmEsconder    = wmApp + 2
	wsOverlapped  = 0x00CF0000 // WS_OVERLAPPEDWINDOW
	cwUseDefault  = 0x80000000
	swHide        = 0
	swMaximize    = 3
	swShow        = 5
	swRestore     = 9
	idiApp        = 1 // ícone do grupo 1 (gerar_recursos.py)
	imageIcon     = 1
	lrDefaultSize = 0x40
	lrShared      = 0x8000
	smCySmIcon    = 50
	smCxSmIcon    = 49
	wmSetIcon     = 0x0080
)

var (
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	procCoInitializeEx     = ole32.NewProc("CoInitializeEx")
	procCoTaskMemFree      = ole32.NewProc("CoTaskMemFree")
	procGetModuleHandle    = kernel32.NewProc("GetModuleHandleW")
	procRegisterClassEx    = user32.NewProc("RegisterClassExW")
	procCreateWindowEx     = user32.NewProc("CreateWindowExW")
	procDefWindowProc      = user32.NewProc("DefWindowProcW")
	procDestroyWindow      = user32.NewProc("DestroyWindow")
	procShowWindow         = user32.NewProc("ShowWindow")
	procUpdateWindow       = user32.NewProc("UpdateWindow")
	procGetMessage         = user32.NewProc("GetMessageW")
	procTranslateMessage   = user32.NewProc("TranslateMessage")
	procDispatchMessage    = user32.NewProc("DispatchMessageW")
	procPostMessage        = user32.NewProc("PostMessageW")
	procPostQuitMessage    = user32.NewProc("PostQuitMessage")
	procGetClientRect      = user32.NewProc("GetClientRect")
	procLoadImage          = user32.NewProc("LoadImageW")
	procLoadCursor         = user32.NewProc("LoadCursorW")
	procSendMessage        = user32.NewProc("SendMessageW")
	procGetSystemMetrics   = user32.NewProc("GetSystemMetrics")
	procFindWindow         = user32.NewProc("FindWindowW")
	procIsIconic           = user32.NewProc("IsIconic")
	procSetForeground      = user32.NewProc("SetForegroundWindow")
	procShellExecute       = shell32.NewProc("ShellExecuteW")
	procGetDpiForWindow    = user32.NewProc("GetDpiForWindow")
	procSetProcessDpiAware = user32.NewProc("SetProcessDpiAwarenessContext")
)

type retangulo struct{ esquerda, topo, direita, baixo int32 }

type ponto struct{ x, y int32 }

type mensagemWin struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      ponto
	privado uint32
}

type minMaxInfo struct {
	reservado, maxSize, maxPosition, minTrackSize, maxTrackSize ponto
}

type classeWin struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

// ---------- COM mínimo ----------

// Converte um endereço vindo do Windows em ponteiro (sem o aviso do go vet).
func ptr(u uintptr) unsafe.Pointer { return *(*unsafe.Pointer)(unsafe.Pointer(&u)) }

// Chama o método n da tabela de um objeto COM.
//
//go:uintptrescapes
func metodo(obj uintptr, n int, args ...uintptr) uintptr {
	tabela := *(*uintptr)(ptr(obj))
	f := *(*uintptr)(ptr(tabela + uintptr(n)*unsafe.Sizeof(uintptr(0))))
	r, _, _ := syscall.SyscallN(f, append([]uintptr{obj}, args...)...)
	return r
}

func falhou(hr uintptr) bool { return int32(hr) < 0 }

func addRef(obj uintptr) {
	if obj != 0 {
		metodo(obj, 1)
	}
}

func release(obj uintptr) {
	if obj != 0 {
		metodo(obj, 2)
	}
}

func boolCOM(b bool) uintptr {
	if b {
		return 1
	}
	return 0
}

// Manipulador COM (os "handlers" do WebView2): QueryInterface, AddRef, Release, Invoke(a, b).
type manipulador struct {
	tabela  *[4]uintptr
	invocar func(a, b uintptr) uintptr
}

var (
	tabelaManipulador [4]uintptr
	vivos             []*manipulador // mantém os manipuladores vivos enquanto o app roda
)

func init() {
	tabelaManipulador = [4]uintptr{
		syscall.NewCallback(func(this, iid, saida uintptr) uintptr {
			*(*uintptr)(ptr(saida)) = this
			return 0
		}),
		syscall.NewCallback(func(this uintptr) uintptr { return 1 }),
		syscall.NewCallback(func(this uintptr) uintptr { return 1 }),
		syscall.NewCallback(func(this, a, b uintptr) uintptr {
			m := (*manipulador)(ptr(this))
			defer func() {
				if r := recover(); r != nil {
					registrarLog("janela: erro no evento: %v", r)
				}
			}()
			return m.invocar(a, b)
		}),
	}
}

func novoManipulador(f func(a, b uintptr) uintptr) uintptr {
	m := &manipulador{tabela: &tabelaManipulador, invocar: f}
	vivos = append(vivos, m)
	return uintptr(unsafe.Pointer(m))
}

func textoCOM(p uintptr) string {
	if p == 0 {
		return ""
	}
	defer procCoTaskMemFree.Call(p)
	return syscall.UTF16ToString((*[1 << 20]uint16)(ptr(p))[:])
}

// Textos passados ao Windows ficam guardados aqui para o coletor de lixo não liberá-los no meio da chamada.
var (
	textosMu sync.Mutex
	textos   = map[string]*uint16{}
)

func utf16(s string) uintptr {
	textosMu.Lock()
	defer textosMu.Unlock()
	p := textos[s]
	if p == nil {
		p, _ = syscall.UTF16PtrFromString(s)
		textos[s] = p
	}
	return uintptr(unsafe.Pointer(p))
}

// ---------- janelas ----------

type janelaWeb struct {
	hwnd       uintptr
	controle   uintptr // ICoreWebView2Controller
	web        uintptr // ICoreWebView2
	principal  bool
	inicial    string
	aoCarregar func(erro error)
}

type aplicativo struct {
	instancia  uintptr
	icone      uintptr
	iconePeq   uintptr
	ambiente   uintptr // ICoreWebView2Environment
	principal  *janelaWeb
	compras    *janelaWeb
	janelas    map[uintptr]*janelaWeb
	configura  configPonte
	falhaAntes error // erro do WebView2 antes de mostrar a plataforma
	mostrou    bool
}

var app *aplicativo

func (a *aplicativo) procedimento(hwnd, msg, wParam, lParam uintptr) uintptr {
	j := a.janelas[hwnd]
	switch msg {
	case wmSize:
		if j != nil {
			j.ajustar()
		}
		return 0
	case wmMove:
		if j != nil && j.controle != 0 {
			metodo(j.controle, 23) // NotifyParentWindowPositionChanged
		}
	case wmSetFocus:
		if j != nil && j.controle != 0 {
			metodo(j.controle, 12, 0) // MoveFocus(PROGRAMMATIC)
		}
	case wmGetMinMax:
		info := (*minMaxInfo)(ptr(lParam))
		info.minTrackSize = ponto{a.escala(hwnd, 760), a.escala(hwnd, 520)}
		return 0
	case wmAbrirCompra:
		a.abrirCompras()
		return 0
	case wmEsconder:
		if a.compras != nil {
			procShowWindow.Call(a.compras.hwnd, swHide)
		}
		return 0
	case wmClose:
		if j != nil && j == a.compras {
			// Fechar a janela do Compras.gov.br só a esconde: o login (que vale só nesta janela) continua.
			procShowWindow.Call(hwnd, swHide)
			return 0
		}
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		if j != nil {
			if j.controle != 0 {
				metodo(j.controle, 24) // Close
				release(j.web)
				release(j.controle)
				j.controle, j.web = 0, 0
			}
			delete(a.janelas, hwnd)
			if j == a.compras {
				a.compras = nil
			}
			if j.principal {
				procPostQuitMessage.Call(0)
			}
		}
		return 0
	}
	r, _, _ := procDefWindowProc.Call(hwnd, msg, wParam, lParam)
	return r
}

func (a *aplicativo) escala(hwnd uintptr, px int32) int32 {
	if procGetDpiForWindow.Find() != nil {
		return px
	}
	dpi, _, _ := procGetDpiForWindow.Call(hwnd)
	if dpi == 0 {
		return px
	}
	return int32(int64(px) * int64(dpi) / 96)
}

func (j *janelaWeb) ajustar() {
	if j.controle == 0 {
		return
	}
	var r retangulo
	procGetClientRect.Call(j.hwnd, uintptr(unsafe.Pointer(&r)))
	metodo(j.controle, 6, uintptr(unsafe.Pointer(&r))) // put_Bounds (RECT vai por referência no x64)
}

func (a *aplicativo) registrarClasse() error {
	a.instancia, _, _ = procGetModuleHandle.Call(0)
	a.icone, _, _ = procLoadImage.Call(a.instancia, idiApp, imageIcon, 0, 0, lrDefaultSize|lrShared)
	cx, _, _ := procGetSystemMetrics.Call(smCxSmIcon)
	cy, _, _ := procGetSystemMetrics.Call(smCySmIcon)
	a.iconePeq, _, _ = procLoadImage.Call(a.instancia, idiApp, imageIcon, cx, cy, lrShared)
	cursor, _, _ := procLoadCursor.Call(0, 32512) // IDC_ARROW
	nome, _ := syscall.UTF16PtrFromString(classeJanela)
	c := classeWin{
		lpfnWndProc:   syscall.NewCallback(a.procedimento),
		hInstance:     a.instancia,
		hIcon:         a.icone,
		hIconSm:       a.iconePeq,
		hCursor:       cursor,
		hbrBackground: 5 + 1, // COLOR_WINDOW + 1
		lpszClassName: nome,
	}
	c.cbSize = uint32(unsafe.Sizeof(c))
	if r, _, err := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&c))); r == 0 {
		return fmt.Errorf("RegisterClassEx: %v", err)
	}
	return nil
}

func (a *aplicativo) criarJanela(titulo string, maximizada bool) (uintptr, error) {
	hwnd, _, err := procCreateWindowEx.Call(0, utf16(classeJanela), utf16(titulo), wsOverlapped,
		cwUseDefault, cwUseDefault, cwUseDefault, cwUseDefault, 0, 0, a.instancia, 0)
	if hwnd == 0 {
		return 0, fmt.Errorf("CreateWindowEx: %v", err)
	}
	if a.icone != 0 {
		procSendMessage.Call(hwnd, wmSetIcon, 1, a.icone)
		procSendMessage.Call(hwnd, wmSetIcon, 0, a.iconePeq)
	}
	modo := uintptr(swShow)
	if maximizada {
		modo = swMaximize
	}
	procShowWindow.Call(hwnd, modo)
	procUpdateWindow.Call(hwnd)
	return hwnd, nil
}

// Endereço que pode ficar dentro do aplicativo (o resto abre no navegador padrão do Windows).
func (a *aplicativo) interno(endereco string) bool {
	u, err := url.Parse(endereco)
	if err != nil {
		return true
	}
	switch u.Scheme {
	case "http", "https":
	default:
		return true // blob:, data:, about: (prévias de PDF e arquivos gerados na plataforma)
	}
	return mesmoSite(endereco, a.configura.Plataforma)
}

func abrirNoNavegador(endereco string) {
	procShellExecute.Call(0, utf16("open"), utf16(endereco), 0, 0, swShow)
}

// Cria o WebView2 dentro da janela e abre o endereço.
func (a *aplicativo) ligarWeb(j *janelaWeb) {
	aoControle := novoManipulador(func(hr, controle uintptr) uintptr {
		if falhou(hr) || controle == 0 {
			erro := fmt.Errorf("WebView2 não criou a janela (0x%08X)", uint32(hr))
			if j.aoCarregar != nil {
				j.aoCarregar(erro)
			}
			return 0
		}
		addRef(controle)
		j.controle = controle
		var web uintptr
		metodo(controle, 25, uintptr(unsafe.Pointer(&web))) // get_CoreWebView2
		j.web = web
		var cfg uintptr
		if metodo(web, 3, uintptr(unsafe.Pointer(&cfg))) == 0 && cfg != 0 { // get_Settings
			metodo(cfg, 10, 0) // put_IsStatusBarEnabled(FALSE)
			release(cfg)
		}
		var token int64
		if j.principal {
			// Links para outros sites (PNCP, portais, WhatsApp...) abrem no navegador padrão.
			metodo(web, 44, novoManipulador(func(_, args uintptr) uintptr { // add_NewWindowRequested
				var p uintptr
				metodo(args, 3, uintptr(unsafe.Pointer(&p))) // get_Uri
				endereco := textoCOM(p)
				if !a.interno(endereco) {
					metodo(args, 6, 1) // put_Handled(TRUE)
					abrirNoNavegador(endereco)
				}
				return 0
			}), uintptr(unsafe.Pointer(&token)))
			// Um link externo aberto na própria janela também vai para o navegador padrão,
			// para a plataforma nunca "sumir" de dentro do aplicativo.
			metodo(web, 7, novoManipulador(func(_, args uintptr) uintptr { // add_NavigationStarting
				var p uintptr
				metodo(args, 3, uintptr(unsafe.Pointer(&p))) // get_Uri
				endereco := textoCOM(p)
				if !a.interno(endereco) {
					metodo(args, 8, 1) // put_Cancel(TRUE)
					abrirNoNavegador(endereco)
				}
				return 0
			}), uintptr(unsafe.Pointer(&token)))
		}
		if !j.principal {
			// Pop-ups do Compras.gov.br/gov.br abrem na própria janela do Compras (que pode estar escondida),
			// para a sessão ficar sempre num lugar só e nenhuma janela nova aparecer na tela.
			metodo(web, 44, novoManipulador(func(_, args uintptr) uintptr { // add_NewWindowRequested
				var p uintptr
				metodo(args, 3, uintptr(unsafe.Pointer(&p))) // get_Uri
				endereco := textoCOM(p)
				if u, err := url.Parse(endereco); err == nil && (u.Scheme == "https" || u.Scheme == "http") &&
					(strings.HasSuffix(u.Hostname(), ".gov.br") || mesmoSite(endereco, a.configura.Compras)) {
					metodo(args, 6, 1)              // put_Handled(TRUE)
					metodo(web, 5, utf16(endereco)) // Navigate
					registrarLog("janela do Compras: pop-up aberto na mesma janela: %s", endereco)
				}
				return 0
			}), uintptr(unsafe.Pointer(&token)))
		}
		metodo(web, 59, novoManipulador(func(_, _ uintptr) uintptr { // add_WindowCloseRequested (window.close())
			if !j.principal {
				procPostMessage.Call(j.hwnd, wmClose, 0, 0)
			}
			return 0
		}), uintptr(unsafe.Pointer(&token)))
		if j.principal {
			// Avisa a plataforma que ela está dentro do aplicativo (a página Disputas usa isso).
			script := fmt.Sprintf(`window.montzionApp = Object.freeze({ versao: %q, janelaPropria: true });`, versao)
			metodo(web, 27, utf16(script), novoManipulador(func(_, _ uintptr) uintptr { return 0 })) // AddScriptToExecuteOnDocumentCreated
		}
		j.ajustar()
		metodo(controle, 4, 1)           // put_IsVisible(TRUE)
		metodo(web, 5, utf16(j.inicial)) // Navigate
		metodo(controle, 12, 0)
		if j.aoCarregar != nil {
			j.aoCarregar(nil)
		}
		return 0
	})
	if hr := metodo(a.ambiente, 3, j.hwnd, aoControle); falhou(hr) { // CreateCoreWebView2Controller
		if j.aoCarregar != nil {
			j.aoCarregar(fmt.Errorf("WebView2 recusou a janela (0x%08X)", uint32(hr)))
		}
	}
}

// Abre (ou traz para a frente) a janela do Compras.gov.br, onde a pessoa entra com o gov.br.
func (a *aplicativo) abrirCompras() {
	if a.compras != nil {
		procShowWindow.Call(a.compras.hwnd, swShow)
		focar(a.compras.hwnd)
		return
	}
	if a.ambiente == 0 {
		return
	}
	hwnd, err := a.criarJanela(nomeApp+" - Compras.gov.br", false)
	if err != nil {
		registrarLog("janela do Compras.gov.br: %v", err)
		return
	}
	j := &janelaWeb{hwnd: hwnd, inicial: a.configura.paginaLogin()}
	j.aoCarregar = func(erro error) {
		if erro != nil {
			registrarLog("janela do Compras.gov.br: %v", erro)
			procDestroyWindow.Call(hwnd)
		}
	}
	a.janelas[hwnd] = j
	a.compras = j
	a.ligarWeb(j)
}

func focar(hwnd uintptr) {
	if r, _, _ := procIsIconic.Call(hwnd); r != 0 {
		procShowWindow.Call(hwnd, swRestore)
	}
	procSetForeground.Call(hwnd)
}

// Se o Montzion já está aberto, só traz a janela para a frente.
func focarJanelaAberta() bool {
	hwnd, _, _ := procFindWindow.Call(utf16(classeJanela), utf16(nomeApp)) // a principal (não a do Compras)
	if hwnd == 0 {
		return false
	}
	focar(hwnd)
	return true
}

// Grava o WebView2Loader.dll (e a licença dele) na pasta do aplicativo, se ainda não estiver lá.
func prepararCarregador() (string, error) {
	pasta := pastaInstalacao()
	if err := os.MkdirAll(pasta, 0o755); err != nil {
		return "", err
	}
	dll := filepath.Join(pasta, "WebView2Loader.dll")
	if st, err := os.Stat(dll); err != nil || st.Size() != int64(len(dllCarregador)) {
		tmp := dll + ".novo"
		if err := os.WriteFile(tmp, dllCarregador, 0o644); err != nil {
			return "", err
		}
		_ = os.Remove(dll)
		if err := os.Rename(tmp, dll); err != nil {
			return "", err
		}
		_ = os.WriteFile(filepath.Join(pasta, "WebView2Loader-LICENCA.txt"), licencaCarregador, 0o644)
	}
	return dll, nil
}

var errSemWebView2 = errors.New("sem WebView2")

// janelaNativa abre o Montzion na janela própria e só volta quando a pessoa fecha o aplicativo.
// Devolve errSemWebView2 (embrulhado) se o motor do Edge não estiver disponível neste Windows.
func janelaNativa(cfg configPonte, portaDepuracao int, aoAbrir func()) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if procSetProcessDpiAware.Find() == nil {
		procSetProcessDpiAware.Call(^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (-4)
	}
	procCoInitializeEx.Call(0, 2) // COINIT_APARTMENTTHREADED

	dll, err := prepararCarregador()
	if err != nil {
		return fmt.Errorf("%w: não gravou o WebView2Loader.dll: %v", errSemWebView2, err)
	}
	carregador := syscall.NewLazyDLL(dll)
	criarAmbiente := carregador.NewProc("CreateCoreWebView2EnvironmentWithOptions")
	if err := criarAmbiente.Find(); err != nil {
		return fmt.Errorf("%w: %v", errSemWebView2, err)
	}

	app = &aplicativo{janelas: map[uintptr]*janelaWeb{}, configura: cfg}
	if err := app.registrarClasse(); err != nil {
		return fmt.Errorf("%w: %v", errSemWebView2, err)
	}
	hwnd, err := app.criarJanela(nomeApp, true)
	if err != nil {
		return fmt.Errorf("%w: %v", errSemWebView2, err)
	}
	principal := &janelaWeb{hwnd: hwnd, principal: true, inicial: cfg.Plataforma}
	app.janelas[hwnd] = principal
	app.principal = principal
	principal.aoCarregar = func(erro error) {
		if erro != nil {
			app.falhaAntes = erro
			procDestroyWindow.Call(hwnd)
			return
		}
		app.mostrou = true
		if aoAbrir != nil {
			aoAbrir()
		}
	}

	// A porta de controle deixa a ponte do robô de lances conversar com as janelas (só em 127.0.0.1).
	if portaDepuracao > 0 {
		_ = os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", fmt.Sprintf("--remote-debugging-port=%d", portaDepuracao))
	}
	dados := filepath.Join(pastaInstalacao(), "Dados")
	aoAmbiente := novoManipulador(func(hr, ambiente uintptr) uintptr {
		if falhou(hr) || ambiente == 0 {
			principal.aoCarregar(fmt.Errorf("%w (0x%08X)", errSemWebView2, uint32(hr)))
			return 0
		}
		addRef(ambiente)
		app.ambiente = ambiente
		app.ligarWeb(principal)
		return 0
	})
	if hr, _, _ := criarAmbiente.Call(0, utf16(dados), 0, aoAmbiente); falhou(hr) {
		procDestroyWindow.Call(hwnd)
		return fmt.Errorf("%w (0x%08X)", errSemWebView2, uint32(hr))
	}

	var m mensagemWin
	for {
		r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
	}
	if !app.mostrou && app.falhaAntes != nil {
		if errors.Is(app.falhaAntes, errSemWebView2) {
			return app.falhaAntes
		}
		return fmt.Errorf("%w: %v", errSemWebView2, app.falhaAntes)
	}
	return nil
}

// Pedido da ponte: esconde a janela do Compras.gov.br (ela continua logada e trabalhando).
func pedirEsconderCompras() {
	if app != nil && app.principal != nil {
		procPostMessage.Call(app.principal.hwnd, wmEsconder, 0, 0)
	}
}

// Pedido vindo de outra goroutine (a ponte do robô): abre a janela do Compras.gov.br.
func pedirJanelaCompras() bool {
	if app == nil || app.principal == nil {
		return false
	}
	r, _, _ := procPostMessage.Call(app.principal.hwnd, wmAbrirCompra, 0, 0)
	return r != 0
}
