const ALLOWED_ORIGIN = "https://barakzai.cloud";
const CORS_ALLOW_HEADERS = "X-Adapter-Token, Content-Type";
const CORS_ALLOW_METHODS = "GET,POST,OPTIONS";
const CORS_MAX_AGE = "86400";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Max-Age": CORS_MAX_AGE,
    Vary: "Origin",
  };
}

function apiHeaders(request, extra = {}) {
  return {
    "Cache-Control": "no-store",
    ...corsHeaders(request),
    ...extra,
  };
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function assertOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== ALLOWED_ORIGIN) {
    return { ok: false, status: 403, payload: { detail: "Forbidden origin" } };
  }
  return { ok: true };
}

function assertAuth(request, env) {
  const expected = String(env.ADAPTER_TOKEN || "");
  if (!expected) {
    return { ok: false, status: 500, payload: { detail: "Server misconfigured: ADAPTER_TOKEN is missing" } };
  }

  const provided = request.headers.get("X-Adapter-Token") || "";
  if (provided !== expected) {
    return { ok: false, status: 401, payload: { detail: "Unauthorized" } };
  }

  return { ok: true };
}

async function fetchAsset(env, request, path) {
  const assetUrl = new URL(path, request.url);
  return env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
}

function requiredRunFields(body) {
  const required = ["api_version", "request_id", "topic", "lang", "mode"];
  return required.filter((field) => {
    const value = body?.[field];
    return typeof value !== "string" || !value.trim();
  });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const isTopics = url.pathname === "/v1/topics";
  const isRun = url.pathname === "/v1/run";

  if (request.method === "OPTIONS" && (isTopics || isRun)) {
    const originCheck = assertOrigin(request);
    if (!originCheck.ok) {
      return json(originCheck.payload, originCheck.status, apiHeaders(request));
    }
    return new Response(null, { status: 204, headers: apiHeaders(request) });
  }

  if (url.pathname === "/v1/health" && request.method === "GET") {
    return json({ ok: true, service: "dailyflow-tutor-api" }, 200, apiHeaders(request));
  }

  if (url.pathname.startsWith("/v1/")) {
    const originCheck = assertOrigin(request);
    if (!originCheck.ok) {
      return json(originCheck.payload, originCheck.status, apiHeaders(request));
    }

    const authCheck = assertAuth(request, env);
    if (!authCheck.ok) {
      return json(authCheck.payload, authCheck.status, apiHeaders(request));
    }
  }

  if (isTopics && request.method === "GET") {
    const assetResponse = await fetchAsset(env, request, "/tutor-data/topics.json");
    if (assetResponse.status === 404) {
      return json({ detail: "Not found" }, 404, apiHeaders(request));
    }
    if (!assetResponse.ok) {
      return json({ detail: "Upstream asset error" }, 502, apiHeaders(request));
    }

    return new Response(await assetResponse.text(), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...apiHeaders(request),
      },
    });
  }

  if (isRun && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ detail: "Invalid JSON body" }, 400, apiHeaders(request));
    }

    const missing = requiredRunFields(body);
    if (missing.length) {
      return json({ detail: `Missing required fields: ${missing.join(", ")}` }, 400, apiHeaders(request));
    }

    const topic = body.topic.trim().toLowerCase();
    const lang = body.lang.trim().toLowerCase();
    const mode = body.mode.trim().toLowerCase();
    const assetPath = `/tutor-data/run/${topic}.${lang}.${mode}.json`;

    const assetResponse = await fetchAsset(env, request, assetPath);
    if (assetResponse.status === 404) {
      return json({ detail: "Not found" }, 404, apiHeaders(request));
    }
    if (!assetResponse.ok) {
      return json({ detail: "Upstream asset error" }, 502, apiHeaders(request));
    }

    return new Response(await assetResponse.text(), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...apiHeaders(request),
      },
    });
  }

  return json({ detail: "Not found" }, 404, apiHeaders(request));
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
