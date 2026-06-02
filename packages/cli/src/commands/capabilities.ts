import {
  type DispatchModel,
  SAIL_INTELLIGENCE_BASE_URL,
  SAIL_INTELLIGENCE_DOCS_URL,
  SailorClient,
  getSailDeployment,
  sailDeployments,
} from "@sail/sdk";
import { getChainById, getRpcUrl } from "../lib/chain.js";
import { emit } from "../lib/output.js";
import { ProjectContext } from "../lib/project.js";

/** Best-effort chain display name; falls back to the numeric id. */
function chainName(chainId: number): string {
  try {
    return getChainById(chainId).name;
  } catch {
    return `Chain ${chainId}`;
  }
}

/**
 * `sailor capabilities [--json]` — the feasibility map.
 *
 * Answers "what can this install actually do on the resolved chain?" so an agent
 * can ground a user's request before proposing a strategy: which chains are
 * supported, the kernel dispatch model, the no-Solidity mandate templates
 * available here, the strategy primitives the runtime exposes, and the
 * Intelligence API for allocation advice. Read-only, no gas, no account needed.
 */
export async function capabilities(options: { json?: boolean } = {}): Promise<void> {
  const project = new ProjectContext();
  const chainId = project.chainId;
  const kernel = project.contracts.kernel;
  const deployment = getSailDeployment(chainId);

  // Live dispatch-model detection; fall back to the static hint if RPC is down.
  const rpcUrl = getRpcUrl(chainId) ?? getChainById(chainId).rpcUrls.default.http[0];
  let dispatchModel: DispatchModel | undefined = deployment.dispatchModel;
  let modelSource = "static-hint";
  try {
    const caps = await new SailorClient({ chainId, rpcUrl, kernel }).capabilities();
    dispatchModel = caps.dispatchModel;
    modelSource = caps.source;
  } catch {
    // RPC unavailable — the static hint from the bundled deployment still applies.
  }

  const cloneTemplates = (deployment.cloneTemplates ?? []).map((t) => ({
    key: t.key,
    kind: t.kind,
    label: t.label,
    description: t.description,
    address: t.address,
    initParams: t.initParams,
  }));
  const knownTemplates = (deployment.knownTemplates ?? []).map((t) => ({
    kind: t.kind,
    label: t.label,
    description: t.description,
    address: t.address,
  }));
  // standaloneTemplates without rich metadata are still deployable (deployAndAttach).
  const bareTemplates = Object.keys(deployment.standaloneTemplates ?? {}).filter(
    (k) => !cloneTemplates.some((c) => c.key === k),
  );

  const strategyPrimitives = [
    "strategy.swap — bounded swap (one-off, or looped on a schedule for DCA/rebalance)",
    "dispatch.single — a single permitted call through the kernel",
    dispatchModel === "selective"
      ? "dispatch.batch / dispatch.preview — multi-call (selective kernels only)"
      : "dispatch.batch / dispatch.preview — UNAVAILABLE on this conjunctive kernel",
  ];

  const payload = {
    chainId,
    chainName: chainName(chainId),
    supported: true,
    dispatchModel,
    dispatchModelSource: modelSource,
    contracts: {
      kernel,
      permissionFactory: project.contracts.permissionFactory,
    },
    supportedChains: (Object.keys(sailDeployments) as unknown as number[]).map((id) => ({
      chainId: Number(id),
      name: chainName(Number(id)),
      dispatchModel: sailDeployments[id as keyof typeof sailDeployments].dispatchModel,
    })),
    mandateTemplates: {
      // No-Solidity, self-describing clone templates (deployAndAttach + initialize).
      cloneTemplates,
      // Pre-deployed shared permissions.
      knownTemplates,
      // Deployable clone logic without rich wizard metadata yet.
      otherStandaloneTemplates: bareTemplates,
    },
    strategyPrimitives,
    customMandates:
      "Author a Foundry IPermission contract under mandates/ when no template fits; " +
      "keep all policy parameters constructor-configured.",
    intelligence: {
      baseUrl: SAIL_INTELLIGENCE_BASE_URL,
      docsUrl: SAIL_INTELLIGENCE_DOCS_URL,
      use: "Vault screening, allocation, and rebalance advice for yield strategies.",
    },
  };

  emit(
    options.json,
    () => {
      console.log("Sailor capabilities");
      console.log("────────────────────────────────────────");
      console.log(`Chain:          ${payload.chainName} (${chainId})`);
      console.log(`Dispatch model: ${dispatchModel ?? "unknown"}  (${modelSource})`);
      console.log(
        `Supported chains: ${payload.supportedChains.map((c) => `${c.name} [${c.dispatchModel}]`).join(", ")}`,
      );

      console.log("\nNo-Solidity mandate templates on this chain:");
      if (
        cloneTemplates.length === 0 &&
        knownTemplates.length === 0 &&
        bareTemplates.length === 0
      ) {
        console.log("  (none registered for this chain yet — author a custom mandate)");
      }
      for (const t of cloneTemplates) {
        console.log(`  • ${t.label} (${t.kind}) — ${t.description ?? ""}`);
        console.log(`      params: ${t.initParams.map((p) => `${p.name}: ${p.type}`).join(", ")}`);
      }
      for (const t of knownTemplates) {
        console.log(`  • ${t.label} (${t.kind}, shared) — ${t.description ?? ""}`);
      }
      if (bareTemplates.length > 0) {
        console.log(`  • also deployable: ${bareTemplates.join(", ")}`);
      }

      console.log("\nStrategy primitives:");
      for (const p of strategyPrimitives) console.log(`  • ${p}`);

      console.log("\nCustom mandates:");
      console.log(`  ${payload.customMandates}`);

      console.log("\nIntelligence API (yield/allocation advice):");
      console.log(`  ${SAIL_INTELLIGENCE_BASE_URL}  (docs: ${SAIL_INTELLIGENCE_DOCS_URL})`);

      console.log(
        "\nUse this to decide if a request is buildable. If it can't be expressed as a " +
          "template, a strategy primitive, or a custom mandate, say so — don't scaffold a revert.",
      );
    },
    payload,
  );
}
