import { readdir, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(process.cwd());
const workerRunDir = resolve(repoRoot, "assets", "tutor-data", "run");
const langs = ["de", "fa"];

const fiaeCoreDir = process.env.FIAE_TUTOR_CORE_DIR
  ? resolve(process.env.FIAE_TUTOR_CORE_DIR)
  : resolve(repoRoot, "..", "fiae-tutor-core");
const sourceTopicsDir = resolve(fiaeCoreDir, "export", "tutor", "topics");
const sourceTopicPythonDir = resolve(fiaeCoreDir, "src", "fiae_tutor", "topics");

function stableJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function normalizeTopicTitle(topic) {
  if (!topic) return "";
  return topic
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

async function readJsonIfExists(path) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractLocalizedText(value) {
  if (!value || typeof value !== "object") {
    return { de: "", fa: "" };
  }
  return {
    de: typeof value.de === "string" ? value.de : "",
    fa: typeof value.fa === "string" ? value.fa : "",
  };
}

function extractPseudocode(value) {
  if (!value || typeof value !== "object") {
    return { de: "", fa: "" };
  }
  return {
    de: typeof value.de === "string" ? value.de : "",
    fa: typeof value.fa === "string" ? value.fa : "",
  };
}

function decodeEscapedPythonString(value) {
  return value
    .replaceAll("\\r\\n", "\n")
    .replaceAll("\\n", "\n")
    .replaceAll("\\t", "\t")
    .replaceAll("\\'", "'")
    .replaceAll('\\"', '"')
    .trim();
}

function extractPythonFunctionReturn(source, functionName) {
  const pattern = new RegExp(
    `def\\s+${functionName}\\s*\\([^)]*\\)\\s*(?:->\\s*[^:]+)?:\\s*[\\s\\S]*?return\\s+([\\'\\"]{3})([\\s\\S]*?)\\1`,
    "m",
  );
  const match = source.match(pattern);
  if (!match) return "";
  return decodeEscapedPythonString(match[2] ?? "");
}

async function readTopicPseudocodeFallback(topic) {
  const topicPath = resolve(sourceTopicPythonDir, `${topic}.py`);
  try {
    const source = await readFile(topicPath, "utf8");
    const de = extractPythonFunctionReturn(source, "generate_pseudocode_de");
    const fa = extractPythonFunctionReturn(source, "generate_pseudocode_fa");
    return { de, fa };
  } catch {
    return { de: "", fa: "" };
  }
}

function mergeVariantRecords(variantsDe, variantsFa) {
  const order = [];
  const byId = new Map();

  const ingest = (items, lang) => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : "";
      if (!id) continue;

      if (!byId.has(id)) {
        byId.set(id, { id, de: null, fa: null });
        order.push(id);
      }
      const entry = byId.get(id);
      entry[lang] = item;
    }
  };

  ingest(Array.isArray(variantsDe) ? variantsDe : [], "de");
  ingest(Array.isArray(variantsFa) ? variantsFa : [], "fa");

  return order.map((id) => byId.get(id));
}

function buildPseudocodeAsset({ topic, lang, title, mergedVariants, fallbackPseudo }) {
  const normalizedLang = lang.toLowerCase();
  const variantEntries = [];

  for (const record of mergedVariants) {
    const deItem = record?.de && typeof record.de === "object" ? record.de : null;
    const faItem = record?.fa && typeof record.fa === "object" ? record.fa : null;
    const id = record?.id || "";
    if (!id) continue;

    const labels = {
      de: firstNonEmptyString([deItem?.label, faItem?.label, id]),
      fa: firstNonEmptyString([faItem?.label, deItem?.label, id]),
    };
    const explainFromDe = extractLocalizedText(deItem?.explain);
    const explainFromFa = extractLocalizedText(faItem?.explain);
    const explainVariant = {
      de: firstNonEmptyString([explainFromDe.de, explainFromFa.de]),
      fa: firstNonEmptyString([explainFromDe.fa, explainFromFa.fa]),
    };

    const pseudoFromDe = extractPseudocode(deItem?.pseudocode);
    const pseudoFromFa = extractPseudocode(faItem?.pseudocode);
    const pseudocodeByLang = {
      de: firstNonEmptyString([pseudoFromDe.de, pseudoFromFa.de, fallbackPseudo.de, fallbackPseudo.fa]),
      fa: firstNonEmptyString([pseudoFromDe.fa, pseudoFromFa.fa, fallbackPseudo.fa, fallbackPseudo.de]),
    };
    const preferredPseudo = normalizedLang === "fa"
      ? firstNonEmptyString([pseudocodeByLang.fa, pseudocodeByLang.de])
      : firstNonEmptyString([pseudocodeByLang.de, pseudocodeByLang.fa]);

    if (!preferredPseudo) {
      continue;
    }

    variantEntries.push({
      id,
      title: normalizedLang === "fa" ? labels.fa : labels.de,
      labels,
      is_default: Boolean(deItem?.is_default || faItem?.is_default),
      pseudocode: preferredPseudo,
      explain_variant: explainVariant,
    });
  }

  if (variantEntries.length === 0) {
    const fallback = normalizedLang === "fa"
      ? firstNonEmptyString([fallbackPseudo.fa, fallbackPseudo.de])
      : firstNonEmptyString([fallbackPseudo.de, fallbackPseudo.fa]);
    if (!fallback) {
      return null;
    }
    variantEntries.push({
      id: "default",
      title: "Default",
      labels: { de: "Default", fa: "پیش‌فرض" },
      is_default: true,
      pseudocode: fallback,
      explain_variant: { de: "", fa: "" },
    });
  }

  const selected = variantEntries.find((item) => item.is_default) ?? variantEntries[0];

  return {
    schema_name: "tutor_asset.pseudocode.v1",
    version: "1.0",
    topic,
    lang: normalizedLang,
    mode: "pseudocode",
    title,
    selected_variant: selected.id,
    pseudocode: selected.pseudocode,
    variants: variantEntries,
  };
}

function getExplainSectionsInOrder(explainDoc) {
  if (!Array.isArray(explainDoc?.sections)) {
    return [];
  }

  const sections = explainDoc.sections.filter((section) => section && typeof section === "object");
  const idOrder = Array.isArray(explainDoc.sections_order)
    ? explainDoc.sections_order.filter((id) => typeof id === "string")
    : [];

  if (idOrder.length === 0) {
    return [...sections];
  }

  const byId = new Map();
  for (const section of sections) {
    if (typeof section.id === "string") {
      byId.set(section.id, section);
    }
  }

  const ordered = [];
  for (const id of idOrder) {
    const section = byId.get(id);
    if (section) ordered.push(section);
  }

  for (const section of sections) {
    if (!ordered.includes(section)) {
      ordered.push(section);
    }
  }

  return ordered;
}

function buildExplainAsset({ topic, lang, title, explainDoc }) {
  const sections = getExplainSectionsInOrder(explainDoc);
  const blocks = sections
    .map((section) => ({
      kind:
        (typeof section.id === "string" && section.id.trim()) ||
        (typeof section.format === "string" && section.format.trim()) ||
        "text",
      text: typeof section.body === "string" ? section.body : "",
    }))
    .filter((block) => block.text.trim());

  const definitionSection = sections.find((section) => section?.id === "definition");
  const summary = firstNonEmptyString([
    definitionSection?.body,
    blocks[0]?.text,
    explainDoc?.audience,
  ]);

  return {
    schema_name: "tutor_asset.explain.v1",
    version: "1.0",
    topic,
    lang,
    mode: "explain",
    title,
    summary,
    blocks,
  };
}

function mapExamQuestion(question, lang) {
  const id = firstNonEmptyString([question?.id]);
  const prompt = firstNonEmptyString([question?.task, question?.prompt]);
  const isMc = Array.isArray(question?.choices) && question.choices.length > 0;
  const answer = firstNonEmptyString([question?.answer, question?.expected, question?.solution]);

  const mapped = {
    id,
    type: isMc ? "mc" : "open",
    prompt,
    answer,
    explain_de: lang === "de" ? firstNonEmptyString([question?.solution, question?.expected]) : "",
    explain_fa: lang === "fa" ? firstNonEmptyString([question?.solution, question?.expected]) : "",
  };

  if (isMc) {
    mapped.choices = question.choices;
  }

  return mapped;
}

function buildExamAsset({ topic, lang, title, examDoc }) {
  const questionsRaw = Array.isArray(examDoc?.questions) ? examDoc.questions : [];
  const questions = questionsRaw
    .map((question) => mapExamQuestion(question, lang))
    .filter((question) => question.id && question.prompt)
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    schema_name: "tutor_asset.exam.v1",
    version: "1.0",
    topic,
    lang,
    mode: "exam",
    title,
    questions,
  };
}

async function main() {
  await mkdir(workerRunDir, { recursive: true });
  await rm(workerRunDir, { recursive: true, force: true });
  await mkdir(workerRunDir, { recursive: true });

  const topicEntries = await readdir(sourceTopicsDir, { withFileTypes: true });
  const topics = topicEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const writtenFiles = [];
  const includedTopics = new Set();
  const skipped = [];

  for (const topic of topics) {
    const topicDir = resolve(sourceTopicsDir, topic);
    const variantsDePath = resolve(topicDir, "variants.de.v1.json");
    const variantsFaPath = resolve(topicDir, "variants.fa.v1.json");

    const variantsDe = (await readJsonIfExists(variantsDePath)) ?? [];
    const variantsFa = (await readJsonIfExists(variantsFaPath)) ?? [];
    const mergedVariants = mergeVariantRecords(variantsDe, variantsFa);
    const topicFallbackPseudo = await readTopicPseudocodeFallback(topic);

    for (const lang of langs) {
      const explainPath = resolve(topicDir, `explain.${lang}.v1.json`);
      const examPath = resolve(topicDir, `exam.${lang}.v1.json`);

      const explainDoc = await readJsonIfExists(explainPath);
      const examDoc = await readJsonIfExists(examPath);

      const defaultTitle = `${normalizeTopicTitle(topic)} (${lang.toUpperCase()})`;
      const explainTitle = firstNonEmptyString([explainDoc?.title]);
      const title = explainTitle || defaultTitle;

      const pseudoPayload = buildPseudocodeAsset({
        topic,
        lang,
        title,
        mergedVariants,
        fallbackPseudo: topicFallbackPseudo,
      });
      if (pseudoPayload) {
        const pseudoFileName = `${topic}.${lang}.pseudocode.json`;
        const pseudoOutPath = resolve(workerRunDir, pseudoFileName);
        await writeFile(pseudoOutPath, stableJson(pseudoPayload), "utf8");
        writtenFiles.push(pseudoFileName);
        includedTopics.add(topic);
      } else {
        skipped.push(`${topic}.${lang}.pseudocode :: no pseudocode source (variants/python)`);
      }

      if (explainDoc) {
        const explainPayload = buildExplainAsset({
          topic,
          lang,
          title,
          explainDoc,
        });
        const explainFileName = `${topic}.${lang}.explain.json`;
        await writeFile(resolve(workerRunDir, explainFileName), stableJson(explainPayload), "utf8");
        writtenFiles.push(explainFileName);
        includedTopics.add(topic);
      } else {
        skipped.push(`${topic}.${lang}.explain :: explain file missing`);
      }

      if (examDoc) {
        const examPayload = buildExamAsset({
          topic,
          lang,
          title,
          examDoc,
        });
        const examFileName = `${topic}.${lang}.exam.json`;
        await writeFile(resolve(workerRunDir, examFileName), stableJson(examPayload), "utf8");
        writtenFiles.push(examFileName);
        includedTopics.add(topic);
      } else {
        skipped.push(`${topic}.${lang}.exam :: exam file missing`);
      }
    }
  }

  writtenFiles.sort((a, b) => a.localeCompare(b));
  const includedTopicsSorted = Array.from(includedTopics).sort((a, b) => a.localeCompare(b));

  console.log(`Source topics dir: ${sourceTopicsDir}`);
  console.log(`Files written: ${writtenFiles.length}`);
  console.log(`Topics included (${includedTopicsSorted.length}): ${includedTopicsSorted.join(", ")}`);
  console.log(`Skipped (${skipped.length}):`);
  for (const item of skipped.sort((a, b) => a.localeCompare(b))) {
    console.log(`- ${item}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
