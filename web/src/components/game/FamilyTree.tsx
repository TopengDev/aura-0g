"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Chip, Panel } from "@/components/product/primitives";
import { agentPortraitUrl, fetchLineage, type Lineage, type LineageNode } from "@/lib/api";

// ── The real multi-generation dynasty tree ───────────────────────────────────
// For a focal Aura it renders ANCESTRY upward (parents -> grandparents -> ... until a genesis Aura), the
// focal's own generation row (focal + SIBLINGS that share a parent), and DESCENDANTS downward (children ->
// grandchildren -> ...). It walks the indexer's /api/fusion/lineage/:id (parentsOf lives on `lineage`,
// childrenOf == `children`), fetching each node's lineage client-side, bounded by a per-direction depth cap
// and a hard request ceiling so it can never infinite-loop or over-fetch. Nodes are deduped (an Aura is
// drawn once, at its shallowest position) and every node links to its own detail page, which is the
// natural "see more" affordance for anything beyond the rendered depth.
//
// SSR-safe: the FIRST render is derived purely from props (`initialLineage`, provided by the server on the
// agent detail page, or an in-hand seed on the just-fused child). Deeper generations are fetched in an
// effect and appended AFTER hydration, so the server HTML and the first client render match exactly.

const ANCESTOR_DEPTH = 3; // parents, grandparents, great-grandparents
const DESCENDANT_DEPTH = 3; // children, grandchildren, great-grandchildren
const MAX_FETCH = 60; // hard ceiling on lineage requests (loop + over-fetch guard)
const ROW_CAP = 8; // max node cards drawn per generation row (rest collapse to a "+N" chip)

export interface FamilyFocal {
  agentId: number;
  name: string;
  style?: string;
}

type Tone = "focal" | "ancestor" | "descendant" | "sibling";

interface NodeModel {
  agentId: number;
  name: string | null;
  generation: number | null; // null while that node's own lineage row is not yet fetched
  isGenesis: boolean;
  hasMore: boolean; // relations continue past the rendered edge -> click through to that Aura
}

export function FamilyTree({
  focal,
  initialLineage = null,
  title = "Lineage / Dynasty",
  subtitle,
}: {
  focal: FamilyFocal;
  initialLineage?: Lineage | null;
  title?: string;
  subtitle?: string;
}) {
  const focalId = focal.agentId;
  const [cache, setCache] = useState<Record<number, Lineage>>(() =>
    initialLineage ? { [focalId]: initialLineage } : {},
  );
  const [loading, setLoading] = useState<boolean>(!initialLineage);

  // Walk the tree client-side. Re-runs only when the focal changes; the initial `cache` (from props) is the
  // synchronous first paint, so this effect only ever ADDS deeper generations -> no hydration mismatch.
  useEffect(() => {
    let live = true;
    const seed: Record<number, Lineage> = initialLineage ? { [focalId]: initialLineage } : {};
    setCache(seed);
    setLoading(true);

    (async () => {
      const local: Record<number, Lineage> = { ...seed };
      let fetches = 0;
      const ensure = async (id: number): Promise<Lineage | null> => {
        if (local[id]) return local[id];
        if (fetches >= MAX_FETCH) return null;
        fetches++;
        const l = await fetchLineage(id);
        if (l) local[id] = l;
        return l ?? null;
      };
      const commit = () => {
        if (live) setCache({ ...local });
      };

      const focalLin = await ensure(focalId);
      commit();

      // Ancestry: BFS upward via each node's parentA/parentB, bounded by ANCESTOR_DEPTH.
      const seenUp = new Set<number>([focalId]);
      let up: number[] = focalLin?.lineage
        ? [focalLin.lineage.parentA, focalLin.lineage.parentB].filter((x) => x > 0)
        : [];
      for (let depth = 1; depth <= ANCESTOR_DEPTH && up.length && live; depth++) {
        const next: number[] = [];
        for (const id of up) {
          if (seenUp.has(id)) continue;
          seenUp.add(id);
          const l = await ensure(id);
          if (l?.lineage) {
            for (const p of [l.lineage.parentA, l.lineage.parentB]) if (p > 0) next.push(p);
          }
        }
        commit();
        up = [...new Set(next)];
      }

      // Descendants: BFS downward via each node's children rows, bounded by DESCENDANT_DEPTH.
      const seenDown = new Set<number>([focalId]);
      let down: number[] = (focalLin?.children ?? []).map((c) => c.agentId);
      for (let depth = 1; depth <= DESCENDANT_DEPTH && down.length && live; depth++) {
        const next: number[] = [];
        for (const id of down) {
          if (seenDown.has(id)) continue;
          seenDown.add(id);
          const l = await ensure(id);
          if (l) for (const c of l.children) next.push(c.agentId);
        }
        commit();
        down = [...new Set(next)];
      }

      if (live) setLoading(false);
    })();

    return () => {
      live = false;
    };
    // initialLineage is captured at the render that set focalId; keying on focalId alone avoids a refetch
    // loop when a caller passes a freshly-built (new-identity) seed object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focalId]);

  const model = useMemo(() => buildModel(cache, focal), [cache, focal]);

  return (
    <Panel className="p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="label-caps text-[13px] uppercase tracking-[0.12em]"
          style={{ color: "var(--color-accent)" }}
        >
          {title}
        </span>
        <span className="prov-rule h-px flex-1" style={{ opacity: 0.4 }} aria-hidden />
        {model.focal.isGenesis ? (
          <Chip>Genesis</Chip>
        ) : model.focal.generation != null ? (
          <Chip tone="accent">Gen {model.focal.generation}</Chip>
        ) : null}
      </div>
      {subtitle ? (
        <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
          {subtitle}
        </p>
      ) : null}

      {!model.hasAnyData ? (
        loading ? (
          <TreeSkeleton />
        ) : (
          <EmptyLineage focal={focal} />
        )
      ) : (
        <div className="mt-7 flex flex-col items-center overflow-x-auto">
          <div className="flex min-w-min flex-col items-center">
            {/* Ancestry, oldest generation at the top. */}
            {model.ancestorsTruncated ? (
              <p
                className="mb-1 label-caps text-[11px] uppercase tracking-[0.12em]"
                style={{ color: "var(--color-ink-3)" }}
              >
                earlier generations continue
              </p>
            ) : null}
            {model.ancestorLevels
              .slice()
              .reverse()
              .map((lvl, i) => (
                <div key={`anc-${i}`} className="flex flex-col items-center">
                  <RowCaption>{ancestorCaption(model.ancestorLevels.length - i)}</RowCaption>
                  <NodeRow nodes={lvl} tone="ancestor" />
                  <Connector />
                </div>
              ))}

            {/* Focal generation: the focal Aura (accent) + any siblings that share a parent above. */}
            <RowCaption>
              {model.siblings.length > 0 ? "This Aura + siblings" : "This Aura"}
            </RowCaption>
            <NodeRow
              nodes={[model.focal, ...model.siblings]}
              tone="focal"
              focalId={focalId}
              focalName={focal.name}
            />

            {model.genesisSolo ? (
              <p className="mt-3 max-w-[46ch] text-center text-[13px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
                {model.focal.isGenesis
                  ? "Genesis Aura. It begins its own dynasty and has no descendants yet."
                  : "No lineage recorded yet."}
              </p>
            ) : null}

            {/* Descendants, nearest generation first. */}
            {model.descendantLevels.map((lvl, i) => (
              <div key={`desc-${i}`} className="flex flex-col items-center">
                <Connector />
                <RowCaption>{descendantCaption(i + 1)}</RowCaption>
                <NodeRow nodes={lvl} tone="descendant" />
              </div>
            ))}
            {model.descendantsTruncated ? (
              <p
                className="mt-1 label-caps text-[11px] uppercase tracking-[0.12em]"
                style={{ color: "var(--color-ink-3)" }}
              >
                later generations continue
              </p>
            ) : null}
          </div>

          {loading ? (
            <p className="mt-5 text-[12px]" style={{ color: "var(--color-ink-3)" }} aria-live="polite">
              Reading the rest of the dynasty from on-chain lineage...
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

// ── Render model ─────────────────────────────────────────────────────────────
interface TreeModel {
  focal: NodeModel;
  ancestorLevels: NodeModel[][]; // [0] = parents, [1] = grandparents, ... (nearest-first)
  siblings: NodeModel[];
  descendantLevels: NodeModel[][]; // [0] = children, [1] = grandchildren, ... (nearest-first)
  hasAnyData: boolean;
  genesisSolo: boolean; // nothing to draw around the focal (genesis with no kin yet)
  ancestorsTruncated: boolean;
  descendantsTruncated: boolean;
}

function buildModel(cache: Record<number, Lineage>, focal: FamilyFocal): TreeModel {
  // Index every lineage row we hold (each `lineage` and each `children[]` entry is a full LineageNode),
  // plus a best-known-name map that lets an un-fetched parent still render with its name + portrait.
  const info = new Map<number, LineageNode>();
  const nameOf = new Map<number, string>();
  const rows: LineageNode[] = [];
  for (const l of Object.values(cache)) {
    if (l?.lineage) rows.push(l.lineage);
    for (const c of l?.children ?? []) rows.push(c);
  }
  for (const n of rows) {
    info.set(n.agentId, n);
    if (n.name) nameOf.set(n.agentId, n.name);
  }
  for (const n of rows) {
    if (n.parentA > 0 && n.parentAName && !nameOf.has(n.parentA)) nameOf.set(n.parentA, n.parentAName);
    if (n.parentB > 0 && n.parentBName && !nameOf.has(n.parentB)) nameOf.set(n.parentB, n.parentBName);
  }
  // The focal is also seeded from its caller-supplied name so it renders before any fetch resolves.
  if (!nameOf.has(focal.agentId)) nameOf.set(focal.agentId, focal.name);

  const toNode = (id: number, hasMore: boolean): NodeModel => {
    const row = info.get(id);
    return {
      agentId: id,
      name: nameOf.get(id) ?? row?.name ?? null,
      generation: row ? row.generation : null,
      isGenesis: row?.isGenesis ?? false,
      hasMore,
    };
  };
  const childIdsOf = (id: number): number[] => (cache[id]?.children ?? []).map((c) => c.agentId);
  const parentIdsOf = (id: number): number[] => {
    const row = info.get(id);
    return row ? [row.parentA, row.parentB].filter((x) => x > 0) : [];
  };

  const focalRow = info.get(focal.agentId) ?? null;

  // Ancestors (upward BFS, deduped, capped).
  const ancestorLevels: NodeModel[][] = [];
  let ancestorsTruncated = false;
  {
    const used = new Set<number>([focal.agentId]);
    let frontier = focalRow ? parentIdsOf(focal.agentId) : [];
    for (let d = 0; d < ANCESTOR_DEPTH && frontier.length; d++) {
      const level: NodeModel[] = [];
      const next: number[] = [];
      const willExpand = d + 1 < ANCESTOR_DEPTH;
      for (const id of frontier) {
        if (used.has(id)) continue;
        used.add(id);
        const fetched = info.has(id);
        const parents = parentIdsOf(id);
        const moreAbove = (!fetched && !nameOf.has(id)) || (parents.length > 0 && !willExpand);
        if (parents.length > 0 && !willExpand) ancestorsTruncated = true;
        if (!fetched) ancestorsTruncated = ancestorsTruncated || false; // unknown; resolved once fetched
        level.push(toNode(id, moreAbove));
        if (willExpand) next.push(...parents);
      }
      if (level.length) ancestorLevels.push(level);
      frontier = [...new Set(next)];
    }
  }

  // Siblings: the other children of the focal's parents (deduped, focal removed).
  const siblingIds = new Set<number>();
  for (const pid of parentIdsOf(focal.agentId)) {
    for (const id of childIdsOf(pid)) if (id !== focal.agentId) siblingIds.add(id);
  }
  const siblings = [...siblingIds].map((id) => toNode(id, false));

  // Descendants (downward BFS, deduped, capped).
  const descendantLevels: NodeModel[][] = [];
  let descendantsTruncated = false;
  {
    const used = new Set<number>([focal.agentId]);
    let frontier = childIdsOf(focal.agentId);
    for (let d = 0; d < DESCENDANT_DEPTH && frontier.length; d++) {
      const level: NodeModel[] = [];
      const next: number[] = [];
      const willExpand = d + 1 < DESCENDANT_DEPTH;
      for (const id of frontier) {
        if (used.has(id)) continue;
        used.add(id);
        const fetched = !!cache[id];
        const kids = childIdsOf(id);
        const moreBelow = (!fetched) || (kids.length > 0 && !willExpand);
        if (kids.length > 0 && !willExpand) descendantsTruncated = true;
        level.push(toNode(id, moreBelow));
        if (willExpand) next.push(...kids);
      }
      if (level.length) descendantLevels.push(level);
      frontier = [...new Set(next)];
    }
  }

  const hasAnyData = !!focalRow || descendantLevels.length > 0;
  const genesisSolo =
    hasAnyData && ancestorLevels.length === 0 && siblings.length === 0 && descendantLevels.length === 0;

  return {
    focal: toNode(focal.agentId, false),
    ancestorLevels,
    siblings,
    descendantLevels,
    hasAnyData,
    genesisSolo,
    ancestorsTruncated,
    descendantsTruncated,
  };
}

function ancestorCaption(genUp: number): string {
  if (genUp === 1) return "Parents";
  if (genUp === 2) return "Grandparents";
  return "Ancestors";
}
function descendantCaption(genDown: number): string {
  if (genDown === 1) return "Children";
  if (genDown === 2) return "Grandchildren";
  return "Descendants";
}

// ── Pieces ───────────────────────────────────────────────────────────────────
function NodeRow({
  nodes,
  tone,
  focalId,
  focalName,
}: {
  nodes: NodeModel[];
  tone: Tone;
  focalId?: number;
  focalName?: string;
}) {
  const shown = nodes.slice(0, ROW_CAP);
  const overflow = nodes.length - shown.length;
  return (
    <div className="flex flex-wrap items-start justify-center gap-4 sm:gap-6">
      {shown.map((n) => {
        const isFocal = focalId != null && n.agentId === focalId;
        return (
          <NodeCard
            key={n.agentId}
            node={n}
            tone={isFocal ? "focal" : tone === "focal" ? "sibling" : tone}
            label={isFocal ? focalName : undefined}
          />
        );
      })}
      {overflow > 0 ? (
        <div className="flex min-h-[120px] items-center">
          <Chip>+{overflow} more</Chip>
        </div>
      ) : null}
    </div>
  );
}

function NodeCard({ node, tone, label }: { node: NodeModel; tone: Tone; label?: string }) {
  const accent = tone === "focal";
  const displayName = label ?? node.name ?? `Aura #${node.agentId}`;
  // style only feeds the portrait route's cosmetic ?style= param; the real portrait resolves by agentId
  // (agent-<id>) or catalog name, so a constant is correct for a lineage node (which carries no style).
  const portrait = agentPortraitUrl(
    { agentId: node.agentId, name: node.name ?? displayName, style: "custom" },
    128,
  );
  return (
    <Link
      href={`/agents/${node.agentId}`}
      aria-label={`${displayName} #${node.agentId}`}
      className="micro block rounded-[16px] active:scale-[0.985]"
    >
      <div
        className="flex min-w-[118px] max-w-[136px] flex-col items-center rounded-[16px] border p-3"
        style={{
          borderColor: accent ? "var(--color-accent)" : "var(--color-border-strong)",
          background: accent
            ? "color-mix(in oklab, var(--color-accent) 8%, var(--color-paper))"
            : "var(--color-paper)",
          boxShadow: accent ? "0 0 0 2px color-mix(in oklab, var(--color-accent) 30%, transparent)" : "none",
        }}
      >
        <div
          className="relative h-16 w-16 overflow-hidden rounded-[12px]"
          style={{ background: "var(--color-cream-deep)" }}
        >
          <Image
            src={portrait}
            alt={displayName}
            fill
            sizes="64px"
            className="object-cover"
            unoptimized
          />
        </div>
        <div className="mt-2 max-w-[118px] truncate font-display text-[15px]" style={{ color: "var(--color-ink)" }}>
          {displayName}
        </div>
        <div className="font-mono-x tabular-nums text-[12px]" style={{ color: "var(--color-ink-3)" }}>
          #{node.agentId}
          {node.generation != null ? ` · Gen ${node.generation}` : ""}
        </div>
        {node.isGenesis ? (
          <span
            className="mt-1 label-caps text-[10px] uppercase tracking-[0.1em]"
            style={{ color: "var(--color-ink-3)" }}
          >
            Genesis
          </span>
        ) : node.hasMore ? (
          <span
            className="mt-1 label-caps text-[10px] uppercase tracking-[0.1em]"
            style={{ color: "var(--color-accent)" }}
          >
            more -&gt;
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function Connector() {
  return <div className="my-2 h-6 w-px" style={{ background: "var(--color-border-strong)" }} aria-hidden />;
}

function RowCaption({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2 label-caps text-[11px] uppercase tracking-[0.14em]"
      style={{ color: "var(--color-ink-3)" }}
    >
      {children}
    </div>
  );
}

function EmptyLineage({ focal }: { focal: FamilyFocal }) {
  return (
    <div
      className="mt-6 rounded-[16px] border p-6 text-center"
      style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}
    >
      <p className="mx-auto max-w-[48ch] text-[15px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        No fusion lineage yet. Fuse {focal.name} with another Aura you own to begin its dynasty.
      </p>
      <div className="mt-4 flex justify-center">
        <Link
          href={`/fuse?a=${focal.agentId}`}
          className="label-caps text-[13px] uppercase tracking-[0.12em] hover:underline"
          style={{ color: "var(--color-accent)" }}
        >
          Fuse {focal.name} -&gt;
        </Link>
      </div>
    </div>
  );
}

function TreeSkeleton() {
  return (
    <div className="mt-7 flex flex-col items-center gap-3">
      <div className="aura-skeleton h-[120px] w-[128px] rounded-[16px]" />
      <div className="h-6 w-px" style={{ background: "var(--color-border-strong)" }} />
      <div className="flex gap-5">
        <div className="aura-skeleton h-[120px] w-[128px] rounded-[16px]" />
        <div className="aura-skeleton h-[120px] w-[128px] rounded-[16px]" />
      </div>
    </div>
  );
}
