package main

import "testing"

func TestListaFechadaDoFornecedor(t *testing.T) {
	base := "https://cnetmobile.estaleiro.serpro.gov.br"
	c := "15812005900452026"
	pode := []pedidoCompras{
		{Metodo: "GET", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens/1/propostas", Captcha: true},
		{Metodo: "GET", Caminho: "/comprasnet-fase-externa/public/v1/compras/" + c + "/itens/1/fase-recursal/1"},
		{Metodo: "GET", Caminho: "/comprasnet-fase-externa/v2/compras/" + c + "/itens/3/participacoes/12345678000199/anexos/77"},
		{Metodo: "GET", Caminho: "/comprasnet-mensagem/v2/chat/" + c + "/itens/2", Query: "size=100&page=0&legadoAsp=false"},
		{Metodo: "POST", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens/1/intencoes-recurso", Corpo: []byte(`{"etapaSelecaoFornecedores":"JP"}`)},
		{Metodo: "POST", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens/1/participacao/12345678000199/anexos", Arquivo: &arquivoEnvio{Nome: "proposta.pdf", Base64: "JVBERg=="}},
		{Metodo: "GET", URL: "https://storage.estaleiro.serpro.gov.br/objetos/abc.pdf"},
		{Metodo: "GET", Caminho: "/comprasnet-fase-externa/v1/compras/" + c},
		{Metodo: "GET", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens", Captcha: true, Query: "pagina=0&tamanhoPagina=100"},
		{Metodo: "GET", Caminho: "/comprasnet-fase-externa/v1/declaracoes", Query: "fundamentoLegal=LEI_14133%20art75"},
		{Metodo: "POST", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/participacao", Corpo: []byte(`{"declaracaoMeEpp":true}`)},
		{Metodo: "POST", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens/2/participacao", Corpo: []byte(`{"valor":10}`)},
		{Metodo: "PUT", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens/2/participacao", Corpo: []byte(`{"valor":9}`)},
		{Metodo: "DELETE", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens/2/participacao"},
	}
	for _, p := range pode {
		if err := validarPedido(&p, base); err != nil {
			t.Errorf("%s %s%s deveria passar: %v", p.Metodo, p.Caminho, p.URL, err)
		}
	}
	nao := []pedidoCompras{
		{Metodo: "GET", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/analise-propostas"},                            // tela do pregoeiro
		{Metodo: "POST", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/em-selecao-fornecedores/itens/1/homologacao"}, // ação do governo
		{Metodo: "POST", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens/1/participacoes/1/negociacoes-valores"}, // ação do governo
		{Metodo: "DELETE", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/participacao"},                              // desistir da compra
		{Metodo: "GET", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens/1/propostas/../../../../usuario"},        // fuga de caminho
		{Metodo: "GET", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens/1/propostas", Query: "captcha=x"},        // captcha só o nosso
		{Metodo: "GET", URL: "https://exemplo.com/roubo"},                                                                      // fora do governo
		{Metodo: "GET", URL: "http://storage.estaleiro.serpro.gov.br/x"},                                                       // sem https
		{Metodo: "POST", URL: "https://storage.estaleiro.serpro.gov.br/x"},                                                     // arquivo só se baixa
		{Metodo: "GET", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens/1/participacoes/../anexos"},
		{Metodo: "PATCH", Caminho: "/comprasnet-fase-externa/v1/compras/" + c + "/itens/1/recursos"},
	}
	for _, p := range nao {
		if err := validarPedido(&p, base); err == nil {
			t.Errorf("%s %s%s?%s deveria ser recusado", p.Metodo, p.Caminho, p.URL, p.Query)
		}
	}
}
