// `aura chat <name|id> "<message>"` - talk to an Aura from the terminal: the Living-Agents surface. SIWE
// sign-in with AURA_KEY (off-chain, non-custodial - see siwe.ts), then POST /chat. The reply is in-character,
// grounded in the Aura's on-chain identity + your private relationship memory, and TEE-attested when 0G
// serves it. The Aura can ACT via guarded tools (read its own on-chain stats; start a TEE generation you
// mint yourself). `--health` probes the provider with no key; `--history` shows your relationship history.
import { resolveAgent, api } from "../api.ts";
import type { ChatReply } from "../api.ts";
import { c, kv, heading, shortHex } from "../ui.ts";
import { signIn } from "../siwe.ts";

export async function cmdChat(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const health = args.includes("--health");
  const history = args.includes("--history");

  // --health: a PUBLIC, no-auth probe - is 0G TEE chat live + which model would serve. Needs no key.
  if (health) {
    const h = await api.chatHealth();
    if (json) {
      process.stdout.write(JSON.stringify(h, null, 2) + "\n");
      return;
    }
    process.stdout.write(heading("AURA chat provider"));
    process.stdout.write(
      kv([
        ["preferred", h.preferred === "zerog" ? c.green("0G TEE") : c.yellow(h.preferred)],
        ["0G TEE", h.zerogHealthy ? `${c.green("healthy")}  ${c.dim(h.zerogModel ?? "")}` : c.red("unavailable")],
        ["fallback", h.fallbackConfigured ? c.dim("configured") : c.dim("none")],
      ]) + "\n",
    );
    return;
  }

  const nonFlag = args.filter((a) => !a.startsWith("--"));
  const ref = nonFlag[0];
  const message = nonFlag.slice(1).join(" ").trim();
  if (!ref) {
    throw new Error('usage: aura chat <name|id> "<message>"   [--history] [--json]   |   aura chat --health');
  }

  const agent = await resolveAgent(ref);

  // --history: the owner's decrypted relationship history with this Aura (authed).
  if (history) {
    const { token } = await signIn();
    const h = await api.chatHistory(token, agent.agentId);
    if (json) {
      process.stdout.write(JSON.stringify(h, null, 2) + "\n");
      return;
    }
    const n = h.turns.length;
    process.stdout.write(heading(`Chat history with ${c.bold(c.white(agent.name))} ${c.gray(`#${agent.agentId}`)}  ${c.dim(`(${n} turn${n === 1 ? "" : "s"})`)}`));
    if (!n) {
      process.stdout.write(c.dim(`  no history yet - say something:  aura chat ${agent.name.toLowerCase()} "..."\n`));
      return;
    }
    for (const t of h.turns) {
      process.stdout.write(`\n  ${c.gray(t.ts)}\n`);
      process.stdout.write(`  ${c.cyan("you")}    ${t.ownerText}\n`);
      process.stdout.write(`  ${c.magenta(agent.name.toLowerCase())}  ${t.auraText}\n`);
      if (t.tools.length) process.stdout.write(`  ${c.dim(`tools: ${t.tools.join(", ")}`)}\n`);
    }
    return;
  }

  if (!message) throw new Error('usage: aura chat <name|id> "<message>"  (a message is required)');

  const { token, address } = await signIn();
  const res = await api.chat(token, agent.agentId, message);
  if (json) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }
  renderReply(res, address);
}

function renderReply(res: ChatReply, address: string): void {
  process.stdout.write(heading(`${c.bold(c.white(res.agentName))} ${c.gray(`#${res.agentId}`)}`));

  // the in-character reply (indented; preserves the model's line breaks)
  process.stdout.write("  " + res.reply.split("\n").join("\n  ") + "\n");

  // what the Aura DID (guarded tools): the human one-liner + a mint hint when a generation was started.
  if (res.toolInvocations.length) {
    process.stdout.write("\n");
    for (const t of res.toolInvocations) {
      process.stdout.write(`  ${t.ok ? c.green("•") : c.red("•")} ${c.dim(t.name)}  ${t.display}\n`);
      if (t.job) process.stdout.write(`    ${c.dim(`job ${t.job.jobId} (${t.job.status}) - mint it from your own wallet when ready`)}\n`);
    }
  }

  // the verifiable footer: which provider served it + the per-reply TEE attestation (honest: only 0G is attested).
  process.stdout.write(
    "\n" +
      kv([
        ["provider", res.provider === "zerog" ? `${c.green("0G TEE")}  ${c.dim(res.attestation?.model ?? "")}` : c.yellow(res.provider)],
        [
          "attested",
          res.teeAttested
            ? `${c.green("✔ " + (res.attestation?.verifiability ?? "TEE"))}  ${c.dim(`signer ${shortHex(res.attestation?.teeSigner)}`)}`
            : c.yellow("○ no (fallback provider, not TEE-attested)"),
        ],
        ["latency", c.dim(`${res.latencyMs} ms`)],
        ["signed in", c.dim(shortHex(address, 6, 4))],
      ]) + "\n",
  );
}
