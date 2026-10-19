# Relatórios de lives

Interface em português, sem dependências e sem banco de dados, com uma Vercel Function para geração opcional de resumos por IA.

## Configuração pelo administrador

Edite `config.js` no repositório e publique novamente:
- `clients`: lista de objetos com `id` único e `name`.
- `webhookUrl`: URL HTTPS do destino.
- `additionalFieldLabel`: rótulo do campo de contexto. O texto original “setorio ocevove” é ambíguo; foi adotado “Resumo da live”, editável nesta configuração.

Exemplo de cliente: `{ id: "acme", name: "Acme" }`.

O cadastro é estático, compartilhado pela versão publicada e mantido por quem tem permissão de edição no repositório. Não existe painel de administrador ou autenticação de usuários. Não se usa armazenamento local nem persistência centralizada de clientes ou relatórios.

## Publicação

Sirva os arquivos `index.html`, `styles.css`, `config.js`, `app.js` e `summary.js` em qualquer hospedagem estática via HTTPS. Nenhum build é necessário para a interface. A geração de IA exige a função `api/summary.js` hospedada na Vercel; hospedagem puramente estática mantém o preenchimento manual. O repositório não habilita hospedagem automaticamente.

## Webhook

O navegador envia POST JSON com `schemaVersion`, `event`, `submittedAt` (UTC), `client: { id, name }`, `liveDate` (AAAA-MM-DD), `metrics: { interactions, sales, productClicks, views, impressions, addToCart, gmv, gmvCurrency }` e `additionalField: { label, value }`.

`impressions` e `addToCart` são contagens inteiras não negativas. `gmv` é o valor bruto de vendas em reais (número JSON, por exemplo 1234.56), acompanhado de `gmvCurrency: "BRL"`. O formulário aceita ponto ou vírgula decimal, até duas casas e nenhum separador de milhar. Todos os resultados são obrigatórios; zero é aceito.

O destino deve responder ao preflight OPTIONS permitindo a origem publicada, POST e o cabeçalho Content-Type, e incluir os cabeçalhos CORS também na resposta ao POST. Apenas respostas HTTP 2xx confirmam recebimento; isso não garante processamento posterior. Não se usa modo no-cors, pois ele impede confirmar a entrega.

A URL e a configuração são públicas no navegador: não inclua credenciais. Se o serviço exigir segredo, use um intermediário controlado pela equipe; a função de IA não atua como intermediário do webhook de relatórios. O receptor deve validar o payload, aplicar seus controles de acesso e limitar abuso; os valores enviados pelo navegador podem ser alterados por terceiros.

O envio tem limite de 20 segundos e bloqueia cliques repetidos enquanto aguarda. Em falhas os campos são preservados. Não há reenvio automático: timeout ou falha de CORS pode acontecer depois do recebimento, portanto confirme com a equipe antes de reenviar.

## Validação manual

1. Sem configuração, verificar aviso e envio desabilitado.
2. Configurar clientes e um receptor de testes com CORS; verificar seleção e rótulo personalizado.
3. Campos obrigatórios e negativos devem impedir envio; contagens fracionárias também. GMV deve aceitar 0, 1234,56 e 1234.56, rejeitando mais de duas casas decimais; zero deve ser aceito.
4. Conferir um POST com os valores e cliente escolhidos, botão bloqueado durante envio e limpeza apenas após 2xx.
5. Simular HTTP 500, falha de rede e timeout; verificar preservação dos campos e ausência de sucesso.
6. Conferir navegação por teclado e layout em celular.

## Resumo com IA

O botão “Gerar análise com IA” usa os resultados preenchidos para sugerir um resumo, pontos de atenção e próximos testes. A sugestão aparece separada do resumo. “Usar sugestão no resumo” adiciona o texto sem apagar observações já escritas. A pessoa pode escrever do zero, editar e enviar manualmente pelo webhook existente. Gerar a análise nunca envia o relatório.

Apenas as métricas são transmitidas diretamente à Groq; nomes de clientes e texto manual não são enviados à IA. Se as métricas, cliente ou data mudarem durante ou depois da geração, a sugestão fica inválida. A interface aceita o resumo editado como antes, em `additionalField.value`, sem mudar as chaves do webhook.

### Configuração na Vercel

- Node.js 22 ou superior (projeto atual: 24).
- Configure `GROQ_API_KEY` como variável privada do servidor em Settings → Environment Variables na Vercel, para Production (e Preview se necessário). Após salvar, faça um novo deploy. Não use prefixos públicos nem coloque a chave em `config.js` ou no chat.
- Gere a chave na [Groq Console](https://console.groq.com/keys). A função chama diretamente `https://api.groq.com/openai/v1/chat/completions`; não usa AI Gateway, créditos de IA ou tokens OIDC da Vercel.
- Modelo padrão: `openai/gpt-oss-120b`, disponível no catálogo de produção e nos limites do plano gratuito da Groq na data da implementação. Configuração opcional `GROQ_MODEL`: use um modelo GPT-OSS compatível com `reasoning_effort: "low"` e `include_reasoning: false`, como `openai/gpt-oss-20b`.
- O uso segue a cota e o plano da conta Groq. O código não altera o plano nem compra créditos. A hospedagem e a execução da função continuam sujeitas ao plano da Vercel.
- O endpoint é público, assim como o formulário; a checagem de origem não é autenticação.
- Há limites temporários por instância (5 gerações/IP a cada 10 minutos, 100/hora por instância), payload de até 4 KB e geração limitada a 2.400 tokens/28 segundos. Esses limites não são distribuídos e reiniciam com a instância; não substituem limites da conta Groq ou proteção de abuso na Vercel.
- A função não armazena relatórios em banco. Contadores temporários ficam apenas em memória.

### Verificação da IA

Verificar números válidos e zeros; contagens negativas/fracionárias; GMV com centavos; falha de autenticação/permissão da Groq e cota atingida; sugestão vazia; timeout; edição manual durante geração; alterações das métricas invalidando sugestão; uso da sugestão preservando texto manual e limite de 5.000 caracteres; envio final com o texto revisado.
