//go:build windows

package main

// Instalação com chamadas diretas ao Windows: atalho (IShellLink), registro em "Aplicativos
// instalados" (advapi32) e remoção. Sem abrir PowerShell, reg.exe ou cmd.exe escondidos: o
// antivírus do Windows trata programas que fazem isso como suspeitos.

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"
)

var (
	advapi32             = syscall.NewLazyDLL("advapi32.dll")
	procRegCreateKeyExW  = advapi32.NewProc("RegCreateKeyExW")
	procRegSetValueExW   = advapi32.NewProc("RegSetValueExW")
	procRegCloseKey      = advapi32.NewProc("RegCloseKey")
	procRegDeleteTreeW   = advapi32.NewProc("RegDeleteTreeW")
	procRegDeleteKeyW    = advapi32.NewProc("RegDeleteKeyW")
	procCoCreateInstance = ole32.NewProc("CoCreateInstance")
)

const (
	hkeyCurrentUser = 0x80000001
	keySetValue     = 0x0002
	keyCreateSub    = 0x0004
	regSZ           = 1
	regDWORD        = 4
	clsctxInproc    = 0x1
	// Caminho da chave dentro de HKEY_CURRENT_USER.
	subchaveDesinstalar = `Software\Microsoft\Windows\CurrentVersion\Uninstall\Montzion`
)

var (
	clsidShellLink = guid{0x00021401, 0x0000, 0x0000, [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidShellLinkW  = guid{0x000214F9, 0x0000, 0x0000, [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
	iidPersistFile = guid{0x0000010B, 0x0000, 0x0000, [8]byte{0xC0, 0, 0, 0, 0, 0, 0, 0x46}}
)

func texto16(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

// gravarRegistro grava os valores (string ou uint32) na chave de HKEY_CURRENT_USER.
func gravarRegistro(subchave string, valores map[string]any) error {
	var chave uintptr
	r, _, _ := procRegCreateKeyExW.Call(hkeyCurrentUser, uintptr(unsafe.Pointer(texto16(subchave))), 0, 0, 0,
		keySetValue|keyCreateSub, 0, uintptr(unsafe.Pointer(&chave)), 0)
	if r != 0 {
		return fmt.Errorf("registro: erro %d", r)
	}
	defer procRegCloseKey.Call(chave)
	for nome, v := range valores {
		switch x := v.(type) {
		case string:
			d, _ := syscall.UTF16FromString(x)
			procRegSetValueExW.Call(chave, uintptr(unsafe.Pointer(texto16(nome))), 0, regSZ, uintptr(unsafe.Pointer(&d[0])), uintptr(len(d)*2))
		case uint32:
			procRegSetValueExW.Call(chave, uintptr(unsafe.Pointer(texto16(nome))), 0, regDWORD, uintptr(unsafe.Pointer(&x)), 4)
		}
	}
	return nil
}

func apagarRegistro(subchave string) {
	if procRegDeleteTreeW.Find() == nil {
		procRegDeleteTreeW.Call(hkeyCurrentUser, uintptr(unsafe.Pointer(texto16(subchave))))
	}
	procRegDeleteKeyW.Call(hkeyCurrentUser, uintptr(unsafe.Pointer(texto16(subchave))))
}

// criarAtalhoNativo cria um atalho .lnk pelo próprio Windows (IShellLinkW + IPersistFile).
func criarAtalhoNativo(lnk, alvo, args, descricao string) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	procCoInitializeEx.Call(0, 2) // COINIT_APARTMENTTHREADED (se já estava iniciado, não faz mal)

	var link uintptr
	hr, _, _ := procCoCreateInstance.Call(uintptr(unsafe.Pointer(&clsidShellLink)), 0, clsctxInproc,
		uintptr(unsafe.Pointer(&iidShellLinkW)), uintptr(unsafe.Pointer(&link)))
	if falhou(hr) || link == 0 {
		return fmt.Errorf("IShellLink indisponível (0x%x)", uint32(hr))
	}
	defer metodo(link, 2) // Release

	alvo16, args16, pasta16, desc16 := texto16(alvo), texto16(args), texto16(filepath.Dir(alvo)), texto16(descricao)
	metodo(link, 20, uintptr(unsafe.Pointer(alvo16)))    // SetPath
	metodo(link, 11, uintptr(unsafe.Pointer(args16)))    // SetArguments
	metodo(link, 9, uintptr(unsafe.Pointer(pasta16)))    // SetWorkingDirectory
	metodo(link, 7, uintptr(unsafe.Pointer(desc16)))     // SetDescription
	metodo(link, 17, uintptr(unsafe.Pointer(alvo16)), 0) // SetIconLocation

	var arquivo uintptr
	if hr := metodo(link, 0, uintptr(unsafe.Pointer(&iidPersistFile)), uintptr(unsafe.Pointer(&arquivo))); falhou(hr) || arquivo == 0 {
		return fmt.Errorf("IPersistFile indisponível (0x%x)", uint32(hr))
	}
	defer metodo(arquivo, 2)
	_ = os.MkdirAll(filepath.Dir(lnk), 0o755)
	lnk16 := texto16(lnk)
	if hr := metodo(arquivo, 6, uintptr(unsafe.Pointer(lnk16)), 1); falhou(hr) { // Save
		return fmt.Errorf("não salvou o atalho (0x%x)", uint32(hr))
	}
	runtime.KeepAlive(alvo16)
	runtime.KeepAlive(args16)
	runtime.KeepAlive(pasta16)
	runtime.KeepAlive(desc16)
	runtime.KeepAlive(lnk16)
	if _, err := os.Stat(lnk); err != nil {
		return errors.New("atalho não foi criado")
	}
	return nil
}
