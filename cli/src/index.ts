#!/usr/bin/env bun
// AURA CLI - the composable, scriptable surface for the AURA verifiable creative-agent protocol.
// Same actions as the AURA app + AI-chat surface, driven from any terminal or script. The headline is
// `aura verify <id>`: it recomputes a Relic's rarity + subject from the on-chain seed locally, so a pull
// is provably unrigged without trusting our API.
import { c } from "./ui.ts";
import { API_BASE, ApiError } from "./api.ts";
import { cmdAgents } from "./commands/agents.ts";
import { cmdExplore } from "./commands/explore.ts";
import { cmdAura } from "./commands/aura.ts";
import { cmdRelic } from "./commands/relic.ts";
import { cmdVerify } from "./commands/verify.ts";
import { cmdSummon } from "./commands/summon.ts";

const VERSION = "0.1.0";

function help(): void {
  const b = (s: string) => c.bold(c.white(s));
  process.stdout.write(`
${b("AURA")} ${c.gray(`v${VERSION}`)}  ${c.dim("- provable creative-agent gacha, from your terminal")}

${c.bold("USAGE")}
  aura <command> [args]

${c.bold("COMMANDS")}
  ${c.cyan("agents")}                list every Aura (creative agent)
  ${c.cyan("explore")} ${c.gray("[n]")}           list the n most recent Relics with rarity   ${c.dim("(default 15)")}
  ${c.cyan("aura")} ${c.gray("<name|id>")}        inspect an Aura - lore, style, royalty, relic count
  ${c.cyan("relic")} ${c.gray("<id>")}            inspect a Relic - image, owner, on-chain provenance
  ${c.cyan("verify")} ${c.gray("<id>")}           ${c.white("recompute a Relic's rarity + subject from the on-chain seed")}
                        ${c.dim("locally (trustless) - the provable-pulls proof.  --json for scripts")}
  ${c.cyan("summon")} ${c.gray("<name|id>")}      explain + watch a summon  ${c.dim("(--watch <requestId> to follow one)")}

${c.bold("EXAMPLES")}
  ${c.dim("$")} aura explore
  ${c.dim("$")} aura verify 23                ${c.gray("# proves the RARE pull (roll 8054) yourself")}
  ${c.dim("$")} aura verify 23 --json | jq .recomputedLocally.provable

${c.bold("ENV")}
  ${c.gray("AURA_API")}   backend base URL   ${c.dim(`(default ${API_BASE})`)}
  ${c.gray("NO_COLOR")}   disable ANSI color
`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    help();
    return 0;
  }
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  try {
    switch (cmd) {
      case "agents":
        await cmdAgents();
        break;
      case "explore":
      case "relics":
        await cmdExplore(rest);
        break;
      case "aura":
      case "agent":
        await cmdAura(rest);
        break;
      case "relic":
      case "output":
        await cmdRelic(rest);
        break;
      case "verify":
        await cmdVerify(rest);
        break;
      case "summon":
        await cmdSummon(rest);
        break;
      default:
        process.stderr.write(`${c.red("unknown command")} "${cmd}". Run ${c.bold("aura help")}.\n`);
        return 2;
    }
    return 0;
  } catch (e) {
    if (e instanceof ApiError) {
      process.stderr.write(`${c.red("error")} ${e.body || e.message}  ${c.dim(`[${e.status} ${e.path}]`)}\n`);
    } else {
      process.stderr.write(`${c.red("error")} ${e instanceof Error ? e.message : String(e)}\n`);
    }
    return 1;
  }
}

main().then((code) => process.exit(code));
