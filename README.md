# Raiden Engineering Toolbox ⚡

一套專為工業自動化與嵌入式開發設計的綜合測試工具箱。整合了 **Web Serial (COM Port)**、**Modbus (TCP/RTU)** 以及 **Socket (TCP/UDP)** 測試功能，具備現代化的 UI/UX 介面與強大的數據解析能力。

![Version](https://img.shields.io/badge/version-3.6-indigo)
![License](https://img.shields.io/badge/license-MIT-emerald)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Windows%20%7C%20Linux-blue)

---

## 🚀 核心功能

### 1. COM Port (Web Serial)
- **直接驅動**：利用瀏覽器 Web Serial API 直連硬體，無需安裝驅動（僅限 Chrome/Edge）。
- **雙模式視圖**：支援標準 **Log 模式** 與具備 ANSI 支援的 **Terminal (PuTTY 模式)**。
- **快速指令**：自定義快捷指令面板，支援持久化儲存。
- **Local Echo**：支援本地回顯功能。

### 2. Modbus Master (v3.5)
- **多協議支援**：支援 **Modbus TCP** 與 **Modbus RTU**。
- **Data Inspector**：即時解析寄存器數據，直觀顯示 Hex 與十進制數值。
- **Bridge 架構**：透過 Python Bridge 克服瀏覽器無法直接存取 TCP/串列埠的限制。

### 3. Socket 測試工具 (v1.4)
- **雙協議測試**：支援 **TCP Client** 與 **UDP** 傳輸。
- **並行 I/O**：重構後的非同步引擎，確保大數據量下不阻塞、不掉包。
- **Windows 優化**：特別針對 **WinError 10035** (UDP 非阻塞錯誤) 進行修復，穩定性大幅提升。

---

## 🛠 系統架構

由於瀏覽器安全限制，Web 環境無法直接建立原生 TCP 連結或跨網域連線。本工具採用 **"Bridge (橋接)"** 架構：

1. **Frontend (React)**: 負責 UI 操作、指令封裝與數據展示。
2. **WebSocket**: 前端與後端之間的通訊橋樑。
3. **Python Bridge**: 負責執行底層的網路請求與串列埠操作。

---

## 📦 安裝與啟動

### 1. 準備 Python 環境
確保您的系統已安裝 Python 3.8+，並安裝必要的依賴套件：

```bash
pip install websockets pyserial pyserial-asyncio
```

### 2. 啟動後端 Bridge
您可以從網頁介面直接下載 Bridge 腳本，或手動執行：

- **Modbus Bridge**: `python modbus_bridge.py` (預設啟動於 ws://localhost:8080)
- **Socket Bridge**: `python socket_bridge.py` (預設啟動於 ws://localhost:8888)

### 3. 使用網頁端
直接開啟 `index.html` 即可開始使用。初次使用請先登入（支援 Mock Auth）。

---

## 💡 常見問題排除 (Troubleshooting)

#### Q: 為什麼 UDP 模式下會出現 `WinError 10035`？
**A:** 這是因為 Windows 對於非同步 Socket 的實作差異。本專案 **v1.4 版本** 的 Socket Bridge 已修復此問題：
- 針對 Windows 平台，UDP 接收改由獨立的 `executor` 線程負責阻塞式監聽。
- 取消了對 UDP Socket 的 `setblocking(False)` 限制。

#### Q: Log 出現 `undefined connection established`？
**A:** 此問題已在 **v3.6 UI 更新** 中修復。現在狀態解析具備完整的 Fallback 機制，若 Bridge 未回傳 mode 欄位，則自動對應前端當前的協議設定。

#### Q: 為什麼 COM Port 無法連線？
**A:** 請確認您使用的是 **Chrome** 或 **Edge** 瀏覽器。Firefox 與 Safari 尚未支援 Web Serial API。

---

## 📬 聯絡資訊
- **Author**: Raiden
- **Email**: [raidenlan@gmail.com](mailto:raidenlan@gmail.com)
- **Industrial Testing Suite v3.6**

---
*Create with ❤️ by Raiden Engineering.*
