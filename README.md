# Crypto Trading System

A full-stack cryptocurrency paper trading system built with Next.js 16. Automatically monitors market signals, executes simulated trades, and tracks strategy performance — all running locally without any cloud infrastructure.

## Features

### Strategy Engine
- **7 built-in strategies**: MA Cross, RSI, Grid, SuperTrend, Crypto Pulse (VWAP+BB+RSI), EMA Ribbon+SuperTrend, MACD+BB Squeeze
- **Automated signal detection**: server-side background loop ticks every 5 minutes via `instrumentation.ts` — no browser required after startup
- **Fresh signal guard**: strategies never fire immediately on activation; they wait for a genuine signal transition to prevent false entries on startup
- **Risk management**: ATR-based dynamic stop-loss, daily loss limit auto-stop, position size cap

### Backtesting
- Historical backtest against Binance OHLCV data with **Binance fee deduction** (0.1% per side)
- One-click **Best Return** and **Best Win Rate** preset buttons per strategy type
- Sharpe ratio, max drawdown, win rate, equity curve chart
- Annual backtest scripts (`scripts/annual.ts`, `scripts/annual2.ts`) for multi-symbol × multi-interval sweeps

### Paper Trading
- Simulated order execution with real-time Binance price feeds
- Position tracking with unrealized PnL
- Session grouping: one-click create strategies across multiple symbols at once
- Live runtime counter per session; freezes on stop with total runtime shown

### Live Trading (optional)
- Binance API key configuration (stored encrypted in local DB)
- Live order placement via Binance REST API
- Telegram bot notifications: buy / sell / stop-loss / take-profit / risk-stop
- Paper / Live mode toggle in Settings

## Recommended Strategy (from backtests, fees included)

| Strategy | Symbol | Interval | 2024 Return | 2025 Return |
|----------|--------|----------|-------------|-------------|
| Crypto Pulse | SOL/USDT | 4h | **+13.5%** | +7.7% |
| Crypto Pulse | BNB/USDT | 4h | **+10.0%** | +6.1% |
| Crypto Pulse | BTC/USDT | 4h | +5.5% | +5.5% |

> 15m strategies are unviable due to fee drag (800+ trades/year × 0.2% round-trip ≈ returns wiped out).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 App Router |
| Database | SQLite via `better-sqlite3` |
| Charts | `lightweight-charts` v5 |
| UI | shadcn/ui, Tailwind CSS |
| Market data | Binance public REST API + WebSocket |
| Notifications | Telegram Bot API |

## Getting Started

```bash
npm install
npm run dev -- --port 3333
```

Open [http://localhost:3333](http://localhost:3333).

**Requirements**: Node.js 18+, internet connection for Binance market data.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — live prices for BTC, ETH, SOL, BNB with candlestick chart |
| `/strategies` | Strategy management — create, start/stop, monitor positions and runtime |
| `/backtest` | Backtest engine — historical simulation with parameter tuning and presets |
| `/trades` | Trade history — all simulated orders and closed positions with PnL |
| `/settings` | Configuration — trade size, risk limits, Binance API keys, Telegram bot |

## Project Structure

```
├── app/
│   ├── api/              # API routes (engine, strategies, backtest, tickers…)
│   ├── backtest/         # Backtest UI
│   ├── strategies/       # Strategy management UI
│   ├── trades/           # Trade history UI
│   └── settings/         # Settings UI
├── components/           # Shared UI components (dialogs, charts, sidebar)
├── lib/
│   ├── engine.ts         # Trading engine — signal computation → order execution
│   ├── backtest.ts       # Backtest engine — 7 strategies, fee-aware
│   ├── indicators.ts     # Technical indicators (EMA, RSI, ATR, BB, VWAP, MACD, SuperTrend)
│   ├── binance.ts        # Binance REST + WebSocket client
│   └── db.ts             # SQLite schema + auto-migrations
├── scripts/              # Annual backtest sweep scripts
└── instrumentation.ts    # Server-side background engine loop (every 5 min)
```

## Environment Variables

Create a `.env.local` file (never committed):

```env
# Only needed for live trading and notifications
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
```

All settings can also be configured through the Settings page and are stored in the local SQLite database.

## License

MIT
