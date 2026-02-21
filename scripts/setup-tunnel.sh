#!/bin/bash
# CCC Cloudflare Tunnel Setup
# Run this script once to set up the tunnel

set -e

echo "=== CCC Cloudflare Tunnel Setup ==="
echo ""

# Step 1: Login to Cloudflare (opens browser)
if [ ! -f ~/.cloudflared/cert.pem ]; then
  echo "Step 1: Authenticating with Cloudflare..."
  echo "This will open a browser window. Select the ideaplaces.com zone."
  cloudflared tunnel login
else
  echo "Step 1: Already authenticated."
fi

# Step 2: Create the tunnel
echo ""
echo "Step 2: Creating tunnel 'ccc'..."
if cloudflared tunnel list | grep -q "ccc"; then
  echo "Tunnel 'ccc' already exists."
  TUNNEL_ID=$(cloudflared tunnel list | grep "ccc" | awk '{print $1}')
else
  cloudflared tunnel create ccc
  TUNNEL_ID=$(cloudflared tunnel list | grep "ccc" | awk '{print $1}')
fi

echo "Tunnel ID: $TUNNEL_ID"

# Step 3: Create DNS record
echo ""
echo "Step 3: Setting up DNS..."
cloudflared tunnel route dns ccc ccc.ideaplaces.com || echo "DNS route may already exist."

# Step 4: Verify config
echo ""
echo "Step 4: Config file at ~/.cloudflared/config.yml"
cat ~/.cloudflared/config.yml

echo ""
echo "=== Setup Complete ==="
echo "Start the tunnel with: cloudflared tunnel run ccc"
echo "Or via PM2: pm2 start ecosystem.config.cjs"
