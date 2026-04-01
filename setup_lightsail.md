# Lightsail 部署教學

將 crypto-trading 部署到 Amazon Lightsail，讓程式 24/7 運行，不需要開著自己的電腦。

---

## Step 1 — SSH 進入 Lightsail

從 Lightsail 控制台點「Connect using SSH」，或用自己的 SSH key：
```bash
ssh -i your-key.pem ubuntu@你的IP
```

---

## Step 2 — 安裝 Node.js 18+

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node -v  # 確認 v18+
```

---

## Step 3 — 安裝 PM2（讓程式背景常駐）

```bash
sudo npm install -g pm2
```

### 如果出現 `pm2: command not found`

```bash
# 把 npm 全域 bin 加進 PATH
export PATH=$PATH:$(npm prefix -g)/bin
pm2 --version

# 永久生效
echo 'export PATH=$PATH:/usr/local/bin' >> ~/.bashrc
source ~/.bashrc
pm2 --version
```

如果還是找不到，先確認 pm2 位置：
```bash
sudo find / -name "pm2" -type f 2>/dev/null | head -5
```

---

## Step 4 — Clone 專案並安裝套件

```bash
git clone https://github.com/SamuelPeng60/crypto_trading.git
cd crypto_trading
npm install   # better-sqlite3 會自動編譯原生 binding，需要幾分鐘
npm run build
```

---

## Step 5 — 設定環境變數（選填，實盤 / Telegram 才需要）

```bash
nano .env.local
```

填入：
```
BINANCE_API_KEY=xxx
BINANCE_API_SECRET=xxx
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CHAT_ID=xxx
```

---

## Step 6 — 用 PM2 啟動

```bash
pm2 start npm --name "crypto-trading" -- start -- --port 3333
pm2 save          # 儲存目前的 process 清單
pm2 startup       # 產生開機自動啟動指令，複製輸出的那行指令貼上執行
```

常用 PM2 指令：
```bash
pm2 list                        # 查看所有 process
pm2 logs crypto-trading         # 看即時 log
pm2 restart crypto-trading      # 重啟
pm2 stop crypto-trading         # 停止
```

---

## Step 7 — 開放 Lightsail 防火牆 Port 3333

1. 進入 Lightsail 控制台
2. 點選你的 instance → **Networking**
3. **Firewall** → **Add rule**
   - Protocol: TCP
   - Port: 3333
4. 儲存

之後用瀏覽器開啟：
```
http://你的Lightsail IP:3333
```

---

## 之後更新程式碼

```bash
cd crypto_trading
git pull
npm install
npm run build
#pm2 restart crypto-trading
/home/bitnami/.nvm/versions/node/v24.13.0/lib/node_modules/pm2/bin/pm2 restart crypto-trading
```

---

## 注意事項

- SQLite 資料庫（`data/trading.db`）存在 server 本地，不在 GitHub 上，首次啟動會自動建立
- 策略引擎每 5 分鐘自動 tick，不需要瀏覽器開著
- Lightsail instance 重開機後，PM2 會自動重啟（需執行過 `pm2 startup`）
