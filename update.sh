#!/usr/bin/env bash
# Commit everything and push.
# Usage: ./update.sh                  commits with the message "update"
#        ./update.sh "add fox dance"  commits with your own message
set -euo pipefail

# Work from the repo root, wherever the script is run from.
cd "$(dirname "$0")"

git add -A

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "${1:-update}"
fi

git push
