#!/bin/bash
# ─────────────────────────────────────────────────────────────
# JML Ops · Hetzner VPS Bootstrap
# Run ONCE on a fresh Ubuntu 24.04 server as root
# Usage: curl -fsSL https://raw.githubusercontent.com/your-org/jmlops/main/infra/scripts/bootstrap-server.sh | bash
# ─────────────────────────────────────────────────────────────
set -euo pipefail

DEPLOY_USER="jmlops"
APP_DIR="/opt/jmlops"
DOMAIN="app.yourdomain.com"   # ← change this

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " JML Ops · Server Bootstrap"
echo " Hetzner CX41 · Ubuntu 24.04"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── System update ────────────────────────────────────────────
echo "[1/9] System update..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  curl wget git unzip htop ncdu ufw fail2ban \
  ca-certificates gnupg lsb-release apt-transport-https

# ── Docker ───────────────────────────────────────────────────
echo "[2/9] Installing Docker..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
echo "  ✓ Docker $(docker --version)"

# ── Ollama (for local AI models) ─────────────────────────────
echo "[3/9] Installing Ollama..."
curl -fsSL https://ollama.com/install.sh | sh
systemctl enable --now ollama
echo "  ✓ Ollama installed"

# ── Deploy user ──────────────────────────────────────────────
echo "[4/9] Creating deploy user ($DEPLOY_USER)..."
useradd -m -s /bin/bash "$DEPLOY_USER" || true
usermod -aG docker "$DEPLOY_USER"
mkdir -p /home/$DEPLOY_USER/.ssh
# Copy root's authorized_keys if present
[ -f /root/.ssh/authorized_keys ] && \
  cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/ && \
  chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh && \
  chmod 700 /home/$DEPLOY_USER/.ssh && \
  chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
echo "  ✓ User $DEPLOY_USER created"

# ── App directory ─────────────────────────────────────────────
echo "[5/9] Creating app directory..."
mkdir -p $APP_DIR/infra/{dev,prod,scripts}
mkdir -p $APP_DIR/backups
chown -R $DEPLOY_USER:$DEPLOY_USER $APP_DIR
echo "  ✓ $APP_DIR ready"

# ── Firewall ─────────────────────────────────────────────────
echo "[6/9] Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment "SSH"
ufw allow 80/tcp   comment "HTTP"
ufw allow 443/tcp  comment "HTTPS"
ufw --force enable
echo "  ✓ UFW active (22, 80, 443 open)"

# ── Fail2ban ─────────────────────────────────────────────────
echo "[7/9] Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port    = ssh
logpath = %(sshd_log)s
EOF
systemctl enable --now fail2ban
echo "  ✓ fail2ban active"

# ── Swap (safety net on 16GB server) ─────────────────────────
echo "[8/9] Setting up swap..."
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
  echo "  ✓ 4GB swap enabled"
else
  echo "  → swap already exists"
fi

# ── Log rotation ─────────────────────────────────────────────
echo "[9/9] Configuring log rotation..."
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  },
  "live-restore": true
}
EOF
systemctl restart docker

# ── Pull Ollama models ────────────────────────────────────────
echo ""
echo "Pulling essential Ollama models (background)..."
sudo -u ollama ollama pull mistral &
sudo -u ollama ollama pull nomic-embed-text &
echo "  → mistral + nomic-embed-text pulling in background"
echo "  → Run later: ollama pull qwen2.5:27b (17GB)"

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " ✓ Server bootstrap complete!"
echo ""
echo " Next steps:"
echo "   1. Add GitHub deploy key:"
echo "      su - $DEPLOY_USER"
echo "      ssh-keygen -t ed25519 -C 'deploy@$DOMAIN'"
echo "      cat ~/.ssh/id_ed25519.pub  # add to GitHub repo"
echo ""
echo "   2. Clone repo:"
echo "      cd $APP_DIR"
echo "      git clone git@github.com:your-org/jmlops.git ."
echo ""
echo "   3. Create .env.prod:"
echo "      cp infra/dev/.env.example .env"
echo "      nano .env   # fill in real secrets"
echo ""
echo "   4. Issue TLS certificate:"
echo "      docker run --rm -p 80:80 certbot/certbot certonly \\"
echo "        --standalone -d $DOMAIN --email you@$DOMAIN --agree-tos"
echo ""
echo "   5. Start production stack:"
echo "      docker compose -f infra/prod/docker-compose.prod.yml up -d"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
