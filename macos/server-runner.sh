#!/bin/zsh
# The real work of "Lingo Dojo Server.app" (LSUIElement — faceless). Runs the dev
# server with this process as its parent. Since macOS 26.6.2 this script is
# NOT the bundle's executable — a compiled shim (server-shim.c) execs it,
# because tccd stopped attributing TCC to script-executable bundles (the
# process is /bin/zsh, a platform binary: silently denied, no prompt, and
# Full Disk Access rows never match). The shim carries the bundle identity;
# this script keeps the TCC-safe-cwd and blocking-child behavior.
set -uo pipefail
# cd / first AND stay there through login-shell init: a TCC-guarded cwd makes
# every getcwd (shell-init, brew shellenv, npm) explode before the real work
# starts. The cd into the repo happens INSIDE the login shell, after init.
cd /
# build-app.sh substitutes the checkout it was built from. If the placeholder
# is still here, this copy is being run in place from the repo (debugging),
# so derive the repo from this script's own location (macos/..).
REPO="__LINGODOJO_REPO__"
case "$REPO" in __LINGODOJO_*) REPO="${0:A:h:h}";; esac
LOG="$HOME/Library/Logs/LingoDojo.log"
# rotate, don't truncate: the previous run's crash evidence is exactly what
# the failure dialog tells the user to go read — a reflexive relaunch must
# not destroy it
if [ -f "$LOG" ]; then mv -f "$LOG" "$LOG.old"; fi
{
  echo "lingo dojo server starting $(date) (repo $REPO)"
  # a real readdir, not test -r: TCC denial intercepts open/readdir but can
  # let access(2) succeed, and this guard exists precisely for that denial
  if ! ls "$REPO/web" >/dev/null 2>&1; then
    echo "cannot read $REPO — grant Lingo Dojo Server access in System Settings > Privacy & Security > Files and Folders, then relaunch"
    exit 1
  fi
  # `npm --prefix web run dev` from the repo root (the root package.json's
  # `dev` script is the same command): vite's cwd is web/, where
  # vite.config.ts pins port 38400.
  exec /bin/zsh -lc "cd ${(q)REPO} && exec npm --prefix web run dev"
} >> "$LOG" 2>&1 < /dev/null
