# DWM Clip

Paste a YouTube, Twitch or Kick link and get vertical clips with captions, a hook, a title and hashtags.
Live at https://clip.dealwithmuhammad.com.

## How it is built

| Part | What it is |
|---|---|
| `src/` | The website: Next.js + HeroUI, deployed to Cloudflare Workers with OpenNext |
| `migrations/` | The database tables (Cloudflare D1) |
| R2 bucket `dwm-clip-media` | Where finished clips are kept, one folder per member |
| `engine/` | The clip engine (Python): fetches the video, finds the moments, renders the clips |
| `engine/studio/` | [PeakCut](https://github.com/haziqahmedqasmi/PeakCut) at commit `1bef2b4`, unchanged (MIT, see `engine/PEAKCUT-LICENSE`) |
| `engine/runner.py`, `engine/server.py` | Ours: run one job with PeakCut's pipeline and report back to the website |
| `engine/cloudflare/` | The engine as a Cloudflare Container (one per video) |

The website starts a job on the engine (`ENGINE_URL`), and the engine sends progress and finished clips back to
`/api/engine/progress` and `/api/engine/clip`. Limits (clips, storage) are checked by the website when a clip arrives.

## Plans

Set in `src/lib/plans.ts`. Free: 2 clips with the member's own AI key, 200 MB. Pro: $9/month, 100 clips a month
with our AI key, 5 GB, plus 10 GB blocks at $2/month. Payments: `src/lib/server/billing.ts` (Paddle); Paddle calls `/api/billing/webhook`.

## Run it on this computer

```bash
npm install
```

```bash
npm run db:local
```

```bash
npm run dev
```

In a second terminal, the engine (first time: `cd engine && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt`; needs `ffmpeg`):

```bash
npm run engine
```

Settings for development live in `.dev.vars` (not committed): `SESSION_SECRET`, `ENGINE_SECRET`,
`ENGINE_URL=http://127.0.0.1:8080`, `ADMIN_EMAILS`, `AI_KEY`. Sign-in codes are printed in the `npm run dev` output.

## Deploy

```bash
npm run cf:deploy
```

Secrets on the `dwm-clip` Worker (`npx wrangler secret put NAME`): `SESSION_SECRET`, `ENGINE_SECRET`, `ENGINE_URL`,
`SMTP_USER`, `SMTP_PASS`, `AI_KEY`, `ADMIN_EMAILS`, and the `PADDLE_*` values listed in `wrangler.jsonc`.

The engine: `cd engine/cloudflare && npx wrangler deploy` (Workers Paid plan, Docker running), then
`npx wrangler secret put ENGINE_SECRET` there with the same value as the website.
