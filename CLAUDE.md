@AGENTS.md

# Crypto Trading System — 開發紀錄

## 專案概覽
Next.js 16 App Router 全端加密貨幣交易系統。Port: **3333** (`npm run dev -- --port 3333`)

- **資料庫**：SQLite via `better-sqlite3`（`data/trading.db`）
- **行情來源**：`https://data-api.binance.vision`（非 `api.binance.com`，因美東 Lightsail IP 被封鎖）+ WebSocket 即時報價
- **圖表**：`lightweight-charts` v5（用 `chart.addSeries(CandlestickSeries, {})` 而非舊版 `addCandlestickSeries()`）
- **UI**：shadcn/ui new-york style，使用 `@base-ui/react`（非 radix-ui）
- **生產環境**：Amazon Lightsail（美東 us-east-1），PM2 常駐，開機自動啟動

## 頁面
- `/` — Dashboard（即時行情）
- `/strategies` — 策略管理（新增/啟動/停止/刪除）
- `/backtest` — 回測
- `/trades` — 交易記錄
- `/settings` — 設定

## 策略清單（8 個）

### 1. MA Cross（移動平均交叉）
- 檔案：`lib/backtest.ts` → `backtestMaCross()`
- 參數：`fastPeriod`, `slowPeriod`, `maType (sma|ema)`, `tradeSize`, `stopLoss`, `takeProfit`
- 邏輯：快線上穿慢線買入，下穿賣出

### 2. RSI 超買超賣
- 檔案：`lib/backtest.ts` → `backtestRsi()`
- 參數：`period`, `oversold`, `overbought`, `tradeSize`, `stopLoss`, `takeProfit`
- 邏輯：RSI ≤ oversold 買入，RSI ≥ overbought 或觸及止損/止盈賣出

### 3. Grid（網格交易）
- 檔案：`lib/backtest.ts` → `backtestGrid()`
- 參數：`upperPrice`, `lowerPrice`, `gridCount`, `amountPerGrid`
- 邏輯：在上下界等間距掛單，震盪行情

### 4. SuperTrend（ATR 趨勢追蹤）
- 檔案：`lib/backtest.ts` → `backtestSupertrend()`
- 參數：`atrPeriod`(10), `multiplier`(3), `ema200Filter`(true), `tradeSize`
- 邏輯：ATR 動態追蹤止損線，方向翻轉時切換多空；EMA200 過濾只做順趨勢

### 5. Crypto Pulse（VWAP + BB + RSI 均值回歸）
- 檔案：`lib/backtest.ts` → `backtestVwapBbRsi()`
- 參數：`rsiPeriod`(14), `rsiOversold`(35), `rsiOverbought`(65), `bbPeriod`(20), `bbStdDev`(2), `vwapWindow`(24), `atrPeriod`(14), `atrSlMultiplier`(1.0), `trailAtrMult`(0), `tradeSize`
- 波動率過濾參數：`volRegimeShort`(20), `volRegimeLong`(60), `volRegimeThreshold`(1.3)
- 邏輯：
  - **買入**：RSI < 35 或跌破 BB 下軌，且價格 < VWAP（跌離均值），且不在趨勢行情中
  - **賣出（trailAtrMult=0）**：RSI > 65 或突破 BB 上軌，且價格 > VWAP（均值回歸完成出場）
  - **賣出（trailAtrMult>0）**：停用 RSI overbought 出場，改用 trailing stop（SL 只能上升）；SL = `max_close_since_entry - trailAtrMult × ATR`
  - **止損**：ATR 動態止損 `price - atrSlMultiplier × ATR`（自動跟時間框架縮放）；啟用 trailing stop 後 SL 持續追蹤最高點
  - **波動率過濾**：`calcRealizedVol(20) / calcRealizedVol(60) > 1.3` 時判定為趨勢行情，暫停進場
  - **注意**：`trailAtrMult=0`（預設）= 原始均值回歸模式；`trailAtrMult=2.0`（頁面預設）= 趨勢延伸模式，讓強勢牛市走更長；兩者互斥，trailing stop 啟用時 RSI 出場關閉

### 6. EMA Ribbon + SuperTrend（趨勢追蹤）
- 檔案：`lib/backtest.ts` → `backtestEmaRibbonSt()`
- 參數：`fastEma`(5), `midEma`(13), `slowEma`(34), `atrPeriod`(14), `multiplier`(2.5), `ema200Filter`(true), `atrSlMultiplier`(1.5), `tradeSize`
- 邏輯：
  - **買入**：SuperTrend 翻多（方向 -1→1）AND fast EMA > slow EMA（趨勢確認）AND 價格 > EMA200
  - **賣出**：SuperTrend 翻空 OR fast EMA 跌破 mid EMA（ribbon 破壞）
  - **止損**：ATR 動態止損（不設固定 TP，讓趨勢走完）
  - **最佳時框**：1d（測試結果 Sharpe 1.28，回報 9.9%，回撤 2.5%）
  - **注意**：入場條件原先要求三條 EMA 同時對齊 AND ST flip（同K棒，幾乎不可能），已改為 fast > slow 即可

### 7. MACD + BB Squeeze（突破）
- 檔案：`lib/backtest.ts` → `backtestMacdBbSqueeze()`
- 參數：`macdFast`(12), `macdSlow`(26), `macdSignal`(9), `bbPeriod`(15), `rsiPeriod`(14), `atrPeriod`(14), `atrSlMultiplier`(2), `atrTpMultiplier`(5), `ema200Filter`(true), `tradeSize`
- 邏輯：
  - **買入**：MACD histogram 由負轉正 AND BB 帶寬 ≤ 40棒平均（壓縮區間）AND RSI 35-70 AND 價格 > EMA200
  - **賣出**：MACD histogram 轉負 OR 止損/止盈觸發
  - **止損/止盈**：ATR×2 止損，ATR×5 止盈（R:R ≈ 2.5:1）
  - **最佳時框**：1h
  - **注意**：原版同時要求 prevInSqueeze + expanding + macdCross + rsiOk + ema200（5條件同時），4h 完全無信號，已改為寬鬆的 bandwidth ≤ 40棒平均

### 8. 自適應組合（Adaptive Combo）
- 檔案：`lib/backtest.ts` → `backtestAdaptiveCombo()`，`lib/engine.ts` → `adaptiveComboSignal()`
- 參數：`fastEma`(5), `midEma`(13), `slowEma`(34), `atrPeriod`(14), `multiplier`(2.5), `ema200Filter`(true), `atrSlMultiplier`(1.5), `rsiPeriod`(14), `rsiOversold`(35), `rsiOverbought`(65), `bbPeriod`(20), `bbStdDev`(2), `vwapWindow`(24), `tradeSize`
- 邏輯：
  - **市場狀態偵測**：每根K棒判斷 `st.direction[i-1] === 1 && fastEma > slowEma` → TRENDING UP；否則 SIDEWAYS
  - **TRENDING UP**：使用 EMA Ribbon + SuperTrend 進出場邏輯
    - 買入：SuperTrend 翻多（-1→1）且 fast EMA > slow EMA（且可選 price > EMA200）
    - 賣出：SuperTrend 翻空 OR fast EMA 跌破 mid EMA
    - 止損：ATR trailing stop（持倉期間追蹤最高收盤）
  - **SIDEWAYS**：使用 Crypto Pulse（RSI/BB/VWAP）均值回歸進出場邏輯
    - 買入：RSI < 35 或跌破 BB 下軌，且 price < VWAP
    - 賣出：RSI > 65 或突破 BB 上軌，且 price > VWAP
    - 止損：ATR 固定止損（`price - atrSlMultiplier × ATR`）
  - **設計目標**：不需手動判斷牛熊，自動在趨勢行情用趨勢策略，震盪行情用均值回歸策略
  - **最佳時框**：4h（建議）

## 指標庫（`lib/indicators.ts`）
- `sma()`, `ema()`, `rsi()` — 基礎指標
- `atr()` — Wilder 平滑法 ATR
- `supertrend()` — 回傳 `{ trend[], direction[] }`，direction: 1=上升, -1=下降
- `bollingerBands()` — 回傳 `{ mid[], upper[], lower[] }`
- `vwap()` — 支援 `window=0`（累積）或 rolling window

## API Routes（`app/api/`）
- `POST /api/backtest` — 執行回測，存結果至 `backtest_results` 表
- `GET /api/backtest` — 取最近 50 筆回測記錄
- `GET/POST /api/strategies` — 策略 CRUD
- `PATCH/DELETE /api/strategies/[id]` — 切換啟停、刪除
- `PATCH/DELETE /api/strategies/session/[sessionId]` — 整組停止/刪除
- `GET/POST /api/engine` — GET 查引擎狀態，POST 觸發所有啟用策略執行一次 tick
- `GET /api/positions` — 持倉列表
- `GET /api/klines` — K 線資料
- `GET /api/tickers` — 即時報價
- `GET/PUT /api/settings` — 設定讀寫

## 引擎架構（`lib/engine.ts`）
- `computeSignal(type, params, klines)` — 各策略訊號計算，回傳 `'buy' | 'sell' | 'hold'`
- `runStrategyTick(id)` — 單一策略執行：風控檢查 → 抓K線 → 計算訊號 → 下單/平倉/SL/TP
- `runAllActiveTick()` — 批次執行所有 `is_active=1` 的策略
- **Fresh Buy Guard**：strategies 表有 `last_signal` 欄位，只有訊號從非 buy **轉變**為 buy 時才進場，防止策略剛啟動時因條件已成立而立刻下單
- **背景定時執行**：`instrumentation.ts` 在 server 啟動後 10 秒開始，每 **5 分鐘** 自動 tick，不需要瀏覽器開著

## 資料庫 Migration 紀錄
- Migration 1：strategies 表加 `session_id TEXT`
- Migration 2：strategies 表擴充 type CHECK（加入 ema_ribbon_st, macd_bb_squeeze）
- Migration 3：strategies 表加 `last_signal TEXT NOT NULL DEFAULT 'hold'`
- Migration 4：strategies 表加 `mode TEXT NOT NULL DEFAULT 'paper'`
- Migration 5：重建 strategies_v3，CHECK constraint 加入 `adaptive_combo`
- Migration 6：建立 `participants` 表（參與者管理）
- Migration 7：participants 表加 `bound_session_id TEXT`、`allocated REAL`
- Migration 8：建立 `users`、`user_sessions` 表（登入系統）
- Migration 9：建立 `archives` 表；orders/positions 加 `archive_id`；positions 加 `trail_high REAL`
- Migration 10：participants 表加 `telegram_chat_id TEXT`（個別通知）
- Migration 11：orders 表加 `closed_at TEXT`（持倉關閉時間）
- Migration 12：participants 表加 `settled_at TEXT`、`final_pnl REAL`（結算）
- Migration 13：重建 strategies_v4，CHECK constraint 加入 `ma_consolidation_breakout`
- Migration 14：positions 表加 `trail_sl REAL`（跨 tick 保存最高 SL，實作「只升不降」trailing stop）

## 回測結論（已扣除幣安手續費 0.1%/單邊）

### 最佳週期
| 策略 | 最高回報週期 | 平均回報 | 最高勝率週期 | 平均勝率 |
|------|------------|---------|------------|---------|
| Crypto Pulse | 4h | +8.1% | 1d | 45% |
| MA Cross | 1d | +4.8% | 1d | 53% |
| SuperTrend | 4h | +3.2% | 4h | 47% |
| EMA Ribbon | 4h | +2.9% | 4h | 53% |
| MACD Squeeze | 1d | +2.1% | 1d | 50% |
| RSI | 4h | +1.8% | 4h | 67% |

### 推薦運行組合（Crypto Pulse 4h，trailAtrMult=2.0, atrSlMultiplier=1.0）
| 幣種 | 2022 🐻 | 2023 🐂 | 2024 🐂 | 2025 📊 |
|------|---------|---------|---------|---------|
| **4幣平均** | **+4.5%** | **+14.4%** | **+11.2%** | **+8.9%** |

參數掃描（23 組合 × 4 幣種 × 4 年）結論：`atrSlMultiplier=1.0` 是最強改變，每年全線提升。
舊預設（trail=2.5, sl=1.5）平均 8.3%；新預設（trail=2.0, sl=1.0）平均 9.7%，+1.4% 整體提升，2022 熊市從 +1.4% 跳至 +4.5%。

### 重要發現：15m 策略被手續費毀滅
- 15m Crypto Pulse：864 trades × 0.2% round-trip ≈ 累計手續費超過本金 → 實際回報接近 0 或負值
- 所有策略的 `STRATEGY_DEFAULT_INTERVAL['vwap_bb_rsi']` 已從 `'15m'` 改為 `'4h'`

## 回測頁功能（`app/backtest/page.tsx`）
- **勝率最高** 按鈕：套用 `BEST_WR_PRESET[type]` 參數組合
- **回報最高** 按鈕：套用 `BEST_RETURN_PRESET[type]` 參數組合
- **跑績效 ▶** 按鈕：選幣種後建立並啟動策略，跳轉策略頁
- K線週期選到最高回報週期時顯示「回報最高」黃色標籤
- 夏普比率卡片有 ⓘ hover tooltip 說明

## 策略頁功能（`app/strategies/page.tsx`）
- Session 分組顯示（一鍵建立的策略歸同一 session）
- 運行中顯示 live 計時「已運行 Xh Ym」（每分鐘更新）
- 停止後凍結顯示「已停止 · 共運行 Xh Ym」
- 全部停止時頂部顯示警示橫條「目前沒有任何策略在運行」

## 一鍵模擬盤（`components/seed-dialog.tsx`）
- 選策略類型後自動帶入最佳預設週期
- 時間框架旁顯示「回報最高」標籤（與回測頁邏輯相同）

## 開發路線圖（PHASE）

### ✅ PHASE 1 — 基礎架構（已完成）
- SQLite DB（strategies/orders/positions/logs/backtest）
- Binance REST API + WebSocket 即時報價
- Dashboard 行情總覽（4幣種 + K線圖）
- 5個策略定義 + 回測引擎
- 所有頁面骨架（策略/回測/交易記錄/設定）

### ✅ PHASE 2 — 模擬交易引擎（已完成）
- 策略執行引擎（`lib/engine.ts`）
- 自動模擬下單 → 寫入 orders 表
- positions 持倉追蹤（進場價/數量/浮動盈虧）
- strategy_logs 執行日誌
- Fresh Buy Guard（防止啟動即下單）
- Server-side 背景定時執行（`instrumentation.ts`，每 5 分鐘）

### ✅ PHASE 3 — 績效分析儀表板（已完成）
- 每策略獨立績效（勝率/PnL/MDD/Sharpe/Profit Factor/Avg Win/Avg Loss/Best/Worst Trade）
- 資金曲線圖（Equity Curve，策略展開後個別曲線）
- Dashboard 迷你 Equity 曲線（首頁即時顯示）
- 策略展開後顯示最近 50 筆個別交易記錄
- 回測結果歷史比較（回測頁 tab）
- 策略間績效排行（支援全部 7 種策略 TYPE_LABEL）
- 每日/幣種分析 tab
- 累積資金曲線可切換「合計 / 各幣種」個別顯示
- 顯示投入本金（`totalInvested` / `symbolInvested`）與計算出的報酬率%
- `/api/stats` 新增 `symbolEquity`、`totalInvested`、`symbolInvested` 欄位
- **投入本金計算方式**：從 `strategies.params` 取 `tradeSize`（每策略分配的本金，循環使用非累加），而非加總所有買單金額

### ✅ PHASE 4 — 實盤交易（已完成）
- Settings 設定 Binance API Key（加密儲存）
- 真實下單（Binance REST API，placeOrder()）
- 風控系統（每日最大虧損自動停止策略、單筆倉位上限）
- 通知推播（Telegram Bot：買入/賣出/止損/止盈/風控停止）
- Paper/Live 模式切換（全域設定）
- API 連線測試 + Telegram 測試通知按鈕

## 重要修正紀錄

### 資金曲線空白修正（lightweight-charts 重複時間戳）
**問題**：同一個 engine tick 內多筆交易的 `closed_at` 相同（同秒），`buildEquityFromOrders` 產生重複 `time` 值，`series.setData()` 拋出例外，整個 `useEffect` 靜默失敗，圖表完全空白
- **根本原因**：`lightweight-charts` 要求時間戳嚴格遞增，重複時間點會讓整條曲線消失
- 修前：直接 `points.push()`，重複時間戳照存
- 修後：改用 `Map<timestamp, value>` 去重（相同秒內的多筆 trade 合併成一點），最後排序輸出
- 同步修正 SQLite 日期格式：`"YYYY-MM-DD HH:MM:SS"` 加 `.replace(' ', 'T') + 'Z'` 確保正確 UTC 解析
- 修改位置：`app/api/stats/route.ts` → `buildEquityFromOrders()`

### Crypto Pulse VWAP 條件修正
**問題**：原始碼 VWAP 條件寫反，導致回測 0 筆交易、全部值為 0
- 修前：超賣時要求 `price > VWAP`（永遠不成立）
- 修後：超賣時要求 `price < VWAP`（跌離均值才買）

### Crypto Pulse 勝率高但報酬差的修正
**問題**：固定 TP 和 overbought 訊號搶先出場，勝利只拿 +1~2%，虧損卻是完整 -3%
- 修前：SL + TP + overbought 訊號三路搶出場
- 修後：移除固定 TP，只用 SL（硬止損）+ overbought 訊號（均值回歸完成再出場）
- 效果：贏的讓市場走完整段，輸的有固定上限

### Crypto Pulse 固定止損不適配不同時框的修正
**問題**：固定 `-stopLoss%` 止損沒有跟著時間框架縮放，導致 1h 勝率 52.7% 但報酬 -0.82%，1d 勝率 36.8% 反而報酬 +4.21%
- **根本原因**：1h 每根 K 棒波動只有 0.3–0.5%，均值回歸利潤約 0.5–1%，但止損固定 -3%。即使勝率過半，數學期望值仍為負（`0.527×0.8% - 0.473×3% ≈ -1%`）
- 修前：止損 = `price × (1 - stopLoss%)`，所有時框相同
- 修後：止損 = `price - atrSlMultiplier × ATR`，自動跟波動幅度縮放
  - 1h：ATR ≈ 0.4% → 止損 ≈ 0.6%，符合回歸潛力
  - 1d：ATR ≈ 2.5% → 止損 ≈ 3.75%，符合更大的回歸幅度
- 參數：`atrPeriod`(14), `atrSlMultiplier`(1.0)，可在回測頁調整

### 手續費扣除
- `lib/backtest.ts` 加入 `const BINANCE_FEE = 0.001`，買入扣 `tradeSize × (1 + FEE)`，賣出收 `qty × price × (1 - FEE)`
- 所有 7 個策略函式均已套用，包含 SL/TP/ATR SL/ATR TP 出場

### SuperTrend 引擎賣出條件 EMA200 多餘過濾修正（2026-05-24）

**問題**：引擎 `supertrendSignal`（`lib/engine.ts`）在 `ema200Filter=true` 時，賣出訊號多加了 `curPrice < curE200` 條件；回測無此條件（ST 翻空即出場）。

**影響**：當 SuperTrend 翻空但價格仍在 EMA200 上方時，引擎回傳 `'hold'`，持倉無限期不關閉（因為下一個 tick 翻空的 bar 已移到 `direction[n-2]`，再也找不到 flip 事件）。

**修正（`lib/engine.ts`）**：
- 修前：`if (direction[n-2] === 1 && direction[n-1] === -1 && curPrice < curE200) return 'sell'`
- 修後：`if (direction[n-2] === 1 && direction[n-1] === -1) return 'sell'`（EMA200 只過濾進場，不過濾出場）

**回測影響**：無（回測本身邏輯正確，不需修改）。引擎行為現在與回測一致。

### EMA Ribbon 進場條件放寬
- 修前：要求 3 條 EMA 同時對齊 AND ST flip（同一K棒，幾乎不可能，每年約 2 筆交易）
- 修後：`stFlipUp && emaFast > emaSlow`（ST翻多 + 快線在慢線上方即可）
- 新增 trailing stop：追蹤 `trailingHigh`（持倉期間最高收盤），止損 = `trailingHigh - atrSlMultiplier × ATR`

### MACD Squeeze 進場條件放寬
- 修前：5 條件同時（prevInSqueeze + expanding + macdCross + rsiOk + ema200），4h 完全無信號
- 修後：BB 帶寬 ≤ 40棒平均（寬鬆 squeeze 代理），RSI 35-70，MACD histogram 由負轉正

### Binance API 美東封鎖問題
- `api.binance.com`、`api3.binance.com`、`api-gcp.binance.com` 在 Lightsail 美東（us-east-1）全部封鎖（含 api1~api4 和 Cloudflare Worker 美東節點）
- 公開行情改用 `https://data-api.binance.vision`（不受地區限制）
- 認證 endpoint（下單/帳戶）透過 Oracle Cloud 免費方案 nginx proxy 轉發
- 修改位置：`lib/binance.ts` 第 1 行 `const TRADE_BASE` 改讀 `process.env.BINANCE_TRADE_BASE`
- WebSocket（`wss://stream.binance.com`）從瀏覽器直連，不經過 server，不受影響

#### Oracle Cloud Proxy（2026-04-08）
- **伺服器**：Oracle Cloud 免費方案，東京 region，IP `168.138.194.210`
- **用途**：轉發 Binance 認證 API 請求（繞過美東 IP 封鎖）
- **nginx 設定**：`/etc/nginx/sites-available/binance-proxy`，port 8080，轉發 `/api/v3/` 到 `api-gcp.binance.com`
- **Lightsail `.env.local`**：`BINANCE_TRADE_BASE=http://168.138.194.210:8080`
- **Binance API Key IP 白名單**：需加入 `168.138.194.210`
- SSH 連線：`ssh oracle`（設定於 `~/.ssh/config`，key: `C:\Users\ASUS\Desktop\ssh-key-2026-04-07.key`，user: ubuntu）
- 重啟 nginx：`sudo systemctl reload nginx`
- 延遲影響：多一跳約 100–200ms，5 分鐘策略完全不影響

### Lightsail 部署
- 詳細教學見 `setup_lightsail.md`
- Node.js 18 + PM2 常駐，`pm2 startup` 設定開機自動啟動
- Firewall 開放 TCP port 3333
- 訪問：`http://34.206.128.225:3333`
- PM2 路徑（`pm2` 指令找不到時用完整路徑）：`/home/bitnami/.nvm/versions/node/v24.13.0/lib/node_modules/pm2/bin/pm2`
- 每次 git pull 後需要 `npm run build` 再 restart，否則 production build 仍是舊版
- 部署指令：`git pull && npm install && npm run build && /home/bitnami/.nvm/versions/node/v24.13.0/lib/node_modules/pm2/bin/pm2 restart crypto-trading`
- `$HOME` 環境變數可能指向 `/tmp`，nvm 需用絕對路徑載入：`source /home/bitnami/.nvm/nvm.sh`
- **正確 PM2 daemon**：`PM2_HOME=/home/bitnami/.pm2`，直接下 `pm2` 指令時若 list 是空的，代表連到 `/tmp/.pm2` 錯誤 daemon；需加 `PM2_HOME=/home/bitnami/.pm2` 前綴，或用完整路徑
- 正確 restart 指令：`PM2_HOME=/home/bitnami/.pm2 /home/bitnami/.nvm/versions/node/v24.13.0/lib/node_modules/pm2/bin/pm2 restart crypto-trading --update-env`
- **`.env.local` 內容**（`/opt/bitnami/projects/crypto_trading/.env.local`）：
  ```
  ENCRYPTION_SECRET=<32字元以上隨機字串>
  BINANCE_TRADE_BASE=http://168.138.194.210:8080
  ```
- SSH 連線別名：`ssh lightsail`（設定於 `C:\Users\ASUS\.ssh\config`）
- VS Code Remote SSH：用 `lightsail` 別名連線（config 內需有 Host lightsail 區塊）

#### ⚠️ HTTP 部署的 secure cookie 陷阱（2026-04-04）
**症狀**：登入輸入正確帳密後，頁面卡在 `/login` 不跳轉。
**根本原因**：`secure: process.env.NODE_ENV === 'production'` 在 `NODE_ENV=production` 時設 `secure: true`，但 Lightsail 是純 HTTP（非 HTTPS），瀏覽器拒絕在 HTTP 連線儲存 secure cookie，導致 session token 永遠無法寫入，每次請求 `/api/auth/me` 都回 401，前端以為未登入而停留在 login 頁。
**修正**：`app/api/auth/login/route.ts` 改為 `secure: process.env.HTTPS === 'true'`，只在明確設定 `HTTPS=true` 環境變數時才啟用，HTTP 部署預設 `false`。
**教訓**：`NODE_ENV=production` ≠ 使用 HTTPS。若未來架設 HTTPS，在 `.env.production` 加入 `HTTPS=true` 即可自動啟用。

### K線圖（`components/price-chart.tsx`）
- Dashboard K線圖用 `createSeriesMarkers`（v5 API）畫 B/S 標記
- 買入：K棒下方綠色向上箭頭 `B $價格`；賣出：K棒上方紅色向下箭頭 `S $價格`
- 時間 floor 到對應時框（1h→整點、4h→每4h、1d→當天 00:00 UTC）
- 只顯示 `filled_price != null && status != 'pending'` 的訂單
- **策略條件面板**：標題列選策略後顯示對應買入/賣出條件即時數值（7 種策略各有不同條件）；無持倉顯示買入條件，有持倉顯示賣出條件
- **B/S 標記依策略過濾**：`/api/orders?strategyType=xxx`；不選策略時清空標記
- **回測同步**：回測頁「跑績效」後自動把策略類型存 `localStorage('dashboard_strategy')`，回首頁自動套用
- **技術指標疊加**：右上角三個切換按鈕（EMA7 青色、EMA30 橘色、BB 紫色），勾選後即時繪製；切換幣種/時框自動重算
- **OHLC tooltip**：滑鼠懸停 K 棒顯示左上角 H/L/C，有勾指標時第二行顯示該棒指標數值
- **VWAP 黃點線**：選 Crypto Pulse 策略時自動顯示 VWAP 參考線
- `/api/indicators`：後端計算各策略即時條件，支援 `strategy` + `inPosition` + `symbol` + `interval` 參數
- **時區**：所有時間戳加上 `TZ_OFFSET_S = -new Date().getTimezoneOffset() * 60`，圖表顯示本地時間（非 UTC）
- **左邊界鎖定**：`subscribeVisibleLogicalRangeChange` 偵測 `from < 0` 時強制拉回，防止滑過第一根K棒
- **初始縮放**：統一顯示最近 300 根K棒（`setVisibleLogicalRange({ from: total-300, to: total-1 })`）
- **資料範圍**：1m 往前 350 分鐘、5m 往前 ~29h、15m 往前 ~87h、1h 往前 1 個月、4h 往前 3 個月、1d 往前 2 年；均用 `startTime` 傳給 `/api/klines`
- `/api/klines` 的 `limit` 預設改為 1000，支援 `startTime` query param
- `data/` 目錄被 `.gitignore` 排除，DB 不隨 git 同步，Lightsail 上的資料獨立

### Telegram Bot（`lib/telegram-bot.ts`）
- Server 啟動 15 秒後開始 long polling（`instrumentation.ts`）
- 指令：`/chart [symbol]` — 用 Puppeteer 截圖 `/chart-preview/[symbol]` 頁面並傳到聊天室
- 支援：`btc`, `eth`, `sol`, `bnb`（或完整幣名如 `SOLUSDT`）
- 截圖頁面：`app/chart-preview/[symbol]/`，等待 `#chart-preview[data-loaded]` 後截圖
- Token/ChatId 從 Settings 頁設定，存於 SQLite

#### Puppeteer Lightsail 部署注意事項（2026-05-10）

**問題 1：截圖失敗「Could not find Chrome」**
- **根本原因**：Lightsail PM2 執行時 `$HOME=/tmp`（已知問題），但 `npm install` 把 Puppeteer bundled Chrome 下載到 `/home/bitnami/.cache/puppeteer`，執行時找 `/tmp/.cache/puppeteer` 找不到
- **修正**：在 Lightsail `.env.local` 加 `PUPPETEER_CACHE_DIR=/home/bitnami/.cache/puppeteer`
- Chrome binary 位置：`/home/bitnami/.cache/puppeteer/chrome/linux-<版本>/chrome-linux64/chrome`

**問題 2：圖表顯示錯誤條件、B/S 標記不顯示**
- **根本原因**：`chart-preview` client 端 fetch `/api/positions` 和 `/api/orders`，但這兩個 route 有 auth 檢查，Puppeteer headless browser 無 session cookie → 401 → 持倉狀態永遠 `false`（永遠顯示買入條件）、標記完全不畫
- **修正**：`app/chart-preview/[symbol]/page.tsx`（server component）直接查 DB 取得 `initialInPosition` 和 `initialOrders`，以 props 傳給 client，client 不再 fetch 這兩個需要 auth 的 API
- **原則**：未來若 chart-preview 需要其他需要 auth 的資料，一律在 `page.tsx` server side 查 DB，不在 client 端 fetch

### Crypto Pulse 官方參數統一（2026-04-01）
**問題**：回測頁 UI 預設（vwapWindow=48, atrSlMultiplier=1.0）與 CLAUDE.md/README 表格所用參數（vwapWindow=24, atrSlMultiplier=1.5）不同，導致網頁回測數字與文件數字不符。
**決定**：統一採用 `vwapWindow=24, atrSlMultiplier=1.0`（參數掃描後最優）。
**修改位置**：`app/backtest/page.tsx`（state 預設值 + BEST_WR/BEST_RETURN preset）、`components/seed-dialog.tsx`（defaultParams）。
CLAUDE.md 與 README 的回測表格本身即以此參數計算，無需修改。

### ✅ 績效分析模擬/實盤切換（2026-04-01）
- `/api/stats` 新增 `?mode=paper|live|all` query param，所有 SQL 查詢（orders、positions、daily/symbol breakdown、strategiesWithTrades）均加上 mode 過濾
- `/performance` 頁右上角加三段切換器（🟡 模擬 / 🔴 實盤 / 全部），切換時自動重新 fetch 並重繪所有圖表與統計

### 一鍵實盤按鈕 + Per-Strategy Mode（2026-04-01）
- strategies 表新增 `mode TEXT NOT NULL DEFAULT 'paper'`（Migration 4）
- 風控設定：每日最大虧損 & 單筆最大倉位說明更新為「模擬 & 實盤均適用」；移除無作用的 `defaultCapital` 欄位（引擎從未使用）
- `app/api/strategies/route.ts` POST 接受並儲存 `mode` 參數
- `lib/engine.ts` 改用 `strategy.mode ?? settings.mode`，每個策略可獨立設定模擬/實盤，不再受全域設定影響
- `components/seed-dialog.tsx`：
  - 新增 `initialMode` prop（`'paper' | 'live'`）
  - 對話框頂部加模擬/實盤切換 toggle
  - 選實盤時顯示紅色警告提示；按鈕/標題顏色隨模式改變
- `app/strategies/page.tsx`：
  - 新增「一鍵實盤」按鈕（紅色邊框），與「一鍵模擬盤」並排
  - Session 標頭與單獨策略卡片均顯示 🟡 模擬 / 🔴 實盤 badge
  - `seedMode` state 控制開啟哪種模式的對話框

### Fresh Buy Guard（引擎防止啟動即下單）
- strategies 表新增 `last_signal TEXT DEFAULT 'hold'`
- 進場條件：`signal === 'buy' && last_signal !== 'buy'`（需訊號轉換，非持續狀態）
- 每次 tick 結尾更新 `last_signal`

### Crypto Pulse — LLM Council 分析與雙修正（2026-04-01）
**背景**：用 /council 對 Crypto Pulse 策略做五人顧問委員會壓力測試，找出設計缺陷。

**最高共識缺陷（5位顧問均同意）**
- **Fix 1（必做）：信號基於未確認K棒**：引擎每 5 分鐘 tick，對仍在形成中的 4h K棒計算 RSI/BB/VWAP。影棒 spike 可觸發 RSI < 35 後立即回復，回測從未見到此信號但實盤卻下單。估計造成 30–50% 實盤 vs 回測績效差距。
  - 修正：`lib/engine.ts` 計算信號時改為 `klines.slice(0, -1)`，只用已收盤K棒
- **Fix 2（高優先）：趨勢行情盲區**：均值回歸策略在強趨勢中持續虧損，2022 熊市四幣平均 -2.46%。
  - 修正：`lib/backtest.ts` + `lib/engine.ts` 新增已實現波動率過濾器
  - 邏輯：`stddev(log_returns, 20) / stddev(log_returns, 60) > 1.3` → 判定趨勢行情 → 暫停進場
  - 新參數：`volRegimeShort`(20), `volRegimeLong`(60), `volRegimeThreshold`(1.3)

**修正前後回測對比（4h，已扣手續費）**
| 年份 | 修正前平均 | 修正後平均 | 變化 |
|------|-----------|-----------|------|
| 2022 🐻 | -2.46% | +0.52% | **+2.98%** |
| 2023 🐂 | +7.15% | +6.87% | -0.28% |
| 2024 🐂 | +6.47% | +8.40% | **+1.93%** |
| 2025 📊 | +6.76% | +7.03% | +0.27% |

**Council 結論（未實施）**：Fix 3（OR 改 AND 進場條件）有爭議，C 顧問認為在波動率過濾已擋掉趨勢行情後，Fix 3 會使交易次數太少、無法統計驗證。暫不實施。

**回測頁新增功能**：波動率過濾三參數輸入框 + 「各年度回測 2021–2025 ▶」按鈕（僅 vwap_bb_rsi 顯示），跑完自動顯示 5×4 矩陣表格。

### 登入系統與角色權限（2026-04-02）

#### 架構
- **Next.js 16 proxy**：`proxy.ts`（Next.js 16 把 middleware 改名為 proxy，export 函式也改名為 `proxy`）
- **認證**：`lib/auth.ts` — `hashPassword/verifyPassword`（Node.js `crypto.scryptSync`），`createSession/getSession`（SQLite `user_sessions` 表，7天有效），`ensureAdmin`（首次啟動自動建立 admin/admin123）
- **Session cookie**：`ct_session`，httpOnly，sameSite: lax
- **AuthProvider**：`components/auth-provider.tsx`，全域 React Context，`user.role === 'admin'` 判斷身份
- **登入後重導向**：必須用 `window.location.href = '/'`，不能用 `router.push`（後者不會重新掛載 AuthProvider，user 永遠是 null）
- **公開路徑**：`PUBLIC_PREFIXES = ['/login', '/api/auth/']`（含斜線，讓所有 /api/auth/* 路徑通過）

#### 資料庫（Migration 8）
- `users` 表：`id, username, password_hash, role, created_at`
- `user_sessions` 表：`id, user_id, token, expires_at, created_at`

#### 角色權限對照
| 功能 | Admin | User |
|------|-------|------|
| 查看所有頁面 | ✅ | ✅（Settings 除外） |
| 策略新增/啟停/刪除 | ✅ | 唯讀 |
| 回測執行（跑績效 ▶） | ✅ | 隱藏 |
| 回測策略參數 | 顯示 | 隱藏 |
| 交易記錄刪除（逐條/全部） | ✅ | 隱藏 |
| 設定頁 | ✅ | 重導向 / |
| 使用者管理 | ✅ | 無此頁 |

#### 新頁面 / 新 API
- `app/login/page.tsx` — 全螢幕登入表單（sidebar 在 /login 路由返回 null）
- `app/admin/users/page.tsx` — 使用者管理（新增/刪除/重設密碼），非 admin 自動重導向
- `app/api/auth/login/route.ts` — 登入，設定 cookie
- `app/api/auth/logout/route.ts` — 登出，清除 cookie
- `app/api/auth/me/route.ts` — 回傳目前登入使用者
- `app/api/auth/users/route.ts` — 使用者 CRUD（admin only）
- `app/api/auth/change-password/route.ts` — 使用者自行改密碼

#### 綁定參與者的自動過濾
- `lib/use-my-session.ts`：自訂 hook，比對 `participants.name === user.username`，回傳 `{ boundSessionId, startDate, ready }`
- **交易記錄頁**（`app/trades/page.tsx`）：mount 時若使用者有綁定 session，自動套用 session 篩選器
- **績效頁**（`app/performance/page.tsx`）：同上，mount 時自動套用綁定 session 篩選器；另有「我的績效」按鈕從 `start_date` 起算 PnL
- **API**：`/api/stats?start_date=YYYY-MM-DD` 對 orders/positions/daily/symbol 全部加日期下限過濾

#### 參與者管理費
- 管理費 10%（從收益中收取），可提領金額 = 投入本金 + PnL × 0.90
- PnL 從各參與者的 `start_date` 起算（`sessId__startDate` 作為 cache key）

### 安全性審計與修正（2026-04-04）

全面審計後修正以下問題：

#### 立即修正（高危）
- **`lib/crypto.ts`**：移除硬編碼 fallback 金鑰，加入最少 32 字元驗證。未設定 `ENCRYPTION_SECRET` 時直接拋錯而非靜默使用弱金鑰
- **`app/api/auth/login/route.ts`**：新增 IP 速率限制（5 次 / 15 分鐘），超過回傳 429；production 環境 cookie 加上 `secure: true`
- **`app/api/stats/route.ts`**：SQL 字串插值改為參數化查詢（`mode`, `session_id`, `start_date` 三個 query param 全部改用 `?` placeholder），防止 SQL injection
- **`next.config.ts`**：新增 HTTP 安全標頭（`X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`）

#### 中期修正（中危）
- **`lib/engine.ts`**：修正所有 4 個 SL/TP 實盤下單失敗的 catch block，原本 `catch { /* continue */ }` 靜默吞錯，現在改為寫入 strategy log + 發送 Telegram 通知並保留部位
- **`instrumentation.ts`**：新增 `isRunning` flag，防止前一個 tick 未完成時下一個定時器又觸發（tick overlap）
- **`lib/auth.ts`**：移除 `ensureAdmin` log 中的預設密碼明文輸出
- **`app/api/participants/route.ts`**：PUT handler 已有 `db.transaction()` 包裝（同時更新多個 strategies 的 tradeSize + participants 記錄，防止崩潰造成部分更新）
- **所有 API routes**：全面補上 `getSessionFromCookieHeader` 認證檢查，確保未登入不能存取任何 API

#### 其他調整
- **`app/api/backtest/route.ts`**：K 線上限從 5000 改為 8640（≈ 30 天 × 5m，避免過大請求）

### Crypto Pulse 冷靜期研究（2026-04-04，最終放棄）

**背景**：Production server 的交易記錄（`data/prod_trades.json`，2026-03-28 ~ 2026-04-02，62 筆）顯示 29 次已結清交易中有 21 次（72%）在 5 分鐘內立刻重買，且**全部都是虧損後馬上重買**。

**根本原因分析**：
- Engine 每 5 分鐘 tick，而策略設計用 4h K棒
- SL 觸發後，當前 4h K棒尚未換棒 → 下一個 5 分鐘 tick 信號計算結果完全相同 → 立刻又買回
- 這是「tick 頻率 vs K棒週期不匹配」造成的問題，與 Fix 1（未確認K棒）是兩個不同的問題

**Production 影響量化**：
- 正常出場（8筆）：PnL = +263.94 USDT
- Bug 造成的快速重買賣出（21筆）：PnL = -215.76 USDT
- 淨結果：+48.17 USDT（表面上還好，實際上是賺了 264 賠了 216）

**測試的解法：`cooldownBars` 參數**
- 在 `lib/backtest.ts` → `VwapBbRsiParams` 新增 `cooldownBars?: number`（已實作並保留在程式碼中）
- 邏輯：任何賣出後，跳過 N 根棒才允許再次買入

**回測測試結論（4h，2022–2026Q1，4幣種）**：

| 冷靜期 | 0m | 4h | 8h | 12h | 24h | 48h |
|--------|----|----|----|----|-----|-----|
| 整體平均報酬 | **+13.1%** | +10.8% | +10.9% | +9.6% | +8.4% | +6.3% |

- **cd=0（無冷靜期）整體表現最好**
- cooldown 越長，報酬越低，因為在牛市中錯過了後續的再進場機會（2023 SOL +134% vs cd=12 +124%）
- 大多數年份 4h 策略每個幣每年只有 1–5 筆交易，連續快速重買的情況在 4h 回測中幾乎不存在
- **5m 回測無意義**：30 天 200+ 次交易 × 0.2% 手續費 = 本金幾乎全部吃掉

**Fix 1 vs cd=1 的差異**（重要）：
- Fix 1（`klines.slice(0, -1)`）：防止「影棒 spike 假信號」，不能防止「SL 後同棒重買」
- cd=1：防止「出場後同根 K 棒重複進場」，但 4h 回測顯示整體報酬反而降低
- 兩者解決不同問題，且 cd 無法在 4h 回測中看出效果（因為 4h 本來就不會有同棒重買）

**最終決定：放棄加入冷靜期**。`cooldownBars` 參數保留在程式碼（`VwapBbRsiParams`）但預設值為 0，不影響現有策略。Production 快速重買問題留待 Fix 1 部署後觀察實際改善效果。

### Crypto Pulse Trailing Stop 改進（2026-04-06）

**問題**：原始 RSI=65 出場在牛市中過早截斷利潤，強勢行情均值回歸後繼續上漲但已出場。

**解法**：新增 `trailAtrMult` 參數（可選，預設 0）
- `trailAtrMult=0`（預設）：維持原始 RSI overbought 出場邏輯（均值回歸模式）
- `trailAtrMult=2.0`（推薦，頁面預設）：停用 RSI 出場，改用 trailing stop 追蹤最高收盤
  - SL = `max(初始SL, max_close_since_entry - trailAtrMult × ATR)`
  - SL 只能上升，不能下降，讓強趨勢繼續走

**修改位置**：`lib/backtest.ts` → `VwapBbRsiParams` + `backtestVwapBbRsi()`，`app/backtest/page.tsx`（回測頁 UI 新增 trailAtrMult 輸入框）

**注意**：trailing stop 和 RSI 出場二擇一，`trailAtrMult > 0` 時 RSI 出場關閉，避免 RSI 先觸發讓 trailing stop 無效

### MTF 多時框策略刪除（2026-04-06）

曾嘗試建立 `vwap_bb_rsi_mtf` 和 `vwap_bb_rsi_mtf2` 策略（4h 看到買點後轉 5m 等確認），但測試後發現均值回歸策略的 5m 確認邏輯會系統性選到最差進場點，報酬率大幅下降。已完整刪除：
- `lib/backtest.ts`：移除 `backtestVwapBbRsiMtf` 和 `backtestVwapBbRsiMtf2`
- `app/api/backtest/route.ts`：移除 MTF 路由
- `app/backtest/page.tsx`：移除 MTF 選項、比較功能

### Crypto Pulse 參數掃描與調優（2026-04-06）

**背景**：實驗性進場過濾器（BB Width、OBV、EMA200、VWAP 偏離度、RSI 背離）全部測試無效後，改從現有參數空間尋找最優組合。

**掃描規模**：23 組合 × 4 幣種（BTC/ETH/SOL/BNB）× 4 年（2022–2025）= 368 次回測

**掃描範圍**：
- `trailAtrMult`：[1.5, 2.0, 2.5, 3.0, 3.5]
- `atrSlMultiplier`：[1.0, 1.5, 2.0, 2.5]
- `volRegimeThreshold`：[1.1, 1.3, 1.5, 2.0]

**關鍵結論：`atrSlMultiplier=1.0` 是最強單一改變**
- 初始止損縮緊後，進場若判斷正確則幾乎不觸發 SL，若觸發則代表真的進錯 → 小虧快出
- 所有 trailAtrMult 值配搭 sl=1.0 均比 sl=1.5 更好

**最優組合排行（4幣平均）：**
| 組合 | 2022 | 2023 | 2024 | 2025 | 平均 |
|------|------|------|------|------|------|
| trail=2.0, sl=1.0 ⭐ | +4.5% | +14.4% | +11.2% | +8.9% | **9.7%** |
| trail=3.0, sl=1.0 | +2.5% | +13.7% | +12.8% | +9.3% | 9.6% |
| trail=2.5, sl=1.0 | +3.1% | +12.9% | +12.7% | +9.3% | 9.5% |
| **舊預設 trail=2.5, sl=1.5** | +1.4% | +13.0% | +10.9% | +8.0% | **8.3%** |

**選 trail=2.0 理由**：各年最均衡，2022 熊市最強（+4.5%，所有組合中最高），不像 trail=3.5 在熊市更脆弱。

**volRegimeThreshold 結論**：越高（越寬鬆）→ 2024/2025 更好但 2022 轉負；1.3 是最佳平衡點，維持不變。

**實驗性過濾器結論（放棄原因）**：trailAtrMult>0 模式依賴進場**數量**。每次進場都是潛在的「大漲彩票」，任何減少進場次數的過濾器都移除了這些彩票，不能補回來。

**修改位置**：`app/backtest/page.tsx`（state 預設值 + BEST_WR/BEST_RETURN preset）、`components/seed-dialog.tsx`（defaultParams）、CLAUDE.md 參數文件。

### 歷史封存刪除 bug 修正（2026-04-06）

**問題**：封存後到交易記錄頁點「清除全部」，會連已封存的訂單一起刪除，導致封存下拉展開後顯示空白。

**根本原因**：`app/api/orders/route.ts` DELETE handler 沒有過濾 `archive_id IS NULL`：
- `DELETE FROM orders WHERE mode = ?` — 刪到封存訂單
- `DELETE FROM orders` — 刪光所有訂單包括封存

**修正**：兩個刪除路徑加上 `AND archive_id IS NULL` 條件，封存訂單永遠不會被一般刪除操作影響。逐條刪除（by id）也同樣加上保護。

### 實盤賣出「Account has insufficient balance」修正（2026-04-23）

**問題**：引擎日誌每 5 分鐘出現 `實盤 ATR 止損下單失敗: Account has insufficient balance`，策略持倉無法關閉。

**根本原因**：Binance BUY market order 手續費從**收到的幣**扣除（約 0.079%–0.1%）。引擎算 `qty = tradeSize / price` 後直接存入 DB，但幣安實際交付 `qty × (1 - fee)`，賣出時要賣 DB 量（比實際多）→ 幣安拒絕。

**修正位置**：`lib/binance.ts` + `lib/engine.ts`
1. `placeOrder` 回傳型別加 `executedQty: string`
2. 買入後：`if (result.executedQty) qty = parseFloat(result.executedQty)`（存實際成交量，而非計算值）
3. 新增 `fetchAssetBalance(apiKey, apiSecret, asset)` — 複用帳戶 API 查任意幣種 free 餘額（內部抽出 `fetchAccountBalances` 共用）
4. 新增 `sellQty(posQty)` helper — live 模式賣出前查實際餘額，取 `min(position.quantity, freeBalance)` 後格式化；5 個賣出路徑（signal sell、fixed SL、fixed TP、ATR TP、ATR SL）全部改用此 helper

**教訓**：Binance SPOT BUY 費從收到的幣扣，SELL 費從收到的 USDT 扣。持倉量必須用 `executedQty` 而非理論計算值。

### 歷史封存前自動市價平倉（2026-04-23）

**問題**：按下歷史封存後，持倉只被標記 `archive_id` 但不賣出，手動在幣安賣出的損益不計入封存摘要；重啟策略後新策略看不到舊持倉，直接再買造成雙倍曝險。

**修正位置**：`app/api/archives/route.ts` POST handler

**新流程**：
1. 查所有 `archive_id IS NULL` 的持倉
2. 每個持倉：取當前報價 → live 模式呼叫 `placeOrder SELL`（用 `fetchAssetBalance` 取實際餘額避免手續費問題）；paper 模式用報價模擬
3. 寫入 sell 訂單記錄（含 PnL）→ 刪除 position
4. 計算含平倉損益的封存摘要 → 建立 archive → 標記 orders → 停止策略

**注意**：封存前若有持倉失敗賣出（網路錯誤等），錯誤訊息會附在回應的 `closeErrors` 欄位，封存仍會繼續執行。

### vwap_bb_rsi：回測 vs 實盤 差異完整對照（更新 2026-05-24）

系統性審計 `lib/backtest.ts` → `backtestVwapBbRsi()` 與 `lib/engine.ts` → `vwapBbRsiSignal()` + `runStrategyTick()`。

#### ✅ 邏輯完全一致的部分（已全部對齊）

| 項目 | 說明 |
|------|------|
| 買入信號 | `(RSI < rsiOversold OR BB下穿) AND price < VWAP AND !inTrend` |
| 賣出信號 | `(RSI > rsiOverbought OR BB上穿) AND price > VWAP` |
| BB crossover | `prevClose > lower[i-1] && price <= lower[i]`（需跨越，非持續觸碰）|
| 波動率過濾 | `stddev(log_returns, 20) / stddev(log_returns, 60) > 1.3` 算法完全相同 |
| ATR SL 公式 | `slPrice = max(entry - atrSl×ATR, trailHigh - trail×ATR)`，每 bar 用當前 ATR 重算，不鎖定 |
| 出場價 | 兩者皆用當前 bar close（backtest = `price`；engine = `curPrice` at tick time）|
| trailHigh 更新 | 兩者皆用已收盤 K 棒 close（backtest: bar close；engine: `lastConfirmedClose` via Fix 3）|
| ATR 來源 | 兩者皆用 confirmed klines 的 ATR（backtest: `atrVals[i]`；engine: `confirmedKlines`）|
| trailAtrMult > 0 時壓制 RSI/BB 賣出 | 兩邊邏輯相同（只靠 ATR trailing SL 出場）|
| SL 後同棒禁止重買 | backtest: `slFiredThisBar`；engine: `saveSignal(signal)` 防止 isFreshBuy |
| VWAP 函數 | engine 的 `calcVwap` = backtest 的 `vwap`，同一實作 |

#### ⚠️ 殘餘固有差異（無法消除）

- **觸發粒度**：engine 每 5 分鐘檢查（接近即時），backtest 只在 4h K 棒收盤時檢查 → engine 能抓住棒內高點/低點，backtest 只看收盤
- **出場價細節**：engine 以 curPrice（觸發時的 5 分鐘 tick 價）出場，backtest 以 bar close 出場 → 極端行情下有差異，正常均值回歸行情可忽略

#### 🔧 已修正的差異彙整

**Fix A（2026-05-17）— ATR SL 後立刻重買（`lib/engine.ts`）**
- ATR SL 觸發後改呼叫 `saveSignal(signal)`（而非 `saveSignal('sell')`），阻止下一個 5 分鐘 tick 立刻重買

**Fix B（2026-05-17）— backtest slFiredThisBar（`lib/backtest.ts`）**
- SL 觸發時設 `slFiredThisBar=true`，封鎖同一根 K 棒的再進場

**Fix 3（2026-05-23）— trailing stop 改用已收盤 K 棒（`lib/engine.ts`）**
- `trailHigh` 改用 `lastConfirmedClose`；ATR TP / ATR SL 計算改用 `confirmedKlines`
- 修正 5 分鐘 spike 把 trailHigh 鎖定在虛高水位，讓引擎提前出場的問題

**Fix 4（2026-05-24）— backtest ATR SL 改為每 bar 重算（`lib/backtest.ts`）**
- 修前：initialSl 在進場時固定，trailSl 用「只升不降」存儲值
- 修後：`slPrice = Math.max(entry - atrSl×atrVals[i], trailHigh - trail×atrVals[i])`，每 bar 用當前 ATR 重算，不鎖定（= 引擎行為）
- 出場改為 `exitPrice = price`（bar close），不再用 `exitPrice = position.sl`
- **根本影響**：舊 `exitPrice = position.sl` 在 SL 被「只升不降」鎖在高位時，退出價高於實際 bar close，造成系統性虛報盈利；新方法誠實

**回測影響（trail=2.0, sl=1.0，4幣平均，Fix 4 前→後）：**

| 年份 | Fix 4 前（只升不降）| Fix 4 後（新，更準確）|
|------|-------------------|---------------------|
| 2021 🐂 | +19.3% | +10.9% |
| 2022 🐻 | +2.7% | -7.9% |
| 2023 🐂 | +12.7% | +5.8% |
| 2024 🐂 | +9.5% | +2.4% |
| 2025 📊 | +6.6% | -0.8% |
| 2026Q1-Q2 | +1.1% | -1.9% |

下降原因：舊方法在 SL 觸發時用「儲存的高位 SL 價」出場，此價高於實際 bar close → 系統性浮報。新方法誠實用 bar close 出場，配合 ATR 動態調整（不鎖定），熊市中 SL 觸發更頻繁（ATR 擴張時 SL 放寬但 price 快速下跌，仍觸發）。

#### 已實施：Fix 3 — trailing stop 改用已收盤 K 棒（2026-05-23）

**問題**：實盤 `trailHigh` 每 5 分鐘從 live 價更新，短暫 spike 把 trailHigh 鎖定在虛高水位；ATR 用「成形中的 4h K 棒」，安靜期偏小。兩者合讓 trailing SL 比回測緊 3–5 倍，小回調即觸發出場。

**修正（`lib/engine.ts`）**：
- 提取 `confirmedKlines = klines.slice(0, -1)` 供 signal 計算與 ATR 共用
- `trailHigh` 改用 `lastConfirmedClose`（最近已收盤 4h K 棒）更新
- ATR TP / ATR SL 計算改用 `confirmedKlines`

#### 趨勢過濾器研究（2026-05-23，最終放棄）

**背景**：2026Q2 vol regime 過濾器抓不住緩慢下跌趨勢（ETH 2270→2039，10% 下跌），策略持續買在下降斜坡。測試加入 EMA 方向過濾器是否改善。

**測試三種方案（trail=2.0, sl=1.0，4幣平均；數字來自 Fix 4 前的舊 backtest，絕對值已過時但相對比較仍有效）**：

| 期間 | 無過濾器 | EMA20/50 | EMA200 | 兩者都加 |
|------|--------|---------|------|--------|
| 2021 | **+19.3%** | +8.9% | +11.8% | +8.8% |
| 2022 | **+2.7%** | -1.0% | -0.8% | -0.5% |
| 2023 | **+12.7%** | +4.3% | +6.6% | +4.1% |
| 2024 | **+9.5%** | +3.9% | +3.1% | +2.6% |
| 2025 | **+6.6%** | +1.1% | +2.3% | +0.9% |
| 2026Q1 | **+0.7%** | -0.1% | -0.5% | -0.2% |
| 2026Q2 | +0.4% | +0.3% | **+0.5%** | +0.3% |
| **全期平均** | **+7.4%** | +2.5% | +3.3% | +2.3% |

**結論（放棄原因）**：三種過濾器全部使全期平均大幅下降（-4~5%）。原因同之前研究：`trailAtrMult>0` 模式的 alpha 來自「大漲彩票」型進場，加密貨幣大反彈的進場點往往就在 EMA 下方，過濾器把最好的進場點擋掉無法補回。結論不因 Fix 4 而改變。

**全期回測彙整（BTC/SOL/BNB = vwap_bb_rsi trail=2.0 sl=1.0 4h；ETH ★ = adaptive_combo atrSl=1.5 4h）**：

> ★ ETH 於 2026-05-24 換成 adaptive_combo；全年均以 adaptive_combo 參數回測，反映目前策略的歷史預期績效

| 期間 | BTC | ETH ★ | SOL | BNB | 4幣平均 |
|------|-----|--------|-----|-----|--------|
| 2021 🐂 | -0.5% | +0.8% | +22.7% | +10.3% | **+8.3%** |
| 2022 🐻 | -8.9% | -2.9% | -11.1% | -3.4% | **-6.6%** |
| 2023 🐂 | +7.0% | +25.9% | +17.9% | +1.5% | **+13.1%** |
| 2024 🐂 | +2.1% | -5.8% | +7.7% | +3.9% | **+2.0%** |
| 2025 📊 | -1.4% | +46.8% | +2.9% | -2.9% | **+11.4%** |
| 2026Q1-Q2 | -1.4% | -6.5% | -3.5% | -0.3% | **-2.9%** |

### BTC 策略比較（誠實版，2026-05-24）

以 `scripts/btc_compare.ts`（npx tsx 執行）對 BTC 跑三策略 × 六年期 4h 回測：

| 期間 | vwap_bb_rsi | adaptive_combo | supertrend |
|------|-------------|----------------|------------|
| 2021 | -13.8% | +47.2% | +33.7% |
| 2022 | -61.8% | -34.5% | **-5.2%** |
| 2023 | +68.2% | +1.3% | +12.9% |
| 2024 | +11.7% | +50.3% | +50.1% |
| 2025 | -17.1% | +16.1% | -1.6% |
| 2026Q1-Q2 | -14.5% | -5.4% | -11.2% |
| **平均** | **-4.5%** | **+12.5%** | **+13.1%** |

**結論**：
- `vwap_bb_rsi` 完全不適合 BTC（均值回歸被大趨勢反覆打止損）
- `supertrend` vs `adaptive_combo` 平均相近，但 supertrend **熊市防守最強**（2022 -5.2% vs adaptive -34.5%）
- 暫時維持 BTC 用 `vwap_bb_rsi`（未換策略），後續可考慮換 supertrend

### 一鍵平倉按鈕（2026-05-24）

**需求**：單次強制以現價平掉所有持倉，不停止策略、不影響後續自動交易。

**實作**：
- `app/api/positions/close-all/route.ts`：POST endpoint（admin only）
  - 逐一抓 Binance 即時報價（失敗 fallback 用 DB 存的 current_price）
  - paper 直接計算 PnL；live 先查實際餘額（`fetchAssetBalance`）再下 SELL 單
  - 插入 sell 訂單記錄（含 PnL）→ 刪除 position row
  - 策略 `is_active` 與 `last_signal` 均不動（策略繼續正常運行）
- `app/strategies/page.tsx`：持倉區塊右上角「一鍵平倉」橘色按鈕（admin only，按前需 confirm）

### Session Symbol Chip 策略類型標籤（2026-05-24）

**需求**：同一 session 內不同幣種用了不同策略（如 ETH 換成 adaptive_combo），要能在 session card 看出來。

**實作**（`app/strategies/page.tsx`）：
- Session symbol chip 檢查組內所有策略的 `type` 是否全部相同
- 不全相同時，每個 chip 額外顯示彩色策略類型 badge（`TYPE_COLOR` 樣式）
- 全部相同則不顯示（避免重複資訊）

### Per-Symbol 預設策略與時框（2026-05-24）

**需求**：Dashboard 切換幣種時自動套用該幣正在使用的策略與時框；Telegram /chart 截圖條件面板也要用對應策略。

**實作**：

`components/price-chart.tsx`：
```typescript
const SYMBOL_DEFAULTS: Record<string, { strategy: string; interval: Interval }> = {
  BTCUSDT: { strategy: 'vwap_bb_rsi',    interval: '4h' },
  ETHUSDT: { strategy: 'adaptive_combo', interval: '4h' },
  SOLUSDT: { strategy: 'vwap_bb_rsi',    interval: '4h' },
  BNBUSDT: { strategy: 'vwap_bb_rsi',    interval: '4h' },
}
// useEffect on symbol change → setSelectedStrategy + setInterval + localStorage
```
- 策略選單新增「自適應組合（adaptive_combo）」選項

`app/chart-preview/[symbol]/client.tsx`：
```typescript
const SYMBOL_STRATEGY: Record<string, string> = { ETHUSDT: 'adaptive_combo' }
const strategy = SYMBOL_STRATEGY[symbol] ?? 'vwap_bb_rsi'
// indicator API 查詢改用 strategy 變數
```

**維護注意**：未來若某幣換策略，同時更新這兩處 mapping。


# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
