import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { contextBridge, ipcRenderer } = require("electron");

const runtime = {
  invoke(command, payload) {
    return ipcRenderer.invoke("ttl:invoke", { command, payload });
  },
  emit(eventName, payload) {
    return ipcRenderer.invoke("ttl:emit", { eventName, payload });
  },
  async listen(eventName, handler) {
    const listener = (_event, message) => {
      if (!message || message.eventName !== eventName) {
        return;
      }
      handler({ payload: message.payload });
    };
    ipcRenderer.on("ttl:event", listener);
    return () => {
      ipcRenderer.removeListener("ttl:event", listener);
    };
  },
  openDialog(options) {
    return ipcRenderer.invoke("ttl:dialog:open", options);
  },
  getVersion() {
    return ipcRenderer.invoke("ttl:get-version");
  },
};

contextBridge.exposeInMainWorld("__TTL_RUNTIME__", runtime);
