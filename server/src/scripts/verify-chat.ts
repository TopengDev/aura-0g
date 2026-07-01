// VERIFY chat-with-an-Aura END TO END via app.inject() (exercises the REAL /chat route: auth, persona,
// owner memory dual-wall, the provider seam, and the command-surface tools). Run with the funded sponsor
// key in env (PRIVATE_KEY). Spends a tiny amount of testnet OG on the 0G TEE chat calls. NEVER prints keys.
//
//   tsx src/scripts/verify-chat.ts            -> T1..T5 (T5 gen is gated off by default)
//   AICHAT_RUN_GEN=1 tsx src/scripts/verify-chat.ts  -> also runs the real generate_and_mint job (slow)
import { buildApp } from "../app.js";
import { rawAgent } from "../aura/agents.js";
import { sponsorAddress } from "../aura/wallet.js";
import { appendTurn, loadOwnerMemory } from "../aura/chat-memory.js";

const line = (s = "") => console.log(s);
const j = (o: unknown) => JSON.stringify(o);

async function main() {
  const app = await buildApp({ logger: false });
  const owner = sponsorAddress().toLowerCase();
  const token = app.jwt.sign({ address: owner });
  const auth = { authorization: `Bearer ${token}` };

  // discover a real on-chain agent to talk to - PREFER one THIS caller OWNS, because relationship memory is
  // now gated to the agent's current on-chain owner (loadOwnerMemory resolves ownerOf + fails closed). Fall
  // back to any agent (memory will then be correctly gated OFF, which the script reports honestly).
  let agentId = 0;
  let agentName = "";
  let fbId = 0, fbName = "";
  for (let i = 1; i <= 40; i++) {
    const a = await rawAgent(i);
    if (!a) continue;
    if (!fbId) { fbId = i; fbName = a.name; }
    if (a.owner.toLowerCase() === owner) { agentId = i; agentName = a.name; break; }
  }
  const ownsAgent = agentId !== 0;
  if (!ownsAgent) { agentId = fbId; agentName = fbName; }
  if (!agentId) throw new Error("no on-chain agent found in 1..40");
  line(`[setup] talking to agent #${agentId} ${agentName} as owner ${owner.slice(0, 6)}..${owner.slice(-4)} (caller ${ownsAgent ? "OWNS it -> memory ungated" : "does NOT own it -> memory gated off, by design"})`);

  const post = async (message: string) => {
    const r = await app.inject({ method: "POST", url: "/chat", headers: auth, payload: { agentId, message } });
    return { status: r.statusCode, body: r.json() as any };
  };

  // ── T0: health
  const h = await app.inject({ method: "GET", url: "/chat/health" });
  line(`\n### T0 /chat/health: ${h.statusCode} ${j(h.json())}`);

  // ── T1: in-character reply (0G TEE provider, no tool needed)
  const t1 = await post("Who are you, and what have you created so far? Keep it short.");
  line(`\n### T1 persona reply: HTTP ${t1.status}`);
  line(`  provider: ${t1.body.provider}  teeAttested: ${t1.body.teeAttested}`);
  line(`  attestation: ${j(t1.body.attestation)}`);
  line(`  reply: ${j(String(t1.body.reply).slice(0, 280))}`);

  // ── T2: command-surface READ (real on-chain read via read_onchain tool)
  const t2 = await post("Check exactly how much royalty you have earned on-chain, and how many Relics you have made.");
  line(`\n### T2 command-surface read: HTTP ${t2.status}  provider=${t2.body.provider}`);
  line(`  toolInvocations: ${j(t2.body.toolInvocations)}`);
  line(`  reply: ${j(String(t2.body.reply).slice(0, 280))}`);

  // ── T3: MEMORY persistence + recall (the relationship)
  await post("Remember this about me: my favorite subject is an empty cathedral at midnight.");
  const t3 = await post("What did I just tell you my favorite subject is?");
  line(`\n### T3 memory recall: HTTP ${t3.status}  provider=${t3.body.provider}`);
  line(`  reply: ${j(String(t3.body.reply).slice(0, 280))}`);
  const recalled = /cathedral/i.test(String(t3.body.reply));
  line(`  RECALL(best-effort, model-dependent): ${recalled ? "PASS (mentions cathedral)" : "soft-miss"}`);
  // deterministic memory round-trip via the history endpoint
  const hist = await app.inject({ method: "GET", url: `/chat/${agentId}/history`, headers: auth });
  const turns = (hist.json() as any).turns ?? [];
  line(`  history endpoint: ${turns.length} sealed turn(s) round-tripped (decrypted for this owner)`);

  // ── T3b: DUAL-WALL (a different owner cannot read this owner's sealed segments)
  const stranger = "0x000000000000000000000000000000000000dead";
  await appendTurn(agentId, owner, { ts: new Date().toISOString(), ownerText: "secret to owner A", auraText: "noted", tools: [] });
  const asStranger = await loadOwnerMemory(agentId, stranger);
  const asOwner = await loadOwnerMemory(agentId, owner);
  line(`\n### T3b dual-wall:`);
  line(`  owner sees ${asOwner.records.length} record(s); stranger sees ${asStranger.records.length} record(s), blocked=${asStranger.blockedSegments}`);
  line(`  WALL: ${asStranger.records.length === 0 && asStranger.blockedSegments > 0 ? "PASS (stranger reads nothing; segments opaque)" : "FAIL"}`);

  // ── T4: provider seam FALLBACK (force anthropic; reply must be served + labeled NOT TEE-attested)
  process.env.AURA_CHAT_PROVIDER = "anthropic";
  const t4 = await post("In one sentence, what do you paint?");
  delete process.env.AURA_CHAT_PROVIDER;
  line(`\n### T4 fallback (forced anthropic): HTTP ${t4.status}`);
  line(`  provider: ${t4.body.provider}  teeAttested: ${t4.body.teeAttested}  attestation: ${j(t4.body.attestation)}`);
  line(`  reply: ${j(String(t4.body.reply).slice(0, 200))}`);
  line(`  FALLBACK: ${t4.body.provider === "anthropic" && t4.body.attestation === null ? "PASS (served + honestly NOT TEE-attested)" : "check"}`);

  // ── T5 (gated): command-surface CREATE (real TEE generation kicked off; mint stays non-custodial)
  if (process.env.AICHAT_RUN_GEN === "1") {
    const t5 = await post("Make me a new Relic: a lone figure on a rain-slick bridge at midnight.");
    line(`\n### T5 command-surface create: HTTP ${t5.status}  provider=${t5.body.provider}`);
    line(`  toolInvocations: ${j(t5.body.toolInvocations)}`);
    const jobId = t5.body.jobId;
    line(`  jobId: ${jobId}`);
    if (jobId) {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const jr = await app.inject({ method: "GET", url: `/generate/${jobId}`, headers: auth });
        const job = jr.json() as any;
        line(`  [poll ${i}] status=${job.status} ${job.progress ?? ""}`);
        if (job.status === "done") {
          line(`  GEN DONE: teeVerified=${job.result?.teeVerified} model=${job.result?.model} imageRoot=${String(job.result?.imageRoot).slice(0, 16)}... mintable=${job.result?.mintable}`);
          const ma = await app.inject({ method: "POST", url: "/mint-args", headers: auth, payload: { jobId } });
          const m = ma.json() as any;
          line(`  MINT-ARGS (non-custodial, user signs): contract=${m.contract} to=${String(m.to).slice(0, 10)}.. seed=${m.seed} attestationSig=${String(m.attestationSig).slice(0, 14)}..`);
          break;
        }
        if (job.status === "error") { line(`  GEN ERROR: ${job.error}`); break; }
      }
    }
  } else {
    line(`\n### T5 skipped (set AICHAT_RUN_GEN=1 to run the real generate_and_mint job).`);
  }

  line(`\n=== VERIFY DONE ===`);
  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error("FATAL:", e?.stack || e); process.exit(1); });
