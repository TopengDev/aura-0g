# AURA CLI - Deploy Plan (GATED)

**Status: NOT executed. Main + Christopher gate this.** This documents exactly how to host the per-OS binaries + installers on the AURA domain so `curl -fsSL https://aura.topengdev.com/install.sh | sh` works. Nothing here touches the live web/API containers' behavior - it only adds static-file routes in front of them.

## What gets hosted

From `cli/dist/` after `bun run build`:
- `install.sh`, `install.ps1` (from `cli/`)
- `aura-linux-x64.gz`, `aura-linux-arm64.gz`, `aura-darwin-x64.gz`, `aura-darwin-arm64.gz`, `aura-windows-x64.exe.gz`
- `SHA256SUMS`

`install.sh` defaults `BASE=https://aura.topengdev.com` and fetches `<BASE>/aura-<os>-<arch>.gz` + `<BASE>/SHA256SUMS`, so all assets sit at the domain root.

## Option A (recommended): static routes on the existing host nginx

The VPS already terminates TLS (certbot) and proxies `aura.topengdev.com` → the web container. Add **explicit static locations** that win over the proxy for the installer paths only; everything else still proxies to the web app untouched.

1. Stage the files (read-only to nginx):
   ```sh
   sudo mkdir -p /var/www/aura-cli
   sudo rsync -av cli/install.sh cli/install.ps1 \
     cli/dist/SHA256SUMS cli/dist/aura-*.gz /var/www/aura-cli/
   sudo chown -R www-data:www-data /var/www/aura-cli
   ```
2. In the `server { server_name aura.topengdev.com; ... }` block, **above** the `location / { proxy_pass ... }`, add:
   ```nginx
   location = /install.sh   { root /var/www/aura-cli; default_type text/x-shellscript; }
   location = /install.ps1  { root /var/www/aura-cli; default_type text/plain; }
   location = /SHA256SUMS   { root /var/www/aura-cli; default_type text/plain; }
   location ~ ^/aura-(linux|darwin|windows)-(x64|arm64)(\.exe)?\.gz$ {
       root /var/www/aura-cli;
       default_type application/gzip;
       add_header Content-Disposition "attachment";
   }
   ```
3. `sudo nginx -t && sudo systemctl reload nginx`
4. Verify (no disruption to the app, which still serves `/`):
   ```sh
   curl -fsSI https://aura.topengdev.com/install.sh        # 200, shell script
   curl -fsSI https://aura.topengdev.com/aura-linux-x64.gz # 200, application/gzip
   curl -fsSL https://aura.topengdev.com/install.sh | sh   # full e2e on a clean box
   ```

**Rollback:** remove the four `location` blocks + `reload nginx`; delete `/var/www/aura-cli`. The web app is never modified, so rollback is zero-risk.

## Option B: GitHub Releases (zero VPS change)

Attach the `.gz` + `SHA256SUMS` to a `gh release`, host `install.sh` with `AURA_INSTALL_BASE` pointed at the release's asset base (or commit the script and curl it raw). Good as a fallback / mirror; the domain one-liner (Option A) is the jury-facing story.

## npx path (publish `@aura/cli`)

```sh
cd cli && bun run build        # produces dist/index.js (node bundle, already shebang'd)
npm publish --access public    # @aura/cli  -> npx @aura/cli verify 23
```
`package.json` ships only `dist/index.js` + `README.md` (the `files` allowlist), so the npm tarball is ~0.5MB - it does NOT carry the 60-110MB binaries.

## Gates / cautions

- **GATED**: do not run any of this without main + Christopher's go.
- Rebuild the matrix immediately before deploy so `SHA256SUMS` matches the shipped bytes (checksums are over the exact gz served).
- Serving large `.gz` (22-41MB) from the VPS adds bandwidth; acceptable for a demo. CDN/Releases mirror if it ever gets real traffic.
- TLS already covers `aura.topengdev.com` (certbot) - no new cert needed.
- Do not point `install.sh`'s default BASE at the API subdomain; assets live on the web domain root.
