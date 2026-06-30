import { api } from "../api.ts";
import { c, table, heading } from "../ui.ts";

export async function cmdAgents(): Promise<void> {
  const agents = await api.agents();
  agents.sort((a, b) => a.agentId - b.agentId);
  const rows = agents.map((a) => [
    c.gray(`#${a.agentId}`),
    c.bold(c.white(a.name)),
    c.cyan(a.style ?? a.meta?.aesthetic?.split(" ")[0] ?? "-"),
    `${a.royaltyPct}%`,
    String(a.outputCount),
    c.dim((a.meta?.tagline ?? "").slice(0, 46)),
  ]);
  process.stdout.write(heading(`AURA agents (${agents.length})`));
  process.stdout.write(table(["ID", "NAME", "STYLE", "ROYALTY", "RELICS", "TAGLINE"], rows) + "\n");
  process.stdout.write(c.dim(`\n  aura aura <name|id>   inspect an Aura     aura summon <name>   summon a Relic\n`));
}
