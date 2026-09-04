/**
 * Capability registry — the runtime "what can this install do" map.
 *
 * Provides:
 *   - register(...)       declarative self-registration of tools
 *   - capabilityCatalog() all tools grouped by capability (for the Control Panel)
 *   - providerMenu()      human-readable menu (provider / runtime / availability)
 *   - getByCapability()   raw list for a capability
 *   - resolve()           async selector for the best tool (calls pickTool)
 *
 * Tools register themselves; the pipeline and agents only ever talk to this
 * registry by capability. Replaces the hardcoded provider channel map.
 */
import type {
  Capability,
  SelectorRoute,
  ToolContract,
  ToolInput,
  ToolResult,
} from './contract.js';
import type { SelectorPrefs } from './scoring.js';
import { pickTool } from './scoring.js';

const tools = new Map<string, ToolContract>();

/** Register (or replace) a tool by id. */
export function register(tool: ToolContract): ToolContract {
  tools.set(tool.id, tool);
  return tool;
}

/** Look up a single tool by id. */
export function getTool(id: string): ToolContract | undefined {
  return tools.get(id);
}

/** All registered tools. */
export function allTools(): ToolContract[] {
  return [...tools.values()];
}

/** Capability → list of registered tools (empty array if none). */
export function getByCapability(capability: Capability): ToolContract[] {
  return allTools().filter((t) => t.capability === capability);
}

/** Raw capability list (used for introspection / dropdowns). */
export function capabilityList(): Capability[] {
  const seen = new Set<Capability>();
  for (const t of allTools()) seen.add(t.capability);
  return [...seen];
}

interface CatalogEntry extends ToolContract {
  needsSetup: boolean;
}

/** Grouped catalog, flagged with whether a tool needs setup to be usable. */
export function capabilityCatalog(): Record<Capability, CatalogEntry[]> {
  const out = {} as Record<Capability, CatalogEntry[]>;
  for (const t of allTools()) {
    (out[t.capability] ??= []).push({
      ...t,
      needsSetup:
        t.availability === 'unavailable' ||
        (t.dependencyKeys?.length ?? 0) > 0,
    });
  }
  return out;
}

/** Human-readable menu of providers for each capability. */
export function providerMenu(): Record<Capability, string[]> {
  const out = {} as Record<Capability, string[]>;
  for (const t of allTools()) {
    (out[t.capability] ??= []).push(`${t.id} [${t.runtime}/${t.availability}]`);
  }
  return out;
}

/**
 * Resolve the best tool for a capability using the selectors. Returns a
 * SelectorRoute (chosen + ranked alternatives + rationale) or null if no
 * applicable tool exists.
 */
export function resolve(
  capability: Capability,
  prefs: SelectorPrefs = {},
): SelectorRoute | null {
  const candidates = getByCapability(capability);
  if (candidates.length === 0) return null;
  const ranked = pickTool(candidates, capability, prefs);
  if (!ranked) return null;
  const alternatives = candidates
    .filter((t) => t.id !== ranked.tool.id)
    .sort(
      (a, b) =>
        (b.supports?.score as number) - (a.supports?.score as number),
    );
  const rationale = [
    `capability=${capability}`,
    `chosen=${ranked.tool.id} (total=${ranked.total.toFixed(3)})`,
    ...Object.entries(ranked.breakdown).map(
      ([k, v]) => `${k}=${v.toFixed(2)}`,
    ),
  ].join(' ');
  return {
    capability,
    chosen: ranked.tool,
    alternatives,
    rationale,
  };
}

/** Convenience: resolve + run the chosen tool for a capability. */
export async function runCapability(
  capability: Capability,
  input: ToolInput,
  prefs: SelectorPrefs = {},
): Promise<ToolResult> {
  const route = resolve(capability, prefs);
  if (!route) {
    return {
      ok: false,
      capability,
      toolId: 'none',
      error: `No tool registered for capability ${capability}`,
      usage: { requests: 0, costEur: 0 },
    };
  }
  try {
    const result = await route.chosen.run(input);
    return { ...result, toolId: route.chosen.id, capability };
  } catch (err) {
    return {
      ok: false,
      capability,
      toolId: route.chosen.id,
      error: err instanceof Error ? err.message : String(err),
      usage: { requests: 0, costEur: 0 },
    };
  }
}
