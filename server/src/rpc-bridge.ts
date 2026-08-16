import { WebSocket } from "ws";
import { EventEmitter } from "node:events";

// 连接容器内的 pi RPC WebSocket 桥（bridge.mjs），发命令、收事件。
// 自动重连；掉线期间发送的命令进入队列，重连后 flush。
export class RpcBridge extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private queue: string[] = [];
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  connected = false;

  constructor(bridgePort: number) {
    super();
    this.url = `ws://127.0.0.1:${bridgePort}`;
  }

  connect() {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.connected = true;
      this.emit("open");
      for (const line of this.queue.splice(0)) ws.send(line);
    });

    ws.on("message", (data) => {
      const text = data.toString("utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          this.emit("event", msg);
        } catch {
          // ignore malformed line
        }
      }
    });

    const scheduleReconnect = () => {
      this.connected = false;
      this.ws = null;
      if (this.closed) return;
      if (this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 1500);
    };

    ws.on("close", scheduleReconnect);
    ws.on("error", () => {
      try {
        ws.close();
      } catch {
        // noop
      }
    });
  }

  send(command: Record<string, unknown>) {
    const line = JSON.stringify(command);
    if (this.ws && this.connected) {
      this.ws.send(line);
    } else {
      this.queue.push(line);
    }
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {
      // noop
    }
  }
}
