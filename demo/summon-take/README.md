# Live Summon — demo recording kit

How the AURA Live Summon demo take was driven against the **live Galileo** stack
(`contracts/deployed-summon.json`). Testnet-only; everything is local + reversible.

## What it does
Drives the genuine on-screen Summon flow in qutebrowser with a demo BUYER wallet,
**without putting the buyer key in the browser**:

- `../../server/src/scripts/buyer-signer.ts` — a `localhost:8799` service that holds the buyer
  key (`SUMMON_BUYER_KEY` in the repo `.env`, server-side) and signs+broadcasts the txs the
  page relays. `GET /address`, `GET /health`, `POST /send {to,data,value,gas}` (legacy 5 gwei).
- `aura-buyer-provider.js` — an **EIP-6963** injected provider (embeds only the public buyer
  ADDRESS). Handles `eth_requestAccounts` / `eth_chainId` (0x40da) / `wallet_switchEthereumChain`;
  relays `eth_sendTransaction` → the signer; proxies all reads → the Galileo RPC. Announced via
  `eip6963:announceProvider` so wagmi/RainbowKit auto-detect "AURA Demo Buyer" and auto-connect.
- `take-connect.py` — navigates the agent page (pre-loads the SSR), injects the provider, and
  confirms the buyer is connected.

## Re-up the stack (re-shoot)
```bash
# 1. backend with the watcher, pointed at the live Galileo Summon stack
cd server && CHAIN_ID=16602 RPC_URL=https://evmrpc-testnet.0g.ai \
  AGENT_REGISTRY_ADDR=<deployed-summon.agentRegistry> OUTPUT_NFT_ADDR=<...outputNFT> \
  SUMMON_ESCROW_ADDR=<...summonEscrow> SUMMON_WATCHER=1 SUMMON_START_BLOCK=41381313 \
  SQLITE_PATH=$PWD/data/aura-summon-demo.db PORT=8787 npm run start:dev

# 2. web built with the live NEXT_PUBLIC_* (see web/.env.local) -> standalone server
cd web && npx next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ \
  && PORT=3000 AURA_API_INTERNAL=http://localhost:8787 node .next/standalone/server.js

# 3. the buyer signer (key from .env)
cd server && npx tsx src/scripts/buyer-signer.ts
```

## Drive the take (qutebrowser via the CDP on :2262)
1. `python3 demo/summon-take/take-connect.py` — agent page + inject + auto-connect the buyer.
2. Click "Summon for X 0G" (a `button` whose text matches `/summon for/i`) → the StepRail runs the
   real ~42s gen; the watcher fulfills → the delivered card.
3. `/verify?id=<tokenId>` → the provenance checks + the paid-commission split.
4. **Income-follows beat:** `cast send <registry> "transferFrom(address,address,uint256)" <owner> <owner2> 1`
   (owner-signed) → re-summon → `/verify` now shows the agent owner + the fee cut flipped to owner2.
5. Capture stills with `~/.config/qutebrowser/scripts/qb-shoot <url-slug> <out.png>` (native render);
   stitch with ffmpeg (concat demuxer + per-still durations, `scale=…,format=yuv420p`, `+faststart`).

Live-video capture is flaky (detached-frame) — capture clean stills + stitch; see
memory `reference_demo_video_pipeline`.
