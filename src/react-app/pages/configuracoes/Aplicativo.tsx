import { CheckCircle2, Download, Loader2, MonitorDown, MonitorSmartphone, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { noAplicativo } from "../../robo/ponte";
import { guardarEscolha, lerEscolha } from "../../robo/AbrirNoAplicativo";

type VersaoPublicada = { versao: string; data?: string; novidades?: string[] };

/** 1 se a for mais nova que b, -1 se mais velha, 0 se igual ("3.0.10" > "3.0.9"). */
export function compararVersoes(a: string, b: string) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

const dataBr = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : "");

/** Dentro do aplicativo: versão instalada e verificar se há uma nova. */
function AtualizacaoApp() {
  const atual = window.montzionApp?.versao ?? "";
  const [estado, setEstado] = useState<"" | "verificando" | "erro">("");
  const [publicada, setPublicada] = useState<VersaoPublicada | null>(null);

  async function verificar() {
    setEstado("verificando");
    try {
      const r = await fetch(`/downloads/versao.json?agora=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      setPublicada((await r.json()) as VersaoPublicada);
      setEstado("");
    } catch {
      setEstado("erro");
    }
  }

  const nova = publicada && atual ? compararVersoes(publicada.versao, atual) > 0 : false;

  return (
    <section className="cartao app-download">
      <div className="app-download-topo">
        <span className="app-icone">
          <img src="/icones/icone-192.png" alt="" />
        </span>
        <div>
          <h2>Montzion para Windows</h2>
          <p className="texto-suave" style={{ margin: "4px 0 0" }}>
            Você está usando o aplicativo. Versão instalada: <strong className="versao-app">{atual || "—"}</strong>
          </p>
        </div>
        <button className="botao secundario" onClick={verificar} disabled={estado === "verificando"}>
          {estado === "verificando" ? <Loader2 className="girando" /> : <RefreshCw />} Verificar atualização
        </button>
      </div>

      {estado === "erro" && <p className="alerta erro">Não foi possível verificar agora. Confira a internet e tente de novo.</p>}

      {publicada && !nova && (
        <p className="aviso-versao ok">
          <CheckCircle2 size={16} /> Você já está na versão mais recente ({atual}).
        </p>
      )}

      {publicada && nova && (
        <div className="aviso-versao nova">
          <div>
            <strong>
              <Sparkles size={16} /> Nova versão {publicada.versao} disponível
            </strong>
            {publicada.data && <span className="texto-fraco pequeno"> · publicada em {dataBr(publicada.data)}</span>}
            {!!publicada.novidades?.length && (
              <ul>
                {publicada.novidades.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <p className="texto-fraco pequeno" style={{ margin: "6px 0 0" }}>
              Baixe e abra o instalador: ele fecha esta janela do Montzion, instala a versão nova e abre de novo sozinho, sem
              perder configurações. Se houver disputa com o robô ligado, atualize depois que ela acabar.
            </p>
          </div>
          <a className="botao acento" href="/downloads/Montzion-Instalador.exe" download="Montzion-Instalador.exe">
            <Download /> Baixar versão {publicada.versao}
          </a>
        </div>
      )}
    </section>
  );
}

type EventoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Baixar o Montzion para o computador (Windows) ou instalar pelo navegador. */
export function AplicativoConfig() {
  // Dentro do aplicativo não faz sentido oferecer baixar o aplicativo: mostra a versão e a atualização.
  if (noAplicativo()) return <AtualizacaoApp />;
  return <AplicativoNavegador />;
}

function AplicativoNavegador() {
  const [instalavel, setInstalavel] = useState<EventoInstalar | null>(null);
  const [instalado, setInstalado] = useState(() => matchMedia("(display-mode: standalone)").matches);
  const windows = /Windows/i.test(navigator.userAgent);

  useEffect(() => {
    const aoPoder = (e: Event) => {
      e.preventDefault();
      setInstalavel(e as EventoInstalar);
    };
    const aoInstalar = () => setInstalado(true);
    addEventListener("beforeinstallprompt", aoPoder);
    addEventListener("appinstalled", aoInstalar);
    return () => {
      removeEventListener("beforeinstallprompt", aoPoder);
      removeEventListener("appinstalled", aoInstalar);
    };
  }, []);

  async function instalarPeloNavegador() {
    if (!instalavel) return;
    await instalavel.prompt();
    await instalavel.userChoice;
    setInstalavel(null);
  }

  return (
    <>
      <section className="cartao app-download">
        <div className="app-download-topo">
          <span className="app-icone">
            <img src="/icones/icone-192.png" alt="" />
          </span>
          <div>
            <h2>Montzion para Windows</h2>
            <p className="texto-suave" style={{ margin: "4px 0 0" }}>
              Programa próprio do Montzion: janela com o nome e o ícone do Montzion, sem barra de endereço nem abas, com atalho na
              área de trabalho e no menu Iniciar. É por ele que o robô de lances funciona.
            </p>
          </div>
          <a className="botao acento" href="/downloads/Montzion-Instalador.exe" download="Montzion-Instalador.exe">
            <Download /> Baixar instalador (.exe)
          </a>
        </div>
        {!windows && (
          <p className="texto-amarelo pequeno" style={{ margin: "12px 0 0" }}>
            Este instalador é para Windows. Em outro sistema, use a opção "Instalar pelo navegador" abaixo.
          </p>
        )}
        <ol className="passos-app">
          <li>
            Clique em <strong>Baixar instalador (.exe)</strong> e abra o arquivo baixado.
          </li>
          <li>
            Se o navegador disser que o arquivo <strong>"não é baixado com frequência"</strong>, clique nos <strong>…</strong> ao lado do
            download → <strong>Manter</strong> → <strong>Mostrar mais</strong> → <strong>Manter mesmo assim</strong>.
          </li>
          <li>
            Se o Windows mostrar <strong>"O Windows protegeu o computador"</strong>, clique em <strong>Mais informações</strong> e
            depois em <strong>Executar assim mesmo</strong>. O aviso aparece porque o instalador é novo e ainda não tem assinatura de
            empresa.
          </li>
          <li>
            Pronto: aparece o atalho <strong>Montzion</strong> na área de trabalho e no menu Iniciar. Não precisa de senha de
            administrador.
          </li>
          <li>
            Já tinha instalado uma versão antiga? Baixe e abra o instalador de novo: ele fecha o Montzion aberto, atualiza e abre
            a versão nova sozinho.
          </li>
          <li>
            Para remover: <strong>Configurações do Windows → Aplicativos → Montzion → Desinstalar</strong>.
          </li>
        </ol>
        <details className="ajuda-defender">
          <summary>
            <ShieldAlert size={15} /> O antivírus do Windows apagou o arquivo ("Ameaças encontradas")?
          </summary>
          <p className="texto-suave pequeno">
            É um alarme falso, comum com programas novos que ainda não têm assinatura digital paga. Para liberar só este arquivo:
          </p>
          <ol className="passos-app">
            <li>
              Abra <strong>Segurança do Windows</strong> (clique no aviso ou procure no menu Iniciar) →{" "}
              <strong>Proteção contra vírus e ameaças</strong> → <strong>Histórico de proteção</strong>.
            </li>
            <li>
              Clique no item do <strong>Montzion-Instalador.exe</strong> → <strong>Ações</strong> → <strong>Permitir no
              dispositivo</strong> (ou <strong>Restaurar</strong>).
            </li>
            <li>Baixe de novo, se o arquivo tiver sumido, e abra normalmente.</li>
          </ol>
          <p className="texto-fraco pequeno">
            Só libere arquivos baixados daqui (montzion.com.br). O instalador não pede senha de administrador e só grava na pasta
            do seu usuário.
          </p>
        </details>
        <p className="texto-fraco pequeno nota-app">
          <ShieldAlert size={14} /> O aplicativo só abre o endereço montzion.com.br: o login e os dados continuam os mesmos da
          plataforma.
        </p>
      </section>

      {windows && <LinksNoAplicativo />}

      <section className="cartao">
        <h2>
          <MonitorSmartphone size={17} /> Instalar pelo navegador
        </h2>
        <p className="descricao">
          Funciona no Windows, Mac e celular, pelo Chrome ou Edge: o Montzion vira um ícone, como um aplicativo.
        </p>
        {instalado ? (
          <p className="texto-verde pequeno">O Montzion já está instalado neste aparelho.</p>
        ) : instalavel ? (
          <button className="botao secundario" onClick={instalarPeloNavegador}>
            <MonitorDown /> Instalar agora
          </button>
        ) : (
          <p className="texto-fraco pequeno" style={{ margin: 0 }}>
            No Chrome ou Edge, clique no ícone de instalar na barra de endereço (ou no menu ⋮ → "Instalar Montzion"). No iPhone,
            use Compartilhar → "Adicionar à Tela de Início".
          </p>
        )}
      </section>
    </>
  );
}

/** Neste computador: links compartilhados (ex.: licitação da busca) abrem no aplicativo, no navegador ou perguntam. */
function LinksNoAplicativo() {
  const [escolha, setEscolha] = useState(lerEscolha);
  const opcoes: { valor: "" | "app" | "navegador"; rotulo: string }[] = [
    { valor: "", rotulo: "Perguntar" },
    { valor: "app", rotulo: "No aplicativo" },
    { valor: "navegador", rotulo: "No navegador" },
  ];
  return (
    <section className="cartao">
      <h2>Links compartilhados</h2>
      <p className="descricao">
        Como abrir, neste computador, os links de licitação que a equipe compartilha (WhatsApp, e-mail). "No aplicativo" abre direto no Montzion
        para Windows (versão 3.1.44 ou mais nova).
      </p>
      <div className="segmentado grande">
        {opcoes.map((o) => (
          <button
            key={o.valor || "perguntar"}
            className={escolha === o.valor ? "ativo" : ""}
            onClick={() => {
              guardarEscolha(o.valor);
              setEscolha(o.valor);
            }}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </section>
  );
}
