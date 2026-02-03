
import React, { useState, useEffect } from 'react';
import { User, ToolTab } from './types';
import AuthPage from './components/AuthPage';
import Layout from './components/Layout';
import COMPortTab from './components/COMPortTab';
import ModbusTab from './components/ModbusTab';
import SocketTab from './components/SocketTab';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<ToolTab>(ToolTab.COM_PORT);

  useEffect(() => {
    const savedUser = localStorage.getItem('raiden_toolbox_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
  }, []);

  const handleLogin = (userData: User) => {
    setUser(userData);
    localStorage.setItem('raiden_toolbox_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('raiden_toolbox_user');
  };

  if (!user) {
    return <AuthPage onLogin={handleLogin} />;
  }

  return (
    <Layout user={user} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout}>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === ToolTab.COM_PORT && <COMPortTab user={user} />}
        {activeTab === ToolTab.MODBUS && <ModbusTab />}
        {activeTab === ToolTab.SOCKET && <SocketTab />}
      </div>
      
      {/* Footer link */}
      <div className="fixed bottom-4 right-4 z-50">
        <a 
          href="mailto:raidenlan@gmail.com" 
          className="bg-white/80 backdrop-blur-sm border border-slate-200 px-4 py-2 rounded-full shadow-lg hover:shadow-xl transition-all text-sm font-semibold text-indigo-600 flex items-center gap-2 group"
        >
          <span className="text-slate-500 font-normal">Create by</span>
          <span className="group-hover:underline">Raiden</span>
        </a>
      </div>
    </Layout>
  );
};

export default App;
