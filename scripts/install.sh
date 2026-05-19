#!/bin/bash
set -e

# Personal Assistant - VPS Install/Update Script
# Usage: curl -fsSL https://raw.githubusercontent.com/ibrahimmansour/personal-assistant/main/scripts/install.sh | bash

REPO="ibrahimmansour/personal-assistant"
INSTALL_DIR="$HOME/.personal-assistant/bin"

echo ""
echo "==> Installing Personal Assistant..."

# Check node
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required."
  echo "  Install: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt-get install -y nodejs"
  exit 1
fi

# Ensure build tools for node-pty
if ! command -v make &>/dev/null; then
  echo "==> Installing build-essential..."
  sudo apt-get install -y build-essential python3 2>/dev/null || true
fi

# Get latest release tag
LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
if [ -z "$LATEST" ]; then
  echo "ERROR: Could not find latest release."
  exit 1
fi
echo "    Latest release: $LATEST"

# Download and extract
mkdir -p "$INSTALL_DIR"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST/personal-assistant-linux-x64.tar.gz"
echo "==> Downloading..."
curl -fsSL "$DOWNLOAD_URL" | tar -xz -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/personal-assistant"

# Install node-pty
echo "==> Installing PTY dependencies..."
cd "$INSTALL_DIR"
npm install --omit=dev 2>&1 | tail -3

echo ""
echo "==> Installation complete!"
echo ""
echo "    Start:   ~/.personal-assistant/bin/personal-assistant"
echo "    (runs on port 4444, PTY on 4445)"
echo ""
echo "    To run in background:"
echo "      nohup ~/.personal-assistant/bin/personal-assistant > ~/.personal-assistant/app.log 2>&1 &"
echo ""
echo "    To stop:"
echo "      pkill -f personal-assistant"
echo ""
echo "    Configure at: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'your-ip'):4444 → Settings (gear icon)"
echo ""
