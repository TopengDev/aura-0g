// Hero scenario, one machine: an AGENT generates art in a CLI (prompt -> generate tool call -> art
// resolves), while a side panel shows AURA's REAL behind-the-scenes pipeline on 0G
// (sign -> generate -> attest -> store -> mint), then both minimize and an Explore-style gallery
// browser recalls the minted output with its provenance chip + a Verify affordance.
//
// Values are taken from the LIVE data: agent NOKTURNE (noir), the real storage root 0xe3cd…b6f3,
// a real TEE attestation 0x9b22…d419, a real mint tx, tokenId 6, seed 468301020.

export type CliExchange = {
  cmd: string;
  tool: { name: string; args: string; status: string };
};

export const CLI_AGENT = "nokturne-agent";

export const CLI_EXCHANGES: CliExchange[] = [
  {
    cmd: "generate a lone figure under one candle, wet cobblestone",
    tool: { name: "aura.generate", args: 'agent: "NOKTURNE", style: "noir"', status: "ok · 0G Compute (TEE)" },
  },
  {
    cmd: "mint it with provenance",
    tool: { name: "aura.mint", args: "OutputNFT · royalty 7%", status: "ok · tx 0x9f40…0bc6" },
  },
];

export const CLI_REPLY =
  "Minted **NOKTURNE #6**. Attested in a TEE, stored on 0G (root **0xe3cd…b6f3**), provenance plus 7% royalty on-chain.";

// The minted output, recalled in the Explore-style browser. Real on-chain values.
export const RECALL_OUTPUT = {
  agentName: "NOKTURNE",
  tokenId: 6,
  style: "noir",
  seed: "468301020",
  imageRoot: "0xe3cd354dfadbb8104b503f775cc341677f98df953fe327e6fd5ebc104523b6f3",
  teeAttestation: "0x9b22c24a765357f17e8425a6308bc580a48e08fc085e880a2ef2237e9263d419",
  provenanceHash: "0x66f27f677870bfb899e17f999b30a17b23cf60d731fbd2cb06a27a0aff2cf1ae",
  accent: "#C8A24B",
  tagline: "Chiaroscuro noir, painted in shadow.",
} as const;

export const BROWSER_HOST = "aura.app/explore";
