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

## 策略清單（7 個）

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
- 參數：`rsiPeriod`(14), `rsiOversold`(35), `rsiOverbought`(65), `bbPeriod`(20), `bbStdDev`(2), `vwapWindow`(24), `atrPeriod`(14), `atrSlMultiplier`(1.5), `tradeSize`
- 邏輯：
  - **買入**：RSI < 35 或跌破 BB 下軌，且價格 < VWAP（跌離均值）
  - **賣出**：RSI > 65 或突破 BB 上軌，且價格 > VWAP（回歸均值以上）
  - **止損**：ATR 動態止損 `price - atrSlMultiplier × ATR`（自動跟時間框架縮放）
  - **注意**：無固定止盈（TP），讓訊號決定出場，避免過早截斷利潤

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

### 推薦運行組合（Crypto Pulse 4h）
| 幣種 | 2024 回報 | 2025 回報 |
|------|---------|---------|
| SOL | +13.5% ★ | +7.7% |
| BNB | +10.0% ★ | +6.1% |
| BTC | +5.5% | +5.5% |

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

### 📊 PHASE 3 — 績效分析儀表板
- 每策略獨立績效（勝率/PnL/MDD/Sharpe）
- 資金曲線圖（Equity Curve）
- Dashboard 強化（總資金/今日盈虧/持倉概覽）
- 回測結果歷史比較
- 策略間績效排行

### ✅ PHASE 4 — 實盤交易（已完成）
- Settings 設定 Binance API Key（加密儲存）
- 真實下單（Binance REST API，placeOrder()）
- 風控系統（每日最大虧損自動停止策略、單筆倉位上限）
- 通知推播（Telegram Bot：買入/賣出/止損/止盈/風控停止）
- Paper/Live 模式切換（全域設定）
- API 連線測試 + Telegram 測試通知按鈕

## 重要修正紀錄

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
- 參數：`atrPeriod`(14), `atrSlMultiplier`(1.5)，可在回測頁調整

### 手續費扣除
- `lib/backtest.ts` 加入 `const BINANCE_FEE = 0.001`，買入扣 `tradeSize × (1 + FEE)`，賣出收 `qty × price × (1 - FEE)`
- 所有 7 個策略函式均已套用，包含 SL/TP/ATR SL/ATR TP 出場

### EMA Ribbon 進場條件放寬
- 修前：要求 3 條 EMA 同時對齊 AND ST flip（同一K棒，幾乎不可能，每年約 2 筆交易）
- 修後：`stFlipUp && emaFast > emaSlow`（ST翻多 + 快線在慢線上方即可）
- 新增 trailing stop：追蹤 `trailingHigh`（持倉期間最高收盤），止損 = `trailingHigh - atrSlMultiplier × ATR`

### MACD Squeeze 進場條件放寬
- 修前：5 條件同時（prevInSqueeze + expanding + macdCross + rsiOk + ema200），4h 完全無信號
- 修後：BB 帶寬 ≤ 40棒平均（寬鬆 squeeze 代理），RSI 35-70，MACD histogram 由負轉正

### Binance API 美東封鎖問題
- `api.binance.com` 和 `api3.binance.com` 在 Lightsail 美東（us-east-1）全部封鎖
- 改用 `https://data-api.binance.vision`（Binance 公開資料節點，不受地區限制）
- 修改位置：`lib/binance.ts` 第 1 行 `const BASE`
- WebSocket（`wss://stream.binance.com`）從瀏覽器直連，不經過 server，不受影響

### Lightsail 部署
- 詳細教學見 `setup_lightsail.md`
- Node.js 18 + PM2 常駐，`pm2 startup` 設定開機自動啟動
- Firewall 開放 TCP port 3333
- 訪問：`http://<Lightsail Public IP>:3333`

### Fresh Buy Guard（引擎防止啟動即下單）
- strategies 表新增 `last_signal TEXT DEFAULT 'hold'`
- 進場條件：`signal === 'buy' && last_signal !== 'buy'`（需訊號轉換，非持續狀態）
- 每次 tick 結尾更新 `last_signal`
