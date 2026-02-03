
import React, { useState, useEffect, useRef } from 'react';
import { LogEntry, ModbusConfig } from '../types';
import LogViewer from './LogViewer';

const FUNCTION_CODES = [
  { label: '01 Read Coils', value: '01' },
  { label: '02 Read Discrete Inputs', value: '02' },
  { label: '03 Read Holding Registers', value: '03' },
  { label: '04 Read Input Registers', value: '04' },
  { label: '05 Write Single Coil', value: '05' },
  { label: '06 Write Single Register', value: '06' }
];

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

const PYTHON_BRIDGE_CODE = `import asyncio
import websockets
import json
import socket
import sys

# Try to import serial for RTU support
try:
    import serial
    import serial_asyncio
    HAS_SERIAL = True
except ImportError:
    HAS_SERIAL = False

async def bridge(websocket):
    target_handle = None
    target_type = None # 'tcp' or 'serial'
    
    print("[*] Browser connection established.")
    
    async def cleanup():
        nonlocal target_handle
        if target_handle:
            print("[*] Cleaning up target link...")
            try:
                if target_type == 'tcp':
                    target_handle.close()
                elif target_type == 'serial':
                    _, writer = target_handle
                    writer.close()
                    await writer.wait_closed()
            except: pass
            target_handle = None

    try:
        async for message in websocket:
            if isinstance(message, str):
                try:
                    data = json.loads(message)
                except: continue
                    
                action = data.get('action')
                if action == 'connect':
                    await cleanup()
                    
                    protocol = data.get('protocol', 'TCP')
                    if protocol == 'TCP':
                        host, port = data.get('host'), data.get('port')
                        print(f"[*] TCP: Connecting to {host}:{port}...")
                        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        sock.setblocking(False)
                        loop = asyncio.get_running_loop()
                        try:
                            await asyncio.wait_for(loop.sock_connect(sock, (host, port)), timeout=5.0)
                            target_handle = sock
                            target_type = 'tcp'
                            await websocket.send(json.dumps({"status": "connected", "mode": "TCP"}))
                            print(f"[+] TCP Link Ready")
                        except Exception as e:
                            print(f"[!] TCP Fail: {e}")
                            await websocket.send(json.dumps({"error": f"Connection failed: {e}"}))
                            sock.close()
                            
                    elif protocol == 'RTU':
                        if not HAS_SERIAL:
                            await websocket.send(json.dumps({"error": "pyserial not installed"}))
                            continue
                        
                        port, baud = data.get('serialPort'), data.get('baudRate', 9600)
                        print(f"[*] RTU: Opening {port} @ {baud}...")
                        try:
                            reader, writer = await serial_asyncio.open_serial_connection(url=port, baudrate=baud)
                            target_handle = (reader, writer)
                            target_type = 'serial'
                            await websocket.send(json.dumps({"status": "connected", "mode": "RTU"}))
                            print(f"[+] Serial Link Ready")
                        except Exception as e:
                            print(f"[!] Serial Fail: {e}")
                            await websocket.send(json.dumps({"error": f"Serial error: {e}"}))
                
            elif isinstance(message, bytes):
                if not target_handle:
                    await websocket.send(json.dumps({"error": "No active target link"}))
                    continue
                    
                if target_type == 'tcp':
                    try:
                        loop = asyncio.get_running_loop()
                        await loop.sock_sendall(target_handle, message)
                        response = await asyncio.wait_for(loop.sock_recv(target_handle, 1024), timeout=3.0)
                        if response:
                            await websocket.send(response)
                        else:
                            print("[!] TCP: Remote closed connection.")
                            await websocket.send(json.dumps({"status": "disconnected", "reason": "TCP peer closed"}))
                            await cleanup()
                    except asyncio.TimeoutError:
                        await websocket.send(json.dumps({"error": "Modbus TCP Timeout"}))
                    except Exception as e:
                        await websocket.send(json.dumps({"error": str(e)}))
                        await cleanup()
                
                elif target_type == 'serial':
                    reader, writer = target_handle
                    try:
                        writer.write(message)
                        await writer.drain()
                        response = await asyncio.wait_for(reader.read(1024), timeout=2.0)
                        if response:
                            await websocket.send(response)
                    except asyncio.TimeoutError:
                        await websocket.send(json.dumps({"error": "Modbus RTU Timeout"}))
                    except Exception as e:
                        await websocket.send(json.dumps({"error": str(e)}))

    except websockets.exceptions.ConnectionClosed:
        print("[-] Browser disconnected.")
    finally:
        await cleanup()

async def main():
    print("========================================")
    print("   Raiden Modbus Master Bridge (v3.5)  ")
    print("   Data Inspector Enabled              ")
    print("========================================")
    try:
        async with websockets.serve(bridge, "localhost", 8080):
            print("[*] Bridge listening on ws://localhost:8080")
            await asyncio.Future()
    except Exception as e:
        print(f"[!] Server error: {e}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)`;

interface ParsedValue {
  address: number;
  value: string | number;
  hex: string;
}

const ModbusTab: React.FC = () => {
  const [config, setConfig] = useState<ModbusConfig & { bridgeUrl: string, serialPort: string, baudRate: number }>({
    protocol: 'TCP',
    bridgeUrl: 'ws://localhost:8080',
    host: '172.16.255.130',
    port: 502,
    serialPort: 'COM1',
    baudRate: 9600,
    slaveId: 1,
    functionCode: '03',
    startAddress: 0,
    quantity: 10,
    value: 0
  });
  
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [parsedData, setParsedData] = useState<ParsedValue[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showHelper, setShowHelper] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const transactionIdRef = useRef<number>(1);
  const lastRequestRef = useRef<{ fc: string, start: number, qty: number } | null>(null);

  const calculateCRC = (buffer: Uint8Array): number => {
    let crc = 0xFFFF;
    for (let pos = 0; pos < buffer.length; pos++) {
      crc ^= buffer[pos];
      for (let i = 8; i !== 0; i--) {
        if ((crc & 0x0001) !== 0) {
          crc >>= 1;
          crc ^= 0xA001;
        } else {
          crc >>= 1;
        }
      }
    }
    return crc;
  };

  const addLog = (type: LogEntry['type'], message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, fractionDigits: 3 } as any);
    setLogs(prev => [...prev, { timestamp, type, message }].slice(-100));
  };

  const parseModbusResponse = (buffer: Uint8Array) => {
    if (!lastRequestRef.current) return;
    const { fc, start, qty } = lastRequestRef.current;
    const pduOffset = config.protocol === 'TCP' ? 7 : 0;
    const respFC = buffer[pduOffset + (config.protocol === 'TCP' ? 0 : 1)];
    
    if (respFC > 0x80) {
      addLog('error', `Modbus Exception Received: 0x${buffer[pduOffset + (config.protocol === 'TCP' ? 1 : 2)].toString(16).toUpperCase()}`);
      return;
    }

    const dataStart = pduOffset + (config.protocol === 'TCP' ? 2 : 3);
    const byteCount = buffer[dataStart - 1];
    const rawData = buffer.slice(dataStart, dataStart + byteCount);
    const results: ParsedValue[] = [];

    if (fc === '01' || fc === '02') {
      for (let i = 0; i < qty; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = i % 8;
        const val = (rawData[byteIdx] >> bitIdx) & 0x01;
        results.push({ address: start + i, value: val ? 'ON' : 'OFF', hex: val ? '01' : '00' });
      }
    } else if (fc === '03' || fc === '04') {
      for (let i = 0; i < qty; i++) {
        const idx = i * 2;
        if (idx + 1 < rawData.length) {
          const val = (rawData[idx] << 8) | rawData[idx + 1];
          results.push({ 
            address: start + i, 
            value: val, 
            hex: `${rawData[idx].toString(16).padStart(2,'0')}${rawData[idx+1].toString(16).padStart(2,'0')}`.toUpperCase() 
          });
        }
      }
    }
    if (results.length > 0) setParsedData(results);
  };

  const handleDownloadBridge = () => {
    const blob = new Blob([PYTHON_BRIDGE_CODE], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modbus_bridge.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleToggleConnect = () => {
    if (wsRef.current) {
      addLog('info', 'Closing bridge connection...');
      wsRef.current.close();
      return;
    }
    setIsConnecting(true);
    addLog('info', `Connecting to Bridge: ${config.bridgeUrl}...`);
    try {
      const ws = new WebSocket(config.bridgeUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      ws.onopen = () => {
        setIsConnecting(false);
        setIsConnected(true);
        const targetDesc = config.protocol === 'TCP' ? `${config.host}:${config.port}` : `${config.serialPort}`;
        addLog('info', `Bridge Connected. Opening ${config.protocol} link to ${targetDesc}...`);
        ws.send(JSON.stringify({ 
          action: 'connect', 
          protocol: config.protocol,
          host: config.host, 
          port: config.port,
          serialPort: config.serialPort,
          baudRate: config.baudRate
        }));
      };
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const buffer = new Uint8Array(event.data);
          const hex = Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
          addLog('received', `[RX] ${hex}`);
          parseModbusResponse(buffer);
          setIsProcessing(false);
        } else {
          try {
            const msg = JSON.parse(event.data);
            if (msg.status === 'connected') {
              addLog('info', `${msg.mode || config.protocol} Link established.`);
            } else if (msg.status === 'disconnected') {
              addLog('error', `Target disconnected: ${msg.reason}`);
              setIsProcessing(false);
              setIsConnected(false);
            } else if (msg.error) {
              addLog('error', `Bridge Error: ${msg.error}`);
              setIsProcessing(false);
            }
          } catch (e) { addLog('info', `Bridge: ${event.data}`); }
        }
      };
      ws.onerror = () => { addLog('error', 'WebSocket Error. Check bridge script.'); setIsConnecting(false); setIsConnected(false); };
      ws.onclose = () => { setIsConnected(false); setIsConnecting(false); wsRef.current = null; addLog('info', 'Bridge link closed.'); };
    } catch (err: any) { addLog('error', `Connection failed: ${err.message}`); setIsConnecting(false); }
  };

  const handleExecute = () => {
    if (!wsRef.current || wsRef.current.readyState !== 1) { addLog('error', 'Bridge not ready. Connect first.'); return; }
    setIsProcessing(true);
    const func = parseInt(config.functionCode);
    const pduParts = [config.slaveId, func];
    pduParts.push((config.startAddress >> 8) & 0xFF);
    pduParts.push(config.startAddress & 0xFF);
    const val = (func === 5 || func === 6) ? (config.value as number) : config.quantity;
    pduParts.push((val >> 8) & 0xFF);
    pduParts.push(val & 0xFF);
    lastRequestRef.current = { fc: config.functionCode, start: config.startAddress, qty: config.quantity };
    
    let request: Uint8Array;
    if (config.protocol === 'TCP') {
      const tid = transactionIdRef.current++;
      request = new Uint8Array(6 + pduParts.length);
      request[0] = (tid >> 8) & 0xFF; request[1] = tid & 0xFF; request[2] = 0; request[3] = 0; request[4] = 0; request[5] = pduParts.length;
      request.set(pduParts, 6);
    } else {
      const rtuBody = new Uint8Array(pduParts);
      const crc = calculateCRC(rtuBody);
      request = new Uint8Array(rtuBody.length + 2);
      request.set(rtuBody);
      request[rtuBody.length] = crc & 0xFF; request[rtuBody.length + 1] = (crc >> 8) & 0xFF;
    }
    const hex = Array.from(request).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    addLog('sent', `[TX] ${hex}`);
    wsRef.current.send(request);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[calc(100vh-180px)]">
      {/* Sidebar: Config & Guide */}
      <div className="lg:col-span-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            Modbus Master
          </h2>
          <div className="space-y-4">
            <input type="text" disabled={isConnected} value={config.bridgeUrl} onChange={(e) => setConfig({ ...config, bridgeUrl: e.target.value })} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none" placeholder="Bridge WebSocket" />
            <div className="flex p-1 bg-slate-100 rounded-xl">
              {['TCP', 'RTU'].map(p => (
                <button key={p} disabled={isConnected} onClick={() => setConfig({ ...config, protocol: p as any })} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${config.protocol === p ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>{p}</button>
              ))}
            </div>
            {config.protocol === 'TCP' ? (
              <div className="grid grid-cols-3 gap-3">
                <input type="text" disabled={isConnected} value={config.host} onChange={(e) => setConfig({ ...config, host: e.target.value })} className="col-span-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none" placeholder="Host" />
                <input type="number" disabled={isConnected} value={config.port} onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) })} className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none" placeholder="Port" />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <input type="text" disabled={isConnected} value={config.serialPort} onChange={(e) => setConfig({ ...config, serialPort: e.target.value })} className="col-span-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none" placeholder="COM" />
                <select disabled={isConnected} value={config.baudRate} onChange={(e) => setConfig({ ...config, baudRate: parseInt(e.target.value) })} className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none">
                  {BAUD_RATES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            )}
            <button onClick={handleToggleConnect} className={`w-full py-3 rounded-xl font-bold border transition-all ${isConnected ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-indigo-600 text-white'}`}>{isConnected ? 'Disconnect Bridge' : 'Connect Bridge'}</button>
            <div className="h-[1px] bg-slate-100 my-1" />
            <div className="grid grid-cols-2 gap-3">
               <input type="number" value={config.slaveId} onChange={e=>setConfig({...config, slaveId: +e.target.value})} className="p-2 border border-slate-200 rounded-lg outline-none text-sm" placeholder="ID" title="Slave ID"/>
               <select value={config.functionCode} onChange={e=>setConfig({...config, functionCode: e.target.value})} className="p-2 border border-slate-200 rounded-lg outline-none text-xs">
                 {FUNCTION_CODES.map(fc=><option key={fc.value} value={fc.value}>{fc.label}</option>)}
               </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
               <input type="number" value={config.startAddress} onChange={e=>setConfig({...config, startAddress: +e.target.value})} className="p-2 border border-slate-200 rounded-lg outline-none text-sm" placeholder="Addr"/>
               <input type="number" value={config.quantity} onChange={e=>setConfig({...config, quantity: +e.target.value})} className="p-2 border border-slate-200 rounded-lg outline-none text-sm" placeholder="Qty"/>
            </div>
            <button onClick={handleExecute} disabled={!isConnected || isProcessing} className={`w-full py-4 rounded-xl font-bold transition-all shadow-md ${!isConnected || isProcessing ? 'bg-slate-100 text-slate-400' : 'bg-slate-900 text-white hover:bg-black'}`}>{isProcessing ? 'Waiting...' : 'Send Request'}</button>
          </div>
        </div>

        {/* Bridge Setup Guide Section */}
        <div className="bg-indigo-50 p-5 rounded-2xl border border-indigo-100 shadow-sm">
          <h3 className="text-xs font-bold text-indigo-900 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Bridge Setup Guide (v3.5)
          </h3>
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">1. Requirements</p>
              <div className="bg-slate-900 rounded-lg p-2 font-mono text-[9px] text-emerald-400 leading-normal">
                pip install websockets pyserial pyserial-asyncio
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">2. Run Script</p>
              <button onClick={handleDownloadBridge} className="w-full py-2 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-colors">Download Bridge .py</button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content: Logs & Data */}
      <div className="lg:col-span-3 grid grid-rows-2 gap-6">
        <div className="min-h-[200px]">
          <LogViewer logs={logs} onClear={() => setLogs([])} />
        </div>
        
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              Data Inspector
            </h3>
            <button onClick={() => setParsedData([])} className="text-[10px] font-bold text-slate-400 hover:text-rose-500 transition-colors">CLEAR</button>
          </div>
          <div className="flex-grow overflow-auto p-4 custom-scrollbar">
            {parsedData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-300 text-sm italic">No Modbus data parsed yet</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {parsedData.map((item, idx) => (
                  <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col gap-1 hover:border-indigo-300 transition-colors">
                    <div className="flex justify-between items-center">
                       <span className="text-[10px] font-bold text-slate-400">ADDR {item.address}</span>
                       <span className="text-[9px] text-indigo-400 font-mono">{item.hex}h</span>
                    </div>
                    <div className="text-lg font-bold text-slate-800 font-mono">{item.value}</div>
                    <div className="h-1 w-full bg-slate-200 rounded-full mt-1 overflow-hidden">
                       <div className={`h-full ${item.value === 'OFF' ? 'bg-slate-300' : 'bg-emerald-500'}`} style={{width: item.value === 'OFF' ? '0%' : '100%'}} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModbusTab;
