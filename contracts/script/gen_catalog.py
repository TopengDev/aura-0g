#!/usr/bin/env python3
"""
GENERATE contracts/src/AuraCatalogMainnet.sol from live testnet cast reads.

Reads getAgent(id) (RAW abi) + ownerOf(id) for ids 1..30 from AgentRegistry
0xb5960cc08caa5195095cfb8aa270f122be09ba0a on 0G Galileo testnet (16602), decodes
each byte-exactly in Python (no hand-transcription), and emits a byte-faithful
Solidity library. String fields (name, encBrainRoot) are emitted with per-byte
\\xNN escaping for any non-safe-ASCII byte so non-ASCII names (e.g. BETON id 24)
are byte-exact regardless of source encoding.
"""
import subprocess, sys

REGISTRY = "0xb5960cc08caa5195095cfb8aa270f122be09ba0a"
RPC = "https://evmrpc-testnet.0g.ai"
CAST = "/home/christopher/.foundry/bin/cast"
N = 30
# curated demo set = ids {1-4, 11-30}; non-curated (embedded+minted for id-preservation,
# but flagged out of the demo/pricing) = test-junk {5,7,8,10} + external CHILLDAWG {6,9}.
NON_CURATED = {5, 6, 7, 8, 9, 10}

def cast_raw_getagent(i):
    out = subprocess.run([CAST, "call", REGISTRY, "getAgent(uint256)", str(i),
                          "--rpc-url", RPC], capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        sys.exit("cast getAgent(%d) failed: %s" % (i, out.stderr))
    return out.stdout.strip()

def cast_owner(i):
    out = subprocess.run([CAST, "call", REGISTRY, "ownerOf(uint256)(address)", str(i),
                          "--rpc-url", RPC], capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        sys.exit("cast ownerOf(%d) failed: %s" % (i, out.stderr))
    return out.stdout.strip()

def decode_get_agent(raw_hex):
    b = bytes.fromhex(raw_hex[2:] if raw_hex.startswith("0x") else raw_hex)
    def word(i, base=0):
        off = base + i * 32
        return b[off:off + 32]
    def uint(w):
        return int.from_bytes(w, "big")
    tbase = uint(word(0))                    # outer offset to the (dynamic) tuple, = 0x20
    name_off = uint(word(0, tbase))          # offsets are relative to the tuple start
    style = word(1, tbase).hex()
    enc_off = uint(word(2, tbase))
    model = word(3, tbase).hex()
    royalty = uint(word(4, tbase))
    style_ver = uint(word(5, tbase))
    resale = uint(word(6, tbase))
    def read_bytes(rel):
        start = tbase + rel
        length = int.from_bytes(b[start:start + 32], "big")
        return b[start + 32:start + 32 + length]
    return {
        "name": read_bytes(name_off),
        "style": "0x" + style,
        "enc": read_bytes(enc_off),
        "model": "0x" + model,
        "royalty": royalty,
        "styleVersion": style_ver,
        "resale": resale,
    }

def sol_str(data: bytes) -> str:
    out = []
    for byte in data:
        if byte == 0x22:      # "
            out.append('\\"')
        elif byte == 0x5c:    # backslash
            out.append("\\\\")
        elif 0x20 <= byte <= 0x7e:
            out.append(chr(byte))
        else:                 # non-ASCII / control -> exact byte
            out.append("\\x%02x" % byte)
    return '"' + "".join(out) + '"'

agents = []
owners = []
for i in range(1, N + 1):
    a = decode_get_agent(cast_raw_getagent(i))
    o = cast_owner(i)
    a["styleVersion"] == 1 or sys.exit("agent %d styleVersion != 1 (got %d)" % (i, a["styleVersion"]))
    agents.append(a)
    owners.append(o)
    print("id %2d  name=%-18r royalty=%-4d resale=%-5d owner=%s" %
          (i, a["name"].decode("utf-8", "replace"), a["royalty"], a["resale"], o), file=sys.stderr)

lines = []
lines.append("// SPDX-License-Identifier: MIT")
lines.append("pragma solidity ^0.8.28;")
lines.append("")
lines.append('import {AgentRegistry} from "./AgentRegistry.sol";')
lines.append("")
lines.append("/// @title AuraCatalogMainnet - the EMBEDDED, byte-faithful snapshot of the live testnet catalog.")
lines.append("/// @notice GENERATED (do not hand-edit) by scripts/gen_catalog.py from cast getAgent(id) RAW reads")
lines.append("///         against AgentRegistry %s on 0G Galileo" % REGISTRY)
lines.append("///         testnet (16602). It exists so the MAINNET (16661) cutover can re-mint the catalog with")
lines.append("///         NO cross-chain read (the source registry has no code on mainnet): DeployCutover, under")
lines.append("///         EMBEDDED_CATALOG=1, iterates this array through the SAME AuraMigration.remint path with the")
lines.append("///         SAME require(nextAgentId()==id) id-preservation invariant.")
lines.append("///")
lines.append("///         ALL 30 entries are embedded (id order, index i => agentId i+1) so ids stay CONTIGUOUS and")
lines.append("///         the curated premium agents keep their exact ids (VELLUM..SOLACE = 11..30). The 6 NON-curated")
lines.append("///         entries (test-junk 5,7,8,10 = TESTAGENT/BRAINTEST; external 6,9 = CHILLDAWG) are still minted")
lines.append("///         to preserve ids but are flagged curated=false (surfaced/priced out of the demo economy).")
lines.append("///         Per the diligence ownership verdict, the mainnet deploy consolidates EVERY agent to the")
lines.append("///         deployer (the caller applies the owner override; owners below are reference-only).")
lines.append("///")
lines.append("///         FAITHFULNESS is machine-checked: AuraCatalogForkParity.t.sol forks live testnet and asserts")
lines.append("///         every curated entry equals AgentRegistry.getAgent(id) field-by-field.")
lines.append("library AuraCatalogMainnet {")
lines.append("    uint256 internal constant COUNT = %d;" % N)
lines.append("")
lines.append("    function count() internal pure returns (uint256) {")
lines.append("        return COUNT;")
lines.append("    }")
lines.append("")
lines.append("    /// @notice The full %d-entry catalog in id order (index i => agentId i+1) as AgentRegistry.Agent" % N)
lines.append("    ///         structs, so it feeds the SAME AuraMigration.remint(inft, owner, a) path. The owner is")
lines.append("    ///         applied by the caller (mainnet deploy overrides ALL to the deployer).")
lines.append("    function agents() internal pure returns (AgentRegistry.Agent[] memory a) {")
lines.append("        a = new AgentRegistry.Agent[](COUNT);")
for idx, a in enumerate(agents):
    i = idx + 1
    name_lit = sol_str(a["name"])
    enc_lit = sol_str(a["enc"])
    tag = "curated" if i not in NON_CURATED else "NON-curated"
    lines.append("        // id %d  (%s)  owner(testnet)=%s" % (i, tag, owners[idx]))
    lines.append("        a[%d] = AgentRegistry.Agent(%s, %s, %s, %s, %d, %d, %d);" % (
        idx, name_lit, a["style"], enc_lit, a["model"], a["royalty"], a["styleVersion"], a["resale"]))
lines.append("    }")
lines.append("")
lines.append("    /// @notice curated[i] == true for the demo set (ids 1-4, 11-30); false for the 6 non-curated")
lines.append("    ///         (ids 5,6,7,8,9,10). Used to gate summon-pricing to the curated agents on the mainnet cutover.")
lines.append("    function curated() internal pure returns (bool[] memory c) {")
lines.append("        c = new bool[](COUNT);")
lines.append("        for (uint256 i = 0; i < COUNT; i++) {")
lines.append("            c[i] = true;")
lines.append("        }")
for i in sorted(NON_CURATED):
    lines.append("        c[%d] = false; // id %d" % (i - 1, i))
lines.append("    }")
lines.append("")
lines.append("    /// @notice The ORIGINAL testnet owners (reference only; NOT used to mint - the mainnet cutover")
lines.append("    ///         consolidates ALL agents to the deployer per the diligence Q2 ownership verdict).")
lines.append("    function testnetOwners() internal pure returns (address[] memory o) {")
lines.append("        o = new address[](COUNT);")
for idx, own in enumerate(owners):
    lines.append("        o[%d] = %s; // id %d" % (idx, own, idx + 1))
lines.append("    }")
lines.append("}")
lines.append("")

OUT = "/home/christopher/claude/Git/repositories/zerog-smoke/.claude/worktrees/wf_da3c6a9e-66f-1/contracts/src/AuraCatalogMainnet.sol"
with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("\nWROTE %s (%d agents, %d curated, %d non-curated)" %
      (OUT, N, N - len(NON_CURATED), len(NON_CURATED)), file=sys.stderr)
