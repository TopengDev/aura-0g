"use client";

// Last-resort boundary: catches a throw in the ROOT layout itself, where error.tsx cannot render because
// it lives inside that layout. It must supply its own <html>/<body> and cannot rely on the app providers,
// fonts, or globals, so it is deliberately self-contained with inline styles in the warm palette.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f9f8f6",
          color: "#0e0d0a",
          fontFamily: "'Helvetica Neue', Arial, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "36rem", textAlign: "center" }}>
          <p style={{ textTransform: "uppercase", letterSpacing: "0.16em", fontSize: 13, fontWeight: 600, color: "#736f65", margin: 0 }}>
            Something broke
          </p>
          <h1 style={{ fontSize: "clamp(28px, 6vw, 48px)", lineHeight: 1.05, margin: "16px 0 0" }}>
            An unexpected error.
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: "#46443d", margin: "16px auto 0", maxWidth: "44ch" }}>
            AURA hit an error it could not recover from on this page. Try again, or reload.
          </p>
          {error?.digest ? (
            <p style={{ fontFamily: "monospace", fontSize: 14, color: "#736f65", marginTop: 16 }}>ref {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 28,
              cursor: "pointer",
              borderRadius: 9999,
              border: "1px solid #0e0d0a",
              background: "#0e0d0a",
              color: "#f9f8f6",
              padding: "12px 24px",
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
