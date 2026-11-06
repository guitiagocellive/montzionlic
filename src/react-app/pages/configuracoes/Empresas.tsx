import { Building2, ImageIcon, Pencil, Plus, Star, Trash2, Upload } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { Empresa } from "../../../shared/tipos";
import { api, enviarArquivo, mensagemDeErro } from "../../api";
import { Alerta, Campo } from "../../components/Formulario";
import { avisar, Carregando, Interruptor, Modal, Vazio } from "../../components/Ui";
import { EscolherModeloPdf } from "../../proposta/EscolherModelo";

/** Empresas que participam das licitações. Cada proposta escolhe uma. */
export function EmpresasConfig() {
  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [editando, setEditando] = useState<Empresa | "nova" | null>(null);

  async function carregar() {
    try {
      setEmpresas((await api<{ empresas: Empresa[] }>("/empresas")).empresas);
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }
  useEffect(() => {
    carregar();
  }, []);

  async function tornarPadrao(e: Empresa) {
    await api(`/empresas/${e.id}`, { metodo: "PATCH", corpo: { padrao: true } }).catch((err) => avisar(mensagemDeErro(err), "erro"));
    carregar();
  }

  async function excluir(e: Empresa) {
    if (!confirm(`Excluir a empresa "${e.nome}"? As contas bancárias dela também serão excluídas.`)) return;
    try {
      await api(`/empresas/${e.id}`, { metodo: "DELETE" });
      carregar();
    } catch (err) {
      avisar(mensagemDeErro(err), "erro");
    }
  }

  if (!empresas) return <Carregando />;
  return (
    <section className="cartao">
      <div className="cartao-titulo">
        <h2>Empresas</h2>
        <button className="botao pequeno" onClick={() => setEditando("nova")}>
          <Plus /> Nova empresa
        </button>
      </div>
      <p className="descricao">
        Os dados da empresa, do representante legal e o logo entram sozinhos na proposta. Na aba Proposta de cada licitação você
        escolhe qual empresa está participando.
      </p>
      {empresas.length === 0 ? (
        <Vazio icone={<Building2 />} titulo="Nenhuma empresa cadastrada">
          Cadastre a sua empresa para gerar propostas.
        </Vazio>
      ) : (
        <div className="lista-empresas">
          {empresas.map((e) => (
            <article key={e.id} className="linha-empresa">
              <div className="empresa-logo">
                {e.tem_logo ? <img src={`/api/empresas/${e.id}/logo`} alt="" /> : <Building2 aria-hidden="true" />}
              </div>
              <div className="empresa-texto">
                <strong>
                  {e.nome} {e.padrao ? <span className="etiqueta">Padrão</span> : null}
                </strong>
                <span className="texto-fraco pequeno">
                  {[e.cnpj && `CNPJ ${e.cnpj}`, e.cidade, e.representante_nome && `Representante: ${e.representante_nome}`].filter(Boolean).join(" · ") ||
                    "Complete os dados"}
                </span>
              </div>
              <div className="linha-botoes">
                {!e.padrao && (
                  <button className="botao-icone" onClick={() => tornarPadrao(e)} aria-label="Tornar padrão" title="Tornar padrão">
                    <Star />
                  </button>
                )}
                <button className="botao-icone" onClick={() => setEditando(e)} aria-label="Editar">
                  <Pencil />
                </button>
                <button className="botao-icone perigo" onClick={() => excluir(e)} aria-label="Excluir">
                  <Trash2 />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {editando && (
        <ModalEmpresa
          empresa={editando === "nova" ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            carregar();
          }}
        />
      )}
    </section>
  );
}

function ModalEmpresa({ empresa, aoFechar, aoSalvar }: { empresa: Empresa | null; aoFechar: () => void; aoSalvar: () => void }) {
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [marcaDagua, setMarcaDagua] = useState(empresa ? !!empresa.marca_dagua : true);
  const [modeloPdf, setModeloPdf] = useState(empresa?.modelo_pdf || "classico");
  const [corPdf, setCorPdf] = useState(empresa?.cor_pdf || "#1f3b8a");
  const [logo, setLogo] = useState<File | null>(null);
  const [temLogo, setTemLogo] = useState(!!empresa?.tem_logo);
  const [previa, setPrevia] = useState<string | null>(empresa?.tem_logo ? `/api/empresas/${empresa.id}/logo?v=${Date.now()}` : null);
  const entrada = useRef<HTMLInputElement>(null);

  function escolherLogo(f: File) {
    if (!["image/png", "image/jpeg"].includes(f.type)) {
      setErro("Use uma imagem PNG ou JPG.");
      return;
    }
    setLogo(f);
    setTemLogo(true);
    setPrevia(URL.createObjectURL(f));
  }

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const corpo = { ...Object.fromEntries(new FormData(e.currentTarget)), marca_dagua: marcaDagua, modelo_pdf: modeloPdf, cor_pdf: corPdf };
    setErro("");
    setEnviando(true);
    try {
      const r = empresa
        ? await api<{ empresa: Empresa }>(`/empresas/${empresa.id}`, { metodo: "PATCH", corpo })
        : await api<{ empresa: Empresa }>("/empresas", { corpo });
      const id = r.empresa.id;
      if (logo) {
        const dados = new FormData();
        dados.set("logo", logo);
        await enviarArquivo(`/empresas/${id}/logo`, dados);
      } else if (empresa?.tem_logo && !temLogo) {
        await api(`/empresas/${id}/logo`, { metodo: "DELETE" });
      }
      avisar("Empresa salva.");
      aoSalvar();
    } catch (err) {
      setErro(mensagemDeErro(err));
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={empresa ? empresa.nome : "Nova empresa"} aoFechar={aoFechar} largo>
      <form className="formulario" onSubmit={enviar}>
        <Alerta>{erro}</Alerta>
        <div className="logo-proposta">
          <div className="logo-previa">{previa && temLogo ? <img src={previa} alt="Logo" /> : <ImageIcon aria-hidden="true" />}</div>
          <div>
            <strong>Logo (cabeçalho da proposta)</strong>
            <p className="texto-fraco pequeno" style={{ margin: "2px 0 10px" }}>
              PNG ou JPG, até 1,5 MB. Fundo transparente fica melhor.
            </p>
            <div className="linha-botoes">
              <button type="button" className="botao secundario pequeno" onClick={() => entrada.current?.click()}>
                <Upload /> {temLogo ? "Trocar logo" : "Enviar logo"}
              </button>
              {temLogo && (
                <button
                  type="button"
                  className="botao secundario pequeno perigo"
                  onClick={() => {
                    setTemLogo(false);
                    setLogo(null);
                  }}
                >
                  <Trash2 /> Remover
                </button>
              )}
            </div>
            <input
              ref={entrada}
              type="file"
              accept="image/png,image/jpeg"
              hidden
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) escolherLogo(f);
                ev.target.value = "";
              }}
            />
          </div>
        </div>
        <Interruptor ligado={marcaDagua} aoMudar={setMarcaDagua} rotulo="Logo clarinho no fundo das páginas (marca d'água)" />

        <h3 className="subtitulo-form">Modelo padrão da proposta em PDF</h3>
        <p className="texto-fraco pequeno" style={{ margin: "-4px 0 4px" }}>
          Usado em todas as propostas desta empresa. Dá para trocar em cada proposta, na aba Proposta.
        </p>
        <EscolherModeloPdf
          modelo={modeloPdf}
          cor={corPdf}
          aoMudar={(n) => {
            if (n.modelo) setModeloPdf(n.modelo);
            if (n.cor) setCorPdf(n.cor);
          }}
        />

        <h3 className="subtitulo-form">Dados da empresa</h3>
        <div className="grade-2">
          <Campo rotulo="Razão social" name="nome" defaultValue={empresa?.nome ?? ""} required autoFocus />
          <Campo rotulo="CNPJ" name="cnpj" defaultValue={empresa?.cnpj ?? ""} placeholder="00.000.000/0001-00" />
        </div>
        <div className="grade-3">
          <Campo rotulo="Inscrição estadual" name="ie" defaultValue={empresa?.ie ?? ""} />
          <Campo rotulo="Telefone" name="telefone" defaultValue={empresa?.telefone ?? ""} />
          <Campo rotulo="E-mail" name="email" type="email" defaultValue={empresa?.email ?? ""} />
        </div>
        <div className="grade-2">
          <Campo rotulo="Endereço" name="endereco" defaultValue={empresa?.endereco ?? ""} />
          <Campo rotulo="Cidade/Estado" name="cidade" defaultValue={empresa?.cidade ?? ""} placeholder="Ex.: Brasília-DF" />
        </div>

        <h3 className="subtitulo-form">Representante legal (quem assina)</h3>
        <div className="grade-2">
          <Campo rotulo="Nome" name="representante_nome" defaultValue={empresa?.representante_nome ?? ""} />
          <Campo rotulo="Cargo" name="representante_cargo" defaultValue={empresa?.representante_cargo ?? ""} placeholder="Ex.: Sócio-administrador" />
        </div>
        <div className="grade-2">
          <Campo rotulo="CPF" name="representante_cpf" defaultValue={empresa?.representante_cpf ?? ""} />
          <Campo rotulo="RG" name="representante_rg" defaultValue={empresa?.representante_rg ?? ""} />
        </div>
        <div className="botoes-modal">
          <button type="button" className="botao secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
