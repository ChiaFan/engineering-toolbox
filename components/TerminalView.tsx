
import React, { useRef, useEffect, useState } from 'react';

interface TerminalViewProps {
  data: string[];
  onKey: (key: string) => void;
  onClear: () => void;
  isConnected: boolean;
}

const TerminalView: React.FC<TerminalViewProps> = ({ data, onKey, onClear, isConnected }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Handle smart auto-scroll
  useEffect(() => {
    if (terminalRef.current && isAtBottom) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [data, isAtBottom]);

  const handleScroll = () => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      // If we are within 20px of the bottom, consider it "at bottom"
      const atBottom = scrollHeight - scrollTop - clientHeight < 20;
      setIsAtBottom(atBottom);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isConnected) return;
    
    // Prevent default browser behavior for terminal-specific keys
    if (e.key === 'Backspace' || e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
    }

    let keyToSend = e.key;
    if (keyToSend === 'Enter') keyToSend = '\r';
    if (keyToSend === 'Backspace') keyToSend = '\b';
    if (keyToSend === 'Tab') keyToSend = '\t';
    
    // Only send single characters or special control keys
    if (keyToSend.length === 1) {
      onKey(keyToSend);
    }
  };

  return (
    <div className="flex flex-col h-full bg-black rounded-xl overflow-hidden border border-slate-800 shadow-2xl relative">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">PuTTY Terminal Mode</h3>
        </div>
        <div className="flex gap-4 items-center">
           {!isAtBottom && isConnected && (
             <button 
               onClick={() => setIsAtBottom(true)}
               className="bg-indigo-600/20 text-indigo-400 text-[9px] px-2 py-0.5 rounded border border-indigo-500/30 hover:bg-indigo-600/40 transition-all animate-bounce"
             >
               Scroll to Bottom ↓
             </button>
           )}
           <span className={`text-[10px] font-bold uppercase transition-colors ${isFocused ? 'text-indigo-400' : 'text-slate-600'}`}>
            {isFocused ? 'Focused' : 'Click to Focus'}
          </span>
          <button
            onClick={onClear}
            className="text-[10px] font-bold text-slate-500 hover:text-slate-300 transition-colors uppercase"
          >
            Reset
          </button>
        </div>
      </div>
      
      <div 
        ref={terminalRef}
        tabIndex={0}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        className={`flex-grow p-4 overflow-y-scroll terminal-scrollbar mono text-sm leading-tight outline-none cursor-text ${isFocused ? 'ring-1 ring-inset ring-indigo-500/30' : ''}`}
        style={{ color: '#00FF00', backgroundColor: '#000' }}
      >
        {data.length === 0 ? (
          <div className="text-slate-700 italic opacity-50">Terminal Ready...</div>
        ) : (
          <div className="whitespace-pre-wrap break-all min-h-full">
            {data.join('')}
            <span className={`inline-block w-2 h-4 bg-emerald-500 align-middle ml-1 ${isFocused ? 'animate-pulse' : 'opacity-0'}`}></span>
          </div>
        )}
      </div>

      {!isConnected && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <span className="bg-slate-900/80 text-slate-400 px-4 py-2 rounded-lg border border-slate-700 text-xs font-bold uppercase tracking-widest">
            Disconnected
          </span>
        </div>
      )}
    </div>
  );
};

export default TerminalView;
