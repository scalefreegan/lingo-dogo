#!/bin/zsh
# Rasterize icon.svg -> icon-1024.png (1024x1024, alpha preserved). sips can
# read SVG directly on this macOS, so no Pillow, browser or librsvg is needed.
# Re-run after editing icon.svg, then ./build-app.sh to rebuild the .icns.
set -euo pipefail
cd "$(dirname "$0")"
sips -s format png icon.svg --out icon-1024.png >/dev/null
sips -g pixelWidth -g pixelHeight -g hasAlpha icon-1024.png
