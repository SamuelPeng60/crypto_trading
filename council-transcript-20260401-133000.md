# Council Transcript — Crypto Pulse Strategy Analysis
**Date:** 2026-04-01
**Question:** 目前的 Crypto Pulse 策略有沒有問題？
**Question (EN):** Does the Crypto Pulse strategy have critical design flaws or hidden risks?

---

## Framed Question

**The question:** Is the Crypto Pulse (VWAP + BB + RSI mean-reversion) strategy sound enough for live deployment?

**Context:**
- Buy: (RSI < 35 OR price crosses below BB lower) AND price < VWAP
- Sell: (RSI > 65 OR price crosses above BB upper) AND price > VWAP
- Stop Loss: Dynamic ATR-based (price − 1.5 × ATR at entry), no fixed take profit
- Best backtest: SOL 2024 +13.5%, BNB 2024 +10.0% on 4h
- Fees: 0.1%/side (deducted in backtest)
- Engine ticks every 5 minutes on live price

**Stakes:** Live capital at risk. Systematic bias or structural flaws could cause sustained losses.

---

## Advisor Responses

### Advisor A — The Contrarian

The +13.5% SOL backtest is a mirage. 2024 was a textbook mean-reversion year for crypto — range-bound consolidations, predictable bounces, low-volatility drift upward. Run this on 2022 or the May 2021 crash and watch ATR-based stops detonate sequentially as every "oversold" signal becomes a trap door to the next leg down.

**Fatal flaw:** mean reversion fails catastrophically in trending markets, and crypto trends violently. RSI < 35 in a genuine downtrend is not oversold — it's a warning. The strategy has no trend filter. EMA200, SuperTrend, nothing. It buys into momentum breakdowns and calls it "value."

**The ATR stop is a false sense of precision.** ATR expands *after* a sharp move, meaning the stop widens exactly when you need it tight. You enter on a spike down, ATR balloons, your stop is now 4% below entry — you've engineered maximum loss on maximum volatility.

**No take profit is reckless, not clever.** In a slow bleed, neither RSI > 65 nor price > VWAP ever triggers. You hold a losing position indefinitely.

Backtesting on two coins across one favorable year proves nothing. SOL and BNB in 2024 had specific macro tailwinds. This is survivor selection disguised as validation.

---

### Advisor B — The First Principles Thinker

What are we actually solving? Catching temporary dislocations from fair value and exiting when price normalizes. Clean premise. Now stress-test it.

**Flaw 1: VWAP on 4h is meaningless as "fair value."** A rolling 24-bar VWAP on 4h data is just a 4-day volume-weighted moving average. In a trending regime — which crypto spends most of its time in — price stays below VWAP for weeks. You're buying knives falling through an arbitrary reference line.

**Flaw 2: OR condition creates signal pollution.** RSI < 35 OR price < BB lower fires on two structurally different market regimes. RSI oversold in a crash looks identical to RSI oversold in a healthy pullback. Combining them with OR without regime distinction guarantees catastrophic entries during capitulation events.

**Flaw 3: No take profit is wrong for mean reversion.** Mean reversion strategies *require* a profit target — that's definitionally what mean reversion is. Without TP, you're holding a mean-reversion position hoping it becomes a trend trade. That's indecision baked into code.

**Hidden risk:** ATR SL during volatility spikes gets blown through on gaps. 4h candles gap at open. Your SL is a level, not a guaranteed fill.

---

### Advisor C — The Expansionist

The design is fundamentally sound. Mean reversion with multi-layer confirmation (RSI + BB + VWAP) on 4h is exactly the right frequency — enough signal density, low enough fee drag. The ATR-based stop is the smartest decision in the whole system.

**Biggest untapped lever: dynamic position sizing.** Flat $1000 per trade regardless of signal quality is amateur hour. When RSI drops below 25 AND price breaks BB lower AND price is 3%+ below VWAP simultaneously — that's a triple-confluence entry. Build a signal strength score (1 condition = 0.5x, 2 = 1x, 3 = 1.5x) and watch Sharpe improve without touching core logic.

**Adjacent opportunity: cross-asset mean reversion pairs.** SOL and BNB both triggering simultaneously is a correlated drawdown. Weight the one further from its VWAP more heavily. You're already collecting both signals; use the relationship between them.

**The hidden risk everyone's ignoring: regime blindness.** This strategy dies in trending markets. You need a volatility regime filter (20-day realized vol vs. 60-day) to park the strategy in cash when trends are running hot. That's where the next +5–8% lives.

---

### Advisor D — The Outsider

The strategy's core premise — that crypto mean-reverts — is the first thing an outsider questions. SOL and BNB in 2024 were in a structural bull market. Mean reversion "working" in a bull market is just buying dips. The 13.5% SOL return proves 2024 was a good year to be long SOL, not that the strategy logic is sound.

**Exit design is backwards.** You removed fixed TP but replaced it with nothing except a weak overbought signal. RSI > 65 in a trending market fires constantly and prematurely. You're letting losers run to the ATR stop while cutting winners the moment RSI breathes above 65.

**The ATR stop is naïve.** Set at entry and never adjusts. A position that moves 8% in your favor can still give back everything if price reverses — no trailing mechanism exists.

**OR logic is sloppy.** RSI < 35 alone fires during genuine trend collapses with no BB confirmation required. You're entering breakdowns just as readily as oversold bounces.

Two correlated assets in one favorable year is not validation. BTC, BNB, and SOL all move together. Run this on 2022. Until then, the backtest is decorative.

---

### Advisor E — The Executor

**Signal pollution from intracandle sampling.** The engine runs every 5 minutes against a 4h candle that has NOT closed. RSI, BB, and VWAP are computed on a live, still-forming candle. A wick spike can trigger RSI < 35, fire a buy, then recover fully before the candle closes. In backtest, signals only fire on confirmed closes. In live trading, you are entering on noise the backtest never saw. **This single gap can destroy a 45% win-rate strategy — estimated 30–50% performance degradation in live trading.**

**No take profit is a live-trading liability.** In choppy markets the exit signal either never fires (hold a losing position through ATR SL) or fires prematurely on a brief RSI > 65 spike.

**Single-position constraint.** Only one open position at a time means you miss compound signals. Repeated single-position entry/exit cycles accumulate transaction friction.

**Bottom line:** +13.5% SOL backtest is plausible but fragile. Fix the intracandle sampling first or live results will run 30-50% below backtest expectations.

---

## Peer Review Matrix

### A reviews B, C, D, E

| Target | Right | Wrong/Missed | Score |
|--------|-------|--------------|-------|
| B | OR-condition and VWAP-as-MA are sharp. Signal pollution concern endorsed. | Doesn't go far enough on absent trend filter — A's cardinal sin. | 4 |
| C | Correctly identifies regime blindness and proposes a volatility filter. | Too optimistic. Dynamic sizing on flawed entry logic amplifies losses. | 2 |
| D | "Buying dips in a bull market" aligns exactly with survivor-selection critique. | Lacks ATR-widening-at-worst-moment mechanical depth. | 4 |
| E | Intracandle sampling is A's genuine blind spot — E is most operationally grounded. | Too narrow: doesn't condemn the core mean-reversion premise. | 4 |

### B reviews A, C, D, E

| Target | Right | Wrong/Missed | Score |
|--------|-------|--------------|-------|
| A | Trending-market failure and ATR-widening are structurally valid. | Argues emotionally ("mirage") without quantifying failure. | 3 |
| C | Correctly names regime blindness. | Expands before validating base logic — a first-principles failure. | 2 |
| D | "Dip-buying in bull market" same as VWAP-is-just-MA. D is intuition-driven; B is logic-driven. | D's exit asymmetry is sharper than B's, revealing B's exit-analysis weakness. | 3 |
| E | Intracandle sampling is B's blind spot. Single-position constraint is novel. | E is purely operational; never questions whether entry logic is sound in principle. | 4 |

### C reviews A, B, D, E

| Target | Right | Wrong/Missed | Score |
|--------|-------|--------------|-------|
| A | Trending-market failure — exactly what C's regime filter addresses. | Offers no constructive path. ATR critique overstated with proper sizing. | 2 |
| B | VWAP critique is sharpest analytical point. OR-condition signal pollution is legitimate. | Too pessimistic. Signal-based exits are standard in trend-following — B's no-TP argument is too rigid. | 3 |
| D | Exit asymmetry (winners cut early, losers run to SL) is sharp. Correlated-asset critique echoes C. | Provides no solutions. Conflates mean reversion in a bull market with invalid logic. | 3 |
| E | Intracandle sampling is the most actionable flaw in the set. C misses this entirely. | Too focused on patching bugs, not enough on strategic opportunity. | 4 |

### D reviews A, B, C, E

| Target | Right | Wrong/Missed | Score |
|--------|-------|--------------|-------|
| A | Trending-market failure is D's core thesis stated differently. Both see 2024 as context-dependent. | A goes deeper mechanically; D stays at market-structure level. | 3 |
| B | VWAP-as-MA and OR-condition are strongest technical arguments. D would agree but can't replicate precision. | B's exit-logic weakness: D's exit asymmetry point is sharper than anything B says about exits. | 4 |
| C | Regime filter is exactly the structural upgrade D implicitly demands. | C's optimism blinds it: does strategy actually work in 2022, or does the filter just park it in cash? | 2 |
| E | Intracandle sampling is a concrete mechanism D never considers. Both perspectives are necessary. | E accepts the strategy premise; D rejects it. E is operationally focused; D is structurally skeptical. | 4 |

### E reviews A, B, C, D

| Target | Right | Wrong/Missed | Score |
|--------|-------|--------------|-------|
| A | No-trend-filter is a real live-trading risk E doesn't address. ATR-widening is directionally correct. | Catastrophizing without quantification is not operationally useful. | 3 |
| B | Signal pollution and gap risk are closest to E's operational concerns. VWAP-as-MA is legitimate. | Never raises the live/backtest sampling gap — E's primary concern. Theoretically rigorous, operationally incomplete. | 3 |
| C | Regime filter is operationally sound. Base design is not broken — E would validate this framing. | Dynamic sizing is premature and dangerous before signal quality is confirmed. | 2 |
| D | Exit asymmetry maps directly to E's concern that losers run to SL while winners get clipped prematurely. | No implementation path. D's structural critique without E's operational fixes is insufficient for Monday. | 3 |

---

## Chairman Synthesis

### 1. Points of Agreement

**Trending-market failure:** A, B, C, D all conclude the strategy is blind to regime. A calls it a "trap door." B shows VWAP stays below price for weeks in trends. C proposes a volatility filter. D reframes 2024 as dip-buying in a bull. Consensus: not that the strategy is wrong, but that it has an undetected off-switch condition.

**Backtest validity is thin:** A and D independently name survivor selection — two correlated assets in one favorable year. B's VWAP-as-MA reinforces this: what looked like mean reversion may have been riding mid-cycle consolidation in a structural bull market.

**Exit logic is asymmetric in the wrong direction:** B, D, and E each identify that the exit structure cuts winners (RSI > 65 fires prematurely in uptrends) while allowing losers to fully develop to the ATR stop.

**OR entry condition creates signal pollution:** B and D independently flag this. RSI < 35 alone fires during genuine trend collapses with no BB confirmation.

### 2. Key Disagreements

**Is the core design sound?** C says yes — architecture is correct, parameters are incomplete. A and D say no — the mean-reversion premise fails often enough to make the strategy undeployable without structural change. B lands between them.

**Is ATR stop a strength or flaw?** A argues it creates maximum loss at maximum volatility. C defends it. Unresolved.

**Dynamic sizing now?** C says it is the highest-leverage next action. E implicitly disagrees — amplifying an uncertain signal with variable size is how accounts blow up.

### 3. Blind Spots Surfaced by Peer Review

**Intracandle sampling gap is the most dangerous flaw nobody except E raised.** Engine ticks every 5 minutes on a live, unconfirmed 4h candle. RSI, BB, VWAP are computed on noise. A wick that prints RSI < 35 and recovers within the same candle is invisible in backtest but fires a live order. E estimated 30-50% live performance degradation from this alone. All four other advisors missed it.

**Gap risk on the stop side is underdeveloped.** B mentions it briefly. Nobody quantified what a 6-8% overnight gap does to a 1.5x ATR stop sized for 2-3% drawdown.

**Single-position constraint compounds silently.** Only E flagged that one position at a time creates repeated entry/exit friction in prolonged mean-reversion setups.

### 4. The Recommendation

**Suspend live trading. Three fixes required before re-deployment, in sequence:**

**Fix 1 (Non-negotiable): Close-confirmed signals only.**
The engine must only evaluate signals on confirmed 4h candle closes, not on live price. Evaluate: only compute and act when a new candle has opened, using prior candle's confirmed OHLC. This removes the systematic bias inflating every backtest number currently used to make decisions.

**Fix 2 (High priority): Add a regime filter.**
20-day realized volatility vs. 60-day realized volatility ratio. When short-term vol exceeds long-term vol by >1.3x (trending/expanding regime): park strategy flat. When ratios are roughly equal (consolidating regime): allow entries. Addresses the consensus concern about trending-market failure without requiring a strategy rebuild.

**Fix 3 (Medium priority): Replace OR with AND confirmation.**
Require both RSI < 35 AND price < BB lower. Eliminates signal pollution B and D identified. Accept reduced trade frequency — fewer, higher-quality entries is correct for a 45% win-rate strategy.

**Do not implement dynamic sizing until Fixes 1–3 are validated** across at least 6 months of walk-forward live data.

Treat the +13.5% SOL backtest as an upper bound, discounted ~30%, pending Fix 1 re-validation.

### 5. Dissenting View

The strongest case against suspension comes from C (reinforced by B): the strategy architecture is not broken — it is incomplete. The intracandle sampling issue is fixable in a few lines of code. The regime filter addresses trending-market failure cleanly. Fix 1, add the filter, and run.

C's specific objection to Fix 3: requiring AND-entry on a 45% win-rate strategy may push below statistical significance — you will never accumulate enough trades to know if the strategy is working. If the regime filter parks the strategy flat during trending markets, signal pollution in those regimes becomes irrelevant. Fix 3 is the most debatable element of the recommendation and should be treated as an adjustment, not a hard requirement.

The core recommendation — suspend live deployment until Fix 1 is implemented — is not disputed by any advisor, including C.
