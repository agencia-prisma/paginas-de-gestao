(() => {
  "use strict";
  const form = document.querySelector("#report-form");
  const generate = document.querySelector("#generate-summary");
  const apply = document.querySelector("#apply-summary");
  const discard = document.querySelector("#discard-summary");
  const draft = document.querySelector("#ai-draft");
  const draftText = document.querySelector("#ai-draft-text");
  const status = document.querySelector("#ai-status");
  const textarea = form.elements.additionalValue;
  const submit = document.querySelector("#submit");
  const keys = ["interactions", "impressions", "views", "productClicks", "addToCart", "sales", "gmv"];
  let suggestion = "";
  let source = "";
  const fingerprint = () => JSON.stringify([...keys, "clientId", "liveDate"].map(key => form.elements[key].value));
  const clear = () => { suggestion = ""; draft.hidden = true; };
  function invalidate() {
    if (suggestion && fingerprint() !== source) {
      clear();
      status.textContent = "Os dados da live mudaram. Gere uma nova análise para usar os valores atualizados.";
    }
  }
  form.addEventListener("input", invalidate);
  form.addEventListener("change", invalidate);
  form.addEventListener("reset", () => { clear(); status.textContent = ""; });
  discard.addEventListener("click", () => { clear(); status.textContent = "Sugestão descartada. Seu resumo foi mantido."; });
  generate.addEventListener("click", async () => {
    if (form.dataset.generating === "true" || form.dataset.sending === "true") return;
    for (const key of ["clientId", "liveDate", ...keys]) {
      if (!form.elements[key].reportValidity()) return;
    }
    const metrics = {};
    for (const key of keys.filter(key => key !== "gmv")) {
      metrics[key] = Number(form.elements[key].value);
      if (!Number.isSafeInteger(metrics[key]) || metrics[key] < 0) {
        status.textContent = "As contagens precisam ser números inteiros iguais ou maiores que zero.";
        return;
      }
    }
    const amount = form.elements.gmv.value.trim();
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(amount)) {
      status.textContent = "Preencha o GMV em reais, com até duas casas decimais.";
      return;
    }
    const [whole, fraction = ""] = amount.replace(",", ".").split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(cents) || cents < 0) {
      status.textContent = "O valor do GMV está acima do limite permitido.";
      return;
    }
    metrics.gmv = cents / 100;
    metrics.gmvCurrency = "BRL";
    clear();
    source = fingerprint();
    const snapshot = source;
    const wasDisabled = submit.disabled;
    form.dataset.generating = "true";
    generate.disabled = true;
    submit.disabled = true;
    generate.textContent = "Gerando análise…";
    status.textContent = "Analisando os resultados da live…";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch("/api/summary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics }), signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "A IA está indisponível. Tente novamente ou escreva seu resumo.");
      if (typeof result.summary !== "string" || !result.summary.trim() || result.summary.length > 4500) {
        throw new Error("A IA não retornou uma sugestão válida. Seu texto foi mantido.");
      }
      if (fingerprint() !== snapshot) {
        status.textContent = "Os dados mudaram durante a geração. Gere novamente para analisar os números atuais.";
        return;
      }
      suggestion = result.summary.trim();
      draftText.textContent = suggestion;
      draft.hidden = false;
      status.textContent = "Sugestão pronta. Revise e use no resumo quando desejar.";
    } catch (error) {
      status.textContent = error.name === "AbortError"
        ? "A geração demorou mais que o esperado. Seu resumo foi mantido. Tente novamente ou escreva manualmente."
        : error.message === "Failed to fetch"
          ? "Não foi possível conectar à IA. Seu resumo foi mantido."
          : error.message;
    } finally {
      clearTimeout(timeout);
      form.dataset.generating = "false";
      generate.disabled = false;
      submit.disabled = wasDisabled;
      generate.textContent = "Gerar análise com IA";
    }
  });
  apply.addEventListener("click", () => {
    if (!suggestion || fingerprint() !== source) { invalidate(); return; }
    const existing = textarea.value.trim();
    const combined = existing ? existing + "\n\n" + suggestion : suggestion;
    if (combined.length > textarea.maxLength) {
      status.textContent = "O resumo ultrapassaria 5.000 caracteres. Encurte o texto atual antes de adicionar a sugestão.";
      return;
    }
    textarea.value = combined;
    clear();
    status.textContent = "Análise adicionada ao resumo. Edite como desejar antes de enviar.";
    textarea.focus();
  });
})();
