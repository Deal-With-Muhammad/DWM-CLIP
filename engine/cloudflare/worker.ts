// The clip engine's Worker. Each video gets its own container (a Durable Object named after the job),
// which runs server.py from the image, takes the one job, and exits when the clips are made.
// Follows Cloudflare's "Durable Object Container API" guide.
import { DurableObject } from "cloudflare:workers";

type Env = { ENGINE: DurableObjectNamespace<ClipEngine>; ENGINE_SECRET: string; YTDLP_PROXY?: string };

const PORT = 8080;
// A long stream can take a while, and nothing calls the container while it works.
const INACTIVITY_TIMEOUT_MS = 90 * 60 * 1000;

export class ClipEngine extends DurableObject<Env> {
  private starting: Promise<void> | undefined;
  private monitoring: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
      this.observeExit();
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!;
    if (!container.running) {
      const proxy = this.env.YTDLP_PROXY ? { HTTPS_PROXY: this.env.YTDLP_PROXY, HTTP_PROXY: this.env.YTDLP_PROXY } : {};
      container.start({
        image: container.images.base,
        instance: "standard-3", // 2 vCPU, 8 GiB: enough for the speech model and a 1080p render
        enableInternet: true,
        env: { ENGINE_SECRET: this.env.ENGINE_SECRET, ENGINE_ONE_SHOT: "1", ...proxy },
      });
    }
    this.observeExit();
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const response = await port.fetch("http://container/health", { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // Not listening yet.
      }
      await scheduler.wait(200);
    }
    throw new Error("The clip engine did not start");
  }

  private observeExit(): void {
    if (this.monitoring) return;
    this.monitoring = this.ctx
      .container!.monitor()
      .catch((error: unknown) => console.error("Clip engine container failed:", error))
      .finally(() => {
        this.monitoring = undefined;
      });
    this.ctx.waitUntil(this.monitoring);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/jobs") return new Response("Not found", { status: 404 });
    // Only the website may start a container (they cost money): the same shared secret the container checks again.
    if (!env.ENGINE_SECRET || request.headers.get("authorization") !== `Bearer ${env.ENGINE_SECRET}`) return new Response("Unauthorized", { status: 401 });
    const body = await request.text();
    let id = "";
    try {
      id = String((JSON.parse(body) as { id?: unknown }).id ?? "");
    } catch {}
    if (!/^[\w-]{8,64}$/.test(id)) return new Response("Bad job", { status: 400 });
    return env.ENGINE.getByName(id).fetch(new Request(request.url, { method: "POST", headers: request.headers, body }));
  },
};
