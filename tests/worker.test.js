import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { handleRequest } from "../src/index.js";

const repoRoot = resolve(process.cwd());

function createEnv() {
  return {
    ADAPTER_TOKEN: "dev-secret",
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        const localPath = resolve(repoRoot, "assets", `.${url.pathname}`);
        try {
          const content = await readFile(localPath, "utf8");
          return new Response(content, {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        } catch {
          return new Response(JSON.stringify({ detail: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }
      },
    },
  };
}

async function readJson(res) {
  return JSON.parse(await res.text());
}

async function run() {
  const env = createEnv();

  {
    const req = new Request("https://api.barakzai.cloud/v1/topics", {
      headers: { "X-Adapter-Token": "dev-secret", Origin: "https://barakzai.cloud" },
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.ok(Array.isArray(body.topics));
    assert.equal(body.topics[0].topic, "bubblesort");
  }

  {
    const req = new Request("https://api.barakzai.cloud/v1/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Adapter-Token": "dev-secret",
      },
      body: JSON.stringify({
        api_version: "v1",
        request_id: "11111111-1111-1111-1111-111111111111",
        topic: "bubblesort",
        lang: "de",
        mode: "pseudocode",
      }),
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.api_version, "v1");
    assert.equal(body.topic, "bubblesort");
    assert.equal(body.lang, "de");
    assert.ok(body.result && typeof body.result === "object");
  }

  {
    const req = new Request("https://api.barakzai.cloud/v1/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Adapter-Token": "dev-secret",
      },
      body: JSON.stringify({ topic: "mergesort", lang: "de", mode: "pseudocode" }),
    });
    const res = await handleRequest(req, env);
    assert.equal(res.status, 404);
    const body = await readJson(res);
    assert.equal(body.detail, "Not found");
  }

  console.log("All tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
