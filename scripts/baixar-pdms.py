# Gera public/dados/pdms.json (catálogo de produtos do Compras.gov.br) para a Inteligência de mercado.
# Uso: python3 -I scripts/baixar-pdms.py public/dados/pdms.json
import json, urllib.request, concurrent.futures as cf, sys
URL = "https://dadosabertos.compras.gov.br/modulo-material/3_consultarPdmMaterial?pagina={}&tamanhoPagina=500"
def pagina(n):
    for t in range(4):
        try:
            with urllib.request.urlopen(URL.format(n), timeout=90) as r:
                return json.load(r)["resultado"]
        except Exception as e:
            err = e
    raise err
with cf.ThreadPoolExecutor(4) as ex:
    todos = [x for pg in ex.map(pagina, range(1, 42)) for x in pg]
print(len(todos), file=sys.stderr)
classes = {}
pdms = []
vistos = set()
for p in todos:
    if p["codigoPdm"] in vistos: continue
    vistos.add(p["codigoPdm"])
    classes[str(p["codigoClasse"])] = p["nomeClasse"].strip()
    pdms.append([p["codigoPdm"], p["nomePdm"].strip(), p["codigoClasse"], 1 if p["statusPdm"] else 0])
pdms.sort(key=lambda x: x[1])
json.dump({"classes": classes, "pdms": pdms}, open(sys.argv[1], "w"), ensure_ascii=False, separators=(",", ":"))
