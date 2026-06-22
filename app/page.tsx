// Placeholder home. The retro-future UI is built by a separate worker (/artifex)
// that consumes the typed API contract at notes/aura-backend-build/api-contract.md.
export default function Home() {
  return (
    <main style={{ fontFamily: "ui-monospace, monospace", padding: "3rem", lineHeight: 1.6 }}>
      <h1>AURA</h1>
      <p>Verifiable Creative-Agent Marketplace on 0G — backend API.</p>
      <p>API is server-side under <code>/api/*</code>. UI pending.</p>
    </main>
  );
}
