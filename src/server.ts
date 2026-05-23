import Fastify from "fastify";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { handleBrowserStream } from "./browser-stream.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function startServer(): Promise<void> {
  const { port } = config.server;

  const httpServer = createServer();

  const app = Fastify({
    serverFactory: (handler) => {
      httpServer.on("request", handler);
      return httpServer;
    },
  });

  const browserWss = new WebSocketServer({ noServer: true });

  browserWss.on("connection", (ws: WebSocket) => {
    console.log("[browser-ws] New connection");
    handleBrowserStream(ws);
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(
      request.url ?? "",
      `http://${request.headers.host}`
    ).pathname;

    if (pathname === "/voice/browser") {
      const token = config.server.authToken;
      if (token) {
        const url = new URL(request.url ?? "", `http://${request.headers.host}`);
        if (url.searchParams.get("token") !== token) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
      }
      browserWss.handleUpgrade(request, socket, head, (ws) => {
        browserWss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  app.get("/", async (_request, reply) => {
    const htmlPath = resolve(__dirname, "../public/index.html");
    const html = readFileSync(htmlPath, "utf-8");
    reply.type("text/html").send(html);
  });

  app.get("/generated/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const filePath = resolve(__dirname, "../public/generated", filename);
    if (!existsSync(filePath)) {
      reply.code(404).send("Not found");
      return;
    }
    const mimeTypes: Record<string, string> = {
      ".html": "text/html",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".jpg": "image/jpeg",
      ".json": "application/json",
    };
    const ext = extname(filename);
    reply.type(mimeTypes[ext] || "application/octet-stream").send(readFileSync(filePath));
  });

  app.get("/health", async () => ({ status: "ok", service: "walkie-talkie" }));

  await app.ready();

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`Walkie-Talkie listening on http://localhost:${port}`);
  });
}
