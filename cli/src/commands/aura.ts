import { resolveAgent, api } from "../api.ts";
import { c, kv, heading, shortHex } from "../ui.ts";

export async function cmdAura(args: string[]): Promise<void> {
  const ref = args[0];
  if (!ref) throw new Error("usage: aura aura <name|id>");
  const a = await resolveAgent(ref);
  // resolveAgent(name) returns the list-shape agent; fetch the detail for the richest meta when we have an id.
  const full = await api.agent(a.agentId).catch(() => a);
  const m = full.meta ?? {};
  const style = full.style ?? a.style ?? (m.aesthetic ?? "").split(" ")[0] ?? "-";

  process.stdout.write(heading(`${c.bold(c.white(full.name))}  ${c.gray(`#${full.agentId}`)}`));
  if (m.tagline) process.stdout.write(`  ${c.italic(c.cyan(m.tagline))}\n\n`);
  process.stdout.write(
    kv([
      ["style", c.cyan(style)],
      ["aesthetic", c.white((m.aesthetic ?? "-").slice(0, 100))],
      ["signature", m.signatureCharacter ? c.white(m.signatureCharacter.slice(0, 90)) : c.gray("-")],
      ["model", m.model ? c.dim(m.model) : c.gray("-")],
      ["accent", m.accent ? `${m.accent}` : c.gray("-")],
      ["royalty", `${full.royaltyPct}%  ${c.dim(`(${full.royaltyBps} bps)`)}`],
      ["relics", c.bold(String(full.outputCount))],
      ["owner", c.dim(full.owner)],
      ["minted", full.minted ? c.green("yes") : c.red("no")],
    ]) + "\n",
  );
  process.stdout.write(c.dim(`\n  aura summon ${full.name.toLowerCase()}   summon a Relic from this Aura\n`));
}
