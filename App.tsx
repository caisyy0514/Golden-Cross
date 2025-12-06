import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Play, Pause, RefreshCw, Activity, Zap, TrendingUp, AlertCircle, Terminal, Shield, Target, Brain, X, Eye, Flame, Cloud } from 'lucide-react';
import { MarketDataCollection, AccountContext, AIDecision, SystemLog, AppConfig } from './types';
import { DEFAULT_CONFIG, INSTRUMENT_ID, CONTRACT_VAL_ETH } from './constants';
import SettingsModal from './components/SettingsModal';
import CandleChart from './components/CandleChart';

const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  
  const [marketData, setMarketData] = useState<MarketDataCollection | null>(null);
  const [accountData, setAccountData] = useState<AccountContext | null>(null);
  
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [latestDecision, setLatestDecision] = useState<AIDecision | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
        const res = await fetch('/api/status');
        if (!res.ok) return; 

        const text = await res.text();
        try {
            const data = JSON.parse(text);
            setIsRunning(data.isRunning);
            setMarketData(data.marketData);
            setAccountData(data.accountData);
            setLatestDecision(data.latestDecision);
            setLogs(data.logs); 
        } catch (parseError) {
             // Ignore
        }
    } catch (e) {
        // Ignore
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchStatus, 1000);
    fetchStatus();
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const toggleRunning = async () => {
      try {
        await fetch('/api/toggle', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ running: !isRunning })
        });
        fetchStatus();
      } catch (e) {
        console.error("Failed to toggle:", e);
      }
  };

  const saveConfig = async (newConfig: AppConfig) => {
      try {
        await fetch('/api/config', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(newConfig)
        });
        setConfig(newConfig);
        setIsSettingsOpen(false);
      } catch (e) {
        console.error("Failed to save config:", e);
      }
  };

  const formatPrice = (p?: string) => parseFloat(p || "0").toLocaleString('en-US', { minimumFractionDigits: 2 });
  const formatPct = (p?: string) => parseFloat(p || "0").toFixed(2) + '%';

  return (
    <div className="min-h-screen bg-okx-bg text-okx-text font-sans selection:bg-okx-primary selection:text-white">
      {/* HEADER */}
      <header className="h-16 border-b border-okx-border flex items-center justify-between px-6 bg-okx-card/50 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-red-600 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-red-500/20">
            ⚔️
          </div>
          <div>
            <h1 className="font-bold text-white leading-tight">ETH 双均线战神</h1>
            <div className="text-xs text-okx-subtext flex items-center gap-1">
              <Cloud size={12} className="text-blue-400"/>
              {config.isSimulation ? '模拟盘 (Sim)' : '实盘 (Live)'} - 1H Trend / 3m Entry
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-1.5 bg-okx-bg border border-okx-border rounded-full text-sm">
            <span className="text-okx-subtext">权益:</span>
            <span className={`font-mono font-bold ${parseFloat(accountData?.balance.totalEq || "0") < 20 ? 'text-red-400' : 'text-green-400'}`}>
                {formatPrice(accountData?.balance.totalEq)} USDT
            </span>
          </div>
          
          <button 
            onClick={toggleRunning}
            className={`flex items-center gap-2 px-4 py-2 rounded font-medium transition-all ${
              isRunning 
                ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' 
                : 'bg-okx-primary text-white hover:bg-blue-600'
            }`}
          >
            {isRunning ? <><Pause size={18} /> 暂停</> : <><Play size={18} /> 启动</>}
          </button>
          
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-okx-subtext hover:text-white">
            <Settings size={20} />
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="p-6 grid grid-cols-12 gap-6 max-w-[1600px] mx-auto">
        
        {/* LEFT COLUMN: DATA */}
        <div className="col-span-12 lg:col-span-3 space-y-4 h-full flex flex-col">
          {/* Market Card */}
          <div className="bg-okx-card border border-okx-border rounded-xl p-5">
            <div className="flex justify-between items-start">
                 <div>
                    <div className="text-okx-subtext text-sm">{INSTRUMENT_ID}</div>
                    <div className="text-3xl font-bold text-white font-mono mt-1">
                    {formatPrice(marketData?.ticker?.last)}
                    </div>
                 </div>
                 <div className="text-right">
                    <div className={`text-sm font-bold ${parseFloat(marketData?.ticker?.open24h || "0") < parseFloat(marketData?.ticker?.last || "0") ? "text-okx-up" : "text-okx-down"}`}>
                        {formatPct(marketData ? ((parseFloat(marketData.ticker!.last) - parseFloat(marketData.ticker!.open24h)) / parseFloat(marketData.ticker!.open24h) * 100).toString() : "0")}
                    </div>
                 </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-okx-subtext">
                <div className="bg-okx-bg p-2 rounded">
                    <div>1H 趋势状态</div>
                    <div className={`text-white font-mono font-bold ${latestDecision?.stage_analysis.includes('上涨') ? 'text-okx-up' : 'text-okx-down'}`}>
                        {latestDecision?.stage_analysis.replace('趋势', '') || '--'}
                    </div>
                </div>
                <div className="bg-okx-bg p-2 rounded">
                    <div>资金费率</div>
                    <div className="text-white font-mono">{formatPct(marketData?.fundingRate)}</div>
                </div>
            </div>
          </div>

          {/* Position Cards */}
          <div className="flex-1 space-y-3">
             <div className="flex items-center gap-2 text-white font-bold text-sm px-1">
                <Shield size={16} /> 持仓监控
             </div>
             
             {accountData?.positions && accountData.positions.length > 0 ? (
                accountData.positions.map((pos, idx) => (
                    <div key={`${pos.instId}-${pos.posSide}-${idx}`} className={`bg-okx-card border rounded-xl p-5 relative overflow-hidden ${pos ? 'border-okx-primary' : 'border-okx-border'}`}>
                        <div className="absolute top-0 right-0 p-1 bg-okx-primary text-xs font-bold text-white rounded-bl-lg">
                            {pos.instId}
                        </div>
                        <div className="space-y-3 text-sm mt-2">
                            <div className="flex justify-between">
                                <span className="text-okx-subtext">方向</span>
                                <span className={`font-bold uppercase ${pos.posSide === 'long' ? 'text-okx-up' : 'text-okx-down'}`}>
                                    {pos.posSide}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-okx-subtext">持仓量</span>
                                <span className="text-white font-mono">{pos.pos} 张</span>
                            </div>
                            <div className="flex justify-between border-t border-okx-border pt-2">
                                <span className="text-okx-subtext">开仓均价</span>
                                <span className="text-white font-mono">{pos.avgPx}</span>
                            </div>
                            <div className="flex justify-between border-t border-okx-border pt-2">
                                <span className="text-okx-subtext">未结盈亏</span>
                                <span className={`font-mono font-bold ${parseFloat(pos.upl) > 0 ? 'text-okx-up' : 'text-okx-down'}`}>
                                    {pos.upl} U ({formatPct(pos.uplRatio)})
                                </span>
                            </div>
                            {(pos.slTriggerPx || pos.tpTriggerPx) && (
                                <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-okx-border">
                                    <div className="bg-okx-bg p-1.5 rounded text-center">
                                        <div className="text-xs text-okx-subtext">止损 (SL)</div>
                                        <div className="text-xs font-mono text-red-400">{pos.slTriggerPx || "--"}</div>
                                    </div>
                                    <div className="bg-okx-bg p-1.5 rounded text-center">
                                        <div className="text-xs text-okx-subtext">止盈 (TP)</div>
                                        <div className="text-xs font-mono text-green-400">{pos.tpTriggerPx || "--"}</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))
             ) : (
                <div className="bg-okx-card border border-okx-border rounded-xl p-6 text-okx-subtext text-center text-sm">
                    <div className="mb-2 opacity-50"><Brain size={32} className="mx-auto"/></div>
                    等待 3分钟 K线信号...
                </div>
             )}
          </div>
        </div>

        {/* MIDDLE COLUMN: CHART */}
        <div className="col-span-12 lg:col-span-6 h-[500px] lg:h-[600px] bg-okx-card border border-okx-border rounded-xl p-4 flex flex-col relative">
           <div className="absolute top-4 right-4 z-10 bg-okx-bg/80 px-2 py-1 rounded text-xs text-okx-subtext border border-okx-border font-mono">
               Timeframe: 3m
           </div>
           <CandleChart data={marketData?.candles3m || []} />
        </div>

        {/* RIGHT COLUMN: STRATEGY */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-4 h-[600px] lg:h-full">
           {/* Strategy Status */}
           <div className="bg-gradient-to-b from-gray-800 to-okx-card border border-okx-border rounded-xl p-5 flex flex-col">
              <div className="flex items-center gap-2 text-purple-400 font-bold mb-3">
                 <Brain size={18} /> 策略引擎实时逻辑
              </div>
              
              {latestDecision ? (
                  <div className="space-y-3 flex-1">
                      <div className="flex items-center justify-between">
                          <span className="text-xs text-okx-subtext">指令动作</span>
                          <span className={`text-xs px-2 py-1 rounded border font-bold ${
                              latestDecision.action === 'BUY' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                              latestDecision.action === 'SELL' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                              'bg-gray-500/20 text-gray-400 border-gray-500/30'
                          }`}>
                              {latestDecision.action}
                          </span>
                      </div>
                      
                      <div className="text-xs text-okx-subtext bg-okx-bg p-3 rounded-lg border border-okx-border max-h-[120px] overflow-y-auto">
                          {latestDecision.reasoning}
                      </div>

                      {latestDecision.trading_decision.stop_loss !== "0" && (
                          <div className="flex justify-between text-xs text-red-400 bg-red-900/10 p-2 rounded">
                             <span>计划止损位:</span>
                             <span className="font-mono">{latestDecision.trading_decision.stop_loss}</span>
                          </div>
                      )}
                  </div>
              ) : (
                  <div className="text-center text-okx-subtext text-sm py-8 flex flex-col items-center">
                      <div className="animate-spin mb-2"><RefreshCw size={16}/></div>
                      系统初始化中...
                  </div>
              )}
           </div>

           {/* Logs */}
           <div className="flex-1 bg-black/40 border border-okx-border rounded-xl p-4 overflow-hidden flex flex-col min-h-[300px]">
             <div className="flex items-center gap-2 mb-2 text-okx-subtext text-xs uppercase tracking-wider font-semibold">
                <Terminal size={12} /> 系统日志
             </div>
             <div className="flex-1 overflow-y-auto space-y-2 pr-2 font-mono text-xs">
                 {logs.slice().reverse().map(log => (
                    <div key={log.id} className="break-words border-b border-gray-800/50 pb-1 mb-1 last:border-0">
                        <span className="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
                        <span className={
                            log.type === 'ERROR' ? 'text-red-500' :
                            log.type === 'SUCCESS' ? 'text-green-500' :
                            log.type === 'TRADE' ? 'text-yellow-400' :
                            'text-gray-300'
                        }>
                            {log.message}
                        </span>
                    </div>
                 ))}
             </div>
          </div>
        </div>

      </main>

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        config={config} 
        onSave={saveConfig} 
      />
    </div>
  );
};

export default App;
