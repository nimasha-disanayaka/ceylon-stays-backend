#!/usr/bin/env bash
# ========================================================
# Ceylon Stays - One-Click Production Deployment for AWS EC2
# ========================================================
set -e

echo "🚀 Starting Ceylon Stays AWS EC2 Production Deployment..."

# 1. Update system & install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker & Docker Compose..."
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg lsb-release
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-compose
    sudo usermod -aG docker $USER
    echo "✅ Docker installed successfully."
fi

# 2. Add 2GB Swap Memory (ensures low-RAM t2.micro/t3.small instances build smoothly)
if [ ! -f /swapfile ]; then
    echo "💾 Creating 2GB Swap Space for build stability..."
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "✅ Swap memory enabled."
fi

# 3. Pull latest code or build containers
echo "🔨 Building production Docker containers (PostgreSQL, Backend, Next.js Web, Nginx)..."
cd "$(dirname "$0")"

docker compose -f docker-compose.prod.yml down --remove-orphans || true
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d

echo "⏳ Waiting for database and services to report healthy..."
sleep 10

# 4. Run Prisma database seed
echo "🌱 Seeding initial platform data and verified accounts..."
docker exec -i ceylon_stays_backend npm run seed || true

echo "========================================================"
echo "🎉 DEPLOYMENT COMPLETE! Ceylon Stays is LIVE!"
echo "🌐 Web Dashboard: http://$(curl -s http://checkip.amazonaws.com || echo 'YOUR_EC2_IP')"
echo "🔗 Backend Health: http://$(curl -s http://checkip.amazonaws.com || echo 'YOUR_EC2_IP')/api/auth/me"
echo "========================================================"
