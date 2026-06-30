#!/bin/sh
# AURA CLI installer - works on any POSIX shell (sh/bash/zsh) on macOS + Linux.
#   curl -fsSL https://aura.topengdev.com/install.sh | sh
# Detects your OS + arch, downloads the matching single static binary (no Node/runtime needed), verifies
# its checksum, and drops `aura` on your PATH. Override the source with AURA_INSTALL_BASE, the install dir
# with AURA_INSTALL_DIR. Windows: see the PowerShell one-liner in the README (or use `npx @aura/cli`).
set -eu

BASE="${AURA_INSTALL_BASE:-https://aura.topengdev.com}"
BIN_NAME="aura"

say()  { printf '%s\n' "$*"; }
info() { printf '\033[36m=>\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
die()  { printf '\033[31merror\033[0m %s\n' "$*" >&2; exit 1; }

# ── detect OS + arch -> the published binary label ─────────────────────────────────────────────────────
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux)  OS=linux ;;
  Darwin) OS=darwin ;;
  MINGW*|MSYS*|CYGWIN*) die "Windows detected. Use the PowerShell installer or 'npx @aura/cli' (see README)." ;;
  *) die "unsupported OS: $os" ;;
esac
case "$arch" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) die "unsupported arch: $arch" ;;
esac
LABEL="${OS}-${ARCH}"
ASSET="aura-${LABEL}.gz"
info "platform: ${OS}/${ARCH}  ->  ${ASSET}"

# ── pick a downloader ──────────────────────────────────────────────────────────────────────────────────
if command -v curl >/dev/null 2>&1; then
  dl() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  dl() { wget -qO "$2" "$1"; }
else
  die "need curl or wget to download"
fi

# ── choose an install dir on PATH (no sudo if we can avoid it) ──────────────────────────────────────────
if [ -n "${AURA_INSTALL_DIR:-}" ]; then
  DEST="$AURA_INSTALL_DIR"
elif [ -d "$HOME/.local/bin" ] || mkdir -p "$HOME/.local/bin" 2>/dev/null; then
  DEST="$HOME/.local/bin"
elif [ -w "/usr/local/bin" ]; then
  DEST="/usr/local/bin"
else
  DEST="$HOME/.local/bin"; mkdir -p "$DEST"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

info "downloading ${BASE}/${ASSET}"
dl "${BASE}/${ASSET}" "${TMP}/${ASSET}" || die "download failed: ${BASE}/${ASSET}"

# ── verify checksum (best-effort: skip cleanly if SHA256SUMS or a sha tool is absent) ──────────────────
if dl "${BASE}/SHA256SUMS" "${TMP}/SHA256SUMS" 2>/dev/null; then
  want="$(grep " ${ASSET}\$" "${TMP}/SHA256SUMS" 2>/dev/null | awk '{print $1}' || true)"
  if [ -n "$want" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      got="$(sha256sum "${TMP}/${ASSET}" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
      got="$(shasum -a 256 "${TMP}/${ASSET}" | awk '{print $1}')"
    else
      got=""
    fi
    if [ -n "$got" ]; then
      [ "$got" = "$want" ] && ok "checksum verified" || die "checksum MISMATCH (want $want, got $got)"
    fi
  fi
fi

# ── gunzip -> chmod -> place ───────────────────────────────────────────────────────────────────────────
gunzip -c "${TMP}/${ASSET}" > "${TMP}/${BIN_NAME}" || die "gunzip failed"
chmod +x "${TMP}/${BIN_NAME}"

if mv "${TMP}/${BIN_NAME}" "${DEST}/${BIN_NAME}" 2>/dev/null; then
  :
elif command -v sudo >/dev/null 2>&1; then
  info "writing to ${DEST} needs sudo"
  sudo mv "${TMP}/${BIN_NAME}" "${DEST}/${BIN_NAME}"
else
  die "cannot write to ${DEST} (set AURA_INSTALL_DIR to a writable dir)"
fi
ok "installed ${BIN_NAME} -> ${DEST}/${BIN_NAME}"

# ── PATH hint ──────────────────────────────────────────────────────────────────────────────────────────
case ":${PATH}:" in
  *":${DEST}:"*) ;;
  *)
    say ""
    info "add ${DEST} to your PATH:"
    say "    echo 'export PATH=\"${DEST}:\$PATH\"' >> ~/.profile  &&  . ~/.profile"
    ;;
esac

say ""
ok "try it:  aura explore   |   aura verify 23"
