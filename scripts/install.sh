#!/bin/bash
set -e

# Personal Assistant - VPS Install/Update Script
# Usage: curl -fsSL https://raw.githubusercontent.com/ibrahimmansour/personal-assistant/main/scripts/install.sh | bash

REPO="ibrahimmansour/personal-assistant"
INSTALL_DIR="$HOME/.personal-assistant/bin"
SERVICE_NAME="personal-assistant"

echo "==> Installing Personal Assistant..."

# Get latest release tag
LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
if [ -z "$LATEST" ]; then
  echo "ERROR: Could not find latest release. Make sure you've created a release (git tag v0.1.0 && git push --tags)"
  exit 1
fi
echo "    Latest release: $LATEST"

# Download
mkdir -p "$INSTALL_DIR"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST/personal-assistant-linux-x64.tar.gz"
echo "==> Downloading $DOWNLOAD_URL..."
curl -fsSL "$DOWNLOAD_URL" | tar -xz -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/personal-assistant"

echo "==> Binary installed to $INSTALL_DIR/personal-assistant"

# Create systemd service
SYSTEMD_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_DIR"

cat > "$SYSTEMD_DIR/$SERVICE_NAME.service" << EOF
[Unit]
Description=Personal Assistant Dashboard
After=network.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/personal-assistant
WorkingDirectory=$INSTALL_DIR
Restart=on-failure
RestartSec=5
Environment=PORT=4444
Environment=PTY_PORT=4445
Environment=NODE_TLS_REJECT_UNAUTHORIZED=0

[Install]
WantedBy=default.target
EOF

# Enable and start
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

echo ""
echo "==> Done! Personal Assistant is running on port 4444"
echo ""
echo "    Manage with:"
echo "      systemctl --user status personal-assistant"
echo "      systemctl --user restart personal-assistant"
echo "      journalctl --user -u personal-assistant -f"
echo ""
echo "    Configure at: http://$(hostname -I | awk '{print $1}'):4444 → Settings (gear icon)"
echo ""
