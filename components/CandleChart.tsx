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
  const chartData = useMemo(() => {
    if(!data || data.length === 0) return [];

    const processed = data.map(d => ({
      timeRaw: parseInt(d.ts),
      time: new Date(parseInt(d.ts)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
      o: parseFloat(d.o),
      h: parseFloat(d.h),
      l: parseFloat(d.l),
      c: parseFloat(d.c),
      vol: parseFloat(d.vol),
    }));

    // Calculate EMAs based on this specific timeframe data
    const ema15 = calculateEMA(processed, 15);
    const ema60 = calculateEMA(processed, 60);

    return processed.map((item, i) => ({
      ...item,
      ema15: ema15[i],
      ema60: ema60[i],
      isUp: item.c >= item.o
    }));
  }, [data]);

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return ['auto', 'auto'];
    // Focus domain on recent prices
    const slice = chartData.slice(-50); 
    const lows = slice.map(d => d.l);
    const highs = slice.map(d => d.h);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const padding = (max - min) * 0.1; 
    return [min - padding, max + padding];
  }, [chartData]);

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
    const centerX = x + width / 2;

    return (
      <g>
        <line x1={centerX} y1={high} x2={centerX} y2={low} stroke={color} strokeWidth={1} />
        <rect x={x} y={bodyY} width={width} height={bodyHeight} fill={color} stroke={color} />
      </g>
    );
  };

  return (
    <div className="w-full h-full select-none relative">
      <div className="absolute top-2 left-4 text-xs font-mono z-10 flex gap-4 pointer-events-none bg-black/50 p-1 rounded">
          <span className="text-yellow-400 font-bold">EMA 15</span>
          <span className="text-blue-400 font-bold">EMA 60</span>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
          
          <XAxis 
            dataKey="time" 
            stroke="#52525b" 
            tick={{fontSize: 10, fill: '#71717a'}} 
            tickLine={false}
            axisLine={false}
            minTickGap={30}
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

          <YAxis yAxisId="volume" orientation="left" domain={[0, (dataMax: number) => dataMax * 4]} hide />

          <Tooltip 
            contentStyle={{backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', fontSize: '12px'}}
            labelStyle={{color: '#a1a1aa'}}
            content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                        <div className="bg-okx-card border border-okx-border p-2 rounded shadow-xl text-xs z-50">
                            <div className="text-gray-400 mb-1">{label} (3m)</div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                <span className="text-gray-400">Close:</span>
                                <span className={data.isUp ? 'text-okx-up' : 'text-okx-down'}>{data.c}</span>
                                <span className="text-gray-400">Vol:</span>
                                <span>{data.vol}</span>
                            </div>
                            <div className="mt-2 pt-2 border-t border-gray-700 flex flex-col gap-1">
                                <div className="text-yellow-400">EMA15: {data.ema15?.toFixed(2)}</div>
                                <div className="text-blue-400">EMA60: {data.ema60?.toFixed(2)}</div>
                            </div>
                        </div>
                    );
                }
                return null;
            }}
          />

          <Bar dataKey="vol" yAxisId="volume" barSize={4}>
             {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.isUp ? '#10b981' : '#ef4444'} opacity={0.3} />
             ))}
          </Bar>

          <Bar dataKey="h" shape={(props: any) => <CandleStickShape {...props} />} isAnimationActive={false} />

          <Line type="monotone" dataKey="ema15" stroke="#facc15" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="ema60" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />

        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CandleChart;
