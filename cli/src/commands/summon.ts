// `aura summon <aura>` - the demo trigger. A real summon is a SELF-FUNDED on-chain tx to the SummonEscrow
// (the buyer pays the commission), so v1 of the lean CLI is EXPLAIN + WATCH, not a bundled wallet: it
// resolves the Aura, shows the live commission price + escrow, prints the exact tx to send, and (with
// --watch <requestId>) polls the summon to settlement and reveals the minted Relic. We never hardcode or
// auto-spend a key; AURA_KEY is only read if you opt into a future signed path. `aura verify <id>` then
// proves the pull. This keeps the trustless core real while staying honest about what the CLI does itself.
import { resolveAgent, api, ApiError } from "../api.ts";
import { c, kv, heading, rarityBadge } from "../ui.ts";

const ESCROW_ABI_SUMMON = "function summon(uint256 agentId) payable returns (uint256 requestId)";

export async function cmdSummon(args: string[]): Promise<void> {
  const ref = args.find((a) => !a.startsWith("--"));
  const watchIdx = args.indexOf("--watch");
  const watchReq = watchIdx >= 0 ? Number(args[watchIdx + 1]) : null;

  if (watchReq && Number.isInteger(watchReq)) return watchSummon(watchReq);
  if (!ref) throw new Error("usage: aura summon <name|id>   [--watch <requestId>]");

  const agent = await resolveAgent(ref);
  const info = await api.summonAgent(agent.agentId);

  process.stdout.write(heading(`Summon ${c.bold(c.white(agent.name))} ${c.gray(`#${agent.agentId}`)}`));
  if (!info.summonable || !info.escrow) {
    process.stdout.write(`  ${c.yellow("This Aura is not currently summonable")} (no escrow price set).\n`);
    return;
  }

  process.stdout.write(
    kv([
      ["price", `${c.bold(info.price)} 0G  ${c.dim(`(${info.priceWei} wei)`)}`],
      ["escrow", c.cyan(info.escrow)],
      ["chain", c.dim("0G Galileo (chainId 16602)")],
    ]) + "\n\n",
  );

  process.stdout.write(c.bold("  How it works\n"));
  process.stdout.write(
    `  A summon is a self-funded on-chain commission: you pay ${c.bold(info.price)} 0G to the escrow, the\n` +
      `  agent renders a unique Relic, and the rarity is rolled from a seed neither side can grind. The\n` +
      `  CLI does not hold your key - send the tx from your own wallet, then ${c.bold("watch")} + ${c.bold("verify")} here.\n\n`,
  );

  process.stdout.write(c.bold("  1. Send the summon ") + c.gray("(foundry cast example - use any wallet)") + "\n");
  process.stdout.write(
    c.dim(
      `     cast send ${info.escrow} \\\n` +
        `       "${ESCROW_ABI_SUMMON.replace("function ", "").replace(" returns (uint256 requestId)", "")}" ${agent.agentId} \\\n` +
        `       --value ${info.priceWei} --rpc-url https://evmrpc-testnet.0g.ai --private-key $AURA_KEY\n`,
    ) + "\n",
  );
  process.stdout.write(c.bold("  2. Watch it settle\n"));
  process.stdout.write(c.dim(`     aura summon ${agent.name.toLowerCase()} --watch <requestId>   ${c.gray("(requestId is emitted by the summon tx)")}\n\n`));
  process.stdout.write(c.bold("  3. Prove the pull\n"));
  process.stdout.write(c.dim(`     aura verify <relicId>   ${c.gray("(recompute the rarity + subject locally - trustless)")}\n`));

  if (process.env.AURA_KEY) {
    process.stdout.write(c.gray("\n  AURA_KEY detected. v1 still prints the tx rather than auto-spending - sign it yourself, intentionally.\n"));
  }
}

async function watchSummon(requestId: number): Promise<void> {
  process.stdout.write(heading(`Watching summon request ${c.gray(`#${requestId}`)}`));
  const deadline = Date.now() + 120_000;
  let last = "";
  while (Date.now() < deadline) {
    let s;
    try {
      s = await api.summonStatus(requestId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        process.stdout.write(c.gray(`  request not seen yet, waiting...\r`));
        await sleep(2500);
        continue;
      }
      throw e;
    }
    if (s.status !== last) {
      process.stdout.write(`  ${c.cyan("●")} ${c.bold(s.status)}${s.agentName ? c.dim(`  ${s.agentName}`) : ""}\n`);
      last = s.status;
    }
    if (s.settled && s.tokenId) {
      process.stdout.write(`\n  ${c.green("✔")} Relic minted: ${c.bold(`#${s.tokenId}`)}\n`);
      try {
        const proof = await api.summonProof(s.tokenId);
        if (proof.roll) process.stdout.write(`  rarity: ${rarityBadge(proof.roll.rarity)}  ${c.dim(`roll ${proof.roll.rarityRoll}`)}\n`);
      } catch {
        /* reveal is best-effort */
      }
      process.stdout.write(c.dim(`\n  aura verify ${s.tokenId}   prove this pull locally\n`));
      return;
    }
    if (s.expired || s.error) {
      process.stdout.write(`\n  ${c.red("✘")} ${s.error ?? "summon expired"}\n`);
      return;
    }
    await sleep(3000);
  }
  process.stdout.write(c.yellow("\n  timed out watching (the summon may still settle - re-run --watch)\n"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
