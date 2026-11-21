// The Worker's entry: OpenNext's own Worker (every page and route), plus a timer.
// Once an hour the timer calls the site's clean-up route, which deletes Free-plan clips older than the plan
// keeps them (src/lib/server/library.ts, sweepFreeClips). The route is called in-process, not over the network.
import handler from "./.open-next/worker.js";

const worker = {
  fetch: handler.fetch,
  async scheduled(_event, env, ctx) {
    const request = new Request("https://clip.dealwithmuhammad.com/api/cron/sweep", {
      method: "POST",
      headers: { authorization: `Bearer ${env.ENGINE_SECRET}` },
    });
    const response = await handler.fetch(request, env, ctx);
    console.log("clean-up timer", response.status, (await response.text()).slice(0, 300));
  },
};

export default worker;
