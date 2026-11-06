#!/usr/bin/env bash
# Gera o instalador do Montzion para Windows em public/downloads/Montzion-Instalador.exe
# Requer: Go 1.22+ e Python 3 (só biblioteca padrão).
set -euo pipefail
cd "$(dirname "$0")"

python3 gerar_recursos.py recursos/montzion.ico recursos/montzion.manifest rsrc_windows_amd64.syso
mkdir -p ../public/downloads
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H=windowsgui" \
  -o ../public/downloads/Montzion-Instalador.exe .
ls -la ../public/downloads/Montzion-Instalador.exe
