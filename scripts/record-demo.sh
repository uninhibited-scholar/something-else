#!/usr/bin/env bash
# Record the demo as an animated SVG for the README — no external account needed.
#
#   ./scripts/record-demo.sh                 # records `npm run demo:openclaw`
#   ./scripts/record-demo.sh demo            # records `npm run demo` instead
#
# Output: assets/demo.svg  (commit it and reference from the README).
#
# Requires: asciinema + svg-term-cli
#   brew install asciinema            # or: pipx install asciinema
#   npm install -g svg-term-cli
#
# If you'd rather host on asciinema.org, run `asciinema rec` then `asciinema upload`.

set -euo pipefail
cd "$(dirname "$0")/.."

WHICH="${1:-demo:openclaw}"
mkdir -p assets
CAST="$(mktemp -t something-else-demo.XXXX).cast"

echo "▶ recording: npm run ${WHICH}"
if ! command -v asciinema >/dev/null 2>&1; then
  echo "✗ asciinema not found. Install it: brew install asciinema" >&2
  exit 1
fi
if ! command -v svg-term >/dev/null 2>&1; then
  echo "✗ svg-term not found. Install it: npm install -g svg-term-cli" >&2
  exit 1
fi

# -c runs the command directly; --overwrite so reruns are clean.
asciinema rec --overwrite -c "npm run ${WHICH}" "$CAST"

echo "▶ converting to assets/demo.svg"
svg-term --in "$CAST" --out assets/demo.svg --window --padding 16 --width 86

rm -f "$CAST"
echo "✓ wrote assets/demo.svg"
echo "  Add to README:  ![demo](assets/demo.svg)"
