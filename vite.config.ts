import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-ignore
import { execSync } from "child_process";

// @ts-expect-error process is a Node.js global
const host = process.env.TTL_DEV_HOST ?? process.env.HOST;

// Get git commit hash at build time
const getCommitHash = () => {
    try {
        return execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
        return "unknown";
    }
};

// https://vitejs.dev/config/
export default defineConfig(async () => ({
    plugins: [react()],

    // Keep Vite noisy during desktop-shell development so renderer/runtime errors stay visible.
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host
            ? {
                protocol: "ws",
                host,
                port: 1421,
            }
            : undefined,
    },
    define: {
        "__COMMIT_HASH__": JSON.stringify(getCommitHash()),
    },
}));
