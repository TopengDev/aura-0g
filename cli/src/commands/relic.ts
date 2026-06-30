import { api, imageUrl } from "../api.ts";
import { c, kv, heading, rarityBadge } from "../ui.ts";

export async function cmdRelic(args: string[]): Promise<void> {
  const idRaw = args[0];
  if (!idRaw || !/^\d+$/.test(idRaw)) throw new Error("usage: aura relic <id>");
  const id = Number(idRaw);
  const o = await api.output(id);

  process.stdout.write(heading(`Relic ${c.gray(`#${o.tokenId}`)}  ${rarityBadge(o.rarity)}`));
  process.stdout.write(
    kv([
      ["aura", `${c.bold(c.white(o.agent.name))} ${c.gray(`#${o.agent.agentId}`)}`],
      ["rarity", rarityBadge(o.rarity)],
      ["image", c.cyan(c.underline(imageUrl("/images/" + o.onChain.imageRoot)))],
      ["owner", c.dim(o.verification.royaltyReceiver || "-")],
      ["seed", c.dim(o.onChain.seed)],
      ["imageRoot", c.dim(o.onChain.imageRoot)],
      ["provenance", c.dim(o.onChain.provenanceHash)],
      ["teeAttest", c.dim(o.onChain.teeAttestation)],
      ["onchain", o.verification.imageOnChain ? c.green("committed") : c.red("missing")],
    ]) + "\n",
  );
  process.stdout.write(`\n  ${c.dim(o.verification.summary)}\n`);
  process.stdout.write(c.dim(`\n  aura verify ${o.tokenId}   recompute the rarity + subject from the on-chain seed (trustless)\n`));
}
