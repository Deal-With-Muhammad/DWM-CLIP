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
| `engine/editing.py`, `engine/follow.py` | Ours: headings that change, quiet parts cut out, and the layout that follows the streamer's head (face model in `engine/face/`) |
| `engine/cloudflare/` | The engine as a Cloudflare Container (one per video) |

The website starts a job on the engine (`ENGINE_URL`), and the engine sends progress and finished clips back to
`/api/engine/progress` and `/api/engine/clip`. Limits (clips, storage) are checked by the website when a clip arrives.

## Plans

Set in `src/lib/plans.ts`. Every plan picks the moments with the member's own AI key; a plan pays for storage,
more clips from one video and more of a long video at a time. Free: 200 MB, 2 clips from one video, 1 hour at a time.
Lite: $2/month, 1 GB, 5 clips, 2 hours. Pro: $9/month, 5 GB, 10 clips, 3 hours, two videos at once. Lite and Pro can add
10 GB blocks at $2/month. Payments: Lemon Squeezy for now (`src/lib/server/lemonsqueezy.ts`, webhook `/api/billing/lemonsqueezy`), Paddle ready beside it (`src/lib/server/billing.ts`, webhook `/api/billing/webhook`). `PAYMENTS` in `wrangler.jsonc` picks which one the pay buttons use; `seller` in `src/lib/site.ts` is the name shown on the legal pages.

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

In a second terminal, the engine (first time: `cd engine && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt -r requirements-face.txt`; needs `ffmpeg`):

```bash
npm run engine
```

Settings for development live in `.dev.vars` (not committed): `SESSION_SECRET`, `ENGINE_SECRET`,
`ENGINE_URL=http://127.0.0.1:8080`, `ADMIN_EMAILS`. Sign-in codes are printed in the `npm run dev` output.

## Deploy

```bash
npm run cf:deploy
```

Secrets on the `dwm-clip` Worker (`npx wrangler secret put NAME`): `SESSION_SECRET`, `ENGINE_SECRET`, `ENGINE_URL`,
`SMTP_USER`, `SMTP_PASS`, `ADMIN_EMAILS`, `LEMONSQUEEZY_WEBHOOK_SECRET`, and the `PADDLE_*` values listed in `wrangler.jsonc`.

The engine: `cd engine/cloudflare && npx wrangler deploy` (Workers Paid plan, Docker running), then
`npx wrangler secret put ENGINE_SECRET` there with the same value as the website.
