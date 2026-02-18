import { readdir, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const repoRoot = resolve(process.cwd());
const workerRunDir = resolve(repoRoot, "assets", "tutor-data", "run");
const langs = ["de", "fa"];

const fiaeCoreDir = process.env.FIAE_TUTOR_CORE_DIR
  ? resolve(process.env.FIAE_TUTOR_CORE_DIR)
  : resolve(repoRoot, "..", "fiae-tutor-core");
const sourceTopicsDir = resolve(fiaeCoreDir, "export", "tutor", "topics");

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

async function readJsonIfExists(path) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function selectPseudocodeVariant(variants, lang) {
  const withPseudo = variants.filter(
    (variant) =>
      variant &&
      typeof variant === "object" &&
      variant.pseudocode &&
      typeof variant.pseudocode === "object" &&
      typeof variant.pseudocode[lang] === "string" &&
      variant.pseudocode[lang].trim(),
  );

  if (withPseudo.length === 0) return null;

  const defaultVariant = withPseudo.find((variant) => variant.is_default === true);
  return defaultVariant || withPseudo[0];
}

function buildPseudocodeAsset({ topic, lang, title, variant }) {
  const notes = [];
  if (variant?.id) {
    notes.push(`variant:${variant.id}`);
  }

  const payload = {
    schema_name: "tutor_asset.pseudocode.v1",
    version: "1.0",
    topic,
    lang,
    mode: "pseudocode",
    title,
    pseudocode: variant.pseudocode[lang],
  };

  if (notes.length > 0) {
    payload.notes = notes;
  }

  return payload;
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

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
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
    const mergedVariants = [
      ...(Array.isArray(variantsDe) ? variantsDe : []),
      ...(Array.isArray(variantsFa) ? variantsFa : []),
    ];

    for (const lang of langs) {
      const explainPath = resolve(topicDir, `explain.${lang}.v1.json`);
      const examPath = resolve(topicDir, `exam.${lang}.v1.json`);

      const explainDoc = await readJsonIfExists(explainPath);
      const examDoc = await readJsonIfExists(examPath);

      const defaultTitle = `${normalizeTopicTitle(topic)} (${lang.toUpperCase()})`;
      const explainTitle = firstNonEmptyString([explainDoc?.title]);
      const title = explainTitle || defaultTitle;

      const pseudoVariant = selectPseudocodeVariant(mergedVariants, lang);
      if (pseudoVariant) {
        const pseudoPayload = buildPseudocodeAsset({
          topic,
          lang,
          title,
          variant: pseudoVariant,
        });
        const pseudoFileName = `${topic}.${lang}.pseudocode.json`;
        const pseudoOutPath = resolve(workerRunDir, pseudoFileName);
        await writeFile(pseudoOutPath, stableJson(pseudoPayload), "utf8");
        writtenFiles.push(pseudoFileName);
        includedTopics.add(topic);
      } else {
        skipped.push(`${topic}.${lang}.pseudocode :: no pseudocode source`);
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
