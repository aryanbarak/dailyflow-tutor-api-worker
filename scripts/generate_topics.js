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

function extractTuple(fileName) {
  const parts = fileName.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const [topic, lang, mode, ext] = parts;
  if (!topic || !lang || !mode || ext !== "json") {
    return null;
  }
  return { topic, lang, mode };
}

async function main() {
  const entries = await readdir(runDir, { withFileTypes: true });
  const topics = new Set();
  const availability = new Map();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const tuple = extractTuple(entry.name);
    if (tuple) {
      topics.add(tuple.topic);
      if (!availability.has(tuple.topic)) {
        availability.set(tuple.topic, new Map());
      }
      const topicModes = availability.get(tuple.topic);
      if (!topicModes.has(tuple.lang)) {
        topicModes.set(tuple.lang, new Set());
      }
      topicModes.get(tuple.lang).add(tuple.mode);
    }
  }

  const normalizedAvailability = Object.fromEntries(
    Array.from(availability.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([topic, langMap]) => [
        topic,
        Object.fromEntries(
          Array.from(langMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([lang, modes]) => [lang, Array.from(modes).sort()]),
        ),
      ]),
  );

  const payload = {
    topics: Array.from(topics).sort(),
    source: "generated-from-assets",
    availability: normalizedAvailability,
  };

  await writeFile(topicsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Generated ${topicsPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
