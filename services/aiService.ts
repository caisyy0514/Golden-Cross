import { AIDecision, MarketDataCollection, AccountContext, CandleData } from "../types";
import { CONTRACT_VAL_ETH, INSTRUMENT_ID } from "../constants";

// --- Technical Analysis Helpers ---

const calcEMA = (prices: number[], period: number): number[] => {
  const k = 2 / (period + 1);
  const emaArray: number[] = [];
  if (prices.length === 0) return [];

  // Seed with simple price to avoid wait (or use SMA)
  let prevEma = prices[0];
  emaArray.push(prevEma);

  for (let i = 1; i < prices.length; i++) {
    const val = prices[i] * k + prevEma * (1 - k);
    emaArray.push(val);
    prevEma = val;
  }
  return emaArray;
};

// --- Strategy Core ---

interface CrossEvent {
    index: number;
    type: 'GOLDEN' | 'DEAD'; // GOLDEN: 15 > 60, DEAD: 15 < 60
    price: number;
    ts: string;
}

/**
 * 核心策略逻辑:
 * 1. 趋势判断 (1H): EMA(15) > EMA(60) 为上涨, 反之为下跌
 * 2. 入场信号 (3m): 
 *    - 做多: 1H上涨 + 3m出现 "死叉 -> 金叉" 序列
 *    - 做空: 1H下跌 + 3m出现 "金叉 -> 死叉" 序列
 */
const analyzeStrategy = (marketData: MarketDataCollection, accountData: AccountContext) => {
    // 1. 数据准备
    const c1h = marketData.candles1H; // Oldest -> Newest
    const c3m = marketData.candles3m; // Oldest -> Newest
    
    if (c1h.length < 60 || c3m.length < 60) {
        return { action: 'HOLD', reason: "数据不足，正在积累K线...", sl: 0, isUpTrend: false };
    }

    // 2. 趋势判定 (1H Chart)
    const closes1h = c1h.map(c => parseFloat(c.c));
    const ema15_1h = calcEMA(closes1h, 15);
    const ema60_1h = calcEMA(closes1h, 60);
    
    // 取最后一根已收盘K线的状态 (倒数第二根，防止当前K线跳动导致信号闪烁)
    // 或者取最新状态，这里取最新
    const idx1h = closes1h.length - 1;
    const isUpTrend = ema15_1h[idx1h] > ema60_1h[idx1h];
    const trendDesc = isUpTrend ? "📈 1H 上涨趋势 (EMA15 > EMA60)" : "📉 1H 下跌趋势 (EMA15 < EMA60)";

    // 3. 入场信号扫描 (3m Chart)
    const closes3m = c3m.map(c => parseFloat(c.c));
    const highs3m = c3m.map(c => parseFloat(c.h));
    const lows3m = c3m.map(c => parseFloat(c.l));
    
    const ema15_3m = calcEMA(closes3m, 15);
    const ema60_3m = calcEMA(closes3m, 60);

    // 寻找最近的交叉点
    const crosses: CrossEvent[] = [];
    // 只扫描最近 50 根K线，提高效率
    const scanStart = Math.max(1, c3m.length - 50);
    
    for(let i = scanStart; i < c3m.length; i++) {
        const prev15 = ema15_3m[i-1];
        const prev60 = ema60_3m[i-1];
        const curr15 = ema15_3m[i];
        const curr60 = ema60_3m[i];

        if (prev15 <= prev60 && curr15 > curr60) {
            crosses.push({ index: i, type: 'GOLDEN', price: closes3m[i], ts: c3m[i].ts });
        } else if (prev15 >= prev60 && curr15 < curr60) {
            crosses.push({ index: i, type: 'DEAD', price: closes3m[i], ts: c3m[i].ts });
        }
    }

    // 4. 状态机判断
    let action: 'BUY' | 'SELL' | 'HOLD' | 'CLOSE' = 'HOLD';
    let slPrice = 0;
    let reason = "";

    const primaryPos = accountData.positions.find(p => p.instId === INSTRUMENT_ID);

    // 4.1 趋势反转风控 (如果持仓方向与大趋势相反，强制平仓)
    if (primaryPos) {
        if (isUpTrend && primaryPos.posSide === 'short') {
            return { action: 'CLOSE', reason: "🚨 1H 趋势反转为多头，空单止损离场", sl: 0, isUpTrend };
        }
        if (!isUpTrend && primaryPos.posSide === 'long') {
             return { action: 'CLOSE', reason: "🚨 1H 趋势反转为空头，多单止损离场", sl: 0, isUpTrend };
        }
    }

    // 4.2 入场逻辑
    // 需要至少两个交叉信号才能构成 "死叉->金叉" 或 "金叉->死叉"
    if (!primaryPos && crosses.length >= 2) {
        const lastCross = crosses[crosses.length - 1]; // 最新交叉
        const prevCross = crosses[crosses.length - 2]; // 前一个交叉
        
        // 信号新鲜度检查: 最新交叉必须发生在最近 2 根K线内，否则视为错过机会
        const candlesAgo = c3m.length - 1 - lastCross.index;
        const isFresh = candlesAgo <= 2; 

        if (isFresh) {
            if (isUpTrend) {
                // 做多逻辑: 死叉(回调) -> 金叉(启动)
                if (prevCross.type === 'DEAD' && lastCross.type === 'GOLDEN') {
                    // 止损计算: 两个交叉之间的最低价
                    let minLow = Number.MAX_VALUE;
                    for (let i = prevCross.index; i <= lastCross.index; i++) {
                        if (lows3m[i] < minLow) minLow = lows3m[i];
                    }
                    // 安全边际: 稍微下移 0.05%
                    slPrice = minLow * 0.9995;
                    action = 'BUY';
                    reason = `⚡ 信号触发: 1H看涨 + 3m完成回调(死叉转金叉)。区间最低价 ${minLow}`;
                }
            } else {
                // 做空逻辑: 金叉(反弹) -> 死叉(下跌)
                if (prevCross.type === 'GOLDEN' && lastCross.type === 'DEAD') {
                    // 止损计算: 两个交叉之间的最高价
                    let maxHigh = Number.MIN_VALUE;
                    for (let i = prevCross.index; i <= lastCross.index; i++) {
                        if (highs3m[i] > maxHigh) maxHigh = highs3m[i];
                    }
                    // 安全边际
                    slPrice = maxHigh * 1.0005;
                    action = 'SELL';
                    reason = `⚡ 信号触发: 1H看跌 + 3m完成反弹(金叉转死叉)。区间最高价 ${maxHigh}`;
                }
            }
        }
    }

    if (action === 'HOLD') {
        reason = `监控中... ${trendDesc} | 3m最新信号: ${crosses.length > 0 ? crosses[crosses.length-1].type : '无'} (Ago: ${crosses.length > 0 ? c3m.length - crosses[crosses.length-1].index : '-'})`;
    }

    return { action, reason, sl: slPrice, isUpTrend };
};

// --- 管理逻辑: 保本损与移动止盈 ---
const calculateManagement = (pos: any, c3m: CandleData[]) => {
    if (!pos) return null;
    const entryPx = parseFloat(pos.avgPx);
    const markPx = parseFloat(pos.avgPx) + (parseFloat(pos.upl) / (parseFloat(pos.pos) * CONTRACT_VAL_ETH)); // 估算当前标记价格
    const currentSL = parseFloat(pos.slTriggerPx || "0");
    
    // 移动止盈参数
    const lookback = 5; // 跟踪最近5根K线极值
    const recentCandles = c3m.slice(-lookback);
    
    let newSL = 0;
    let reason = "";

    // 多单管理
    if (pos.posSide === 'long') {
        // 1. 保本损逻辑: 如果收益超过 100% (这里简化为 UPL > 保证金的一半 或者 价格上涨超过一定幅度)
        // 假设初始止损距离是 entry * 0.5%，如果盈利达到这个距离，移动止损到入场价
        const dist = entryPx * 0.005; 
        if (markPx > entryPx + dist && (currentSL < entryPx)) {
            newSL = entryPx; // 保本
            reason = "💰 触发保本止损设置";
        }
        // 2. 移动止盈: 价格继续上涨，止损跟随最近5根K线的最低点
        else {
             const recentLow = Math.min(...recentCandles.map(c => parseFloat(c.l)));
             const trailSL = recentLow * 0.9995; // 放在最低点下方一点
             // 只有当新的 trailSL 高于当前 SL，且低于当前价格时才更新
             if (trailSL > currentSL && trailSL > entryPx && trailSL < markPx) {
                 newSL = trailSL;
                 reason = "🚀 移动止盈跟随 (近5根低点)";
             }
        }
    } 
    // 空单管理
    else if (pos.posSide === 'short') {
        const dist = entryPx * 0.005;
        if (markPx < entryPx - dist && (currentSL > entryPx || currentSL === 0)) {
            newSL = entryPx;
            reason = "💰 触发保本止损设置";
        }
        else {
            const recentHigh = Math.max(...recentCandles.map(c => parseFloat(c.h)));
            const trailSL = recentHigh * 1.0005;
            // 空单 SL 向下移动 (数值变小)
            if ((trailSL < currentSL || currentSL === 0) && trailSL < entryPx && trailSL > markPx) {
                newSL = trailSL;
                reason = "🚀 移动止盈跟随 (近5根高点)";
            }
        }
    }

    if (newSL > 0 && Math.abs(newSL - currentSL) > (entryPx * 0.0005)) {
        return { sl: newSL.toFixed(2), reason };
    }
    return null;
};


export const getTradingDecision = async (
  apiKey: string,
  marketData: MarketDataCollection,
  accountData: AccountContext
): Promise<AIDecision> => {
  
  // 1. 运行核心策略
  const analysis = analyzeStrategy(marketData, accountData);
  
  // 2. 运行持仓管理 (如果有持仓且策略没让平仓)
  let mgmtAction = null;
  const primaryPos = accountData.positions.find(p => p.instId === INSTRUMENT_ID);
  
  if (primaryPos && analysis.action === 'HOLD') {
      mgmtAction = calculateManagement(primaryPos, marketData.candles3m);
  }

  // 3. 整合决策
  let finalAction = analysis.action;
  let finalSL = analysis.sl > 0 ? analysis.sl.toFixed(2) : "0";
  let finalReason = analysis.reason;

  if (mgmtAction) {
      finalAction = 'UPDATE_TPSL';
      finalSL = mgmtAction.sl;
      finalReason = mgmtAction.reason;
  }

  // 4. 计算仓位大小 (Risk Based)
  let size = "0";
  if (finalAction === 'BUY' || finalAction === 'SELL') {
      const avail = parseFloat(accountData.balance.availEq);
      const riskPerTrade = avail * 0.05; // 单笔亏损不超过本金 5%
      const entry = parseFloat(marketData.ticker?.last || "0");
      const stopDist = Math.abs(entry - parseFloat(finalSL));
      
      if (stopDist > 0) {
          const coinSize = riskPerTrade / stopDist; // 风险平衡数量 (ETH)
          // 转换为合约张数 (1张 = 0.1 ETH)
          const contracts = coinSize / CONTRACT_VAL_ETH;
          size = Math.floor(contracts).toString(); // 取整
          if (parseFloat(size) < 1) size = "1"; // 最小1张
      } else {
          size = "1";
      }
      
      // 杠杆保护: 限制名义价值不超过 20倍杠杆
      const maxNotional = avail * 20;
      const currentNotional = parseFloat(size) * CONTRACT_VAL_ETH * entry;
      if (currentNotional > maxNotional) {
          size = Math.floor(maxNotional / (CONTRACT_VAL_ETH * entry)).toString();
      }
  }

  return {
    stage_analysis: analysis.isUpTrend ? "📈 上涨趋势 (1H)" : "📉 下跌趋势 (1H)",
    market_assessment: "策略监控运行中...",
    hot_events_overview: "Algo Mode",
    eth_analysis: "基于 1H EMA15/60 趋势 & 3m K线形态",
    trading_decision: {
        action: finalAction as any,
        confidence: "100%",
        position_size: size,
        leverage: "10", 
        profit_target: "0", // 动态止盈
        stop_loss: finalSL,
        invalidation_condition: "趋势反转"
    },
    reasoning: finalReason,
    action: finalAction as any,
    size: size,
    leverage: "10"
  };
};

export const testConnection = async (apiKey: string) => {
    return "Local Strategy Engine: OK";
};
