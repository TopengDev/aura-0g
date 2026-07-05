// SERVER-ONLY. The off-chain ART JOURNAL for Creative Arena battles. The on-chain ArenaVote state is the
// SOURCE OF TRUTH for the VOTE (commit-reveal tally); this persists the blind ART + shared theme generated at
// createBattle so a battle BROWSED later (GET /game/arena/battles/:id) renders the two pieces + theme, not just
// the on-chain tally. Best-effort + degrade-safe: a persist failure never fails an already-on-chain battle, and
// a missing row cleanly degrades the read to on-chain-only (the pre-phase-4 behaviour). Nothing here is secret:
// the theme derives from the PUBLIC createBattle block hash and the agents A/B are public on-chain; the VOTE
// stays blind via commit-reveal (this journals the art the crowd JUDGES, not any ballot).
import { db } from "../db.js";
import type { CreateBattleResult, BattleImage } from "./arena.js";

export interface StoredBattleArt {
  battleId: number;
  agentA: number;
  agentB: number;
  theme: { seed: string; subjectProse: string };
  commitDur: number;
  revealDur: number;
  images: BattleImage[]; // [A, B]
}

/** Persist a created battle's blind art + shared theme (INSERT OR REPLACE, idempotent on a re-create). */
export function saveBattleArt(result: CreateBattleResult): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO arena_battles
        (battle_id, agent_a, agent_b, theme_seed, subject_prose, commit_dur, reveal_dur, images_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      result.battleId,
      result.agentA,
      result.agentB,
      result.theme.seed,
      result.theme.subjectProse,
      result.commitDur,
      result.revealDur,
      JSON.stringify(result.images),
      new Date().toISOString(),
    );
}

/** Read a battle's persisted art + theme, or null if none was journaled (e.g. created on another instance). */
export function getBattleArt(battleId: number): StoredBattleArt | null {
  const row = db()
    .prepare(
      `SELECT battle_id, agent_a, agent_b, theme_seed, subject_prose, commit_dur, reveal_dur, images_json
         FROM arena_battles WHERE battle_id = ?`,
    )
    .get(battleId) as
    | {
        battle_id: number;
        agent_a: number;
        agent_b: number;
        theme_seed: string;
        subject_prose: string;
        commit_dur: number;
        reveal_dur: number;
        images_json: string;
      }
    | undefined;
  if (!row) return null;
  let images: BattleImage[] = [];
  try {
    images = JSON.parse(row.images_json) as BattleImage[];
  } catch {
    images = []; // a corrupt journal degrades to on-chain-only, never throws on the public read
  }
  return {
    battleId: row.battle_id,
    agentA: row.agent_a,
    agentB: row.agent_b,
    theme: { seed: row.theme_seed, subjectProse: row.subject_prose },
    commitDur: row.commit_dur,
    revealDur: row.reveal_dur,
    images,
  };
}
