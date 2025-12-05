import { AccountBalance, CandleData, MarketDataCollection, PositionData, TickerData, AIDecision, AccountContext } from "../types";
import { INSTRUMENT_ID, MOCK_TICKER, CONTRACT_VAL_ETH } from "../constants";
import CryptoJS from 'crypto-js';

const randomVariation = (base: number, percent: number) => {
  return base + base * (Math.random() - 0.5) * (percent / 100);
};

const BASE_URL = "https://www.okx.com";

const signRequest = (method: string, requestPath: string, body: string = '', secretKey: string) => {
  const timestamp = new Date().toISOString();
  const message = timestamp + method + requestPath + body;
  const hmac = CryptoJS.HmacSHA256(message, secretKey);
  const signature = CryptoJS.enc.Base64.stringify(hmac);
  return { timestamp, signature };
};

const getHeaders = (method: string, requestPath: string, body: string = '', config: any) => {
  const { timestamp, signature } = signRequest(method, requestPath, body, config.okxSecretKey);
  return {
    'Content-Type': 'application/json',
    'OK-ACCESS-KEY': config.okxApiKey,
    'OK-ACCESS-PASSPHRASE': config.okxPassphrase,
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-SIMULATED': '0' 
  };
};

export const fetchMarketData = async (config: any): Promise<MarketDataCollection> => {
  if (config.isSimulation) {
    return generateMockMarketData();
  }

  try {
    const tickerRes = await fetch(`${BASE_URL}/api/v5/market/ticker?instId=${INSTRUMENT_ID}`);
    const tickerJson = await tickerRes.json();
    
    // 1. 获取 1小时 K线 (用于判断主趋势 Trend)
    // 获取300根以确保 EMA(60) 计算稳定
    const candles1HRes = await fetch(`${BASE_URL}/api/v5/market/candles?instId=${INSTRUMENT_ID}&bar=1H&limit=300`);
    const candles1HJson = await candles1HRes.json();
    
    // 2. 获取 3分钟 K线 (用于入场信号 Entry)
    // 获取300根以确保能回溯到金叉/死叉形态
    const candles3mRes = await fetch(`${BASE_URL}/api/v5/market/candles?instId=${INSTRUMENT_ID}&bar=3m&limit=300`);
    const candles3mJson = await candles3mRes.json();

    const fundingRes = await fetch(`${BASE_URL}/api/v5/public/funding-rate?instId=${INSTRUMENT_ID}`);
    const fundingJson = await fundingRes.json();
    
    const oiRes = await fetch(`${BASE_URL}/api/v5/public/open-interest?instId=${INSTRUMENT_ID}`);
    const oiJson = await oiRes.json();

    if (tickerJson.code !== '0') throw new Error(`OKX API Error (Ticker): ${tickerJson.msg}`);

    return {
      ticker: tickerJson.data[0],
      candles1H: formatCandles(candles1HJson.data),
      candles3m: formatCandles(candles3mJson.data),
      fundingRate: fundingJson.data[0]?.fundingRate || "0",
      openInterest: oiJson.data[0]?.oi || "0",
      orderbook: {}, 
      trades: [],
    };
  } catch (error: any) {
    console.error("OKX API 获取失败:", error);
    throw new Error(`无法连接 OKX API: ${error.message}`);
  }
};

// Fetch Pending Algo Orders (TP/SL)
const fetchAlgoOrders = async (config: any): Promise<any[]> => {
    if (config.isSimulation) return [];
    try {
        const path = `/api/v5/trade/orders-algo-pending?instId=${INSTRUMENT_ID}&ordType=conditional,oco`;
        const headers = getHeaders('GET', path, '', config);
        const res = await fetch(BASE_URL + path, { method: 'GET', headers });
        const json = await res.json();
        return json.code === '0' ? json.data : [];
    } catch (e) {
        console.warn("Failed to fetch algo orders", e);
        return [];
    }
};

export const fetchAccountData = async (config: any): Promise<AccountContext> => {
  if (config.isSimulation) {
    return generateMockAccountData();
  }

  try {
    const balPath = '/api/v5/account/balance?ccy=USDT';
    const balHeaders = getHeaders('GET', balPath, '', config);
    const balRes = await fetch(BASE_URL + balPath, { method: 'GET', headers: balHeaders });
    const balJson = await balRes.json();

    const posPath = `/api/v5/account/positions?instId=${INSTRUMENT_ID}`;
    const posHeaders = getHeaders('GET', posPath, '', config);
    const posRes = await fetch(BASE_URL + posPath, { method: 'GET', headers: posHeaders });
    const posJson = await posRes.json();

    if (balJson.code && balJson.code !== '0') throw new Error(`Balance API: ${balJson.msg}`);
    
    const balanceData = balJson.data?.[0]?.details?.[0]; 
    
    let positions: PositionData[] = [];
    
    if (posJson.data && posJson.data.length > 0) {
        const algoOrders = await fetchAlgoOrders(config);
        
        positions = posJson.data.map((rawPos: any) => {
            const position: PositionData = {
                instId: rawPos.instId,
                posSide: rawPos.posSide,
                pos: rawPos.pos,
                avgPx: rawPos.avgPx,
                upl: rawPos.upl,
                uplRatio: rawPos.uplRatio,
                mgnMode: rawPos.mgnMode,
                margin: rawPos.margin,
                liqPx: rawPos.liqPx,
                cTime: rawPos.cTime
            };
            
             if (algoOrders.length > 0) {
                 const slOrder = algoOrders.find((o: any) => o.instId === rawPos.instId && o.posSide === rawPos.posSide && o.slTriggerPx && parseFloat(o.slTriggerPx) > 0);
                 const tpOrder = algoOrders.find((o: any) => o.instId === rawPos.instId && o.posSide === rawPos.posSide && o.tpTriggerPx && parseFloat(o.tpTriggerPx) > 0);
                 
                 if (slOrder) position.slTriggerPx = slOrder.slTriggerPx;
                 if (tpOrder) position.tpTriggerPx = tpOrder.tpTriggerPx;
             }
             return position;
        });
    }
    
    return {
      balance: {
        totalEq: balanceData?.eq || "0",
        availEq: balanceData?.availEq || "0",
        uTime: balJson.data?.[0]?.uTime || Date.now().toString()
      },
      positions
    };

  } catch (error: any) {
     console.error("OKX Account API Error:", error);
     throw new Error(`账户数据获取失败: ${error.message}`);
  }
};

const setLeverage = async (instId: string, lever: string, posSide: string, config: any) => {
    if (config.isSimulation) return;
    
    const path = "/api/v5/account/set-leverage";
    const body = JSON.stringify({
        instId,
        lever,
        mgnMode: "isolated",
        posSide
    });
    const headers = getHeaders('POST', path, body, config);
    const response = await fetch(BASE_URL + path, { method: 'POST', headers, body });
    const json = await response.json();
    
    if (json.code !== '0') {
        throw new Error(`设置杠杆失败 (${lever}x): ${json.msg} (Code: ${json.code})`);
    }
    return json;
};

const ensureLongShortMode = async (config: any) => {
    if (config.isSimulation) return;
    const path = "/api/v5/account/config";
    const headers = getHeaders('GET', path, '', config);
    const response = await fetch(BASE_URL + path, { method: 'GET', headers });
    const json = await response.json();
    
    if (json.code === '0' && json.data && json.data[0]) {
        if (json.data[0].posMode !== 'long_short_mode') {
            console.log("Switching to long_short_mode...");
            const setPath = "/api/v5/account/set-position-mode";
            const setBody = JSON.stringify({ posMode: 'long_short_mode' });
            const setHeaders = getHeaders('POST', setPath, setBody, config);
            const setRes = await fetch(BASE_URL + setPath, { method: 'POST', headers: setHeaders, body: setBody });
            const setJson = await setRes.json();
            if (setJson.code !== '0') {
                throw new Error(`无法切换持仓模式为双向持仓: ${setJson.msg}`);
            }
        }
    }
};

export const executeOrder = async (order: AIDecision, config: any): Promise<any> => {
  if (config.isSimulation) {
    console.log("SIMULATION: Executing Order", order);
    return { code: "0", msg: "模拟下单成功", data: [{ ordId: "sim_" + Date.now() }] };
  }
  
  try {
    try { await ensureLongShortMode(config); } catch (e: any) { console.warn("Pos Mode Warn:", e.message); }

    if (order.action === 'CLOSE') {
        const closePath = "/api/v5/trade/close-position";
        
        // 尝试平多
        const closeLongBody = JSON.stringify({ instId: INSTRUMENT_ID, posSide: 'long', mgnMode: 'isolated' });
        const headersLong = getHeaders('POST', closePath, closeLongBody, config);
        const resLong = await fetch(BASE_URL + closePath, { method: 'POST', headers: headersLong, body: closeLongBody });
        const jsonLong = await resLong.json();
        if (jsonLong.code === '0') return jsonLong;

        // 尝试平空
        const closeShortBody = JSON.stringify({ instId: INSTRUMENT_ID, posSide: 'short', mgnMode: 'isolated' });
        const headersShort = getHeaders('POST', closePath, closeShortBody, config);
        const resShort = await fetch(BASE_URL + closePath, { method: 'POST', headers: headersShort, body: closeShortBody });
        const jsonShort = await resShort.json();
        if (jsonShort.code === '0') return jsonShort;

        throw new Error(`平仓失败 (多: ${jsonLong.msg}, 空: ${jsonShort.msg})`);
    }

    // 买入/卖出逻辑
    const posSide = order.action === 'BUY' ? 'long' : 'short';
    const side = order.action === 'BUY' ? 'buy' : 'sell';

    try {
        await setLeverage(INSTRUMENT_ID, order.leverage || "50", posSide, config);
    } catch (e: any) {
        throw new Error(`无法设置杠杆: ${e.message}`);
    }

    const path = "/api/v5/trade/order";
    let sizeFloat = 0;
    try {
        sizeFloat = parseFloat(order.size);
        if (sizeFloat < 0.01) throw new Error("数量过小 (<0.01张)");
    } catch (e) {
        throw new Error("无效数量: " + order.size);
    }
    const sizeStr = sizeFloat.toFixed(2);

    const bodyObj: any = {
        instId: INSTRUMENT_ID,
        tdMode: "isolated", 
        side: side,
        posSide: posSide, 
        ordType: "market",
        sz: sizeStr
    };
    
    // 附带止损 (注意：根据OKX规则，市价单附带止损止盈参数可能不同，这里使用attachAlgoOrds)
    const slPrice = order.trading_decision?.stop_loss;
    const cleanPrice = (p: string | undefined) => p && !isNaN(parseFloat(p)) && parseFloat(p) > 0 ? p : null;
    const validSl = cleanPrice(slPrice);

    if (validSl) {
        bodyObj.attachAlgoOrds = [{
            slTriggerPx: validSl,
            slOrdPx: '-1' // 市价止损
        }];
    }
    
    const requestBody = JSON.stringify(bodyObj);
    const headers = getHeaders('POST', path, requestBody, config);
    
    const response = await fetch(BASE_URL + path, { method: 'POST', headers: headers, body: requestBody });
    const json = await response.json();

    if (json.code !== '0') {
        throw new Error(`下单失败: ${json.msg} (Code: ${json.code})`);
    }
    return json;

  } catch (error: any) {
      console.error("Trade execution failed:", error);
      throw error;
  }
};

export const updatePositionTPSL = async (instId: string, posSide: 'long' | 'short', size: string, slPrice?: string, tpPrice?: string, config?: any) => {
    if (config.isSimulation) {
        console.log(`[SIM] Updated TP/SL: SL=${slPrice}, TP=${tpPrice}`);
        return { code: "0", msg: "模拟更新成功" };
    }

    try {
        const pendingAlgos = await fetchAlgoOrders(config);
        const toCancel = pendingAlgos
            .filter((o: any) => o.instId === instId && o.posSide === posSide)
            .map((o: any) => ({ algoId: o.algoId, instId }));

        if (toCancel.length > 0) {
            const cancelPath = "/api/v5/trade/cancel-algos";
            const cancelBody = JSON.stringify(toCancel);
            const headers = getHeaders('POST', cancelPath, cancelBody, config);
            await fetch(BASE_URL + cancelPath, { method: 'POST', headers: headers, body: cancelBody });
        }

        if (!slPrice && !tpPrice) return { code: "0", msg: "无新的止盈止损" };

        const path = "/api/v5/trade/order-algo";
        const bodyObj: any = {
            instId,
            posSide,
            tdMode: 'isolated',
            side: posSide === 'long' ? 'sell' : 'buy',
            ordType: 'conditional',
            sz: size, 
            reduceOnly: true
        };

        if (slPrice) {
            bodyObj.slTriggerPx = slPrice;
            bodyObj.slOrdPx = '-1';
        }
        if (tpPrice) {
            bodyObj.tpTriggerPx = tpPrice;
            bodyObj.tpOrdPx = '-1';
        }

        const body = JSON.stringify(bodyObj);
        const headers = getHeaders('POST', path, body, config);
        const res = await fetch(BASE_URL + path, { method: 'POST', headers: headers, body: body });
        const json = await res.json();
        
        if (json.code !== '0') throw new Error(`更新TPSL失败: ${json.msg}`);
        return { code: "0", msg: "止盈止损更新成功" };

    } catch (e: any) {
        throw new Error(`更新失败: ${e.message}`);
    }
};

export const addMargin = async (params: { instId: string; posSide: string; type: string; amt: string }, config: any) => {
   if (config.isSimulation) return { code: "0", msg: "模拟追加成功" };
  try {
      const path = "/api/v5/account/position/margin-balance";
      const body = JSON.stringify(params);
      const headers = getHeaders('POST', path, body, config);
      const response = await fetch(BASE_URL + path, { method: 'POST', headers: headers, body: body });
      const json = await response.json();
      if (json.code !== '0') throw new Error(`追加失败: ${json.msg}`);
      return json;
  } catch (error: any) {
      throw new Error(`追加保证金错误: ${error.message}`);
  }
}

function formatCandles(apiCandles: any[]): CandleData[] {
  if (!apiCandles || !Array.isArray(apiCandles)) return [];
  // API returns Newest -> Oldest. We reverse it to Oldest -> Newest for technical analysis calculation
  return apiCandles.map((c: string[]) => ({
    ts: c[0],
    o: c[1],
    h: c[2],
    l: c[3],
    c: c[4],
    vol: c[5]
  })).reverse(); 
}

function generateMockMarketData(): MarketDataCollection {
  const now = Date.now();
  const currentPrice = 3250 + Math.sin(now / 10000) * 50; 
  const generateCandles = (count: number, intervalMs: number) => {
    const candles: CandleData[] = [];
    let price = currentPrice;
    for (let i = 0; i < count; i++) {
      const ts = (now - i * intervalMs).toString();
      const open = price;
      const close = randomVariation(open, 0.5);
      candles.push({ 
          ts, 
          o: open.toFixed(2), 
          h: (Math.max(open, close) + 2).toFixed(2), 
          l: (Math.min(open, close) - 2).toFixed(2), 
          c: close.toFixed(2), 
          vol: (Math.random() * 100).toFixed(2) 
      });
      price = parseFloat(open.toFixed(2)) + (Math.random() - 0.5) * 10;
    }
    return candles.reverse();
  };

  return {
    ticker: { ...MOCK_TICKER, last: currentPrice.toFixed(2), ts: now.toString() },
    candles1H: generateCandles(300, 3600000), 
    candles3m: generateCandles(300, 180000), 
    fundingRate: "0.0001",
    openInterest: "50000",
    orderbook: [],
    trades: []
  };
}

function generateMockAccountData(): AccountContext {
  return {
    balance: {
      totalEq: "1000.00", 
      availEq: "1000.00",
      uTime: Date.now().toString(),
    },
    positions: []
  };
}
