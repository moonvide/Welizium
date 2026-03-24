
# Welizium Installer
# Thanks for using epta

set -e

RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

RED='\033[38;5;196m'
GREEN='\033[38;5;46m'
YELLOW='\033[38;5;226m'
BLUE='\033[38;5;39m'
PURPLE='\033[38;5;135m'
CYAN='\033[38;5;51m'
GRAY='\033[38;5;245m'

print_banner() {
  clear
  echo -e ""
  echo -e "${PURPLE}${BOLD}   ╭──────────────────────────────────────────╮${RESET}"
  echo -e "${PURPLE}${BOLD}   │                                          │${RESET}"
  echo -e "${PURPLE}${BOLD}   │   ${WHITE}⚡ WELIZIUM ADMIN PANEL SETUP${PURPLE}        │${RESET}"
  echo -e "${PURPLE}${BOLD}   │                                          │${RESET}"
  echo -e "${PURPLE}${BOLD}   ╰──────────────────────────────────────────╯${RESET}"
  echo -e ""
}

step()    { echo -e "\n${BLUE}${BOLD}▶ ${WHITE}$1${RESET}"; }
success() { echo -e "  ${GREEN}✔ ${GRAY}$1${RESET}"; }
info()    { echo -e "  ${CYAN}ℹ ${GRAY}$1${RESET}"; }
warn()    { echo -e "  ${YELLOW}⚠ ${GRAY}$1${RESET}"; }
error()   { echo -e "\n  ${RED}✖ ${BOLD}$1${RESET}\n"; exit 1; }
prompt()  { echo -ne "  ${PURPLE}❯ ${WHITE}$1 ${RESET}"; }

print_banner

if [ "$EUID" -ne 0 ]; then 
  error "Please run as root (use sudo or su -)"
fi

INSTALL_DIR="/opt/welizium"

if [ -d "$INSTALL_DIR" ]; then
  step "Existing Installation Found"
  prompt "Do you want to reinstall and backup data? (y/n):"
  read -r REINSTALL
  
  if [[ "$REINSTALL" =~ ^[Yy]$ ]]; then
    info "Stopping existing service..."
    systemctl stop welizium 2>/dev/null || true
    
    info "Creating backups..."
    [ -f "$INSTALL_DIR/config.json" ] && cp "$INSTALL_DIR/config.json" /tmp/welizium_config_backup.json && success "Config backed up"
    [ -f "$INSTALL_DIR/files.json" ] && cp "$INSTALL_DIR/files.json" /tmp/welizium_files_backup.json && success "Files DB backed up"
    [ -f "$INSTALL_DIR/api.json" ] && cp "$INSTALL_DIR/api.json" /tmp/welizium_api_backup.json && success "API DB backed up"
    [ -f "$INSTALL_DIR/settings.json" ] && cp "$INSTALL_DIR/settings.json" /tmp/welizium_settings_backup.json && success "Settings backed up"
    [ -f "$INSTALL_DIR/sites.json" ] && cp "$INSTALL_DIR/sites.json" /tmp/welizium_sites_backup.json && success "Sites DB backed up"
    [ -f "$INSTALL_DIR/security.json" ] && cp "$INSTALL_DIR/security.json" /tmp/welizium_security_backup.json && success "Security DB backed up"
    [ -f "$INSTALL_DIR/ports.json" ] && cp "$INSTALL_DIR/ports.json" /tmp/welizium_ports_backup.json && success "Ports DB backed up"
    [ -d "$INSTALL_DIR/uploads" ] && cp -r "$INSTALL_DIR/uploads" /tmp/welizium_uploads_backup && success "Uploads backed up"
    [ -d "$INSTALL_DIR/sites" ] && cp -r "$INSTALL_DIR/sites" /tmp/welizium_sites_files_backup && success "Sites files backed up"
    
    cd /tmp
    rm -rf "$INSTALL_DIR"
    success "Old installation removed"
  else
    error "Installation cancelled by user."
  fi
fi

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR" || exit

step "System Environment"

info "Installing system dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq > /dev/null 2>&1
apt-get install -y -qq cron openssl curl > /dev/null 2>&1

systemctl enable cron > /dev/null 2>&1
systemctl start cron > /dev/null 2>&1

sleep 2

success "System dependencies installed"

if ! command -v node &> /dev/null; then
  info "Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y nodejs > /dev/null 2>&1
  success "Node.js installed"
else
  success "Node.js is already installed ($(node -v))"
fi

if ! command -v npm &> /dev/null; then
  info "Installing npm..."
  apt-get install -y npm > /dev/null 2>&1
  success "npm installed"
else
  success "npm is already installed"
fi

step "Downloading Assets"
info "Fetching files from GitHub..."

curl -sS -o package.json https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/package.json
curl -sS -o server.js https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/server.js

mkdir -p public
curl -sS -o public/index.html https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/index.html
curl -sS -o public/style.css https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/style.css
curl -sS -o public/app.js https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/app.js

success "Core files downloaded"

step "Installing Dependencies"
info "Running npm install (production)..."
npm install --production --silent > /dev/null 2>&1
success "NPM modules installed"

RESTORE_CONFIG=false

if [ -f "/tmp/welizium_config_backup.json" ]; then
  step "Restoring Data"
  prompt "Keep existing login credentials and URL? (y/n):"
  read -r KEEP_CREDS
  
  if [[ "$KEEP_CREDS" =~ ^[Yy]$ ]]; then
    RESTORE_CONFIG=true
    cp /tmp/welizium_config_backup.json config.json
    [ -f "/tmp/welizium_files_backup.json" ] && cp /tmp/welizium_files_backup.json files.json
    [ -f "/tmp/welizium_api_backup.json" ] && cp /tmp/welizium_api_backup.json api.json
    [ -f "/tmp/welizium_settings_backup.json" ] && cp /tmp/welizium_settings_backup.json settings.json
    [ -f "/tmp/welizium_sites_backup.json" ] && cp /tmp/welizium_sites_backup.json sites.json
    [ -f "/tmp/welizium_security_backup.json" ] && cp /tmp/welizium_security_backup.json security.json
    [ -f "/tmp/welizium_ports_backup.json" ] && cp /tmp/welizium_ports_backup.json ports.json
    [ -d "/tmp/welizium_uploads_backup" ] && cp -r /tmp/welizium_uploads_backup uploads
    [ -d "/tmp/welizium_sites_files_backup" ] && cp -r /tmp/welizium_sites_files_backup sites
    
    success "Previous configuration and data restored"
  fi

  rm -rf /tmp/welizium_*
fi

if [ "$RESTORE_CONFIG" = false ]; then
  step "Admin Configuration"
  
  while [ -z "$ADMIN_USER" ]; do
    prompt "Enter admin username:"
    read -r ADMIN_USER
  done

  while [ -z "$ADMIN_PASS" ]; do
    prompt "Enter admin password:"
    read -rs ADMIN_PASS
    echo ""
  done

  step "SSL Configuration"
  prompt "Do you want to setup SSL/HTTPS? (y/n):"
  read -r SETUP_SSL
  
  DOMAIN=""
  EMAIL=""
  SSL_TYPE=""
  
  if [[ "$SETUP_SSL" =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${CYAN}Choose SSL type:${RESET}"
    echo -e "${WHITE}  1) Domain SSL (Let's Encrypt) - Free, trusted by browsers${RESET}"
    echo -e "${WHITE}  2) IP SSL (Self-signed) - 7 days, auto-renewal${RESET}"
    prompt "Enter choice (1 or 2):"
    read -r SSL_CHOICE
    
    if [ "$SSL_CHOICE" = "1" ]; then
      SSL_TYPE="letsencrypt"
      
      while [ -z "$DOMAIN" ]; do
        prompt "Enter your domain (e.g., admin.example.com):"
        read -r DOMAIN
      done
      
      while [ -z "$EMAIL" ]; do
        prompt "Enter your email for SSL certificate:"
        read -r EMAIL
      done
      
      info "Installing Certbot..."
      apt-get install -y certbot python3-certbot-nginx > /dev/null 2>&1
      success "Certbot installed"
      
      info "Obtaining SSL certificate for $DOMAIN..."
      certbot certonly --standalone --non-interactive --agree-tos --email "$EMAIL" -d "$DOMAIN" --preferred-challenges http
      
      if [ $? -eq 0 ]; then
        success "SSL certificate obtained for $DOMAIN"
        
        info "Setting up auto-renewal..."
        sleep 1
        
        (crontab -l 2>/dev/null | grep -v "certbot renew"; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl restart welizium'") | crontab -
        
        if [ $? -eq 0 ]; then
          success "Auto-renewal configured (daily at 3 AM)"
        else
          warn "Failed to add cron job. Add manually: crontab -e"
        fi
      else
        warn "Failed to obtain SSL certificate. Continuing without SSL..."
        SSL_TYPE=""
        DOMAIN=""
      fi
      
    elif [ "$SSL_CHOICE" = "2" ]; then
      SSL_TYPE="selfsigned"
      
      SERVER_IP=$(hostname -I | awk '{print $1}')
      if [ -z "$SERVER_IP" ]; then
        SERVER_IP=$(curl -s ifconfig.me)
      fi
      
      DOMAIN="$SERVER_IP"
      
      mkdir -p /etc/welizium/ssl
      
      info "Generating self-signed certificate for $SERVER_IP..."
      openssl req -x509 -nodes -days 7 -newkey rsa:2048 \
        -keyout /etc/welizium/ssl/privkey.pem \
        -out /etc/welizium/ssl/fullchain.pem \
        -subj "/C=US/ST=State/L=City/O=Welizium/CN=$SERVER_IP" \
        > /dev/null 2>&1
      
      if [ $? -eq 0 ]; then
        success "Self-signed certificate generated"
        
        info "Checking if port 443 is available..."
        if ss -tlnp | grep -q ':443 '; then
          PORT_443_PROCESS=$(ss -tlnp | grep ':443 ' | awk '{print $6}' | head -1)
          warn "Port 443 is already in use by: $PORT_443_PROCESS"
          warn "SSL will be disabled. Welizium will run on HTTP port 1337"
          SSL_TYPE=""
          DOMAIN=""
        else
          info "Setting up auto-renewal (every 6 days)..."
          
          cat > /usr/local/bin/welizium-renew-ssl.sh << 'EOFSSL'
#!/bin/bash
SERVER_IP=$(hostname -I | awk '{print $1}')
openssl req -x509 -nodes -days 7 -newkey rsa:2048 \
  -keyout /etc/welizium/ssl/privkey.pem \
  -out /etc/welizium/ssl/fullchain.pem \
  -subj "/C=US/ST=State/L=City/O=Welizium/CN=$SERVER_IP" \
  > /dev/null 2>&1
systemctl restart welizium
EOFSSL
          
          chmod +x /usr/local/bin/welizium-renew-ssl.sh
          
          info "Adding cron job for auto-renewal..."
          sleep 1
          
          (crontab -l 2>/dev/null | grep -v welizium-renew-ssl; echo "0 2 */6 * * /usr/local/bin/welizium-renew-ssl.sh") | crontab -
          
          if [ $? -eq 0 ]; then
            success "Auto-renewal configured (every 6 days at 2 AM)"
          else
            warn "Failed to add cron job. Add manually: crontab -e"
          fi
          
          warn "Note: Self-signed certificates will show a browser warning."
          warn "This is normal. Click 'Advanced' and 'Proceed' to continue."
        fi
      else
        warn "Failed to generate certificate. Continuing without SSL..."
        SSL_TYPE=""
        DOMAIN=""
      fi
    else
      warn "Invalid choice. Continuing without SSL..."
      SSL_TYPE=""
    fi
  fi

  info "Generating secure tokens..."

  JWT_SECRET=$(openssl rand -hex 32)
  ADMIN_PATH=$(openssl rand -hex 8)
  HASHED_PASSWORD=$(node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('$ADMIN_PASS', 10).then(hash => console.log(hash));")

  if [ "$SSL_TYPE" = "letsencrypt" ]; then
    CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    KEY_PATH="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
  elif [ "$SSL_TYPE" = "selfsigned" ]; then
    CERT_PATH="/etc/welizium/ssl/fullchain.pem"
    KEY_PATH="/etc/welizium/ssl/privkey.pem"
  else
    CERT_PATH=""
    KEY_PATH=""
  fi

  cat > config.json << EOF
{
  "jwtSecret": "$JWT_SECRET",
  "adminPath": "$ADMIN_PATH",
  "ssl": {
    "enabled": $([ -n "$SSL_TYPE" ] && echo "true" || echo "false"),
    "type": "$SSL_TYPE",
    "domain": "$DOMAIN",
    "certPath": "$CERT_PATH",
    "keyPath": "$KEY_PATH"
  },
  "users": [
    {
      "username": "$ADMIN_USER",
      "password": "$HASHED_PASSWORD"
    }
  ]
}
EOF

  echo "{}" > files.json
  echo "{}" > api.json
  echo "{}" > settings.json
  echo "{}" > sites.json
  echo "{}" > security.json
  echo "{}" > ports.json
  
  success "Security configuration generated"
fi

mkdir -p uploads
mkdir -p sites

step "System Service"
info "Configuring systemd..."

cat > /etc/systemd/system/welizium.service << EOF
[Unit]
Description=Welizium Admin Panel
Documentation=https://github.com/moonvide/Welizium
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable welizium > /dev/null 2>&1
systemctl start welizium

sleep 2

if systemctl is-active --quiet welizium; then
  success "Welizium service is running"
else
  warn "Service might have failed to start. Check logs: journalctl -u welizium -n 50"
fi

step "Firewall Configuration"

if command -v ufw &> /dev/null; then
  info "Configuring UFW firewall..."
  
  SSL_ENABLED=$(node -e "console.log(require('$INSTALL_DIR/config.json').ssl?.enabled || false)" 2>/dev/null)
  
  if [ "$SSL_ENABLED" = "true" ]; then
    ufw allow 443/tcp > /dev/null 2>&1
    ufw allow 80/tcp > /dev/null 2>&1
    success "Opened ports 443 (HTTPS) and 80 (HTTP)"
  else
    ufw allow 1337/tcp > /dev/null 2>&1
    success "Opened port 1337 (HTTP)"
  fi
else
  info "UFW not installed, skipping firewall configuration"
fi

step "CLI Tool"
info "Installing welizium command..."

cat > /usr/local/bin/welizium << 'EOFCLI'
#!/bin/bash

WELIZIUM_DIR="/opt/welizium"
CONFIG_FILE="$WELIZIUM_DIR/config.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

if [ ! -f "$CONFIG_FILE" ]; then
  echo -e "${RED}Error: Welizium not installed or config not found${NC}"
  exit 1
fi

show_banner() {
  echo -e "${CYAN}╭─────────────────────────────────────╮${NC}"
  echo -e "${CYAN}│  ${WHITE}⚡ WELIZIUM ADMIN PANEL CLI${CYAN}      │${NC}"
  echo -e "${CYAN}╰─────────────────────────────────────╯${NC}"
  echo ""
}

show_status() {
  show_banner
  
  if systemctl is-active --quiet welizium; then
    echo -e "${GREEN}● Status: Running${NC}"
  else
    echo -e "${RED}● Status: Stopped${NC}"
  fi
  
  ADMIN_PATH=$(node -e "console.log(require('$CONFIG_FILE').adminPath)" 2>/dev/null)
  ADMIN_USER=$(node -e "console.log(require('$CONFIG_FILE').users[0].username)" 2>/dev/null)
  SSL_ENABLED=$(node -e "console.log(require('$CONFIG_FILE').ssl?.enabled || false)" 2>/dev/null)
  SSL_TYPE=$(node -e "console.log(require('$CONFIG_FILE').ssl?.type || 'none')" 2>/dev/null)
  SSL_DOMAIN=$(node -e "console.log(require('$CONFIG_FILE').ssl?.domain || '')" 2>/dev/null)
  
  SERVER_IP=$(hostname -I | awk '{print $1}')
  
  if [ "$SSL_ENABLED" = "true" ]; then
    if [ "$SSL_TYPE" = "letsencrypt" ]; then
      URL="https://${SSL_DOMAIN}/${ADMIN_PATH}"
      PROTOCOL="HTTPS (Let's Encrypt)"
    else
      URL="https://${SSL_DOMAIN}/${ADMIN_PATH}"
      PROTOCOL="HTTPS (Self-signed)"
    fi
  else
    URL="http://${SERVER_IP}:1337/${ADMIN_PATH}"
    PROTOCOL="HTTP"
  fi
  
  echo -e "${CYAN}● URL:${NC} ${WHITE}${URL}${NC}"
  echo -e "${CYAN}● Username:${NC} ${WHITE}${ADMIN_USER}${NC}"
  echo -e "${CYAN}● Protocol:${NC} ${WHITE}${PROTOCOL}${NC}"
  echo ""
}

change_port() {
  show_banner
  echo -e "${YELLOW}Current port: 1337 (HTTP) / 443 (HTTPS)${NC}"
  echo -e "${RED}Note: Changing port requires manual server.js modification${NC}"
  echo ""
}

change_password() {
  show_banner
  read -p "$(echo -e ${WHITE}Enter new admin password: ${NC})" -s NEW_PASS
  echo ""
  
  if [ -z "$NEW_PASS" ]; then
    echo -e "${RED}Password cannot be empty${NC}"
    exit 1
  fi
  
  cd "$WELIZIUM_DIR"
  HASHED_PASSWORD=$(node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('$NEW_PASS', 10).then(hash => console.log(hash));")
  
  node -e "
    const fs = require('fs');
    const config = require('$CONFIG_FILE');
    config.users[0].password = '$HASHED_PASSWORD';
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
  "
  
  echo -e "${GREEN}✔ Password changed successfully${NC}"
  echo -e "${YELLOW}Restarting service...${NC}"
  systemctl restart welizium
  echo -e "${GREEN}✔ Done${NC}"
}

change_username() {
  show_banner
  read -p "$(echo -e ${WHITE}Enter new admin username: ${NC})" NEW_USER
  
  if [ -z "$NEW_USER" ]; then
    echo -e "${RED}Username cannot be empty${NC}"
    exit 1
  fi
  
  node -e "
    const fs = require('fs');
    const config = require('$CONFIG_FILE');
    config.users[0].username = '$NEW_USER';
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
  "
  
  echo -e "${GREEN}✔ Username changed to: ${WHITE}${NEW_USER}${NC}"
}

show_logs() {
  journalctl -u welizium -f
}

show_url() {
  ADMIN_PATH=$(node -e "console.log(require('$CONFIG_FILE').adminPath)" 2>/dev/null)
  SSL_ENABLED=$(node -e "console.log(require('$CONFIG_FILE').ssl?.enabled || false)" 2>/dev/null)
  SSL_DOMAIN=$(node -e "console.log(require('$CONFIG_FILE').ssl?.domain || '')" 2>/dev/null)
  
  SERVER_IP=$(hostname -I | awk '{print $1}')
  
  if [ "$SSL_ENABLED" = "true" ]; then
    echo "https://${SSL_DOMAIN}/${ADMIN_PATH}"
  else
    echo "http://${SERVER_IP}:1337/${ADMIN_PATH}"
  fi
}

show_menu() {
  show_banner
  echo -e "${WHITE}Commands:${NC}"
  echo -e "  ${CYAN}status${NC}          Show service status and info"
  echo -e "  ${CYAN}start${NC}           Start Welizium service"
  echo -e "  ${CYAN}stop${NC}            Stop Welizium service"
  echo -e "  ${CYAN}restart${NC}         Restart Welizium service"
  echo -e "  ${CYAN}logs${NC}            Show live logs"
  echo -e "  ${CYAN}url${NC}             Show admin panel URL"
  echo -e "  ${CYAN}password${NC}        Change admin password"
  echo -e "  ${CYAN}username${NC}        Change admin username"
  echo -e "  ${CYAN}config${NC}          Show config file location"
  echo -e "  ${CYAN}update${NC}          Update Welizium"
  echo ""
  echo -e "${WHITE}Usage:${NC} welizium [command]"
  echo ""
}

update_welizium() {
  show_banner
  echo -e "${YELLOW}Updating Welizium...${NC}"
  
  cd "$WELIZIUM_DIR"
  
  curl -sS -o server.js https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/server.js
  curl -sS -o public/index.html https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/index.html
  curl -sS -o public/style.css https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/style.css
  curl -sS -o public/app.js https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/app.js
  
  npm install --production --silent > /dev/null 2>&1
  
  echo -e "${GREEN}✔ Files updated${NC}"
  echo -e "${YELLOW}Restarting service...${NC}"
  systemctl restart welizium
  echo -e "${GREEN}✔ Welizium updated successfully${NC}"
}

case "$1" in
  status)
    show_status
    ;;
  start)
    systemctl start welizium
    echo -e "${GREEN}✔ Welizium started${NC}"
    ;;
  stop)
    systemctl stop welizium
    echo -e "${YELLOW}✔ Welizium stopped${NC}"
    ;;
  restart)
    systemctl restart welizium
    echo -e "${GREEN}✔ Welizium restarted${NC}"
    ;;
  logs)
    show_logs
    ;;
  url)
    show_url
    ;;
  password)
    change_password
    ;;
  username)
    change_username
    ;;
  config)
    echo "$CONFIG_FILE"
    ;;
  update)
    update_welizium
    ;;
  *)
    show_menu
    ;;
esac
EOFCLI

chmod +x /usr/local/bin/welizium
success "CLI tool installed (use: welizium)"

SERVER_IP=$(hostname -I | awk '{print $1}')
if [ -z "$SERVER_IP" ]; then
  SERVER_IP=$(curl -s ifconfig.me || echo "YOUR_SERVER_IP")
fi

if [ -f "config.json" ]; then
  ADMIN_PATH=$(node -e "console.log(require('./config.json').adminPath)")
  ADMIN_USER=$(node -e "console.log(require('./config.json').users[0].username)")
  SSL_ENABLED=$(node -e "console.log(require('./config.json').ssl?.enabled || false)")
  SSL_TYPE=$(node -e "console.log(require('./config.json').ssl?.type || '')")
  SSL_DOMAIN=$(node -e "console.log(require('./config.json').ssl?.domain || '')")
fi

if [ "$SSL_ENABLED" = "true" ] && [ -n "$SSL_DOMAIN" ]; then
  ADMIN_URL="https://${SSL_DOMAIN}/${ADMIN_PATH}"
  if [ "$SSL_TYPE" = "letsencrypt" ]; then
    PROTOCOL="HTTPS (Let's Encrypt)"
  else
    PROTOCOL="HTTPS (Self-signed)"
  fi
else
  ADMIN_URL="http://${SERVER_IP}:1337/${ADMIN_PATH}"
  PROTOCOL="HTTP"
fi

echo -e "\n"
echo -e "${GREEN}${BOLD}╭────────────────────────────────────────────────────────────╮${RESET}"
echo -e "${GREEN}${BOLD}│                                                            │${RESET}"
echo -e "${GREEN}${BOLD}│   🎉 WELIZIUM DEPLOYED SUCCESSFULLY!                       │${RESET}"
echo -e "${GREEN}${BOLD}│                                                            │${RESET}"
echo -e "${GREEN}${BOLD}├────────────────────────────────────────────────────────────┤${RESET}"
echo -e "${GREEN}${BOLD}│                                                            │${RESET}"
echo -e "${GREEN}${BOLD}│   ${CYAN}🌐 Admin Panel:  ${WHITE}${ADMIN_URL}${RESET}"
echo -e "${GREEN}${BOLD}│   ${CYAN}👤 Username:     ${WHITE}${ADMIN_USER}${RESET}"
echo -e "${GREEN}${BOLD}│   ${CYAN}🔒 Protocol:     ${WHITE}${PROTOCOL}${RESET}"
echo -e "${GREEN}${BOLD}│                                                            │${RESET}"

if [ "$SSL_TYPE" = "selfsigned" ]; then
  echo -e "${GREEN}${BOLD}│   ${YELLOW}⚠️  Browser will show security warning (normal)          ${GREEN}${BOLD}│${RESET}"
  echo -e "${GREEN}${BOLD}│   ${YELLOW}   Click 'Advanced' → 'Proceed' to continue              ${GREEN}${BOLD}│${RESET}"
  echo -e "${GREEN}${BOLD}│                                                            │${RESET}"
fi

echo -e "${GREEN}${BOLD}│   ${YELLOW}⚠️  IMPORTANT: Bookmark the URL above. It is hidden!     ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}│                                                            │${RESET}"
echo -e "${GREEN}${BOLD}├────────────────────────────────────────────────────────────┤${RESET}"
echo -e "${GREEN}${BOLD}│   ${GRAY}Commands:${RESET}                                                ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}│   ${GRAY}• Quick:   ${WHITE}welizium status${RESET}                              ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}│   ${GRAY}• Manage:  ${WHITE}welizium${RESET}                                     ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}│   ${GRAY}• Logs:    ${WHITE}welizium logs${RESET}                                ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}│   ${GRAY}• Update:  ${WHITE}welizium update${RESET}                              ${GREEN}${BOLD}│${RESET}"

if [ "$SSL_TYPE" = "letsencrypt" ]; then
  echo -e "${GREEN}${BOLD}│   ${GRAY}• SSL:     ${WHITE}certbot renew${RESET}                               ${GREEN}${BOLD}│${RESET}"
elif [ "$SSL_TYPE" = "selfsigned" ]; then
  echo -e "${GREEN}${BOLD}│   ${GRAY}• SSL:     ${WHITE}/usr/local/bin/welizium-renew-ssl.sh${RESET}      ${GREEN}${BOLD}│${RESET}"
fi

echo -e "${GREEN}${BOLD}╰────────────────────────────────────────────────────────────╯${RESET}"
echo -e "\n"