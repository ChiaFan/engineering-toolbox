
import React, { useState, useRef, useEffect } from 'react';
import { LogEntry, SocketConfig } from '../types';
import LogViewer from './LogViewer';

const PYTHON_SOCKET_BRIDGE_CODE = `import asyncio
import websockets
import json
import socket
import sys

async def socket_bridge(websocket):
    target_sock = None
    protocol_type = "TCP"
    read_task = None
    
    print("[*] Browser connection established.")
    
    async def listen_to_target(sock, ws, is_tcp):
        """Background task to continuously read from target and push to websocket."""
        loop = asyncio.get_running_loop()
        try:
            while True:
                if is_tcp:
                    # For TCP, use non-blocking recv
                    data = await loop.sock_recv(sock, 4096)
                else:
                    # For UDP on Windows, run blocking recv in executor to avoid WinError 10035
                    data = await loop.run_in_executor(None, sock.recv, 4096)
                
                if data:
                    print(f"[*] Received {len(data)} bytes from target.")
                    await ws.send(data)
                else:
                    if is_tcp:
                        print("[-] Target closed connection.")
                        await ws.send(json.dumps({"status": "disconnected", "reason": "Target closed"}))
                        break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[!] Listen error: {e}")
            if not ws.closed:
                await ws.send(json.dumps({"error": f"Socket read error: {e}"}))
        finally:
            print("[*] Listening task stopped.")

    try:
        async for message in websocket:
            if isinstance(message, str):
                try:
                    data = json.loads(message)
                except: continue
                
                action = data.get('action')
                if action == 'connect':
                    if target_sock: target_sock.close()
                    if read_task: read_task.cancel()
                    
                    host = data.get('host', '127.0.0.1')
                    port = data.get('port', 8080)
                    protocol_type = data.get('protocol', 'TCP')
                    
                    print(f"[*] Connecting to {protocol_type} {host}:{port}...")
                    
                    try:
                        if protocol_type == 'TCP':
                            target_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                            target_sock.setblocking(False)
                            loop = asyncio.get_running_loop()
                            await asyncio.wait_for(loop.sock_connect(target_sock, (host, port)), timeout=5.0)
                            print(f"[+] TCP Connected")
                        else: # UDP
                            target_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                            # Do NOT set non-blocking for UDP on Windows to avoid 10035 error in executor
                            target_sock.connect((host, port))
                            print(f"[+] UDP Ready")
                        
                        await websocket.send(json.dumps({"status": "connected", "mode": protocol_type}))
                        read_task = asyncio.create_task(listen_to_target(target_sock, websocket, protocol_type == 'TCP'))
                    
                    except Exception as e:
                        print(f"[!] Connection Fail: {e}")
                        await websocket.send(json.dumps({"error": f"Connection failed: {e}"}))
                        if target_sock: target_sock.close()
                        target_sock = None
            
            elif isinstance(message, bytes):
                if target_sock:
                    print(f"[*] Sending {len(message)} bytes to target...")
                    loop = asyncio.get_running_loop()
                    try:
                        if protocol_type == 'TCP':
                            await loop.sock_sendall(target_sock, message)
                        else:
                            # Use executor for blocking UDP send to be safe
                            await loop.run_in_executor(None, target_sock.send, message)
                    except Exception as e:
                        print(f"[!] Send error: {e}")
                        await websocket.send(json.dumps({"error": f"Send fail: {e}"}))

    except websockets.exceptions.ConnectionClosed:
        print("[-] Browser disconnected.")
    finally:
        if read_task: read_task.cancel()
        if target_sock: target_sock.close()

async def main():
    print("========================================")
    print("   Raiden Socket Bridge (v1.4)         ")
    print("   Fix: UDP Windows WinError 10035     ")
    print("========================================")
    async with websockets.serve(socket_bridge, "localhost", 8888):
        print("[*] Bridge running on ws://localhost:8888")
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)`;

const SocketTab: React.FC = () => {
  const [config, setConfig] = useState<SocketConfig & { bridgeUrl: string }>({
    protocol: 'TCP',
    role: 'Client',
    host: '172.16.255.130',
    port: 8080,
    bridgeUrl: 'ws://localhost:8888'
  });
  
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [viewMode, setViewMode] = useState<'TEXT' | 'HEX'>('TEXT');
  
  const wsRef = useRef<WebSocket | null>(null);

  const addLog = (type: LogEntry['type'], message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, fractionDigits: 3 } as any);
    setLogs(prev => [...prev, { timestamp, type, message }].slice(-100));
  };

  const toHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

  const handleDownloadBridge = () => {
    const blob = new Blob([PYTHON_SOCKET_BRIDGE_CODE], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'socket_bridge.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleToggleConnection = () => {
    if (wsRef.current) { wsRef.current.close(); return; }
    setIsConnecting(true);
    addLog('info', `Connecting to Socket Bridge...`);
    try {
      const ws = new WebSocket(config.bridgeUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      ws.onopen = () => {
        setIsConnecting(false);
        setIsConnected(true);
        addLog('info', `Bridge Connected. Opening ${config.protocol} link to ${config.host}:${config.port}...`);
        ws.send(JSON.stringify({ 
          action: 'connect', 
          host: config.host, 
          port: config.port, 
          protocol: config.protocol 
        }));
      };
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const display = viewMode === 'TEXT' ? new TextDecoder().decode(event.data) : `[HEX] ${toHex(event.data)}`;
          addLog('received', display);
        } else {
          try {
            const msg = JSON.parse(event.data);
            if (msg.status === 'connected') {
              // Properly fallback to config.protocol if mode is missing
              const modeDisplay = msg.mode || config.protocol;
              addLog('info', `${modeDisplay} connection established.`);
            }
            else if (msg.status === 'disconnected') { 
              addLog('error', `Disconnected: ${msg.reason || 'Unknown reason'}`); 
              setIsConnected(false); 
              wsRef.current = null; 
            }
            else if (msg.error) { 
              addLog('error', `Bridge Error: ${msg.error}`); 
              // Don't auto-disconnect on data errors unless it's a connection failure
              if (msg.error.toLowerCase().includes('failed') || msg.error.toLowerCase().includes('refused')) {
                setIsConnected(false);
                ws.close();
              }
            }
          } catch (e) { addLog('info', `Bridge: ${event.data}`); }
        }
      };
      ws.onerror = () => { addLog('error', 'Bridge connection failed. Check if socket_bridge.py is running.'); setIsConnecting(false); setIsConnected(false); };
      ws.onclose = () => { setIsConnected(false); setIsConnecting(false); wsRef.current = null; addLog('info', 'Socket bridge session closed.'); };
    } catch (err: any) { addLog('error', `Connection failed: ${err.message}`); setIsConnecting(false); }
  };

  const handleSend = () => {
    if (!inputMessage || !wsRef.current || wsRef.current.readyState !== 1) return;
    const data = new TextEncoder().encode(inputMessage);
    addLog('sent', inputMessage);
    wsRef.current.send(data);
    setInputMessage('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-180px)]">
      <div className="lg:col-span-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728" /></svg>
            Socket Config
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Bridge Address</label>
              <input type="text" disabled={isConnected} value={config.bridgeUrl} onChange={(e) => setConfig({ ...config, bridgeUrl: e.target.value })} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              {['TCP', 'UDP'].map(p => (
                <button key={p} disabled={isConnected} onClick={() => setConfig({ ...config, protocol: p as any })} className={`py-2 rounded-xl text-xs font-bold border transition-all ${config.protocol === p ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-50 text-slate-500 hover:border-slate-300'}`}>{p}</button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                 <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Target IP</label>
                 <input type="text" disabled={isConnected} value={config.host} onChange={(e) => setConfig({ ...config, host: e.target.value })} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none" placeholder="127.0.0.1" />
              </div>
              <div>
                 <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Port</label>
                 <input type="number" disabled={isConnected} value={config.port} onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none" />
              </div>
            </div>

            <button onClick={handleToggleConnection} className={`w-full py-4 rounded-xl font-bold transition-all shadow-md ${isConnected ? 'bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
              {isConnected ? 'DISCONNECT' : `CONNECT ${config.protocol}`}
            </button>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-800">Quick Send</h2>
            <div className="flex bg-slate-100 p-0.5 rounded-lg text-[9px] font-bold">
              <button onClick={() => setViewMode('TEXT')} className={`px-2 py-1 rounded ${viewMode === 'TEXT' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>TEXT</button>
              <button onClick={() => setViewMode('HEX')} className={`px-2 py-1 rounded ${viewMode === 'HEX' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}>HEX</button>
            </div>
          </div>
          <textarea disabled={!isConnected} value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())} rows={2} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm font-mono" placeholder="Type message to send..." />
          <button disabled={!isConnected || !inputMessage} onClick={handleSend} className="mt-2 w-full py-3 bg-emerald-500 text-white rounded-xl text-xs font-bold hover:bg-emerald-600 disabled:bg-slate-200 transition-colors shadow-sm">Send Packet</button>
        </div>

        {/* Improved Bridge Setup Guide */}
        <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-100 shadow-sm">
          <h3 className="text-xs font-bold text-emerald-900 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Socket Bridge Setup (v1.4)
          </h3>
          <div className="space-y-4">
            <div className="text-[10px] text-emerald-700 leading-relaxed">
              This bridge enables non-blocking TCP/UDP communication from your browser.
            </div>
            <div>
              <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">1. Install Library</p>
              <div className="bg-slate-900 rounded-lg p-2 font-mono text-[9px] text-emerald-400">pip install websockets</div>
            </div>
            <div>
              <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">2. Run Bridge</p>
              <button onClick={handleDownloadBridge} className="w-full py-2 bg-emerald-600 text-white text-[10px] font-bold rounded-lg hover:bg-emerald-700 transition-colors shadow-sm">Download .py Script</button>
              <div className="mt-1 text-[8px] text-emerald-500 text-center">Run with: python socket_bridge.py</div>
            </div>
          </div>
        </div>
      </div>

      <div className="lg:col-span-2">
        <LogViewer logs={logs} onClear={() => setLogs([])} />
      </div>
    </div>
  );
};

export default SocketTab;
