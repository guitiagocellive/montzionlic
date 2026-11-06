"""Gera rsrc_windows_amd64.syso (ícone + manifesto do Windows) para o compilador Go embutir no .exe.

Escreve um objeto COFF com uma seção .rsrc contendo RT_ICON, RT_GROUP_ICON e RT_MANIFEST.
Uso: python3 gerar_recursos.py recursos/montzion.ico recursos/montzion.manifest rsrc_windows_amd64.syso
"""

import struct
import sys

RT_ICON, RT_GROUP_ICON, RT_MANIFEST = 3, 14, 24
IDIOMA = 0x0409


def ler_ico(caminho):
    dados = open(caminho, "rb").read()
    _, tipo, qtd = struct.unpack_from("<HHH", dados, 0)
    if tipo != 1:
        raise SystemExit("Arquivo .ico inválido")
    imagens = []
    for i in range(qtd):
        w, h, cores, _, planos, bits, tamanho, inicio = struct.unpack_from("<BBBBHHII", dados, 6 + 16 * i)
        imagens.append(((w, h, cores, planos, bits), dados[inicio : inicio + tamanho]))
    return imagens


def alinhar(buf, n=8):
    while len(buf) % n:
        buf.append(0)


def main(ico, manifesto, saida):
    imagens = ler_ico(ico)
    grupo = bytearray(struct.pack("<HHH", 0, 1, len(imagens)))
    for i, ((w, h, cores, planos, bits), img) in enumerate(imagens, start=1):
        grupo += struct.pack("<BBBBHHIH", w, h, cores, 0, planos, bits, len(img), i)

    # tipo -> [(id, dados)]
    recursos = {
        RT_ICON: [(i, img) for i, (_, img) in enumerate(imagens, start=1)],
        RT_GROUP_ICON: [(1, bytes(grupo))],
        RT_MANIFEST: [(1, open(manifesto, "rb").read())],
    }
    tipos = sorted(recursos)

    # Calcula o tamanho de cada nível de diretório para posicionar tudo.
    def tam_dir(n):
        return 16 + 8 * n

    pos = tam_dir(len(tipos))  # raiz
    pos_nomes = {}
    for t in tipos:
        pos_nomes[t] = pos
        pos += tam_dir(len(recursos[t]))
    pos_idiomas = {}
    for t in tipos:
        for rid, _ in recursos[t]:
            pos_idiomas[(t, rid)] = pos
            pos += tam_dir(1)
    pos_entradas = {}
    for t in tipos:
        for rid, _ in recursos[t]:
            pos_entradas[(t, rid)] = pos
            pos += 16
    pos_dados = {}
    for t in tipos:
        for rid, d in recursos[t]:
            pos = (pos + 7) & ~7
            pos_dados[(t, rid)] = pos
            pos += len(d)

    sec = bytearray()

    def diretorio(entradas):
        sec.extend(struct.pack("<IIHHHH", 0, 0, 0, 0, 0, len(entradas)))
        for ident, alvo, eh_dir in entradas:
            sec.extend(struct.pack("<II", ident, alvo | (0x80000000 if eh_dir else 0)))

    diretorio([(t, pos_nomes[t], True) for t in tipos])
    for t in tipos:
        diretorio([(rid, pos_idiomas[(t, rid)], True) for rid, _ in recursos[t]])
    for t in tipos:
        for rid, _ in recursos[t]:
            diretorio([(IDIOMA, pos_entradas[(t, rid)], False)])
    relocacoes = []
    for t in tipos:
        for rid, d in recursos[t]:
            relocacoes.append(len(sec))  # campo OffsetToData (RVA) precisa de relocação
            sec.extend(struct.pack("<IIII", pos_dados[(t, rid)], len(d), 0, 0))
    for t in tipos:
        for rid, d in recursos[t]:
            alinhar(sec)
            assert len(sec) == pos_dados[(t, rid)]
            sec.extend(d)
    alinhar(sec, 4)

    # Objeto COFF: cabeçalho + 1 seção + relocações + tabela de símbolos
    cab = 20
    sh = 40
    pos_raw = cab + sh
    pos_rel = pos_raw + len(sec)
    pos_sim = pos_rel + 10 * len(relocacoes)
    obj = bytearray()
    obj += struct.pack("<HHIIIHH", 0x8664, 1, 0, pos_sim, 1, 0, 0)
    obj += struct.pack(
        "<8sIIIIIIHHI", b".rsrc\0\0\0", 0, 0, len(sec), pos_raw, pos_rel, 0, len(relocacoes), 0, 0x40000040
    )
    obj += sec
    for r in relocacoes:
        obj += struct.pack("<IIH", r, 0, 0x0003)  # IMAGE_REL_AMD64_ADDR32NB, símbolo 0 (.rsrc)
    obj += struct.pack("<8sIhHBB", b".rsrc\0\0\0", 0, 1, 0, 3, 0)  # símbolo estático da seção
    obj += struct.pack("<I", 4)  # tabela de strings vazia
    open(saida, "wb").write(obj)


if __name__ == "__main__":
    main(*sys.argv[1:4])
