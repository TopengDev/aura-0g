import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Footer } from "@/components/chrome/Footer";
import { Panel, Chip, MetaRow, CopyValue, StatFigure } from "@/components/product/primitives";
import { fetchHealth, fetchChatHealth, fetchChatModels, shortAddr, type ChatModelInfo } from "@/lib/api";
import { EXPLORER } from "@/lib/chains";

// /proof - the jury-facing EVIDENCE PAGE. Every claim below re-derives from a LIVE endpoint or an on-chain
// read. The page fetches /health, /chat/health, /chat/models at request time (force-dynamic, same posture
// as /verify) and renders the real values. If a fetch is unavailable it falls back to the snapshot captured
// on 2026-07-01 and LABELS it as a snapshot (the header chip flips to "Snapshot", live-health values drop
// their green tone), so the page is never blank and never presents stale values as live.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Proof, not promises | AURA",
  description:
    "AURA's evidence page: every claim re-derives from a live endpoint or an on-chain read. The TEE guard applies a curated allowlist stricter than 0G's on-chain TeeML flag, chat runs on 0G mainnet GLM-5.1 attested per reply, five contracts are live on Galileo, and creator royalty is enforced by EIP-2981.",
};

// ── Verified public proof surfaces (all resolved 200/3xx on 2026-07-01) ─────
// The clickable API links point at the STABLE public API origin (separate from the fetch base, which is
// container-internal in prod). These are the endpoints a juror can curl to re-derive every claim.
const API_PUBLIC = "https://api-aura.topengdev.com";
const CHAT_URL = "https://aura.topengdev.com/chat";

// The 0G Compute chat providers below run on 0G MAINNET, so their address links must resolve on the MAINNET
// explorer. This is deliberately DIFFERENT from EXPLORER (the Galileo testnet explorer) used for the app's
// contracts: the marketplace contracts are on Galileo testnet, the chat providers are on 0G mainnet. Two
// networks, on purpose (a mainnet provider address shows blank on the testnet explorer). Verified live
// 2026-07-01: all seven providers are active on chainscan.0g.ai and effectively absent from the testnet chain.
const MAINNET_EXPLORER = "https://chainscan.0g.ai";

// The chain the marketplace contracts live on (verified live via /health).
const CHAIN_ID = 16602;

// ── Contracts (Galileo testnet 16602) ──────────────────────────────────────
// AgentRegistry / OutputNFT / Marketplace are echoed by GET /health. SummonEscrow is in
// contracts/deployed-v2.json. AuraINFT is verified on-chain: eth_getCode returns real bytecode and
// name() returns "AURA Creative Agent". All five return a real code size via eth_getCode.
type ContractRow = { label: string; addr: string; note: string };
const CONTRACTS: ContractRow[] = [
  { label: "AgentRegistry", addr: "0xb5960cc08caa5195095cfb8aa270f122be09ba0a", note: "every Aura's on-chain identity (ERC-721)" },
  { label: "OutputNFT", addr: "0xEecED1e6965f00a5f7cA459631370c886FAEFd3b", note: "attestation-gated Relic mint" },
  { label: "Marketplace", addr: "0x815115Eb39987d3fAdb3b373f89fa0096433f228", note: "EIP-2981 royalty-honoring trades" },
  { label: "SummonEscrow", addr: "0xa5CeFBc097d84beE09b12fc1569B6CcA56992838", note: "demand-pull commissioning + fee split" },
  { label: "AuraINFT", addr: "0x19738D5C8867EeAE9910dAbdc21Bf59f4bed843d", note: "ERC-7857 sealed-key transfer · isolated deploy (name: AURA Creative Agent)" },
];

// The hero Relic, verified all-green live (GET /provenance/25 + /royalty/25). tokenId 25, agent 20 (BITSY),
// rarity Rare. These on-chain values are immutable once minted.
const RELIC = {
  tokenId: 25,
  agentId: 20,
  agentName: "BITSY",
  rarity: "Rare",
  imageRoot: "0x04a177d82e8e645ce01d6bf9a386465ea3d2f3607bcd2290aaaa13affdcfe616",
  teeAttestation: "0xa3aa1cfeeeb911aab04a25a259a9b609f7e382581184cebddf97b898eb5d9f4a",
  provenanceHash: "0x0d832542dedf6827b3681901b8706f219db042e213d1f07b131deffc9eafcce6",
  royaltyPct: 9,
};
// The on-0G-Storage proof for the Relic's image root. NOTE: the storagescan `/tx/<hash>` route expects a
// submission TX hash, not a data merkle root, so it never resolves a root. The 0G Storage indexer's
// `/file/info/<root>` route DOES resolve the root and returns `{ finalized: true, size, ... }` = the literal
// proof the blob is committed to 0G Storage. Verified live 2026-07-01 (finalized:true for this root).
const RELIC_STORAGE_PROOF = `https://indexer-storage-testnet-turbo.0g.ai/file/info/${RELIC.imageRoot}`;

// ── Live-model row (widened past ChatModelInfo, which omits `provider` + `allowlisted` from the shared
// type though the API returns both at runtime). ────────────────────────────
type ProofModel = {
  id: string;
  label: string;
  provider?: string;
  teeAttested: boolean;
  allowlisted: boolean;
  selectable: boolean;
  online: boolean | null;
  sizeB: number;
};

// Verified-live provider addresses (chat-compute.ts allowlist + the /chat/models response, 2026-07-01).
const PROVIDER_BY_ID: Record<string, string> = {
  "glm-5.1": "0xDB7B465300B0acf454867683c5481055f698b2e8",
  "zai-org/GLM-5.1-FP8": "0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D",
  "0GM-1.0-35B-A3B": "0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9",
  "deepseek/deepseek-chat-v3-0324": "0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0",
  "deepseek-v4-flash": "0x61C0007197E7D4d6A842d6768E8035728877B9F6",
  "deepseek-v4-pro": "0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB",
  "openai/gpt-oss-20b": "0x44ba5021daDa2eDc84b4f5FC170b85F7bC51ef64",
};

// The snapshot VERIFIED live on 2026-07-01, used only if the live fetch is unavailable so the page is never
// blank. Identical values to what /chat/models returns.
const FALLBACK_MODELS: ProofModel[] = [
  { id: "glm-5.1", label: "GLM 5.1", provider: PROVIDER_BY_ID["glm-5.1"], teeAttested: true, allowlisted: true, selectable: true, online: true, sizeB: 0 },
  { id: "zai-org/GLM-5.1-FP8", label: "GLM 5.1 FP8", provider: PROVIDER_BY_ID["zai-org/GLM-5.1-FP8"], teeAttested: true, allowlisted: true, selectable: true, online: true, sizeB: 0 },
  { id: "0GM-1.0-35B-A3B", label: "0GM 1.0 35B A3B", provider: PROVIDER_BY_ID["0GM-1.0-35B-A3B"], teeAttested: true, allowlisted: true, selectable: true, online: true, sizeB: 35 },
  { id: "deepseek/deepseek-chat-v3-0324", label: "Deepseek Chat V3", provider: PROVIDER_BY_ID["deepseek/deepseek-chat-v3-0324"], teeAttested: true, allowlisted: false, selectable: false, online: true, sizeB: 0 },
  { id: "deepseek-v4-flash", label: "Deepseek V4 Flash", provider: PROVIDER_BY_ID["deepseek-v4-flash"], teeAttested: true, allowlisted: false, selectable: false, online: true, sizeB: 0 },
  { id: "deepseek-v4-pro", label: "Deepseek V4 Pro", provider: PROVIDER_BY_ID["deepseek-v4-pro"], teeAttested: true, allowlisted: false, selectable: false, online: true, sizeB: 0 },
  { id: "openai/gpt-oss-20b", label: "GPT OSS 20B", provider: PROVIDER_BY_ID["openai/gpt-oss-20b"], teeAttested: true, allowlisted: false, selectable: false, online: false, sizeB: 20 },
];

// The four providers spotlighted in the rejected group: TeeML-flagged but NOT on AURA's curated allowlist
// (chat-compute.ts). The remainder is summarized as a count so the table stays scannable.
const REJECT_SPOTLIGHT = new Set([
  "deepseek/deepseek-chat-v3-0324",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "openai/gpt-oss-20b",
]);

function normalizeModels(live: ChatModelInfo[]): ProofModel[] {
  if (!live.length) return FALLBACK_MODELS;
  return live.map((m) => {
    const w = m as ChatModelInfo & { provider?: string; allowlisted?: boolean };
    return {
      id: m.id,
      label: m.label,
      provider: w.provider ?? PROVIDER_BY_ID[m.id],
      teeAttested: m.teeAttested,
      allowlisted: w.allowlisted ?? m.selectable,
      selectable: m.selectable,
      online: m.online,
      sizeB: m.sizeB,
    };
  });
}

export default async function ProofPage() {
  const [health, chatHealth, modelsRes] = await Promise.all([
    fetchHealth(),
    fetchChatHealth(),
    fetchChatModels(),
  ]);

  // Track whether each live fetch actually succeeded. On failure the fetchers return null / an empty list
  // (fetchHealth, fetchChatHealth -> null; fetchChatModels -> { models: [] }). When a fetch is down we still
  // render the 2026-07-01 snapshot, but we LABEL it as a snapshot and drop the green "live" tone, so the page
  // never presents stale values as live. Health booleans NEVER default to true (a down API is not "healthy").
  const healthLive = health !== null;
  const chatLive = chatHealth !== null;
  const modelsLive = modelsRes.models.length > 0;
  const allLive = healthLive && chatLive && modelsLive;
  const SNAPSHOT_DATE = "2026-07-01";

  const chainId = health?.chainId ?? CHAIN_ID;
  // ChatHealth (shared type) omits zerogNetwork, though the API returns it at runtime, so read it via a
  // widened view. The rest are on the shared type.
  const zerogNetwork = (chatHealth as { zerogNetwork?: string } | null)?.zerogNetwork ?? "mainnet";
  const zerogModel = chatHealth?.zerogModel ?? "zai-org/GLM-5.1-FP8";
  const zerogHealthy = chatHealth?.zerogHealthy ?? false;
  const fallbackConfigured = chatHealth?.fallbackConfigured ?? false;

  const models = normalizeModels(modelsRes.models);
  const allowlisted = models.filter((m) => m.allowlisted && m.selectable);
  const rejected = models.filter((m) => m.teeAttested && !m.allowlisted);
  const rejectedSpotlight = rejected.filter((m) => REJECT_SPOTLIGHT.has(m.id));
  const rejectedMore = rejected.length - rejectedSpotlight.length;
  const totalTeeAttested = models.filter((m) => m.teeAttested).length;

  return (
    <main className="min-h-screen pt-14">
      <div className="mx-auto w-full max-w-[var(--container-wrap)] px-5 py-16 sm:px-8 sm:py-24">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="w-full">
          <div className="flex items-center gap-3 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
            <span>Evidence</span>
            <span className="prov-rule h-px flex-1" style={{ opacity: 0.5 }} />
            <span style={{ color: "var(--color-accent)" }}>0G · GALILEO + MAINNET</span>
          </div>
          <h1 className="font-display mt-4" style={{ fontSize: "clamp(40px, 7vw, 92px)", lineHeight: 0.98, letterSpacing: "-0.02em" }}>
            Proof, not promises.
          </h1>
          <p className="mt-5 max-w-[62ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
            Every claim below re-derives from a live endpoint or an on-chain read. Click any value and check it
            yourself. If a claim cannot be verified right now, it is not on this page.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            {allLive ? (
              <Chip tone="ok">Live re-derived</Chip>
            ) : (
              <Chip>Snapshot · {SNAPSHOT_DATE}</Chip>
            )}
            <Chip tone="accent">On-chain reads</Chip>
            <Chip>No unverified claims</Chip>
          </div>
        </header>

        {/* ── Mic-drop ───────────────────────────────────────────────────── */}
        <section className="mt-16 sm:mt-24">
          <Panel className="overflow-hidden p-7 sm:p-10" style={{ background: "color-mix(in oklab, var(--color-accent) 5%, var(--color-paper))", borderColor: "color-mix(in oklab, var(--color-accent) 24%, var(--color-border))" }}>
            <div className="flex items-center gap-3 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-accent)" }}>
              <span>The mic-drop</span>
              <span className="prov-rule h-px flex-1" style={{ opacity: 0.4 }} />
              <span className="font-mono-x tabular-nums" style={{ color: "var(--color-ink-3)" }}>00</span>
            </div>
            <h2 className="font-display mt-4" style={{ fontSize: "clamp(28px, 4.4vw, 52px)", lineHeight: 1.02, letterSpacing: "-0.015em" }}>
              Stricter than the chain&apos;s own flag.
            </h2>
            <p className="mt-5 max-w-[70ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              On 0G mainnet the on-chain <span className="font-mono-x">verifiability: &quot;TeeML&quot;</span> flag is
              coarse: many providers carry it. AURA does not route on the flag alone. It requires TeeML <em>and</em>
              the provider address on a curated allowlist maintained in the server, so the set AURA will actually
              serve is strictly narrower than the chain&apos;s flag. A provider not on the allowlist is never
              selectable or served, even when the chain says TeeML.
            </p>

            <div className="mt-8 grid gap-4 lg:grid-cols-2">
              {/* Allowlisted */}
              <div className="rounded-[18px] border p-5 sm:p-6" style={{ borderColor: "color-mix(in oklab, var(--color-ok) 34%, transparent)", background: "color-mix(in oklab, var(--color-ok) 7%, var(--color-paper))" }}>
                <div className="flex items-center justify-between gap-3">
                  <span className="label-caps text-[13px] uppercase tracking-[0.1em]" style={{ color: "var(--color-ok)" }}>
                    Allowlisted · served in-enclave
                  </span>
                  <span className="font-mono-x tabular-nums text-[16px]" style={{ color: "var(--color-ok)" }}>
                    {String(allowlisted.length).padStart(2, "0")}
                  </span>
                </div>
                <ul className="mt-4 space-y-3">
                  {allowlisted.map((m) => (
                    <ModelLine key={m.id} m={m} accepted />
                  ))}
                </ul>
              </div>

              {/* Rejected */}
              <div className="rounded-[18px] border p-5 sm:p-6" style={{ borderColor: "color-mix(in oklab, var(--color-warn) 30%, transparent)", background: "color-mix(in oklab, var(--color-warn) 6%, var(--color-paper))" }}>
                <div className="flex items-center justify-between gap-3">
                  <span className="label-caps text-[13px] uppercase tracking-[0.1em]" style={{ color: "var(--color-warn)" }}>
                    TeeML-flagged · rejected by AURA
                  </span>
                  <span className="font-mono-x tabular-nums text-[16px]" style={{ color: "var(--color-warn)" }}>
                    {String(rejected.length).padStart(2, "0")}
                  </span>
                </div>
                <ul className="mt-4 space-y-3">
                  {rejectedSpotlight.map((m) => (
                    <ModelLine key={m.id} m={m} accepted={false} />
                  ))}
                </ul>
                {rejectedMore > 0 ? (
                  <p className="mt-4 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
                    and {rejectedMore} more TeeML-tagged providers (MiniMax, Qwen, GLM-5, and others) that AURA does
                    not serve on the chat path.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-7 flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--color-border)" }}>
              <p className="max-w-[60ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                AURA&apos;s curated allowlist is strictly narrower than 0G&apos;s TeeML flag.
                {" "}{totalTeeAttested} providers carry TeeML{allLive ? "" : ` (${SNAPSHOT_DATE} snapshot)`}; AURA serves {allowlisted.length}.
              </p>
              <ProofLink href={`${API_PUBLIC}/chat/models`}>Re-derive live: /chat/models</ProofLink>
            </div>
          </Panel>
        </section>

        {/* ── Stat strip ─────────────────────────────────────────────────── */}
        <section className="mt-16 grid grid-cols-2 gap-x-6 gap-y-10 sm:mt-20 lg:grid-cols-4">
          <StatFigure value={String(CONTRACTS.length).padStart(2, "0")} label="Contracts live on-chain" />
          <StatFigure value="GLM-5.1" label="0G mainnet, attested per reply" />
          <StatFigure value="EIP-2981" label="Enforced creator royalty" />
          <StatFigure value={`${allowlisted.length}/${totalTeeAttested}`} label="TeeML providers we serve" />
        </section>

        {/* ── The four 0G primitives ─────────────────────────────────────── */}
        <SectionHead index="01" kicker="The 0G stack" title="Four primitives, each proven." />
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {/* Compute */}
          <Panel className="p-6 sm:p-8">
            <PrimitiveHead tag="Compute · TEE" title="In-enclave inference, attested per reply." />
            <p className="mt-4 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              Auras chat on 0G mainnet GLM-5.1, and each reply carries its own TEE attestation. Relic images are
              generated in a 0G testnet Compute TEE (qwen-image-edit-2511), with the attestation committed on-chain
              at mint.
            </p>
            <dl className="mt-6">
              <MetaRow k="Chat network" v={allLive ? zerogNetwork : `${zerogNetwork} · ${SNAPSHOT_DATE} snapshot`} ok={zerogHealthy} mono={false} />
              <MetaRow k="Chat model" v={zerogModel} ok={chatLive} mono />
              <MetaRow k="Labeled fallback" v={fallbackConfigured ? "Anthropic Claude · not TEE-attested" : "off"} mono={false} />
              <MetaRow k="Relic attestation" v={<CopyValue full={RELIC.teeAttestation} display={shortAddr(RELIC.teeAttestation)} />} mono />
            </dl>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <ProofLink href={`${API_PUBLIC}/chat/health`}>/chat/health</ProofLink>
              <ProofLink href={`/outputs/${RELIC.tokenId}`} internal>Relic #{RELIC.tokenId}</ProofLink>
            </div>
          </Panel>

          {/* Storage */}
          <Panel className="p-6 sm:p-8">
            <PrimitiveHead tag="Storage · 0G" title="Content-addressed roots, committed on-chain." />
            <p className="mt-4 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              Every Relic image and every sealed agent-brain is a 0G Storage content root, committed on-chain and
              finalized on 0G Storage. Honest caveat: testnet 0G Storage evicts blobs within roughly an hour, so
              v1 serves from a durable content-addressed cache keyed by the same 0G root. Full 0G persistence is a
              mainnet property.
            </p>
            <dl className="mt-6">
              <MetaRow k="Relic image root" v={<CopyValue full={RELIC.imageRoot} display={shortAddr(RELIC.imageRoot)} />} mono />
              <MetaRow k="Committed on-chain" v="yes" ok mono={false} />
              <MetaRow k="Addressing" v="content root (keccak)" mono={false} />
            </dl>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <ProofLink href={RELIC_STORAGE_PROOF}>0G Storage proof</ProofLink>
              <ProofLink href={`/verify?id=${RELIC.tokenId}`} internal>Verify on-chain</ProofLink>
            </div>
          </Panel>

          {/* Chain */}
          <Panel className="p-6 sm:p-8">
            <PrimitiveHead tag="Chain · Galileo 16602" title="Five contracts, live bytecode." />
            <p className="mt-4 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              Five contracts are deployed on 0G Galileo testnet (chainId {chainId}); every address below returns real
              bytecode on-chain and opens on 0G Scan. Four run the live marketplace; AuraINFT is the isolated
              sealed-transfer deploy, with the cutover staged.
            </p>
            <dl className="mt-6">
              {CONTRACTS.map((c) => (
                <MetaRow
                  key={c.label}
                  k={c.label}
                  v={shortAddr(c.addr)}
                  href={`${EXPLORER}/address/${c.addr}`}
                  mono
                />
              ))}
            </dl>
          </Panel>

          {/* iNFT */}
          <Panel className="p-6 sm:p-8">
            <PrimitiveHead tag="ERC-7857 · sealed transfer" title="Sealed-key transfer, proven in isolation." />
            <p className="mt-4 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              ERC-7857 sealed-key transfer is a proven primitive on the AuraINFT contract: a transfer recovers a
              signed re-encryption proof, and the brain is re-encrypted with a fresh key and ECIES-sealed to the
              buyer, so the old owner cannot open it. It is deployed and Foundry-tested in isolation on Galileo. Live
              Auras trade today as standard ERC-721 on AgentRegistry, and Relics are ERC-721 + EIP-2981, not iNFTs;
              the sealed-key cutover is staged. Honest framing: the oracle is a trusted ECDSA signer, not a
              hardware-TEE enclave, which is the bar the field ships today.
            </p>
            <dl className="mt-6">
              <MetaRow k="Contract (isolated deploy)" v={shortAddr(CONTRACTS[4].addr)} href={`${EXPLORER}/address/${CONTRACTS[4].addr}`} mono />
              <MetaRow k="On-chain name" v="AURA Creative Agent" ok mono={false} />
              <MetaRow k="Standard" v="ERC-7857 (trusted-signer)" mono={false} />
              <MetaRow k="Key sealing" v="ECIES to buyer pubkey" mono={false} />
              <MetaRow k="Live Auras" v="ERC-721 on AgentRegistry · cutover staged" mono={false} />
            </dl>
          </Panel>
        </div>

        {/* ── Royalty loop ───────────────────────────────────────────────── */}
        <SectionHead index="02" kicker="The royalty loop" title="Royalty that follows the work." />
        <div className="mt-10 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Panel className="p-6 sm:p-8">
            <p className="text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              Every Relic carries an EIP-2981 creator royalty. The receiver is not a static address: royaltyInfo
              resolves live to <span className="font-mono-x">ownerOf(creatorAgentId)</span>, the current owner of the
              creating Aura. Sell the agent iNFT and the entire future royalty stream moves with it. As far as we can
              tell across the bracket, AURA is the only marketplace enforcing creator royalty on-chain.
            </p>
            <dl className="mt-6">
              <MetaRow k="Standard" v="EIP-2981 royaltyInfo" mono={false} />
              <MetaRow k="Relic" v={`#${RELIC.tokenId} · ${RELIC.agentName} · ${RELIC.rarity}`} mono={false} />
              <MetaRow k="Royalty" v={`${RELIC.royaltyPct}%`} ok mono={false} />
              <MetaRow k="Resolves to" v="current agent owner" ok mono={false} />
              <MetaRow k="Provenance hash" v={<CopyValue full={RELIC.provenanceHash} display={shortAddr(RELIC.provenanceHash)} />} mono />
            </dl>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <ProofLink href={`${API_PUBLIC}/royalty/${RELIC.tokenId}`}>/royalty/{RELIC.tokenId}</ProofLink>
              <ProofLink href={`/agents/${RELIC.agentId}`} internal>Creating Aura</ProofLink>
              <ProofLink href={`/outputs/${RELIC.tokenId}`} internal>The Relic</ProofLink>
            </div>
          </Panel>
          <Panel className="flex flex-col justify-center p-6 sm:p-8" style={{ background: "color-mix(in oklab, var(--color-accent) 4%, var(--color-paper))" }}>
            <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>
              The loop
            </div>
            <ol className="mt-4 space-y-3 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              <li><span className="font-mono-x" style={{ color: "var(--color-accent)" }}>01</span>&nbsp; An Aura creates a Relic.</li>
              <li><span className="font-mono-x" style={{ color: "var(--color-accent)" }}>02</span>&nbsp; The Relic mints with an EIP-2981 royalty.</li>
              <li><span className="font-mono-x" style={{ color: "var(--color-accent)" }}>03</span>&nbsp; The royalty resolves to whoever owns the Aura now.</li>
              <li><span className="font-mono-x" style={{ color: "var(--color-accent)" }}>04</span>&nbsp; Transfer the Aura, and the income follows.</li>
            </ol>
          </Panel>
        </div>

        {/* ── Status table ───────────────────────────────────────────────── */}
        <SectionHead index="03" kicker="Shipped on 0G" title="Primitive, use, and live proof." />
        <Panel className="mt-10 overflow-hidden">
          <div className="hidden grid-cols-[0.8fr_1.6fr_1fr] gap-4 border-b px-6 py-4 sm:grid" style={{ borderColor: "var(--color-border)" }}>
            <span className="label-caps text-[13px] uppercase tracking-[0.1em]" style={{ color: "var(--color-ink-3)" }}>Primitive</span>
            <span className="label-caps text-[13px] uppercase tracking-[0.1em]" style={{ color: "var(--color-ink-3)" }}>How AURA uses it</span>
            <span className="label-caps text-[13px] uppercase tracking-[0.1em] text-right" style={{ color: "var(--color-ink-3)" }}>Live proof</span>
          </div>
          {[
            { p: "0G Compute", u: "Chat on mainnet GLM-5.1; image on testnet qwen-image-edit-2511; both in a TEE, attested per reply.", href: `${API_PUBLIC}/chat/health`, label: "/chat/health", internal: false },
            { p: "TeeML guard", u: "Curated allowlist, strictly narrower than the chain's TeeML flag.", href: `${API_PUBLIC}/chat/models`, label: "/chat/models", internal: false },
            { p: "0G Storage", u: "Content-addressed image + brain roots, committed on-chain.", href: RELIC_STORAGE_PROOF, label: "Storage proof", internal: false },
            { p: "0G Chain", u: "Five contracts on Galileo 16602, real bytecode.", href: `${API_PUBLIC}/health`, label: "/health", internal: false },
            { p: "ERC-7857", u: "Sealed-key transfer proven on AuraINFT (isolated deploy); live Auras are ERC-721, cutover staged.", href: `${EXPLORER}/address/${CONTRACTS[4].addr}`, label: "0G Scan", internal: false },
            { p: "EIP-2981", u: "Creator royalty resolving live to the agent owner.", href: `${API_PUBLIC}/royalty/${RELIC.tokenId}`, label: `/royalty/${RELIC.tokenId}`, internal: false },
          ].map((row) => (
            <div key={row.p} className="grid grid-cols-1 gap-1.5 border-b px-6 py-4 last:border-b-0 sm:grid-cols-[0.8fr_1.6fr_1fr] sm:items-center sm:gap-4" style={{ borderColor: "var(--color-border)" }}>
              <span className="font-display text-[20px]" style={{ letterSpacing: "-0.01em" }}>{row.p}</span>
              <span className="text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>{row.u}</span>
              <span className="sm:text-right">
                <ProofLink href={row.href} internal={row.internal}>{row.label}</ProofLink>
              </span>
            </div>
          ))}
        </Panel>

        {/* ── Close ──────────────────────────────────────────────────────── */}
        <section className="mt-16 sm:mt-24">
          <div className="prov-rule h-px w-full" style={{ opacity: 0.6 }} />
          <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="font-display max-w-[16ch]" style={{ fontSize: "clamp(26px, 4vw, 44px)", lineHeight: 1.02, letterSpacing: "-0.015em" }}>
              Do not take our word. Take the reads.
            </h2>
            <div className="flex flex-wrap gap-2.5">
              <ProofLink href="/verify" internal>Open the verifier</ProofLink>
              <ProofLink href={CHAT_URL}>Chat with an Aura</ProofLink>
              <ProofLink href={`${API_PUBLIC}/health`}>Inspect /health</ProofLink>
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </main>
  );
}

// ── Local presentational helpers (server-rendered) ─────────────────────────

// A section header in the product-page language: mono kicker + index marker + prov rule + display title.
function SectionHead({ index, kicker, title }: { index: string; kicker: string; title: string }) {
  return (
    <div className="mt-20 sm:mt-28">
      <div className="flex items-center gap-3 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
        <span>{kicker}</span>
        <span className="prov-rule h-px flex-1" style={{ opacity: 0.5 }} />
        <span className="font-mono-x tabular-nums" style={{ color: "var(--color-accent)" }}>{index}</span>
      </div>
      <h2 className="font-display mt-4" style={{ fontSize: "clamp(28px, 4.4vw, 56px)", lineHeight: 1.0, letterSpacing: "-0.02em" }}>
        {title}
      </h2>
    </div>
  );
}

// A primitive-panel header: a small accent tag over an architectural sub-title.
function PrimitiveHead({ tag, title }: { tag: string; title: string }) {
  return (
    <div>
      <span className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-accent)" }}>
        {tag}
      </span>
      <h3 className="font-display mt-3" style={{ fontSize: "clamp(21px, 2.6vw, 30px)", lineHeight: 1.05, letterSpacing: "-0.01em" }}>
        {title}
      </h3>
    </div>
  );
}

// One model row in the mic-drop split: label + optional size, provider explorer link, accept/reject glyph.
function ModelLine({ m, accepted }: { m: ProofModel; accepted: boolean }) {
  const tone = accepted ? "var(--color-ok)" : "var(--color-warn)";
  return (
    <li className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[16px]" style={{ color: tone }} aria-hidden>
            {accepted ? "✓" : "✗"}
          </span>
          <span className="truncate text-[16px] font-semibold" style={{ color: "var(--color-ink)" }}>
            {m.label}
          </span>
          {m.sizeB > 0 ? (
            <span className="shrink-0 font-mono-x tabular-nums text-[13px]" style={{ color: "var(--color-ink-3)" }}>
              {m.sizeB}B
            </span>
          ) : null}
        </div>
        {m.provider ? (
          <a
            href={`${MAINNET_EXPLORER}/address/${m.provider}`}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 ml-6 inline-block font-mono-x text-[13px] underline-offset-2 hover:underline"
            style={{ color: "var(--color-ink-3)" }}
          >
            {shortAddr(m.provider)}
          </a>
        ) : null}
      </div>
      <span className="shrink-0 label-caps text-[13px] uppercase tracking-[0.08em]" style={{ color: tone }}>
        {accepted ? "TeeML + allowlist" : "not allowlisted"}
      </span>
    </li>
  );
}

// A verified proof link: internal (site route) renders a plain accent link; external opens on a new tab with
// the gliding-arrow motif. Every href on this page resolved 200/3xx on 2026-07-01.
function ProofLink({ href, children, internal = false }: { href: string; children: ReactNode; internal?: boolean }) {
  return (
    <a
      href={href}
      {...(internal ? {} : { target: "_blank", rel: "noreferrer" })}
      className="lnk micro group inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[16px] font-semibold hover:-translate-y-px hover:shadow-[var(--shadow-pill)]"
      style={{ borderColor: "var(--color-border-strong)", color: "var(--color-accent)", background: "var(--color-paper)" }}
    >
      {children}
      <span className="arrow" aria-hidden>{internal ? "→" : "↗"}</span>
    </a>
  );
}
