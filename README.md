# Relatórios de lives

Página estática em português, sem dependências e sem banco de dados.

## Configuração pelo administrador

Edite `config.js` no repositório e publique novamente:
- `clients`: lista de objetos com `id` único e `name`.
- `webhookUrl`: URL HTTPS do destino.
- `additionalFieldLabel`: rótulo do campo de contexto. O texto original “setorio ocevove” é ambíguo; foi adotado “Resumo da live”, editável nesta configuração.

Exemplo de cliente: `{ id: "acme", name: "Acme" }`.

O cadastro é estático, compartilhado pela versão publicada e mantido por quem tem permissão de edição no repositório. Não existe painel de administrador ou autenticação de usuários. Não se usa armazenamento local nem persistência centralizada de clientes ou relatórios.

## Publicação

Sirva os quatro arquivos `index.html`, `styles.css`, `config.js` e `app.js` em qualquer hospedagem estática via HTTPS. Nenhum build é necessário. O repositório não habilita hospedagem automaticamente.

## Webhook

O navegador envia POST JSON com `schemaVersion`, `event`, `submittedAt` (UTC), `client: { id, name }`, `liveDate` (AAAA-MM-DD), `metrics: { interactions, sales, productClicks, views, impressions, addToCart, gmv, gmvCurrency }` e `additionalField: { label, value }`.

`impressions` e `addToCart` são contagens inteiras não negativas. `gmv` é o valor bruto de vendas em reais (número JSON, por exemplo 1234.56), acompanhado de `gmvCurrency: "BRL"`. O formulário aceita ponto ou vírgula decimal, até duas casas e nenhum separador de milhar. Todos os resultados são obrigatórios; zero é aceito.

O destino deve responder ao preflight OPTIONS permitindo a origem publicada, POST e o cabeçalho Content-Type, e incluir os cabeçalhos CORS também na resposta ao POST. Apenas respostas HTTP 2xx confirmam recebimento; isso não garante processamento posterior. Não se usa modo no-cors, pois ele impede confirmar a entrega.

A URL e a configuração são públicas no navegador: não inclua credenciais. Se o serviço exigir segredo, use um intermediário controlado pela equipe; esta página não implementa um backend. O receptor deve validar o payload, aplicar seus controles de acesso e limitar abuso; os valores enviados pelo navegador podem ser alterados por terceiros.

O envio tem limite de 20 segundos e bloqueia cliques repetidos enquanto aguarda. Em falhas os campos são preservados. Não há reenvio automático: timeout ou falha de CORS pode acontecer depois do recebimento, portanto confirme com a equipe antes de reenviar.

## Validação manual

1. Sem configuração, verificar aviso e envio desabilitado.
2. Configurar clientes e um receptor de testes com CORS; verificar seleção e rótulo personalizado.
3. Campos obrigatórios e negativos devem impedir envio; contagens fracionárias também. GMV deve aceitar 0, 1234,56 e 1234.56, rejeitando mais de duas casas decimais; zero deve ser aceito.
4. Conferir um POST com os valores e cliente escolhidos, botão bloqueado durante envio e limpeza apenas após 2xx.
5. Simular HTTP 500, falha de rede e timeout; verificar preservação dos campos e ausência de sucesso.
6. Conferir navegação por teclado e layout em celular.
