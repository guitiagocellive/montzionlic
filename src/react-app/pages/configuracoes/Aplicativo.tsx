import { Download, MonitorDown, MonitorSmartphone, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

type EventoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Baixar o Montzion para o computador (Windows) ou instalar pelo navegador. */
export function AplicativoConfig() {
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
            Se o Windows mostrar <strong>"O Windows protegeu o computador"</strong>, clique em <strong>Mais informações</strong> e
            depois em <strong>Executar assim mesmo</strong>. O aviso aparece porque o instalador é novo e ainda não tem assinatura de
            empresa.
          </li>
          <li>
            Pronto: aparece o atalho <strong>Montzion</strong> na área de trabalho e no menu Iniciar. Não precisa de senha de
            administrador.
          </li>
          <li>
            Já tinha instalado uma versão antiga? Baixe e abra o instalador de novo: ele atualiza sozinho.
          </li>
          <li>
            Para remover: <strong>Configurações do Windows → Aplicativos → Montzion → Desinstalar</strong>.
          </li>
        </ol>
        <p className="texto-fraco pequeno nota-app">
          <ShieldAlert size={14} /> O aplicativo só abre o endereço montzion.com.br: o login e os dados continuam os mesmos da
          plataforma.
        </p>
      </section>

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
