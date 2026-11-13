//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var procRegGetValueW = advapi32.NewProc("RegGetValueW")

// valorRegistroUsuario lê um valor de HKEY_CURRENT_USER (texto ou número). ok=false se não existe.
func valorRegistroUsuario(chave, nome string, numero bool) (texto string, n uint32, ok bool) {
	const hkcu = 0x80000001
	flags := uintptr(0x2 | 0x4) // RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ
	if numero {
		flags = 0x10 // RRF_RT_REG_DWORD
		var v, tam uint32 = 0, 4
		r, _, _ := procRegGetValueW.Call(hkcu, utf16Reg(chave), utf16Reg(nome), flags, 0, uintptr(unsafe.Pointer(&v)), uintptr(unsafe.Pointer(&tam)))
		return "", v, r == 0
	}
	buf := make([]uint16, 2048)
	tam := uint32(len(buf) * 2)
	r, _, _ := procRegGetValueW.Call(hkcu, utf16Reg(chave), utf16Reg(nome), flags, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&tam)))
	if r != 0 {
		return "", 0, false
	}
	return syscall.UTF16ToString(buf), 0, true
}

func utf16Reg(s string) uintptr {
	p, _ := syscall.UTF16PtrFromString(s)
	return uintptr(unsafe.Pointer(p))
}

// proxyDoWindows: o proxy das "Configurações de proxy" do Windows, que a janela do gov.br (Edge WebView2) usa e
// o teste do aplicativo não. "" = sem proxy.
func proxyDoWindows() string {
	const chave = `Software\Microsoft\Windows\CurrentVersion\Internet Settings`
	if pac, _, ok := valorRegistroUsuario(chave, "AutoConfigURL", false); ok && pac != "" {
		return "script de configuração automática (" + pac + ")"
	}
	if _, ligado, ok := valorRegistroUsuario(chave, "ProxyEnable", true); ok && ligado != 0 {
		servidor, _, _ := valorRegistroUsuario(chave, "ProxyServer", false)
		if servidor == "" {
			servidor = "sem endereço"
		}
		return "servidor proxy " + servidor
	}
	return ""
}
