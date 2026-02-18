# DailyFlow Tutor API Worker

## Name and Route Alignment
The worker name in `wrangler.toml` is intentionally set to `dailyflow-tutor-api` so local `wrangler deploy` updates the same production worker already routed at `api.barakzai.cloud/*`.

If the name differs, deploys will target another worker and production will continue serving old behavior.

## Local Commands
- `npm install`
- `npm test`
- `wrangler dev`
- `wrangler secret put ADAPTER_TOKEN`
- `wrangler deploy`
