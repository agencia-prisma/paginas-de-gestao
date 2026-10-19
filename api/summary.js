const countKeys = ["interactions", "impressions", "views", "productClicks", "addToCart", "sales"];
const attempts = new Map();
let total = { start: 0, count: 0 };
const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
const reply = (status, body, extra = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });
function takeSlot(ip) {
  const now = Date.now();
  for (const [key, value] of attempts) if (now - value.start >= 600000) attempts.delete(key);
  if (now - total.start >= 3600000) total = { start: now, count: 0 };
  const current = attempts.get(ip) || { start: now, count: 0 };
  if (current.count >= 5 || total.count >= 100 || attempts.size >= 2000) return false;
  attempts.set(ip, { start: current.start, count: current.count + 1 });
  total.count++;
  return true;
}
export default {
  async fetch(request) {
    if (request.method !== "POST") return reply(405, { error: "Método não permitido." }, { Allow: "POST" });
    const url = new URL(request.url);
    // Same-origin restriction limits browser callers; it is not authentication.
    if (request.headers.get("origin") !== url.origin) return reply(403, { error: "Origem não permitida." });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return reply(415, { error: "Envie os resultados em JSON." });
    }
    if (Number(request.headers.get("content-length") || 0) > 4096) return reply(413, { error: "Dados acima do limite." });
    let input;
    try {
      const reader = request.body?.getReader();
      if (!reader) return reply(400, { error: "Preencha os resultados da live." });
      let bytes = 0;
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4096) { await reader.cancel(); return reply(413, { error: "Dados acima do limite." }); }
        chunks.push(value);
      }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      input = JSON.parse(new TextDecoder().decode(body));
    } catch { return reply(400, { error: "Dados inválidos." }); }
    const incoming = input?.metrics;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return reply(400, { error: "Preencha os resultados da live." });
    const metrics = {};
    for (const key of countKeys) {
      if (!Number.isSafeInteger(incoming[key]) || incoming[key] < 0) return reply(400, { error: "As contagens devem ser números inteiros iguais ou maiores que zero." });
      metrics[key] = incoming[key];
    }
    if (typeof incoming.gmv !== "number" || !Number.isFinite(incoming.gmv) || incoming.gmv < 0 ||
        incoming.gmv > 90071992547409 || Number(incoming.gmv.toFixed(2)) !== incoming.gmv ||
        incoming.gmvCurrency !== "BRL") return reply(400, { error: "Informe o GMV em reais, com até duas casas decimais." });
    metrics.gmv = incoming.gmv;
    metrics.gmvCurrency = "BRL";
    const token = process.env.GROQ_API_KEY?.trim();
    if (!token) return reply(503, { error: "O administrador precisa configurar a chave da Groq na Vercel. Você pode escrever o resumo manualmente." });
    const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!takeSlot(ip)) return reply(429, { error: "Limite temporário de gerações atingido. Aguarde alguns minutos ou escreva o resumo manualmente." }, { "Retry-After": "600" });
    const percentage = (a, b) => b > 0 ? Math.round(a / b * 10000) / 100 : null;
    const rates = {
      visualizacoesPorImpressoesPct: percentage(metrics.views, metrics.impressions),
      cliquesPorVisualizacoesPct: percentage(metrics.productClicks, metrics.views),
      carrinhosPorCliquesPct: percentage(metrics.addToCart, metrics.productClicks),
      vendasPorCarrinhosPct: percentage(metrics.sales, metrics.addToCart),
      vendasPorCliquesPct: percentage(metrics.sales, metrics.productClicks),
      gmvPorVenda: metrics.sales > 0 ? Math.round(metrics.gmv / metrics.sales * 100) / 100 : null
    };
    const instructions = [
      "Você analisa resultados de lives comerciais em português do Brasil.",
      "Escreva texto simples, sem Markdown ou HTML, com até 250 palavras e 3 partes: Resumo dos resultados; Pontos de atenção; Próximos testes.",
      "Use apenas os números e taxas fornecidos. Interações, impressões, visualizações, cliques no produto, carrinhos, vendas e GMV em BRL.",
      "As taxas são razões entre contagens, não necessariamente conversões de pessoas únicas. Não trate as métricas como usuários únicos.",
      "Não invente metas, benchmarks, histórico, ROI, lucro, custo, duração ou causas. Sem histórico não conclua que o resultado foi bom, ruim ou melhorou.",
      "Taxas nulas são indisponíveis por denominador zero. Não divida por zero. Se os números forem incompatíveis (por exemplo vendas sem cliques), destaque a necessidade de conferir os dados.",
      "Sugira 2 ou 3 testes concretos ligados às etapas observadas: abertura da live, demonstração do produto, CTA ou esclarecimento de frete e dúvidas.",
      "Apresente possíveis gargalos e hipóteses com cautela, nunca como causa comprovada ou promessa de resultado. Se todos os números forem zero, diga que não há resultado mensurável e recomende conferir a coleta antes de otimizar."
    ].join(" ");
    try {
      const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
          max_completion_tokens: 2400,
          include_reasoning: false,
          reasoning_effort: "low",
          messages: [{ role: "system", content: instructions }, { role: "user", content: JSON.stringify({ metrics, taxasCalculadas: rates }) }]
        }),
        signal: AbortSignal.timeout(28000)
      });
      if (!upstream.ok) {
        const adminIssue = [401, 402, 403].includes(upstream.status);
        return reply(adminIssue ? 503 : upstream.status === 429 ? 429 : 502, {
          error: adminIssue
            ? "A IA está indisponível. O administrador precisa conferir a chave e as permissões da Groq. Você pode escrever manualmente."
            : upstream.status === 429
              ? "O limite de uso da Groq foi atingido. Aguarde alguns minutos ou escreva o resumo manualmente."
              : "Não foi possível gerar agora. Tente novamente em alguns minutos ou escreva seu resumo manualmente."
        });
      }
      const output = await upstream.json();
      const choice = output.choices?.[0];
      const summary = choice?.message?.content;
      if (choice?.finish_reason === "length" || typeof summary !== "string" || !summary.trim() || summary.length > 4500) {
        return reply(502, { error: "A IA não concluiu uma sugestão válida. Tente novamente ou escreva manualmente." });
      }
      return reply(200, { summary: summary.trim() });
    } catch {
      return reply(502, { error: "A geração não foi concluída a tempo. Seu texto foi mantido; tente novamente ou escreva manualmente." });
    }
  }
};
