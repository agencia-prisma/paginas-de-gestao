(() => {
  "use strict";
  const config = window.REPORT_CONFIG || {};
  const form = document.querySelector("#report-form");
  const select = document.querySelector("#client");
  const submit = document.querySelector("#submit");
  const status = document.querySelector("#status");
  const clients = Array.isArray(config.clients) ? config.clients : [];
  const ids = new Set();
  for (const client of clients) {
    if (!client || typeof client.id !== "string" || !client.id.trim() ||
        typeof client.name !== "string" || !client.name.trim() || ids.has(client.id)) continue;
    ids.add(client.id);
    select.add(new Option(client.name, client.id));
  }
  const label = typeof config.additionalFieldLabel === "string" && config.additionalFieldLabel.trim()
    ? config.additionalFieldLabel.trim() : "Resumo da live";
  document.querySelector("#additional-label").textContent = label;
  let endpoint;
  try {
    endpoint = new URL(config.webhookUrl);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) endpoint = null;
  } catch { endpoint = null; }
  const ready = ids.size > 0 && !!endpoint;
  submit.disabled = !ready;
  document.querySelector("#configuration-status").textContent = ready ? "" :
    "O administrador precisa configurar os clientes e um webhook HTTPS em config.js para habilitar o envio.";
  let sending = false;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!ready || sending || form.dataset.generating === "true" || !form.reportValidity()) return;
    const data = new FormData(form);
    const client = clients.find(item => item && item.id === data.get("clientId") && ids.has(item.id));
    const metrics = {};
    for (const key of ["interactions", "sales", "productClicks", "views", "impressions", "addToCart"]) {
      const value = Number(data.get(key));
      if (!Number.isSafeInteger(value) || value < 0) {
        status.textContent = "Preencha os resultados com números inteiros iguais ou maiores que zero.";
        return;
      }
      metrics[key] = value;
    }
    const gmvText = String(data.get("gmv") || "").trim();
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(gmvText)) {
      status.textContent = "Preencha o GMV em reais, com até duas casas decimais e valor igual ou maior que zero.";
      return;
    }
    const [reais, centavos = ""] = gmvText.replace(",", ".").split(".");
    const gmvInCents = Number(reais) * 100 + Number(centavos.padEnd(2, "0"));
    if (!Number.isSafeInteger(gmvInCents) || gmvInCents < 0) {
      status.textContent = "O valor do GMV está acima do limite permitido.";
      return;
    }
    metrics.gmv = gmvInCents / 100;
    metrics.gmvCurrency = "BRL";
    const additionalValue = String(data.get("additionalValue") || "").trim();
    if (!client || !additionalValue) {
      status.textContent = "Selecione um cliente e preencha o contexto da live.";
      return;
    }
    const payload = {
      schemaVersion: 1, event: "live_report.submitted",
      submittedAt: new Date().toISOString(),
      client: { id: client.id, name: client.name },
      liveDate: data.get("liveDate"), metrics,
      additionalField: { label, value: additionalValue }
    };
    sending = true;
    form.dataset.sending = "true";
    submit.disabled = true;
    submit.textContent = "Enviando…";
    status.textContent = "Enviando relatório…";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint.href, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: controller.signal,
        credentials: "omit", redirect: "error"
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      form.reset();
      status.textContent = "Relatório enviado. Recebimento confirmado pelo webhook.";
    } catch {
      status.textContent = "Não foi possível confirmar o envio. Seus dados foram mantidos. Verifique com a equipe se o relatório chegou antes de tentar novamente.";
    } finally {
      clearTimeout(timeout);
      sending = false;
      form.dataset.sending = "false";
      submit.disabled = false;
      submit.innerHTML = 'Enviar relatório <span aria-hidden="true">↗</span>';
    }
  });
})();
