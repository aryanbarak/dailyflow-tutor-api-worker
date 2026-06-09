<div align="center">

# dailyflow-tutor-api-worker

**Cloudflare Worker — static content API for DailyFlow Tutor**

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License](https://img.shields.io/badge/License-All_Rights_Reserved-red?style=for-the-badge)]()

</div>

---

## Overview

This Cloudflare Worker serves static learning content (pseudocode, explanations, exam questions) for the [DailyFlow](https://barakzai.cloud) tutor feature. It exposes a versioned REST API that the frontend uses to load algorithm training data — available in German and Persian.

It also proxies YouTube search results via the Innertube API for in-app video recommendations.

**Live app:** https://barakzai.cloud · **Main repo:** [aryanbarak/dailyflow](https://github.com/aryanbarak/dailyflow)

---

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/v1/health` | Public | Health check |
| `GET` | `/v1/topics` | Token + Origin | List available topics, filterable by `?mode=` and `?lang=` |
| `POST` | `/v1/run` | Token + Origin | Return content JSON for a topic/language/mode combination |
| `GET` | `/search?q=` | Origin only | YouTube search proxy via Innertube API |

### `/v1/run` — Request body

```json
{
  "api_version": "1",
  "request_id": "abc123",
  "topic": "bubblesort",
  "lang": "de",
  "mode": "pseudocode"
}
```

**Supported modes:** `pseudocode` · `explain` · `exam` · `trace`

**Supported languages:** `de` (German) · `fa` (Persian/Farsi)

> If a Persian (`fa`) payload doesn't exist, the worker automatically falls back to German (`de`).

---

## Content Structure

Learning data lives in `assets/tutor-data/` as static JSON files — deployed alongside the worker via Cloudflare Assets.

```
assets/tutor-data/
├── topics.json                        # Topic registry with availability matrix
└── run/
    ├── bubblesort.de.pseudocode.json
    ├── bubblesort.fa.pseudocode.json
    ├── bubblesort.de.explain.json
    ├── bubblesort.de.exam.json
    ├── selectionsort.de.pseudocode.json
    ├── insertionsort.fa.explain.json
    ├── binarysearch.de.exam.json
    ├── linearsearch.fa.pseudocode.json
    ├── exam_bank_ap2.de.exam.json
    ├── fiae_2023.de.exam.json
    └── ...                            # 60+ topic/lang/mode combinations
```

**Covered algorithms:** Bubble Sort, Selection Sort, Insertion Sort, Binary Search, Linear Search, Min/Max/Avg, Checksum, Count Condition, Search Contains, Max Period, WiSo

---

## Security

| Measure | Implementation |
|---------|----------------|
| Origin restriction | CORS whitelist — `https://barakzai.cloud` only |
| Endpoint auth | `X-Adapter-Token` header validated against `ADAPTER_TOKEN` secret |
| YouTube proxy | Origin-only check (no token required) |
| Secrets | Stored in Cloudflare Worker secrets, never in code |

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Cloudflare Workers (V8 isolates) |
| Language | JavaScript (ES2022) |
| Static assets | Cloudflare Assets (served via `env.ASSETS`) |
| CI/CD | GitHub Actions — auto-deploy on push to `main` |
| Deploy tool | Wrangler CLI |

---

## Getting Started

```bash
npm install

# Local development
wrangler dev

# Run tests
npm test

# Deploy
wrangler deploy
```

**Required secrets:**

```bash
wrangler secret put ADAPTER_TOKEN
```

---

## Author

**Aryan Barakzai** · [barakzai.cloud](https://barakzai.cloud) · [GitHub](https://github.com/aryanbarak)

---

## License

All Rights Reserved — Copyright © Aryan Barakzai
