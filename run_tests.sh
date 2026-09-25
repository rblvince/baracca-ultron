#!/bin/bash
# Tutti i controlli della Baracca in un colpo: hook e server (Python, stdlib),
# blocchi puri della pagina (Node) e pannelli React (vitest + tsc, solo se
# panels/node_modules c'è: cd panels && npm install).
# Esce con 1 se anche un solo controllo fallisce, ma li lancia tutti.
cd "$(dirname "$0")" || exit 1
fail=0
run() {
  local out
  if out=$("$@" 2>&1); then
    echo "ok    $*"
  else
    echo "ROTTO $*"; echo "$out" | sed 's/^/      /'; fail=1
  fi
}

for t in hooks/test_*.py; do run python3 "$t"; done
run python3 test_server.py
run node test_dash.mjs
run node test_aux.mjs
run node test_lavoro.mjs
if [ -d panels/node_modules ]; then
  run npm --prefix panels test
  run npm --prefix panels run typecheck
else
  echo "salto panels: manca panels/node_modules (cd panels && npm install)"
fi
exit $fail
