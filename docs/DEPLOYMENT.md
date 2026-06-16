# Deployment Guide

This guide explains how to deploy the web app to your server using GitHub Actions.

## Prerequisites

- A server with SSH access
- nginx installed on the server
- A directory for deployment (e.g., `/var/www/nom-wallet`)

## GitHub Secrets Setup

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

### SSH Configuration

1. **SSH_PRIVATE_KEY** - Your SSH private key for server access
2. **SSH_HOST** - Server hostname or IP address (e.g., `example.com` or `192.168.1.100`)
3. **SSH_USER** - SSH username (e.g., `deploy` or `root`)
4. **DEPLOY_PATH** - Deployment directory on server (e.g., `/var/www/nom-wallet`)

### Generating SSH Key for Deployment

```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/github_deploy

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/github_deploy.pub user@your-server.com

# Copy the private key content for GitHub secret
cat ~/.ssh/github_deploy
```

## Server Setup

### 1. Create deployment directory

```bash
sudo mkdir -p /var/www/nom-wallet
sudo chown $USER:$USER /var/www/nom-wallet
```

### 2. Install nginx

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx

# Start nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 3. Configure nginx

```bash
# Copy the example config
sudo cp nginx.conf.example /etc/nginx/sites-available/nom-wallet

# Edit the config - update server_name and paths
sudo nano /etc/nginx/sites-available/nom-wallet

# Enable the site
sudo ln -s /etc/nginx/sites-available/nom-wallet /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 4. Setup SSL (Optional but recommended)

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is set up automatically
```

## Deployment

The workflow automatically deploys when:

- You push to the `main` branch
- You manually trigger it via Actions tab

### Manual Deployment

Go to GitHub Actions → Deploy Web App → Run workflow

## Verifying Deployment

1. Check GitHub Actions for build status
2. Visit your domain in a browser
3. Check server logs: `sudo tail -f /var/log/nginx/access.log`

## Troubleshooting

### Build fails

- Check GitHub Actions logs
- Ensure all dependencies are in package.json

### SSH connection fails

- Verify SSH secrets are correct
- Test SSH connection manually: `ssh -i ~/.ssh/deploy_key user@host`
- Check firewall allows SSH (port 22)

### nginx 502/404 errors

- Check files are in deployment directory: `ls -la /var/www/nom-wallet`
- Check nginx error logs: `sudo tail -f /var/log/nginx/error.log`
- Verify nginx config: `sudo nginx -t`

### CORS/COOP errors

- Ensure nginx config includes the COOP/COEP headers
- Clear browser cache

## Security Hardening

### Content-Security-Policy

The web app stores encrypted wallet data in `localStorage`. An XSS vulnerability
on the same origin would allow an attacker to exfiltrate the encrypted keyfile
for offline brute-force. Set a strict CSP header in your nginx config:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss:; font-src 'self';" always;
```

Key directives:

- `script-src 'self'` - Blocks inline scripts and third-party JS (prevents XSS)
- `connect-src 'self' wss:` - Allows WebSocket connections only to same origin and WSS nodes
- `img-src 'self' data: https:` - Allows inline data URIs and images served over HTTPS
- `style-src 'self' 'unsafe-inline'` - Required for Vue/Tailwind inline styles

### Additional Recommendations

- Enable HTTPS (mandatory for a wallet app)
- Set `X-Frame-Options: DENY` to prevent clickjacking
- Set `X-Content-Type-Options: nosniff`
