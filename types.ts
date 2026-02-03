
export enum ToolTab {
  COM_PORT = 'COM Port',
  MODBUS = 'Modbus',
  SOCKET = 'Socket'
}

export interface User {
  username: string;
  email: string;
}

export interface LogEntry {
  timestamp: string;
  type: 'info' | 'sent' | 'received' | 'error';
  message: string;
}

export interface ModbusConfig {
  protocol: 'TCP' | 'RTU';
  host: string;
  port: number;
  slaveId: number;
  functionCode: string;
  startAddress: number;
  quantity: number;
  value?: number | number[];
}

export interface SocketConfig {
  protocol: 'TCP' | 'UDP';
  role: 'Server' | 'Client';
  host: string;
  port: number;
}
