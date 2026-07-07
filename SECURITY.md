# Security

## Dependency advisories

### `fast-jwt` (via `@fastify/jwt`) — present but unreachable as configured

`npm audit` flags `@fastify/jwt@9.1.0` / `fast-jwt@5.0.6` as **critical**. We have **not** bumped it: the fix is a
semver-major of the auth dependency, and none of the flagged code paths are reachable in AURA's configuration.

AURA registers the plugin with a **static HS256 secret only**:

```ts
await app.register(jwt, { secret: JWT_SECRET }); // server/src/app.ts
```

There is no async key resolver, no verify cache, no `allowed*` option, and no RSA/asymmetric key. Every advisory
in the current `fast-jwt` set depends on one of those, so each is unreachable here:

| Advisory | Requires | AURA config | Reachable? |
|---|---|---|---|
| Auth bypass via empty HMAC secret accepted by **async key resolver** | an async `secret`/key resolver function | static string secret; and `resolveJwtSecret` refuses an empty/weak/short secret in production (fail-closed) | No |
| **Cache confusion** via `cacheKeyBuilder` collisions | the verify **cache** enabled | no cache configured | No |
| **ReDoS** using RegExp in `allowed*` | an `allowedIss`/`allowedAud`/`allowedSub` **RegExp** | no `allowed*` options set | No |
| **Stateful RegExp** (`/g`/`/y`) in allowed-claim validation | an `allowed*` **RegExp** | no `allowed*` options set | No |
| Algorithm confusion via **whitespace-prefixed RSA public key** (incomplete CVE-2023-48223 fix) | an **RSA/asymmetric** verifying key | symmetric HS256 only | No |
| Accepts unknown `crit` header extensions (RFC 7515) | a token an attacker can shape | tokens are issued and verified by this server with the same secret; without the secret no valid signature can be forged, so the `crit` quirk grants no bypass | No |

The one-line reason: **AURA uses a static, non-empty HS256 `{ secret }` — no async resolver, no cache, no `allowed*`
RegExp, no RSA key — so every flagged path is unreachable.** When a stable `@fastify/jwt` release ships the fixed
`fast-jwt`, we will upgrade; until then this is a monitored, non-exploitable advisory.

## Reporting

Found a real issue? Open a private report to the maintainer rather than a public issue.
