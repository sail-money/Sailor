/**
 * Fetches the Sail Intelligence OpenAPI spec and generates
 * packages/sdk/src/intelligence.ts — types + typed client.
 *
 * Runs automatically as part of `pnpm build` (via prebuild).
 * Output is formatted with Biome after writing.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, "../src/intelligence.ts");
const SPEC_URL = "https://api.sail.money/openapi.json";
const BIOME = join(__dir, "../../../node_modules/.bin/biome");

// Schemas we don't expose in the public API surface.
const SKIP_SCHEMAS = new Set(["HTTPValidationError", "ValidationError"]);

// ── Spec fetch ────────────────────────────────────────────────────────────────

console.log(`Fetching ${SPEC_URL}…`);
let spec;
try {
  const res = await fetch(SPEC_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  spec = await res.json();
  console.log(`  spec version: ${spec.info?.version ?? "unknown"}`);
} catch (err) {
  console.warn(`  Warning: could not fetch spec (${err.message}). Skipping generation.`);
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveRef(ref) {
  const parts = ref.replace(/^#\//, "").split("/");
  return parts.reduce((o, k) => o?.[k], spec);
}

function refToName(ref) {
  return ref?.split("/").at(-1) ?? "unknown";
}

function schemaToTs(schema, depth = 0) {
  if (!schema) return "unknown";
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref);
    // If the schema isn't in components (inline-only), use the name as a type
    // reference — it will be defined elsewhere or fall back to unknown.
    if (!resolved) return refToName(schema.$ref);
    return refToName(schema.$ref);
  }

  if (schema.anyOf) {
    return schema.anyOf.map((s) => schemaToTs(s, depth)).join(" | ");
  }
  if (schema.allOf) return schema.allOf.map((s) => schemaToTs(s, depth)).join(" & ");
  if (schema.oneOf) return schema.oneOf.map((s) => schemaToTs(s, depth)).join(" | ");

  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `${schemaToTs(schema.items, depth)}[]`;
    case "object": {
      if (schema.additionalProperties && !schema.properties) {
        return `Record<string, ${schemaToTs(schema.additionalProperties, depth)}>`;
      }
      if (!schema.properties) return "Record<string, unknown>";
      const pad = "  ".repeat(depth + 1);
      const closePad = "  ".repeat(depth);
      const required = new Set(schema.required ?? []);
      const props = Object.entries(schema.properties).map(([k, v]) => {
        const opt = required.has(k) ? "" : "?";
        return `${pad}${k}${opt}: ${schemaToTs(v, depth + 1)}`;
      });
      return `{\n${props.join("\n")}\n${closePad}}`;
    }
    default:
      return "unknown";
  }
}

function genInterface(name, schema) {
  if (schema.$ref) schema = resolveRef(schema.$ref);
  if (!schema || schema.type !== "object" || !schema.properties) return null;

  const required = new Set(schema.required ?? []);
  const lines = [];
  if (schema.description) lines.push(`/** ${schema.description} */`);
  lines.push(`export interface ${name} {`);
  for (const [k, v] of Object.entries(schema.properties)) {
    const opt = required.has(k) ? "" : "?";
    const desc = v.description ? `  /** ${v.description} */\n` : "";
    lines.push(`${desc}  ${k}${opt}: ${schemaToTs(v, 1)}`);
  }
  lines.push("}");
  return lines.join("\n");
}

function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// ── Collect all referenced types (including inline refs not in schemas) ────────

const allRefNames = new Set();
function collectRefs(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.$ref) { allRefNames.add(refToName(obj.$ref)); return; }
  for (const v of Object.values(obj)) collectRefs(v);
}
collectRefs(spec.paths);

// ── Generate types ────────────────────────────────────────────────────────────

const schemas = spec.components?.schemas ?? {};
const interfaces = [];
const exportedTypes = new Set();

for (const [name, schema] of Object.entries(schemas)) {
  if (SKIP_SCHEMAS.has(name)) continue;
  const iface = genInterface(name, schema);
  if (iface) {
    interfaces.push(iface);
    exportedTypes.add(name);
  }
}

// Add stub interfaces for referenced types missing from schemas (e.g. inline request bodies).
for (const name of allRefNames) {
  if (!exportedTypes.has(name) && !SKIP_SCHEMAS.has(name)) {
    interfaces.push(`// eslint-disable-next-line @typescript-eslint/no-empty-object-type\nexport interface ${name} {}`);
    exportedTypes.add(name);
  }
}

// ── Generate client methods ───────────────────────────────────────────────────

const methods = [];

for (const [path, pathItem] of Object.entries(spec.paths)) {
  for (const [httpMethod, op] of Object.entries(pathItem)) {
    if (typeof op !== "object" || !op.operationId) continue;

    // Derive method name from operationId (unique per OpenAPI spec).
    const methodName = snakeToCamel(op.operationId);

    const summary = op.summary ?? "";
    const desc = op.description ?? "";

    const pathParams = (op.parameters ?? []).filter((p) => p.in === "path");
    const queryParams = (op.parameters ?? []).filter(
      (p) => p.in === "query" && !["x-api-key"].includes(p.name),
    );

    const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
    const bodyType = bodySchema?.$ref ? refToName(bodySchema.$ref) : null;

    const respSchema = op.responses?.["200"]?.content?.["application/json"]?.schema;
    const respType = respSchema?.$ref
      ? refToName(respSchema.$ref)
      : respSchema?.type === "array"
        ? `${refToName(respSchema.items?.$ref ?? "")}[]`
        : "unknown";

    const pathParamArgs = pathParams.map((p) => `${snakeToCamel(p.name)}: string`);
    const urlExpr = path.replace(/\{([^}]+)\}/g, (_, n) => `\${${snakeToCamel(n)}}`);

    let sig, body;

    if (httpMethod === "get") {
      const hasQuery = queryParams.length > 0;
      const queryType = hasQuery
        ? `{ ${queryParams.map((p) => `${p.name}?: string`).join("; ")} }`
        : null;
      const allArgs = [
        ...pathParamArgs,
        hasQuery ? `query?: ${queryType}` : null,
      ].filter(Boolean);
      sig = `${methodName}(${allArgs.join(", ")}): Promise<${respType}>`;
      const queryCode = hasQuery
        ? `    const _p: Record<string, string> = {};\n    if (query) Object.entries(query).forEach(([k, v]) => { if (v != null) _p[k] = v; });\n`
        : "";
      const fetchArgs = hasQuery ? `\`${urlExpr}\`, _p` : `\`${urlExpr}\``;
      body = `${queryCode}    return this._get(\`${urlExpr}\`${hasQuery ? ", _p" : ""});`;
    } else {
      const allArgs = [...pathParamArgs, bodyType ? `body: ${bodyType}` : null].filter(Boolean);
      sig = `${methodName}(${allArgs.join(", ")}): Promise<${respType}>`;
      body = `    return this._post(\`${urlExpr}\`, ${bodyType ? "body" : "{}"});`;
    }

    const docLines = [summary, desc].filter(Boolean);
    const jsdoc = docLines.length
      ? `  /**\n${docLines.map((l) => `   * ${l}`).join("\n")}\n   */\n`
      : "";
    methods.push(`${jsdoc}  ${sig} {\n${body}\n  }`);
  }
}

// ── Assemble file ─────────────────────────────────────────────────────────────

const specVersion = spec.info?.version ?? "unknown";
const generatedAt = new Date().toISOString();

const output = `\
/**
 * Sail Intelligence — https://api.sail.money
 *
 * AUTO-GENERATED from the OpenAPI spec at build time.
 * Do not edit manually — run \`pnpm build\` to regenerate.
 *
 * Spec version : ${specVersion}
 * Generated at : ${generatedAt}
 */

export const SAIL_INTELLIGENCE_BASE_URL = "https://api.sail.money";
export const SAIL_INTELLIGENCE_DOCS_URL = "https://api.sail.money/docs";

// ── Types (generated from spec schemas) ───────────────────────────────────────

${interfaces.join("\n\n")}

// ── Client ────────────────────────────────────────────────────────────────────

export interface SailIntelligenceOptions {
  /** API key — passed as \`X-API-Key\` header. */
  apiKey: string;
  /** Override the base URL (for testing / staging). */
  baseUrl?: string;
}

export class SailIntelligence {
  private readonly _base: string;
  private readonly _headers: Record<string, string>;

  constructor(opts: SailIntelligenceOptions) {
    this._base = opts.baseUrl ?? SAIL_INTELLIGENCE_BASE_URL;
    this._headers = { "Content-Type": "application/json", "X-API-Key": opts.apiKey };
  }

  private async _get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(\`\${this._base}\${path}\`);
    if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { headers: this._headers });
    if (!res.ok) throw new Error(\`Sail Intelligence GET \${path} → \${res.status}\`);
    return res.json() as Promise<T>;
  }

  private async _post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(\`\${this._base}\${path}\`, {
      method: "POST",
      headers: this._headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(\`Sail Intelligence POST \${path} → \${res.status}\`);
    return res.json() as Promise<T>;
  }

${methods.join("\n\n")}
}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, output, "utf-8");
console.log(`  Written → ${OUT}`);
console.log(`  ${interfaces.length} types, ${methods.length} methods`);

// Format with Biome to match repo style.
try {
  execSync(`${BIOME} format --write "${OUT}"`, { stdio: "pipe" });
  console.log("  Formatted with Biome.");
} catch {
  // Non-fatal — tsc will catch any real issues.
}
