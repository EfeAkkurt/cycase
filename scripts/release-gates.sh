#!/usr/bin/env bash
#
# Runs the release gate matrix against the current commit and preserves the
# whole of it.
#
# The previous evidence set was produced by hand, one command at a time, each
# piped through `tail`. That is how a run reporting "2 failed / 124 passed"
# was read as three lines of green: Playwright puts the failure count four
# lines from the end. Nothing here truncates anything and every exit code is
# written down.
#
#   bash scripts/release-gates.sh                 # into docs/release/<today>/gates
#   bash scripts/release-gates.sh <output-dir>
#
# The script refuses to run on a dirty tree. Evidence that does not correspond
# to a commit cannot be checked by anyone later, which is the whole point of
# recording an RC_SHA.
#
# Exit status is the number of failed gates, so CI or a caller can branch on it.

set -u
set -o pipefail

OUT="${1:-docs/release/$(date +%Y-%m-%d)/gates}"
mkdir -p "$OUT"

# ---------------------------------------------------------------- identity --

RC_SHA="$(git rev-parse HEAD)"
RC_SHORT="$(git rev-parse --short HEAD)"
DIRTY="$(git status --porcelain)"

{
  echo "RC_SHA:            $RC_SHA"
  echo "RC_SHA (short):    $RC_SHORT"
  echo "branch:            $(git rev-parse --abbrev-ref HEAD)"
  echo "committed:         $(git log -1 --format=%cI)"
  echo "subject:           $(git log -1 --format=%s)"
  echo ""
  if [ -z "$DIRTY" ]; then
    echo "working tree:      CLEAN"
  else
    echo "working tree:      DIRTY -- this evidence does not correspond to a commit"
    echo "$DIRTY"
  fi
  echo ""
  echo "node:              $(node -v)"
  echo "npm:               $(npm -v)"
  echo "os:                $(uname -s) $(uname -r) ($(uname -m))"
  if command -v sw_vers >/dev/null 2>&1; then
    echo "macOS:             $(sw_vers -productVersion)"
  fi
  echo ""
  # Two different browsers matter here and they are routinely confused. The
  # `desktop`/`desktop-3d`/`reduced-motion` projects drive Playwright's bundled
  # Chromium; the `native-webmcp` project drives the Chrome the user has
  # installed, because that is the only build with a real document.modelContext.
  echo "Playwright:        $(npx playwright --version 2>/dev/null)"
  CHROME_APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [ -x "$CHROME_APP" ]; then
    echo "installed Chrome:  $("$CHROME_APP" --version 2>/dev/null)"
  else
    echo "installed Chrome:  NOT FOUND at $CHROME_APP"
  fi
} | tee "$OUT/00-identity.txt"

if [ -n "$DIRTY" ]; then
  echo ""
  echo "REFUSING: the working tree is dirty. Commit first, then rerun." >&2
  exit 125
fi

# ------------------------------------------------------------------- gates --

# `npm ci` is first because a gate matrix that does not start from the lockfile
# proves nothing about a fresh clone.
GATES=(
  "01-npm-ci|npm ci"
  "02-typecheck|npm run typecheck"
  "03-lint|npm run lint"
  "04-unit|npm test -- --run"
  "05-backend|npm run test:backend"
  "06-integration|npm run test:integration"
  "07-e2e|npm run test:e2e -- --workers=2 --reporter=list"
  "08-3d|npm run test:3d -- --reporter=list"
  "09-webmcp-native|npm run test:webmcp:native -- --reporter=list"
  "10-secrets|npm run check:secrets"
  "11-licenses|npm run check:licenses"
  "12-links|npm run check:links"
  "13-build|npm run build"
)

FAILED=0
SUMMARY="$OUT/SUMMARY.txt"
: > "$SUMMARY"

{
  echo "Release gate matrix"
  echo "RC_SHA $RC_SHA"
  echo ""
} >> "$SUMMARY"

for entry in "${GATES[@]}"; do
  name="${entry%%|*}"
  cmd="${entry#*|}"
  log="$OUT/$name.log"

  echo ""
  echo "=== $name: $cmd"

  {
    echo "\$ $cmd"
    echo "# rc_sha $RC_SHA"
    echo ""
  } > "$log"

  # Browser suites share one port. A server left behind by a previous run is
  # answered by Playwright's webServer check and the whole suite then tests a
  # stale build -- which has happened, and looked like six product regressions.
  case "$name" in
    07-e2e|08-3d|09-webmcp-native) node scripts/free-test-port.mjs >> "$log" 2>&1 ;;
  esac

  # No pipe to tail, no head, no grep. The complete stream is kept, and the
  # exit code is the command's own rather than tee's.
  eval "$cmd" >> "$log" 2>&1
  code=$?

  echo "" >> "$log"
  echo "# exit $code" >> "$log"

  if [ "$code" -eq 0 ]; then
    printf '%-20s PASS  (exit 0)  %s\n' "$name" "$cmd" | tee -a "$SUMMARY"
  else
    FAILED=$((FAILED + 1))
    printf '%-20s FAIL  (exit %d)  %s\n' "$name" "$code" "$cmd" | tee -a "$SUMMARY"
  fi
done

# Playwright reports skips separately from passes and a skip is not a pass;
# surface every one so the index has to account for it.
{
  echo ""
  echo "Skipped tests reported by the browser projects:"
  grep -hE "^\s+[0-9]+ skipped|skipped$" "$OUT"/07-e2e.log "$OUT"/08-3d.log "$OUT"/09-webmcp-native.log 2>/dev/null |
    sed 's/^/  /' | sort -u
  echo ""
  if [ "$FAILED" -eq 0 ]; then
    echo "RESULT: all ${#GATES[@]} gates passed on $RC_SHORT"
  else
    echo "RESULT: $FAILED of ${#GATES[@]} gates FAILED on $RC_SHORT"
  fi
} | tee -a "$SUMMARY"

exit "$FAILED"
