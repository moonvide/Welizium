#!/bin/bash
# Welizium Installer
# Thanks for using epta

set -e

# ==========================================
# Цвета и форматирование
# ==========================================
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
WHITE='\033[38;5;255m'

# ==========================================
# UI Функции
# ==========================================
print_banner() {
  clear
  echo -e ""
  echo -e "${CYAN}${BOLD}  ╭──────────────────────────────────────────────────╮${RESET}"
  echo -e "${CYAN}${BOLD}  │                                                  │${RESET}"
  echo -e "${CYAN}${BOLD}  │   ${WHITE}⚡ ${PURPLE}WELIZIUM ADMIN PANEL${WHITE} — Установка          ${CYAN}${BOLD}│${RESET}"
  echo -e "${CYAN}${BOLD}  │                                                  │${RESET}"
  echo -e "${CYAN}${BOLD}  ╰──────────────────────────────────────────────────╯${RESET}"
  echo -e ""
}

step()    { echo -e "\n${PURPLE}${BOLD} 🚀 ${WHITE}$1${RESET}"; }
success() { echo -e "    ${GREEN}✔ ${GRAY}$1${RESET}"; }
info()    { echo -e "    ${CYAN}💡 ${GRAY}$1${RESET}"; }
warn()    { echo -e "    ${YELLOW}⚠️  ${GRAY}$1${RESET}"; }
error()   { echo -e "\n    ${RED}✖ ${BOLD}$1${RESET}\n"; exit 1; }
prompt()  { echo -ne "    ${PURPLE}💬 ${WHITE}$1 ${RESET}"; }

# ==========================================
# Начало установки
# ==========================================
print_banner

if [ "$EUID" -ne 0 ]; then 
  error "Пожалуйста, запустите скрипт от имени root (используйте sudo или su -)"
fi

INSTALL_DIR="/opt/welizium"

# Проверка существующей установки
if [ -d "$INSTALL_DIR" ]; then
  step "Найдена существующая установка"
  prompt "Хотите переустановить панель с сохранением данных? (y/n):"
  read -r REINSTALL
  
  if [[ "$REINSTALL" =~ ^[Yy]$ ]]; then
    info "Останавливаем текущий сервис..."
    systemctl stop welizium 2>/dev/null || true
    
    info "Создаем резервные копии..."
    [ -f "$INSTALL_DIR/config.json" ] && cp "$INSTALL_DIR/config.json" /tmp/welizium_config_backup.json && success "Конфиг сохранен"
    [ -f "$INSTALL_DIR/files.json" ] && cp "$INSTALL_DIR/files.json" /tmp/welizium_files_backup.json
    [ -f "$INSTALL_DIR/api.json" ] && cp "$INSTALL_DIR/api.json" /tmp/welizium_api_backup.json
    [ -f "$INSTALL_DIR/settings.json" ] && cp "$INSTALL_DIR/settings.json" /tmp/welizium_settings_backup.json
    [ -f "$INSTALL_DIR/sites.json" ] && cp "$INSTALL_DIR/sites.json" /tmp/welizium_sites_backup.json
    [ -f "$INSTALL_DIR/security.json" ] && cp "$INSTALL_DIR/security.json" /tmp/welizium_security_backup.json
    [ -f "$INSTALL_DIR/ports.json" ] && cp "$INSTALL_DIR/ports.json" /tmp/welizium_ports_backup.json
    [ -d "$INSTALL_DIR/uploads" ] && cp -r "$INSTALL_DIR/uploads" /tmp/welizium_uploads_backup && success "Файлы загрузок сохранены"
    [ -d "$INSTALL_DIR/sites" ] && cp -r "$INSTALL_DIR/sites" /tmp/welizium_sites_files_backup && success "Файлы сайтов сохранены"
    
    cd /tmp
    rm -rf "$INSTALL_DIR"
    success "Старая версия удалена"
  else
    error "Установка отменена пользователем."
  fi
fi

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR" || exit

# ==========================================
# Зависимости
# ==========================================
step "Подготовка системы"

info "Обновление пакетов и установка базовых утилит..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq > /dev/null 2>&1
apt-get install -y -qq cron openssl curl > /dev/null 2>&1

systemctl enable cron > /dev/null 2>&1
systemctl start cron > /dev/null 2>&1
success "Базовые утилиты установлены"

if ! command -v node &> /dev/null; then
  info "Установка Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y nodejs > /dev/null 2>&1
  success "Node.js успешно установлен"
else
  success "Node.js уже установлен ($(node -v))"
fi

if ! command -v npm &> /dev/null; then
  info "Установка npm..."
  apt-get install -y npm > /dev/null 2>&1
  success "npm установлен"
else
  success "npm уже установлен"
fi

# ==========================================
# Загрузка файлов
# ==========================================
step "Загрузка исходного кода"
info "Скачивание файлов с GitHub..."

curl -sS -o package.json https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/package.json
curl -sS -o server.js https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/server.js

mkdir -p public
curl -sS -o public/index.html https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/index.html
curl -sS -o public/style.css https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/style.css
curl -sS -o public/app.js https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/app.js

success "Ядро панели загружено"

info "Установка NPM модулей (production)..."
npm install --production --silent > /dev/null 2>&1
success "Модули установлены"

# ==========================================
# Восстановление / Настройка
# ==========================================
RESTORE_CONFIG=false

if [ -f "/tmp/welizium_config_backup.json" ]; then
  step "Восстановление данных"
  prompt "Сохранить старые логин, пароль и ссылки? (y/n):"
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
    
    # Принудительно отключаем SSL в старом конфиге, так как логика SSL удалена
    node -e "
      const fs = require('fs');
      const config = require('./config.json');
      if (config.ssl) { config.ssl.enabled = false; }
      fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
    "
    success "Предыдущие данные и настройки успешно восстановлены"
  fi

  rm -rf /tmp/welizium_*
fi

if [ "$RESTORE_CONFIG" = false ]; then
  step "Настройка Администратора"
  
  while [ -z "$ADMIN_USER" ]; do
    prompt "Придумайте логин:"
    read -r ADMIN_USER
  done

  while [ -z "$ADMIN_PASS" ]; do
    prompt "Придумайте пароль:"
    read -rs ADMIN_PASS
    echo ""
  done

  info "Генерация секретных ключей..."

  JWT_SECRET=$(openssl rand -hex 32)
  ADMIN_PATH=$(openssl rand -hex 8)
  HASHED_PASSWORD=$(node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('$ADMIN_PASS', 10).then(hash => console.log(hash));")

  cat > config.json << EOF
{
  "jwtSecret": "$JWT_SECRET",
  "adminPath": "$ADMIN_PATH",
  "ssl": {
    "enabled": false,
    "type": "none",
    "domain": "",
    "certPath": "",
    "keyPath": ""
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
  
  success "Конфигурация успешно создана"
fi

mkdir -p uploads
mkdir -p sites

# ==========================================
# Системные службы и Фаервол
# ==========================================
step "Настройка системы"
info "Создание службы systemd (welizium.service)..."

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
  success "Служба Welizium успешно запущена"
else
  warn "Возможно, служба не запустилась. Проверьте логи: journalctl -u welizium -n 50"
fi

if command -v ufw &> /dev/null; then
  info "Настройка UFW фаервола..."
  ufw allow 1337/tcp > /dev/null 2>&1
  success "Открыт порт 1337 (HTTP)"
fi

# ==========================================
# Утилита CLI
# ==========================================
step "Установка CLI инструмента"
info "Создание команды 'welizium'..."

cat > /usr/local/bin/welizium << 'EOFCLI'
#!/bin/bash

WELIZIUM_DIR="/opt/welizium"
CONFIG_FILE="$WELIZIUM_DIR/config.json"

RED='\033[38;5;196m'
GREEN='\033[38;5;46m'
YELLOW='\033[38;5;226m'
BLUE='\033[38;5;39m'
CYAN='\033[38;5;51m'
WHITE='\033[38;5;255m'
NC='\033[0m'

if [ ! -f "$CONFIG_FILE" ]; then
  echo -e "${RED}✖ Ошибка: Welizium не установлен или конфиг не найден${NC}"
  exit 1
fi

show_banner() {
  echo -e "${CYAN}╭─────────────────────────────────────╮${NC}"
  echo -e "${CYAN}│  ${WHITE}⚡ WELIZIUM ADMIN CLI${CYAN}              │${NC}"
  echo -e "${CYAN}╰─────────────────────────────────────╯${NC}"
  echo ""
}

show_status() {
  show_banner
  
  if systemctl is-active --quiet welizium; then
    echo -e "${GREEN}● Статус:${NC} Работает"
  else
    echo -e "${RED}● Статус:${NC} Остановлен"
  fi
  
  ADMIN_PATH=$(node -e "console.log(require('$CONFIG_FILE').adminPath)" 2>/dev/null)
  ADMIN_USER=$(node -e "console.log(require('$CONFIG_FILE').users[0].username)" 2>/dev/null)
  SERVER_IP=$(hostname -I | awk '{print $1}')
  
  URL="http://${SERVER_IP}:1337/${ADMIN_PATH}"
  
  echo -e "${CYAN}● URL:${NC}      ${WHITE}${URL}${NC}"
  echo -e "${CYAN}● Логин:${NC}    ${WHITE}${ADMIN_USER}${NC}"
  echo -e "${CYAN}● Протокол:${NC} ${WHITE}HTTP${NC}"
  echo ""
}

change_password() {
  show_banner
  read -p "$(echo -e ${WHITE}Введите новый пароль: ${NC})" -s NEW_PASS
  echo ""
  
  if [ -z "$NEW_PASS" ]; then
    echo -e "${RED}Пароль не может быть пустым${NC}"
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
  
  echo -e "${GREEN}✔ Пароль успешно изменен${NC}"
  echo -e "${YELLOW}Перезапуск службы...${NC}"
  systemctl restart welizium
  echo -e "${GREEN}✔ Готово${NC}"
}

change_username() {
  show_banner
  read -p "$(echo -e ${WHITE}Введите новый логин: ${NC})" NEW_USER
  
  if [ -z "$NEW_USER" ]; then
    echo -e "${RED}Логин не может быть пустым${NC}"
    exit 1
  fi
  
  node -e "
    const fs = require('fs');
    const config = require('$CONFIG_FILE');
    config.users[0].username = '$NEW_USER';
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
  "
  
  echo -e "${GREEN}✔ Логин изменен на: ${WHITE}${NEW_USER}${NC}"
}

show_logs() {
  journalctl -u welizium -f
}

show_url() {
  ADMIN_PATH=$(node -e "console.log(require('$CONFIG_FILE').adminPath)" 2>/dev/null)
  SERVER_IP=$(hostname -I | awk '{print $1}')
  echo "http://${SERVER_IP}:1337/${ADMIN_PATH}"
}

show_menu() {
  show_banner
  echo -e "${WHITE}Доступные команды:${NC}"
  echo -e "  ${CYAN}status${NC}          Показать статус и информацию"
  echo -e "  ${CYAN}start${NC}           Запустить панель"
  echo -e "  ${CYAN}stop${NC}            Остановить панель"
  echo -e "  ${CYAN}restart${NC}         Перезапустить панель"
  echo -e "  ${CYAN}logs${NC}            Смотреть логи (live)"
  echo -e "  ${CYAN}url${NC}             Вывести ссылку на админку"
  echo -e "  ${CYAN}password${NC}        Изменить пароль"
  echo -e "  ${CYAN}username${NC}        Изменить логин"
  echo -e "  ${CYAN}config${NC}          Путь до файла конфигурации"
  echo -e "  ${CYAN}update${NC}          Обновить файлы панели с GitHub"
  echo ""
  echo -e "${WHITE}Использование:${NC} welizium [команда]"
  echo ""
}

update_welizium() {
  show_banner
  echo -e "${YELLOW}Обновление Welizium...${NC}"
  
  cd "$WELIZIUM_DIR"
  
  curl -sS -o server.js https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/server.js
  curl -sS -o public/index.html https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/index.html
  curl -sS -o public/style.css https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/style.css
  curl -sS -o public/app.js https://raw.githubusercontent.com/moonvide/Welizium/refs/heads/main/public/app.js
  
  npm install --production --silent > /dev/null 2>&1
  
  echo -e "${GREEN}✔ Файлы обновлены${NC}"
  echo -e "${YELLOW}Перезапуск службы...${NC}"
  systemctl restart welizium
  echo -e "${GREEN}✔ Welizium успешно обновлен!${NC}"
}

case "$1" in
  status) show_status ;;
  start) systemctl start welizium; echo -e "${GREEN}✔ Welizium запущен${NC}" ;;
  stop) systemctl stop welizium; echo -e "${YELLOW}✔ Welizium остановлен${NC}" ;;
  restart) systemctl restart welizium; echo -e "${GREEN}✔ Welizium перезапущен${NC}" ;;
  logs) show_logs ;;
  url) show_url ;;
  password) change_password ;;
  username) change_username ;;
  config) echo "$CONFIG_FILE" ;;
  update) update_welizium ;;
  *) show_menu ;;
esac
EOFCLI

chmod +x /usr/local/bin/welizium
success "Утилита установлена (введите в консоль: welizium)"

# ==========================================
# Финальный вывод
# ==========================================
SERVER_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
ADMIN_PATH=$(node -e "console.log(require('./config.json').adminPath)")
ADMIN_USER=$(node -e "console.log(require('./config.json').users[0].username)")
ADMIN_URL="http://${SERVER_IP}:1337/${ADMIN_PATH}"

echo -e "\n"
echo -e "${GREEN}${BOLD}  ╭─────────────────────────────────────────────────────────╮${RESET}"
echo -e "${GREEN}${BOLD}  │                                                         │${RESET}"
echo -e "${GREEN}${BOLD}  │   🎉 ${WHITE}WELIZIUM УСПЕШНО УСТАНОВЛЕН!                       ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}  │                                                         │${RESET}"
echo -e "${GREEN}${BOLD}  ├─────────────────────────────────────────────────────────┤${RESET}"
echo -e "${GREEN}${BOLD}  │                                                         │${RESET}"
echo -e "${GREEN}${BOLD}  │   ${CYAN}🌐 Админ-панель: ${WHITE}${ADMIN_URL}${RESET}"
echo -e "${GREEN}${BOLD}  │   ${CYAN}👤 Ваш логин:    ${WHITE}${ADMIN_USER}${RESET}"
echo -e "${GREEN}${BOLD}  │                                                         │${RESET}"
echo -e "${GREEN}${BOLD}  │   ${YELLOW}⚠️  ВАЖНО: Сохраните эту ссылку, иначе вы           ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}  │   ${YELLOW}   не сможете войти в панель управления!          ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}  │                                                         │${RESET}"
echo -e "${GREEN}${BOLD}  ├─────────────────────────────────────────────────────────┤${RESET}"
echo -e "${GREEN}${BOLD}  │                                                         │${RESET}"
echo -e "${GREEN}${BOLD}  │   ${GRAY}Полезные команды:${RESET}                                     ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}  │   ${GRAY}• Меню управления: ${WHITE}welizium${RESET}                           ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}  │   ${GRAY}• Статус и ссылка: ${WHITE}welizium status${RESET}                    ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}  │   ${GRAY}• Просмотр логов:  ${WHITE}welizium logs${RESET}                      ${GREEN}${BOLD}│${RESET}"
echo -e "${GREEN}${BOLD}  │                                                         │${RESET}"
echo -e "${GREEN}${BOLD}  ╰─────────────────────────────────────────────────────────╯${RESET}"
echo -e "\n"