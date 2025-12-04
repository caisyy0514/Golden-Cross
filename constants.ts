
export const INSTRUMENT_ID = "ETH-USDT-SWAP";
// OKX V5 规范: ETH-USDT-SWAP 1张合约 = 0.1 ETH
// 注意: 实际交易前请核对 OKX 文档，部分币种为 0.01 或 10 USD
export const CONTRACT_VAL_ETH = 0.1;

export const DEFAULT_CONFIG = {
  okxApiKey: "",
  okxSecretKey: "",
  okxPassphrase: "",
  deepseekApiKey: "", // Renamed
  isSimulation: true, 
};

// 10U 战神策略阶段定义
export const STRATEGY_STAGES = {
  STAGE_1: {
    name: "起步期 (生存测试)",
    max_equity: 20,
    leverage: 100, // 高杠杆
    risk_factor: 0.4, // 动态仓位: 使用 40% 的可用余额 (Dynamic: 40% of Balance)
    allow_pyramiding: true, 
    pyramid_condition: "profit_only", 
  },
  STAGE_2: {
    name: "滚仓期 (资金积累)",
    max_equity: 80,
    leverage: 50,
    risk_factor: 0.5, // 动态仓位: 使用 50% 的可用余额
  },
  STAGE_3: {
    name: "稳健期 (模式转型)",
    min_equity: 80,
    leverage: 30,
    split_parts: 8, // 资金分成8份
  }
};

export const MOCK_TICKER = {
  instId: INSTRUMENT_ID,
  last: "3250.50",
  lastSz: "1.2",
  askPx: "3250.60",
  bidPx: "3250.40",
  open24h: "3100.00",
  high24h: "3300.00",
  low24h: "3050.00",
  volCcy24h: "500000000",
  ts: Date.now().toString(),
};
