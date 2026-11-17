#!/bin/sh
# Container entrypoint for the THROTTLEIN API image.
#
# /app/uploads and /app/private-uploads are host volumes. Make sure they
# exist and that the tracked seed assets (helmet-type-*.png, referenced
# by seeded DB records) are present in the mounted uploads directory —
# the volume hides the copy that was baked into the image.
set -eu

mkdir -p /app/uploads /app/private-uploads 2>/dev/null || true

if [ -d /app/seed-uploads ]; then
  for f in /app/seed-uploads/*; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    [ -e "/app/uploads/$name" ] || cp "$f" "/app/uploads/$name" 2>/dev/null || \
      echo "warn: could not seed /app/uploads/$name (check volume permissions)" >&2
  done
fi

# dist/ is compiled from src/ at image build; source maps keep stack traces
# pointing at src/ files and lines.
exec node --enable-source-maps dist/index.js
