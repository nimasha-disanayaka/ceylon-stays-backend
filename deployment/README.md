# 🚀 Ceylon Stays - AWS EC2 Production Deployment Guide

This guide details how to launch and run the entire Ceylon Stays stack (PostgreSQL, Express Backend, Next.js Web Portal, and Nginx Reverse Proxy) on a single AWS EC2 instance.

---

## 1. Launch AWS EC2 Instance
1. In the **AWS Management Console**, navigate to **EC2** → **Launch Instance**.
2. **Name:** `ceylon-stays-server`
3. **OS:** `Ubuntu 22.04 LTS` (64-bit x86).
4. **Instance Type:** `t3.small` (recommended, 2GB RAM) or `t2.micro` (free-tier).
5. **Key Pair:** Create/select your `.pem` key pair (e.g. `ceylon-stays-key.pem`).
6. **Network & Security Group Inbound Rules:**
   - **SSH (Port 22):** Source: *My IP*
   - **HTTP (Port 80):** Source: *Anywhere (0.0.0.0/0)*
   - **HTTPS (Port 443):** Source: *Anywhere (0.0.0.0/0)*
7. **Storage:** 20 GB (General Purpose SSD gp3).
8. Click **Launch Instance**.

---

## 2. Connect & Clone Repositories
Connect to your EC2 instance from your terminal:
```bash
ssh -i "ceylon-stays-key.pem" ubuntu@<YOUR_EC2_PUBLIC_IP>
```

Clone the repositories into the home directory:
```bash
git clone https://github.com/nimasha-disanayaka/ceylon-stays-backend.git
git clone https://github.com/nimasha-disanayaka/ceylon-stays-web.git
```

---

## 3. Run One-Click Deployment
Make the deployment script executable and run it:
```bash
chmod +x ceylon-stays-backend/deployment/deploy.sh
./ceylon-stays-backend/deployment/deploy.sh
```

The script will automatically:
- Install Docker and Docker Compose
- Allocate 2GB of swap memory for zero-crash builds
- Build and boot all 4 production containers
- Run database migrations and seed default accounts
- Route traffic through Nginx on Port 80

---

## 4. Access Live Services
- **Web Host Portal:** `http://<YOUR_EC2_PUBLIC_IP>`
- **Backend API:** `http://<YOUR_EC2_PUBLIC_IP>/api`
- **Default Owner Credentials:**
  - Email: `nimuu1449disanayaka@gmail.com`
  - Password: `password123`

---

## 5. Enable HTTPS / SSL (Optional - if using a domain name)
If you point a domain (e.g. `stays.yourdomain.com`) to your EC2 Public IP:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d stays.yourdomain.com
```
Certbot will automatically install a Let's Encrypt SSL certificate and renew it.
