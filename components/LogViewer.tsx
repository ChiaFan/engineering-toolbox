
import React, { useRef, useEffect } from 'react';
import { LogEntry } from '../types';

interface LogViewerProps {
  logs: LogEntry[];
  onClear: () => void;
}

const LogViewer: React.FC<LogViewerProps> = ({ logs, onClear }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogClass = (type: LogEntry['type']) => {
    switch (type) {
      case 'sent': return 'text-blue-400';
      case 'received': return 'text-emerald-400';
      case 'error': return 'text-rose-400';
      default: return 'text-slate-400';
    }
  };

  const getLogPrefix = (type: LogEntry['type']) => {
    switch (type) {
      case 'sent': return '>>>';
      case 'received': return '<<<';
      case 'error': return '[!]';
      default: return '[-]';
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-800 shadow-inner">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800/50 border-b border-slate-800">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Communication Log</h3>
        <button
          onClick={onClear}
          className="text-[10px] font-bold text-slate-500 hover:text-slate-300 transition-colors uppercase"
        >
          Clear
        </button>
      </div>
      <div 
        ref={scrollRef}
        className="flex-grow p-4 overflow-y-auto mono text-xs leading-relaxed"
      >
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-600 italic">
            Waiting for activity...
          </div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="mb-1 animate-in fade-in slide-in-from-left-2 duration-300">
              <span className="text-slate-600 mr-2">[{log.timestamp}]</span>
              <span className={`font-bold mr-2 ${getLogClass(log.type)}`}>{getLogPrefix(log.type)}</span>
              <span className="text-slate-200 break-all whitespace-pre-wrap">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LogViewer;
