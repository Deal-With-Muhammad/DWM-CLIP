var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.ts
import { DurableObject } from "cloudflare:workers";
var PORT = 8080;
var INACTIVITY_TIMEOUT_MS = 90 * 60 * 1e3;
var ClipEngine = class extends DurableObject {
  static {
    __name(this, "ClipEngine");
  }
  starting;
  monitoring;
  constructor(ctx, env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
      this.observeExit();
    }
  }
  async fetch(request) {
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = void 0;
    });
    await this.starting;
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container.getTcpPort(PORT).fetch(forwarded);
  }
  async startAndWaitForPort() {
    const container = this.ctx.container;
    if (!container.running) {
      const proxy = this.env.YTDLP_PROXY ? { HTTPS_PROXY: this.env.YTDLP_PROXY, HTTP_PROXY: this.env.YTDLP_PROXY } : {};
      container.start({
        image: container.images.base,
        instance: "standard-3",
        // 2 vCPU, 8 GiB: enough for the speech model and a 1080p render
        enableInternet: true,
        env: { ENGINE_SECRET: this.env.ENGINE_SECRET, ENGINE_ONE_SHOT: "1", ...proxy }
      });
    }
    this.observeExit();
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const response = await port.fetch("http://container/health", { signal: AbortSignal.timeout(1e3) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
      }
      await scheduler.wait(200);
    }
    throw new Error("The clip engine did not start");
  }
  observeExit() {
    if (this.monitoring) return;
    this.monitoring = this.ctx.container.monitor().catch((error) => console.error("Clip engine container failed:", error)).finally(() => {
      this.monitoring = void 0;
    });
    this.ctx.waitUntil(this.monitoring);
  }
};
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/jobs") return new Response("Not found", { status: 404 });
    if (!env.ENGINE_SECRET || request.headers.get("authorization") !== `Bearer ${env.ENGINE_SECRET}`) return new Response("Unauthorized", { status: 401 });
    const body = await request.text();
    let id = "";
    try {
      id = String(JSON.parse(body).id ?? "");
    } catch {
    }
    if (!/^[\w-]{8,64}$/.test(id)) return new Response("Bad job", { status: 400 });
    return env.ENGINE.getByName(id).fetch(new Request(request.url, { method: "POST", headers: request.headers, body }));
  }
};
export {
  ClipEngine,
  worker_default as default
};
//# sourceMappingURL=worker.js.map
