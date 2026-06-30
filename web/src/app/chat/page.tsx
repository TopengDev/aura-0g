import type { Metadata } from "next";
import { fetchAgents, featuredAgents } from "@/lib/api";
import { ChatView } from "@/components/product/ChatView";

// /chat - the dedicated Chat-with-an-Aura surface (Claude-AI layout: a sidebar of your Auras-as-
// conversations + a full-height chat main area). Server component: fetch the live Aura catalog once
// (the metadata-less test agents are excluded the same way every other surface does it via
// featuredAgents) and hand it to the client view, which owns selection, the per-Aura history detection,
// and the SIWE-gated thread. ?agent=<id> deep-links a preselected Aura (the Aura detail page links here).
// Full-viewport app surface, so no Footer.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chat | AURA",
  description:
    "Talk to AURA's living Auras. Each Aura is in character, grounded in its on-chain identity and your private owner-scoped memory, and every reply served by 0G is hardware-attested in a TEE. One persistent conversation per Aura.",
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[] }>;
}) {
  const { agent } = await searchParams;
  const initialAgentId = Array.isArray(agent) ? agent[0] : agent;

  const agents = featuredAgents(await fetchAgents());

  return <ChatView agents={agents} initialAgentId={initialAgentId} />;
}
