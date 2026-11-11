#!/usr/bin/env bash
# Gera o instalador do Montzion para Windows em public/downloads/Montzion-Instalador.exe
# Requer: Go 1.22+ e Python 3 (só biblioteca padrão).
set -euo pipefail
cd "$(dirname "$0")"

VERSAO=$(sed -n 's/^[[:space:]]*versao[[:space:]]*=[[:space:]]*"\(.*\)".*/\1/p' comum.go)
python3 gerar_recursos.py recursos/montzion.ico recursos/montzion.manifest rsrc_windows_amd64.syso "$VERSAO"
mkdir -p ../public/downloads
# Sem "-s -w": programas sem símbolos são vistos com mais desconfiança pelos antivírus.
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H=windowsgui" \
  -o ../public/downloads/Montzion-Instalador.exe .
ls -la ../public/downloads/Montzion-Instalador.exe
