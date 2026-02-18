import { readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(process.cwd());
const runDir = resolve(repoRoot, "assets", "tutor-data", "run");
const topicsPath = resolve(repoRoot, "assets", "tutor-data", "topics.json");

function extractTopic(fileName) {
  const parts = fileName.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const [topic, lang, mode, ext] = parts;
  if (!topic || !lang || !mode || ext !== "json") {
    return null;
  }
  return topic;
}

async function main() {
  const entries = await readdir(runDir, { withFileTypes: true });
  const topics = new Set();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const topic = extractTopic(entry.name);
    if (topic) {
      topics.add(topic);
    }
  }

  const payload = {
    topics: Array.from(topics).sort(),
    source: "generated-from-assets",
  };

  await writeFile(topicsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Generated ${topicsPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
