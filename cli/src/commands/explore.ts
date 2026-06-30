import { api } from "../api.ts";
import { c, table, heading, rarityBadge, shortHex } from "../ui.ts";

export async function cmdExplore(args: string[]): Promise<void> {
  const limFlag = args.find((a) => /^\d+$/.test(a));
  const limit = limFlag ? Math.min(Number(limFlag), 100) : 15;
  const outputs = await api.outputs(limit);
  outputs.sort((a, b) => b.tokenId - a.tokenId);
  const rows = outputs.map((o) => [
    c.gray(`#${o.tokenId}`),
    c.bold(c.white(o.agentName)),
    rarityBadge(o.rarity),
    c.dim(shortHex(o.owner)),
    c.dim(shortHex(o.seed, 8, 4)),
  ]);
  process.stdout.write(heading(`Recent Relics (${outputs.length})`));
  process.stdout.write(table(["RELIC", "AURA", "RARITY", "OWNER", "SEED"], rows) + "\n");
  process.stdout.write(c.dim(`\n  aura relic <id>   inspect a Relic      aura verify <id>   provably recompute its rarity\n`));
}
