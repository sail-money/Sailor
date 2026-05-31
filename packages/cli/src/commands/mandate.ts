import fs from "node:fs";
import path from "node:path";
import { packageRoot } from "../lib/packagePaths.js";
import type { Address, MandateItem } from "@sail/sdk";
import {
  type BoundedSwapParams,
  type TransferTargetParams,
  boundedSwapTemplate,
  transferTargetTemplate,
} from "@sail/sdk/templates";
import { type Hex, concatHex, getAddress, keccak256 } from "viem";
import { checksum, confirm, makeClient, readJsonFile, sailPath, writeJsonFile } from "../lib/io.js";
import { loadKeyring } from "../lib/keys.js";
import type { StoredAccount, StoredMandate } from "../lib/state.js";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Locates the mandate source: the project's src/mandate.ts, else the template. */
function locateMandateSource(): { path: string; label: string } | null {
  const projectMandate = path.join(process.cwd(), "src", "mandate.ts");
  if (fs.existsSync(projectMandate)) {
    return { path: projectMandate, label: "src/mandate.ts" };
  }
  // Fall back to the bundled template.
  const templateMandate = path.join(packageRoot(), "templates", "dca-rebalancer", "src", "mandate.ts");
  if (fs.existsSync(templateMandate)) {
    return { path: templateMandate, label: "templates/dca-rebalancer/src/mandate.ts" };
  }
  return null;
}

function extractAddresses(src: string): Address[] {
  const out: Address[] = [];
  const seen = new Set<string>();
  for (const match of src.matchAll(/0x[0-9a-fA-F]{40}/g)) {
    const addr = getAddress(match[0]);
    if (addr === ZERO || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

function extractNumber(src: string, name: string, fallback: number): number {
  const match = src.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  return match ? Number(match[1]) : fallback;
}

function extractProtocols(src: string): string[] {
  const block = src.match(/allowedProtocols:\s*\[([^\]]*)\]/);
  if (!block) return ["uniswapV3"];
  const found = [...block[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  return found.length > 0 ? found : ["uniswapV3"];
}

/**
 * Parses the mandate source into MandateItems. Detects which permission
 * templates the file references and reconstructs their params from the
 * file's constants (with sensible fallbacks), so the explanation reflects
 * what the agent will actually request.
 */
export function parseMandateItems(src: string): MandateItem[] {
  const tokens = extractAddresses(src);
  const items: MandateItem[] = [];

  if (src.includes("boundedSwapTemplate")) {
    const params: BoundedSwapParams = {
      maxSwapValueUsd: extractNumber(src, "MAX_SWAP_USD", 50),
      maxSlippageBps: extractNumber(src, "MAX_SLIPPAGE_BPS", 50),
      allowedInputTokens: tokens,
      allowedOutputTokens: tokens,
      allowedProtocols: extractProtocols(src),
    };
    items.push({ template: boundedSwapTemplate, params } as unknown as MandateItem);
  }

  if (src.includes("transferTargetTemplate")) {
    const params: TransferTargetParams = {
      allowedRecipients: tokens,
      allowedTokens: tokens,
    };
    items.push({ template: transferTargetTemplate, params } as unknown as MandateItem);
  }

  return items;
}

/** Builds the EIP-712 payload that the permission signer authorizes. */
function buildMandateTypedData(account: StoredAccount, items: MandateItem[]) {
  const encoded = items.map((item) => item.template.encoder.encode(item.params));
  const permissionsRoot = keccak256(encoded.length > 0 ? concatHex(encoded) : ("0x" as Hex));
  const domain = {
    name: "SailMandate",
    version: "1",
    chainId: account.chainId,
    verifyingContract: checksum(account.safe),
  };
  const types = {
    primaryType: "Mandate",
    types: {
      Mandate: [
        { name: "safe", type: "address" },
        { name: "permissionsRoot", type: "bytes32" },
        { name: "count", type: "uint256" },
      ],
    },
  };
  const message = {
    safe: checksum(account.safe),
    permissionsRoot,
    count: BigInt(items.length),
  };
  return { domain, types, message };
}

type MandateDraftItem = { template: Address; params: Hex; explanation: string };
type MandateDraft = {
  account: Address;
  chainId: number;
  items: MandateDraftItem[];
  createdAt: string;
};

/**
 * `sailor mandate prepare` — builds a signable mandate draft and writes it to
 * .sail/mandate-draft.json for the UI to review and sign with the owner's
 * wallet (MetaMask). No local key required — the browser produces the
 * signature. For power users with a local key, `sailor mandate sign` still
 * signs entirely from the CLI.
 */
export async function mandatePrepare(): Promise<void> {
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (!account) {
    throw new Error('No account found at .sail/account.json.\nRun "sailor account create" first.');
  }

  const source = locateMandateSource();
  if (!source) {
    throw new Error(
      "Could not find a mandate definition (src/mandate.ts or the dca-rebalancer template).",
    );
  }
  const items = parseMandateItems(fs.readFileSync(source.path, "utf-8"));
  if (items.length === 0) {
    throw new Error(`No known permission templates found in ${source.label}.`);
  }

  const draftItems: MandateDraftItem[] = items.map((item) => ({
    template: item.template.address,
    params: item.template.encoder.encode(item.params),
    explanation: item.template.explainer.explain(item.params).humanReadable.join("; "),
  }));

  const draft: MandateDraft = {
    account: checksum(account.safe),
    chainId: account.chainId,
    items: draftItems,
    createdAt: new Date().toISOString(),
  };
  writeJsonFile(sailPath("mandate-draft.json"), draft);

  console.log(`\nMandate draft from ${source.label}:\n`);
  for (const it of draftItems) {
    console.log(`• ${it.explanation}`);
  }
  console.log("\nMandate draft saved. Open the UI to review and sign at http://localhost:5173");
}

/**
 * `sailor mandate sign` — explains the agent's requested permissions in plain
 * English, asks for confirmation, signs the EIP-712 mandate with the permission
 * signer key, attaches it (SDK stub for now), and records .sail/mandate.json.
 */
export async function mandateSign(): Promise<void> {
  const account = readJsonFile<StoredAccount>(sailPath("account.json"));
  if (!account) {
    throw new Error('No account found at .sail/account.json.\nRun "sailor account create" first.');
  }

  const source = locateMandateSource();
  if (!source) {
    throw new Error(
      "Could not find a mandate definition (src/mandate.ts or the dca-rebalancer template).",
    );
  }
  const items = parseMandateItems(fs.readFileSync(source.path, "utf-8"));
  if (items.length === 0) {
    throw new Error(`No known permission templates found in ${source.label}.`);
  }

  console.log(`\nMandate defined in ${source.label}:\n`);
  for (const item of items) {
    const explanation = item.template.explainer.explain(item.params);
    console.log(`• ${explanation.templateName}`);
    for (const line of explanation.humanReadable) console.log(`    - ${line}`);
    for (const warning of explanation.warnings) console.log(`    ! ${warning}`);
    console.log("");
  }

  const proceed = await confirm("Do you want to sign this mandate?");
  if (!proceed) {
    console.log("Mandate not signed.");
    return;
  }

  const signer = await loadKeyring("permissionSigner");
  if (checksum(signer.address) !== checksum(account.permissionSigner)) {
    throw new Error(
      `The permissionSigner key (${checksum(signer.address)}) does not match the\n` +
        `account's permission signer (${checksum(account.permissionSigner)}).`,
    );
  }

  const { domain, types, message } = buildMandateTypedData(account, items);
  const signature = await signer.signTyped(domain, types, message);

  const client = makeClient(account.chainId);
  let registeredOnChain = false;
  try {
    await client.mandate.attachBatch(checksum(account.safe), items, signer);
    registeredOnChain = true;
  } catch (err) {
    if ((err as Error).message !== "not implemented") throw err;
  }

  console.log("");
  for (const item of items) {
    console.log(`Registered: ${item.template.name}`);
  }

  const stored: StoredMandate = {
    safe: checksum(account.safe),
    chainId: account.chainId,
    signedAt: new Date().toISOString(),
    signature,
    registeredOnChain,
    permissions: items.map((item) => ({ template: item.template.name, params: item.params })),
  };
  writeJsonFile(sailPath("mandate.json"), stored);

  console.log(
    `\nMandate ${registeredOnChain ? "attached on-chain" : "signed locally"} — ` +
      `${items.length} permission(s). Saved to .sail/mandate.json`,
  );
}
