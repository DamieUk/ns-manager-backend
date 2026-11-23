#!/usr/bin/env bash
# First-time setup of a fresh Ubuntu 24.04 VPS for Numenor, run as root once the OS is installed:
#   ssh -p 22022 root@<IP> 'bash -s' < deploy/server-setup.sh
# - SSH: keys only (no passwords, no keyboard-interactive), root only with a key, few attempts;
# - fail2ban on the SSH port; ufw lets in only SSH, HTTP and HTTPS;
# - security updates install automatically;
# - Docker with the compose plugin, and a 2 GB swap file for image builds on a 2 GB machine.
# Stops before touching SSH if root has no authorized key, so it can't lock you out.
set -euo pipefail

if [ ! -s /root/.ssh/authorized_keys ]; then
  echo "No key in /root/.ssh/authorized_keys: add your public key first (password login is about to be disabled)." >&2
  exit 1
fi

mkdir -p /run/sshd
SSH_PORT="$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2; exit }')"
SSH_PORT="${SSH_PORT:-22}"
echo "[setup] SSH port: $SSH_PORT"

# Password logins go first, before anything is installed: they are how an exposed server gets
# taken over (this one was, in November 2026, by brute-forcing root's password). sshd uses the first
# value it reads and includes sshd_config.d/ in name order at the top of its config, so this file is
# named to sort before the image's own drop-ins: Spaceship's 00-custom.conf (PasswordAuthentication
# yes, PermitRootLogin yes) and cloud-init's 50-cloud-init.conf.
rm -f /etc/ssh/sshd_config.d/00-numenor-hardening.conf
cat > /etc/ssh/sshd_config.d/00-00-numenor-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
EOF
mkdir -p /run/sshd # sshd -t/-T need it; on Ubuntu 24.04 sshd is socket-activated and may not have made it yet
sshd -t
systemctl reload ssh
if ! sshd -T | grep -qx 'passwordauthentication no' || ! sshd -T | grep -qx 'permitrootlogin without-password'; then
  echo "[setup] sshd still allows passwords — check the drop-ins in /etc/ssh/sshd_config.d/" >&2
  sshd -T | grep -E '^(passwordauthentication|permitrootlogin) ' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
# A fresh image runs cloud-init and apt on its first boot: retry until they release the package locks.
apt_get() {
  for _ in $(seq 1 60); do
    apt-get -o DPkg::Lock::Timeout=60 "$@" && return 0
    sleep 10
  done
  return 1
}
cloud-init status --wait >/dev/null 2>&1 || true
apt_get update
apt_get -y -o Dpkg::Options::=--force-confold upgrade
apt_get install -y rsync ufw fail2ban unattended-upgrades

# Security updates every day, without asking.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades

cat > /etc/fail2ban/jail.d/sshd.local <<EOF
[sshd]
enabled = true
port = $SSH_PORT
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable fail2ban
systemctl restart fail2ban

ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "[setup] done:"
sshd -T | grep -E '^(port|passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '
ufw status | head -12
fail2ban-client status sshd | tail -3
docker --version
