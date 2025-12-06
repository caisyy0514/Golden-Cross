import React, { useMemo } from 'react';
import { ResponsiveContainer, ComposedChart, XAxis, YAxis, Tooltip, Bar, CartesianGrid, Line, Cell } from 'recharts';
import { CandleData } from '../types';

interface Props {
  data: CandleData[];
}

// EMA Helper
const calculateEMA = (data: any[], period: number) => {
  const k = 2 / (period + 1);
  const result = [];
  if (data.length === 0) return [];
  
  let prevEma = data[0].c; 
  result.push(prevEma);

  for (let i = 1; i < data.length; i++) {
    const val = data[i].c * k + prevEma * (1 - k);
    result.push(val);
    prevEma = val;
  }
  return result;
};

const CandleChart: React.FC<Props> = ({ data }) => {
  // 1. Process full data for accurate EMA calculation
  const processedData = useMemo(() => {
    if(!data || data.length === 0) return [];

    const raw = data.map(d => ({
      timeRaw: parseInt(d.ts),
      time: new Date(parseInt(d.ts)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
      o: parseFloat(d.o),
      h: parseFloat(d.h),
      l: parseFloat(d.l),
      c: parseFloat(d.c),
      vol: parseFloat(d.vol),
    }));

    // Calculate EMAs based on ALL available data
    const ema15 = calculateEMA(raw, 15);
    const ema60 = calculateEMA(raw, 60);

    return raw.map((item, i) => ({
      ...item,
      ema15: ema15[i],
      ema60: ema60[i],
      isUp: item.c >= item.o
    }));
  }, [data]);

  // 2. Slice specific range for Display (Fixed Zoom Level)
  // Showing last 80 candles ensures candles are readable and not too thin
  const visibleData = useMemo(() => {
      return processedData.slice(-80);
  }, [processedData]);

  // 3. Dynamic Y-Axis Domain based ONLY on VISIBLE data
  const yDomain = useMemo(() => {
    if (visibleData.length === 0) return ['auto', 'auto'];
    
    let min = Infinity;
    let max = -Infinity;

    visibleData.forEach(d => {
        if (d.l < min) min = d.l;
        if (d.h > max) max = d.h;
        // Include EMA in domain so lines don't get cut off
        if (d.ema15 && d.ema15 < min) min = d.ema15;
        if (d.ema15 && d.ema15 > max) max = d.ema15;
        if (d.ema60 && d.ema60 < min) min = d.ema60;
        if (d.ema60 && d.ema60 > max) max = d.ema60;
    });

    const padding = (max - min) * 0.15; // 15% Padding for better aesthetics
    return [min - padding, max + padding];
  }, [visibleData]);

  const CandleStickShape = (props: any) => {
    const { x, width, payload, yAxis } = props;
    if (!yAxis || !yAxis.scale) return null;

    const scale = yAxis.scale;
    const open = scale(payload.o);
    const close = scale(payload.c);
    const high = scale(payload.h);
    const low = scale(payload.l);
    
    const isUp = payload.c >= payload.o;
    const color = isUp ? '#10b981' : '#ef4444'; 
    const bodyHeight = Math.max(Math.abs(open - close), 1);
    const bodyY = Math.min(open, close);
    // Add gap between candles
    const candleWidth = Math.max(width - 2, 2); 
    const candleX = x + (width - candleWidth) / 2;
    const centerX = x + width / 2;

    return (
      <g>
        <line x1={centerX} y1={high} x2={centerX} y2={low} stroke={color} strokeWidth={1} opacity={0.8} />
        <rect x={candleX} y={bodyY} width={candleWidth} height={bodyHeight} fill={color} stroke="none" rx={1} />
      </g>
    );
  };

  return (
    <div className="w-full h-full select-none relative">
      <div className="absolute top-2 left-4 text-xs font-mono z-10 flex gap-4 pointer-events-none bg-black/40 backdrop-blur-sm p-1.5 rounded border border-white/5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
            <span className="text-gray-300 font-bold">EMA 15</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-400"></div>
            <span className="text-gray-300 font-bold">EMA 60</span>
          </div>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={visibleData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="volGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#27272a" stopOpacity={0.5}/>
              <stop offset="95%" stopColor="#27272a" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} opacity={0.5} />
          
          <XAxis 
            dataKey="time" 
            stroke="#52525b" 
            tick={{fontSize: 10, fill: '#71717a'}} 
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          
          <YAxis 
            domain={yDomain} 
            orientation="right" 
            stroke="#52525b" 
            tick={{fontSize: 10, fill: '#71717a'}}
            tickLine={false}
            axisLine={false}
            tickFormatter={(val) => val.toFixed(1)}
            width={50}
          />

          <YAxis yAxisId="volume" orientation="left" domain={[0, (dataMax: number) => dataMax * 5]} hide />

          <Tooltip 
            cursor={{ stroke: '#52525b', strokeWidth: 1, strokeDasharray: '4 4' }}
            contentStyle={{backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', fontSize: '12px', padding: '8px'}}
            labelStyle={{color: '#a1a1aa', marginBottom: '4px'}}
            content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                        <div className="bg-okx-card border border-okx-border p-3 rounded-lg shadow-xl text-xs z-50 min-w-[140px]">
                            <div className="text-gray-400 mb-2 font-mono border-b border-gray-800 pb-1">{label}</div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono">
                                <span className="text-gray-500">Price</span>
                                <span className={data.isUp ? 'text-okx-up' : 'text-okx-down'}>{data.c.toFixed(2)}</span>
                                
                                <span className="text-gray-500">EMA15</span>
                                <span className="text-yellow-400">{data.ema15?.toFixed(2)}</span>
                                
                                <span className="text-gray-500">EMA60</span>
                                <span className="text-blue-400">{data.ema60?.toFixed(2)}</span>
                                
                                <span className="text-gray-500">Vol</span>
                                <span className="text-gray-300">{data.vol.toLocaleString()}</span>
                            </div>
                        </div>
                    );
                }
                return null;
            }}
          />

          <Bar dataKey="vol" yAxisId="volume" barSize={4}>
             {visibleData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.isUp ? '#10b981' : '#ef4444'} opacity={0.15} />
             ))}
          </Bar>

          <Bar dataKey="h" shape={(props: any) => <CandleStickShape {...props} />} isAnimationActive={false} />

          <Line 
            type="monotone" 
            dataKey="ema15" 
            stroke="#facc15" 
            strokeWidth={1.5} 
            dot={false} 
            activeDot={{r: 4, strokeWidth: 0}}
            isAnimationActive={false} 
          />
          <Line 
            type="monotone" 
            dataKey="ema60" 
            stroke="#60a5fa" 
            strokeWidth={1.5} 
            dot={false} 
            activeDot={{r: 4, strokeWidth: 0}}
            isAnimationActive={false} 
          />

        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CandleChart;
