#!/bin/bash
# Build extension for Chrome Web Store submission

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
STORE_DIR="$PROJECT_DIR/store"
RELEASES_DIR="$PROJECT_DIR/releases"

echo "Building Clawku Browser Extension for Chrome Web Store..."

# Build the extension
cd "$PROJECT_DIR"
pnpm build

# Create releases directory if it doesn't exist
mkdir -p "$RELEASES_DIR"

# Get version from manifest
VERSION=$(grep '"version"' public/manifest.json | sed 's/.*: "\(.*\)".*/\1/')
echo "Version: $VERSION"

# Create store-ready ZIP (without source maps for smaller size)
cd dist
ZIP_NAME="clawku-extension-v${VERSION}-store.zip"
zip -r "../releases/$ZIP_NAME" . -x "*.map"

echo ""
echo "Store-ready package created: releases/$ZIP_NAME"
echo ""
echo "Next steps:"
echo "1. Go to https://chrome.google.com/webstore/devconsole"
echo "2. Click 'New Item'"
echo "3. Upload releases/$ZIP_NAME"
echo "4. Fill in store listing from store/STORE_LISTING.md"
echo "5. Upload screenshots (see store/SCREENSHOTS_GUIDE.md)"
echo "6. Submit for review"
echo ""
