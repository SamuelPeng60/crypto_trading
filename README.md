# Crypto Trading System

全端加密貨幣模擬交易系統，支援多策略回測、即時模擬下單、績效分析儀表板與 Telegram 通知推播。

**Tech Stack:** Next.js 16 App Router · SQLite · Binance API · lightweight-charts v5 · shadcn/ui · PM2

---

## 功能頁面

| 頁面 | 說明 |
|------|------|
| `/` | Dashboard — 即時行情、K線圖、技術指標疊加（EMA/BB/VWAP）、B/S 訂單標記 |
| `/strategies` | 策略管理 — 新增/啟動/停止/刪除，Session 分組，live 計時 |
| `/backtest` | 回測 — 參數調整、預設套用、年度回測矩陣（2021–2025）、績效歷史比較 |
| `/trades` | 交易記錄 |
| `/settings` | Binance API Key、Telegram Bot Token、Paper/Live 模式切換 |

---

## 7 個交易策略

| 策略 | 類型 | 最佳時框 | 說明 |
|------|------|---------|------|
| **Crypto Pulse** | 均值回歸 | 4h | VWAP + BB + RSI + 波動率過濾 |
| **MA Cross** | 趨勢跟隨 | 1d | 快/慢均線交叉 |
| **RSI** | 超買超賣 | 4h | RSI 閾值進出場 |
| **Grid** | 網格 | — | 上下界等間距掛單 |
| **SuperTrend** | 趨勢跟隨 | 4h | ATR 動態追蹤止損線 |
| **EMA Ribbon + ST** | 趨勢跟隨 | 1d | 三均線 Ribbon + SuperTrend 確認 |
| **MACD + BB Squeeze** | 突破 | 1h | 布林帶壓縮 + MACD 穿越 |

---

## Crypto Pulse 策略詳解

均值回歸策略，核心邏輯：價格偏離 VWAP 後等待回歸，並在趨勢行情中自動暫停進場。

**進場條件（全部滿足）**
- RSI < 35 或價格跌破 BB 下軌
- 價格 < VWAP（確認偏離均值方向）
- 短期已實現波動率 / 長期已實現波動率 ≤ 1.3（非趨勢行情）

**出場條件**
- RSI > 65 或價格突破 BB 上軌，且價格 > VWAP（均值回歸完成）
- ATR 動態止損：`進場價 − 1.5 × ATR`（自動適配各時框波動幅度）

**參數（預設值）**

| 參數 | 預設 | 說明 |
|------|------|------|
| rsiPeriod | 14 | RSI 週期 |
| rsiOversold / Overbought | 35 / 65 | RSI 閾值 |
| bbPeriod / bbStdDev | 20 / 2 | 布林帶 |
| vwapWindow | 24 | 滾動 VWAP 窗口（根數） |
| atrPeriod / atrSlMultiplier | 14 / 1.5 | ATR 動態止損 |
| volRegimeShort / Long | 20 / 60 | 波動率過濾窗口 |
| volRegimeThreshold | 1.3 | 趨勢判定比率 |

---

## Crypto Pulse 回測結果（4h，已扣手續費 0.1%/單邊）

### 修正後（含 Fix 1 + Fix 2）

| 年份 | 市況 | BTC | ETH | SOL | BNB | 平均 |
|------|------|-----|-----|-----|-----|------|
| 2022 | 🐻 熊市 | +0.65% | +1.84% | -2.91% | +2.51% | **+0.52%** |
| 2023 | 🐂 復甦 | +5.29% | +8.59% | +8.67% | +4.93% | **+6.87%** |
| 2024 | 🐂 牛市 | +5.38% | +4.67% | +13.58% | +9.98% | **+8.40%** |
| 2025 | 📊 震盪 | +5.48% | +8.80% | +7.74% | +6.10% | **+7.03%** |

### 修正前 vs 修正後（平均回報對比）

| 年份 | 修正前 | 修正後 | 改善 |
|------|--------|--------|------|
| 2022 🐻 | -2.46% | +0.52% | **+2.98%** |
| 2023 🐂 | +7.15% | +6.87% | -0.28% |
| 2024 🐂 | +6.47% | +8.40% | **+1.93%** |
| 2025 📊 | +6.76% | +7.03% | +0.27% |

> Fix 2（波動率過濾）在熊市效果最顯著：2022 從平均 -2.46% 翻正至 +0.52%，在牛市和震盪市場同樣有小幅改善。

---

## 引擎關鍵設計

```
instrumentation.ts     — Server 啟動後每 5 分鐘自動 tick，不需瀏覽器開著
lib/engine.ts          — 策略執行引擎（信號計算、下單、止損）
lib/backtest.ts        — 回測引擎（7 策略，含手續費）
lib/indicators.ts      — 技術指標（SMA/EMA/RSI/ATR/SuperTrend/BB/VWAP）
lib/binance.ts         — Binance REST API（data-api.binance.vision）
lib/telegram-bot.ts    — Telegram 通知 + /chart 截圖指令
```

| 特性 | 說明 |
|------|------|
| **Fresh Buy Guard** | 訊號需從非 buy 轉為 buy 才進場，防止啟動即下單 |
| **Fix 1 — 已確認K棒** | `klines.slice(0,-1)` 確保只對已收盤K棒計算信號，消除實盤 vs 回測 30–50% 績效差距 |
| **Fix 2 — 波動率過濾** | 趨勢行情（短期/長期波動率 > 1.3）自動暫停均值回歸策略進場 |
| **風控** | 每日最大虧損上限，觸及後自動停止策略 |
| **Telegram /chart** | 傳送 `/chart sol` 回傳 K 線截圖 |

---

## 策略分析方法論

本專案使用 **LLM Council（五人顧問委員會）** 對策略進行壓力測試：五位具備不同視角的顧問（反駁者、第一原則思考者、擴張者、局外人、執行者）各自獨立分析，互相匿名評分，最後由主席綜合建議。

2026-04-01 針對 Crypto Pulse 的 Council 分析找出兩個最高優先缺陷（Fix 1、Fix 2），報告存於 `council-transcript-20260401-133000.md` 與 `council-report-20260401-133000.html`。

---

## 本地開發

```bash
npm install
npm run dev -- --port 3333
```

開啟 [http://localhost:3333](http://localhost:3333)。資料庫 `data/trading.db` 首次啟動自動建立（由 `.gitignore` 排除，不隨 git 同步）。

## 生產環境部署（Amazon Lightsail）

```bash
git pull && npm install && npm run build && pm2 restart crypto-trading
```

> Binance `api.binance.com` 在 Lightsail 美東 IP 被封鎖，系統改用 `data-api.binance.vision`。

---

## License

MIT
