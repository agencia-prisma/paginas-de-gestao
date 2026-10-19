import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const server = await readFile(new URL("../api/summary.js", import.meta.url), "utf8");
const client = await readFile(new URL("../summary.js", import.meta.url), "utf8");
const metrics = { interactions: 10, impressions: 100, views: 50, productClicks: 20, addToCart: 5, sales: 2, gmv: 123.45, gmvCurrency: "BRL" };
function api(status = 200, content = "Resumo e melhorias.", env = { VERCEL_OIDC_TOKEN: "test-only" }) {
  const calls = [];
  const context = { Request, Response, URL, TextDecoder, Uint8Array, AbortSignal, process: { env },
    fetch: async (url, options) => { calls.push(JSON.parse(options.body)); return Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] }, { status }); }
  };
  vm.runInNewContext(server.replace("export default {", "globalThis.handler = {"), context);
  return { calls, run: (body, origin = "https://example.com") => context.handler.fetch(new Request("https://example.com/api/summary", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body)
  })) };
}
test("API returns summary and computes rates; zero denominators become null", async () => {
  const h = api();
  assert.equal((await h.run({ metrics })).status, 200);
  assert.equal(JSON.parse(h.calls[0].messages[1].content).taxasCalculadas.cliquesPorVisualizacoesPct, 40);
  const zeros = Object.fromEntries(Object.keys(metrics).map(key => [key, key === "gmvCurrency" ? "BRL" : 0]));
  assert.equal((await h.run({ metrics: zeros })).status, 200);
  assert.equal(JSON.parse(h.calls[1].messages[1].content).taxasCalculadas.gmvPorVenda, null);
});
test("API rejects invalid metrics, other origins and oversized payloads before generation", async () => {
  const h = api();
  for (const patch of [{ sales: -1 }, { views: 1.5 }, { gmv: 1.001 }, { gmv: "123" }, { gmvCurrency: "USD" }, { views: null }]) {
    assert.equal((await h.run({ metrics: { ...metrics, ...patch } })).status, 400);
  }
  assert.equal((await h.run({ metrics }, "https://other.example")).status, 403);
  assert.equal((await h.run({ metrics, padding: "x".repeat(4200) })).status, 413);
  assert.equal(h.calls.length, 0);
});
test("API handles unavailable credentials, credits and empty provider response", async () => {
  assert.equal((await api(200, "ok", {}).run({ metrics })).status, 503);
  assert.equal((await api(402).run({ metrics })).status, 503);
  assert.equal((await api(200, "").run({ metrics })).status, 502);
});
test("API limits repeated requests per instance", async () => {
  const h = api();
  for (let i = 0; i < 5; i++) assert.equal((await h.run({ metrics })).status, 200);
  assert.equal((await h.run({ metrics })).status, 429);
});
function ui(response = async () => Response.json({ summary: "Sugestão da IA." })) {
  const element = (value = "") => ({ value, disabled: false, hidden: true, maxLength: 5000, handlers: {},
    addEventListener(name, fn) { this.handlers[name] = fn; }, reportValidity() { return true; }, focus() {}
  });
  const form = element();
  form.dataset = {};
  form.elements = Object.fromEntries(Object.entries({ ...metrics, gmv: "123,45", clientId: "a", liveDate: "2026-10-19", additionalValue: "Texto humano." }).map(([key, value]) => [key, element(String(value))]));
  const elements = Object.fromEntries(["generate-summary", "apply-summary", "discard-summary", "ai-draft", "ai-draft-text", "ai-status", "submit"].map(key => ["#" + key, element()]));
  elements["#report-form"] = form;
  const calls = [];
  vm.runInNewContext(client, { document: { querySelector: key => elements[key] }, setTimeout, clearTimeout, AbortController,
    fetch: async (url, options) => { calls.push({ url, payload: JSON.parse(options.body) }); return response(); }
  });
  return { form, elements, calls, click: key => elements["#" + key].handlers.click() };
}
test("AI draft stays separate, preserves writing and never calls report webhook", async () => {
  const h = ui();
  await h.click("generate-summary");
  assert.equal(h.form.elements.additionalValue.value, "Texto humano.");
  assert.equal(h.calls[0].url, "/api/summary");
  assert.deepEqual(Object.keys(h.calls[0].payload), ["metrics"]);
  h.form.elements.additionalValue.value = "Texto revisado durante a geração.";
  await h.click("apply-summary");
  assert.equal(h.form.elements.additionalValue.value, "Texto revisado durante a geração.\n\nSugestão da IA.");
});
test("metric changes invalidate the draft; manual edits do not", async () => {
  const h = ui();
  await h.click("generate-summary");
  h.form.elements.views.value = "51";
  h.form.handlers.input();
  await h.click("apply-summary");
  assert.equal(h.form.elements.additionalValue.value, "Texto humano.");
  assert.equal(h.elements["#ai-draft"].hidden, true);
});
test("changing metrics while waiting discards outdated response", async () => {
  let finish;
  const h = ui(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.click("generate-summary");
  h.form.elements.sales.value = "3";
  finish(Response.json({ summary: "Sugestão desatualizada." }));
  await pending;
  assert.equal(h.elements["#ai-draft"].hidden, true);
  assert.equal(h.form.elements.additionalValue.value, "Texto humano.");
});
test("failure preserves text; applying respects character limit", async () => {
  const failure = ui(async () => Response.json({ error: "Indisponível" }, { status: 503 }));
  await failure.click("generate-summary");
  assert.equal(failure.form.elements.additionalValue.value, "Texto humano.");
  assert.equal(failure.elements["#submit"].disabled, false);
  const h = ui();
  await h.click("generate-summary");
  h.form.elements.additionalValue.value = "x".repeat(5000);
  await h.click("apply-summary");
  assert.equal(h.form.elements.additionalValue.value.length, 5000);
});
