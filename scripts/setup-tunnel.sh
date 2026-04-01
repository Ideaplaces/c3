#!/bin/bash
# C3 Cloudflare Tunnel Setup
# Run this script once to set up the tunnel for your domain.
#
# Usage:
#   ./setup-tunnel.sh <subdomain> <zone>
#
# Example:
#   ./setup-tunnel.sh c3 example.com
#   This creates a tunnel named "c3" and routes c3.example.com to it.
#
# Prerequisites:
#   - cloudflared CLI installed
#   - A Cloudflare account with the target zone

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <subdomain> <zone>"
  echo ""
  echo "  subdomain  The subdomain for the tunnel (e.g. c3)"
  echo "  zone       Your Cloudflare zone / domain (e.g. example.com)"
  echo ""
  echo "Example:"
  echo "  $0 c3 example.com"
  echo "  Creates tunnel 'c3' and routes c3.example.com to it."
  exit 1
fi

TUNNEL_NAME="$1"
TUNNEL_HOSTNAME="${1}.${2}"

echo "=== C3 Cloudflare Tunnel Setup ==="
echo "Tunnel name: $TUNNEL_NAME"
echo "Hostname:    $TUNNEL_HOSTNAME"
echo ""

# Step 1: Login to Cloudflare (opens browser)
if [ ! -f ~/.cloudflared/cert.pem ]; then
  echo "Step 1: Authenticating with Cloudflare..."
  echo "This will open a browser window. Select the ${2} zone."
  cloudflared tunnel login
else
  echo "Step 1: Already authenticated."
fi

# Step 2: Create the tunnel
echo ""
echo "Step 2: Creating tunnel '$TUNNEL_NAME'..."
if cloudflared tunnel list | grep -q "$TUNNEL_NAME"; then
  echo "Tunnel '$TUNNEL_NAME' already exists."
  TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
else
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
fi

echo "Tunnel ID: $TUNNEL_ID"

# Step 3: Create DNS record
echo ""
echo "Step 3: Setting up DNS..."
cloudflared tunnel route dns "$TUNNEL_NAME" "$TUNNEL_HOSTNAME" || echo "DNS route may already exist."

# Step 4: Verify config
echo ""
echo "Step 4: Config file at ~/.cloudflared/config.yml"
cat ~/.cloudflared/config.yml

echo ""
echo "=== Setup Complete ==="
echo "Start the tunnel with: cloudflared tunnel run $TUNNEL_NAME"
echo "Or via PM2: pm2 start ecosystem.config.cjs"
