
import React, { useState, useRef, useEffect } from 'react';
import { LogEntry, User } from '../types';
import LogViewer from './LogViewer';
import TerminalView from './TerminalView';

const BAUD_RATES = [9600, 14400, 19200, 38400, 57600, 115200];
const LINE_ENDINGS = [
  { label: 'None', value: '' },
  { label: 'CR (\\r)', value: '\r' },
  { label: 'LF (\\n)', value: '\n' },
  { label: 'CR+LF (\\r\\n)', value: '\r\n' },
  { label: 'LF+CR (\\n\\r)', value: '\n\r' }
];

// ANSI Escape Sequence Regex to strip terminal control codes
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

interface COMPortTabProps {
  user: User;
}

const COMPortTab: React.FC<COMPortTabProps> = ({ user }) => {
  const [baudRate, setBaudRate] = useState(9600);
  const [lineEnding, setLineEnding] = useState('\r\n');
  const [inputMessage, setInputMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [showHex, setShowHex] = useState(false);
  const [mode, setMode] = useState<'log' | 'terminal'>('log');
  const [localEcho, setLocalEcho] = useState(false);
  
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [terminalData, setTerminalData] = useState<string[]>([]);
  
  // Quick Commands State - Use lazy initializer for better persistence
  const [quickCommands, setQuickCommands] = useState<string[]>(() => {
    const storageKey = `quick_cmds_${user.username}`;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse quick commands", e);
      }
    }
    return ['AT', 'HELP', 'VERSION', 'STATUS']; // Default initial commands
  });
  
  const [newCommand, setNewCommand] = useState('');
  const [isAddingCommand, setIsAddingCommand] = useState(false);
  
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const isConnectedRef = useRef(false);

  // Synchronize with localStorage whenever quickCommands change
  useEffect(() => {
    localStorage.setItem(`quick_cmds_${user.username}`, JSON.stringify(quickCommands));
  }, [quickCommands, user.username]);

  const addQuickCommand = () => {
    const trimmed = newCommand.trim();
    if (trimmed && !quickCommands.includes(trimmed)) {
      setQuickCommands(prev => [...prev, trimmed]);
      setNewCommand('');
      setIsAddingCommand(false);
    }
  };

  const removeQuickCommand = (cmd: string) => {
    setQuickCommands(prev => prev.filter(c => c !== cmd));
  };

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  const addLog = (type: LogEntry['type'], message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, fractionDigits: 3 } as any);
    setLogs(prev => {
        const newLogs = [...prev, { timestamp, type, message }];
        return newLogs.slice(-200);
    });
  };

  const toHexString = (byteArray: Uint8Array) => {
    return Array.from(byteArray, (byte) => {
      return ('0' + (byte & 0xFF).toString(16)).slice(-2).toUpperCase();
    }).join(' ');
  };

  const connectPort = async () => {
    if (!('serial' in navigator)) {
      addLog('error', 'Web Serial API is not supported in this browser.');
      return;
    }

    try {
      addLog('info', 'Requesting port access...');
      const port = await (navigator as any).serial.requestPort();
      
      addLog('info', `Opening port at ${baudRate} baud...`);
      await port.open({ baudRate });
      
      portRef.current = port;
      setIsConnected(true);
      isConnectedRef.current = true;
      addLog('info', `Successfully connected to COM port.`);
      
      readLoop(port);
    } catch (err: any) {
      if (err.name === 'SecurityError') {
        addLog('error', 'Permission denied: Serial access is disallowed.');
      } else if (err.name === 'NotFoundError') {
        addLog('info', 'Port selection cancelled.');
      } else {
        addLog('error', `Connection failed: ${err.message}`);
      }
    }
  };

  const readLoop = async (port: any) => {
    while (port.readable && isConnectedRef.current) {
      const reader = port.readable.getReader();
      readerRef.current = reader;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          
          if (value) {
            const decoded = new TextDecoder().decode(value);
            
            // For Terminal Mode: Strip ANSI Escape Sequences
            const cleanTerminalText = decoded.replace(ANSI_REGEX, '');
            setTerminalData(prev => [...prev, cleanTerminalText].slice(-500));

            // For Log Mode
            let logDisplay = "";
            if (showHex) {
              logDisplay = `[HEX] ${toHexString(value)}`;
            } else {
              logDisplay = decoded;
            }
            addLog('received', logDisplay);
          }
        }
      } catch (err: any) {
        if (err.name !== 'BreakError' && isConnectedRef.current) {
          addLog('error', `Read error: ${err.message}`);
        }
      } finally {
        reader.releaseLock();
      }
    }
  };

  const disconnectPort = async () => {
    try {
      setIsConnected(false);
      isConnectedRef.current = false;
      
      if (readerRef.current) {
        await readerRef.current.cancel();
      }
      
      if (portRef.current) {
        await portRef.current.close();
      }
      
      addLog('info', 'Port disconnected.');
    } catch (err: any) {
      addLog('error', `Disconnect error: ${err.message}`);
    }
  };

  const sendMessage = async (msg: string = inputMessage, ending: string = lineEnding) => {
    if (!portRef.current || !isConnected || !msg) return;

    try {
      const writer = portRef.current.writable.getWriter();
      const data = new TextEncoder().encode(msg + ending);
      await writer.write(data);
      writer.releaseLock();
      
      if (mode === 'log') {
        addLog('sent', msg);
        setInputMessage('');
      }
    } catch (err: any) {
      addLog('error', `Send failed: ${err.message}`);
    }
  };

  const handleTerminalKey = async (key: string) => {
    if (!portRef.current || !isConnected) return;
    
    try {
      const writer = portRef.current.writable.getWriter();
      const data = new TextEncoder().encode(key);
      await writer.write(data);
      writer.releaseLock();

      if (localEcho) {
        setTerminalData(prev => [...prev, key].slice(-500));
      }
    } catch (err: any) {
      addLog('error', `Terminal send failed: ${err.message}`);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-180px)]">
      <div className="lg:col-span-1 space-y-6 overflow-y-auto pr-1 custom-scrollbar">
        {/* Port Settings Panel */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            Port Settings
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Baud Rate</label>
              <select 
                disabled={isConnected}
                value={baudRate}
                onChange={(e) => setBaudRate(Number(e.target.value))}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all disabled:opacity-50"
              >
                {BAUD_RATES.map(rate => (
                  <option key={rate} value={rate}>{rate}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Mode & View</label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                <button 
                  onClick={() => setMode('log')}
                  className={`py-1.5 text-xs font-bold rounded-lg transition-all ${mode === 'log' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                >
                  LOG VIEW
                </button>
                <button 
                  onClick={() => setMode('terminal')}
                  className={`py-1.5 text-xs font-bold rounded-lg transition-all ${mode === 'terminal' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                >
                  TERMINAL
                </button>
              </div>
            </div>

            {mode === 'log' && (
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Display Mode</label>
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                  <button 
                    onClick={() => setShowHex(false)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${!showHex ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                  >
                    TEXT
                  </button>
                  <button 
                    onClick={() => setShowHex(true)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${showHex ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
                  >
                    HEX
                  </button>
                </div>
              </div>
            )}

            {mode === 'terminal' && (
               <div className="flex items-center justify-between px-2 py-1 bg-slate-50 border border-slate-200 rounded-xl">
                 <div className="flex flex-col">
                   <span className="text-xs font-bold text-slate-700">Local Echo</span>
                   <span className="text-[10px] text-slate-500">Enable if remote doesn't echo</span>
                 </div>
                 <button 
                  onClick={() => setLocalEcho(!localEcho)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${localEcho ? 'bg-indigo-600' : 'bg-slate-300'}`}
                 >
                   <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${localEcho ? 'right-1' : 'left-1'}`}></div>
                 </button>
               </div>
            )}

            <div className="pt-2">
              {!isConnected ? (
                <button
                  onClick={connectPort}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Connect Port
                </button>
              ) : (
                <button
                  onClick={disconnectPort}
                  className="w-full py-3 bg-slate-800 text-white rounded-xl font-semibold shadow-lg shadow-slate-200 hover:bg-slate-900 transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Disconnect
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Send Data & Quick Commands Panel */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Quick Command
            </h2>
            <button 
              onClick={() => setIsAddingCommand(!isAddingCommand)}
              className={`p-1 rounded-lg transition-colors ${isAddingCommand ? 'bg-indigo-600 text-white' : 'text-indigo-600 hover:bg-indigo-50'}`}
              title="Add new command"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            {/* Command Add Section */}
            {isAddingCommand && (
              <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100 space-y-2 animate-in slide-in-from-top-2 duration-200">
                <input
                  type="text"
                  autoFocus
                  value={newCommand}
                  onChange={(e) => setNewCommand(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addQuickCommand()}
                  className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  placeholder="New command string..."
                />
                <div className="flex gap-2">
                  <button 
                    onClick={addQuickCommand}
                    className="flex-1 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg"
                  >
                    Save Command
                  </button>
                  <button 
                    onClick={() => setIsAddingCommand(false)}
                    className="flex-1 py-1.5 bg-slate-200 text-slate-600 text-xs font-bold rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Existing Quick Commands Buttons */}
            <div className="flex flex-wrap gap-2">
              {quickCommands.length === 0 && !isAddingCommand && (
                <p className="text-[10px] text-slate-400 italic">No quick commands saved.</p>
              )}
              {quickCommands.map((cmd) => (
                <div key={cmd} className="group relative">
                  <button
                    disabled={!isConnected}
                    onClick={() => sendMessage(cmd)}
                    className="px-3 py-1.5 bg-slate-50 hover:bg-indigo-100 text-slate-700 hover:text-indigo-700 text-xs font-medium rounded-lg border border-slate-200 hover:border-indigo-300 transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {cmd}
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); removeQuickCommand(cmd); }}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px] shadow-sm z-10"
                    title="Remove command"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="block text-sm font-medium text-slate-600 mb-1">Message Ending</label>
              <div className="grid grid-cols-2 gap-2">
                {LINE_ENDINGS.map((ending) => (
                  <button
                    key={ending.label}
                    onClick={() => setLineEnding(ending.value)}
                    className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all ${
                      lineEnding === ending.value
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-200'
                    }`}
                  >
                    {ending.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              <input
                type="text"
                disabled={!isConnected}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                placeholder="Type your command..."
              />
              <button
                disabled={!isConnected || !inputMessage}
                onClick={() => sendMessage()}
                className="absolute right-2 top-2 p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all disabled:bg-slate-300"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* View Area */}
      <div className="lg:col-span-2">
        {mode === 'log' ? (
          <LogViewer logs={logs} onClear={() => setLogs([])} />
        ) : (
          <TerminalView 
            data={terminalData} 
            onKey={handleTerminalKey} 
            onClear={() => setTerminalData([])} 
            isConnected={isConnected}
          />
        )}
      </div>
    </div>
  );
};

export default COMPortTab;
