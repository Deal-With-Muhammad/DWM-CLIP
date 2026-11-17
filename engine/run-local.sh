#!/bin/sh
# Starts the clip engine on this computer, with the same ENGINE_SECRET as the website (../.dev.vars).
cd "$(dirname "$0")" || exit 1
export ENGINE_SECRET="$(grep '^ENGINE_SECRET=' ../.dev.vars | cut -d= -f2-)"
export PORT="${PORT:-8080}"
exec ./.venv/bin/python server.py
