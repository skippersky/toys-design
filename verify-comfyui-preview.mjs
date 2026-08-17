import { createHash } from "node:crypto";
import { createServer } from "node:http";

import sharp from "sharp";

const host = "127.0.0.1";
const port = 8188;
const promptId = "qa-prompt-watermark";
const sockets = new Set();
const preview = await sharp({
  create: {
    width: 1200,
    height: 675,
    channels: 4,
    background: "#164e63",
  },
})
  .composite([
    {
      input: Buffer.from(`
        <svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg">
          <rect width="1200" height="675" fill="#164e63"/>
          <text x="600" y="338" text-anchor="middle" dominant-baseline="middle"
            font-family="Arial, sans-serif" font-size="96" font-weight="700"
            fill="#ecfeff">COMFYUI QA PREVIEW</text>
        </svg>
      `),
    },
  ])
  .png()
  .toBuffer();

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function websocketFrame(value) {
  const payload = Buffer.from(value);
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function send(socket, value) {
  socket.write(websocketFrame(JSON.stringify(value)));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${String(port)}`);

  if (request.method === "POST" && url.pathname === "/prompt") {
    request.resume();
    request.on("end", () => {
      console.log(`[Mock ComfyUI] queued prompt_id=${promptId}`);
      json(response, 200, { prompt_id: promptId, number: 1 });
    });
    return;
  }

  if (request.method === "GET" && url.pathname === `/history/${promptId}`) {
    json(response, 200, {
      [promptId]: {
        prompt: [1, promptId, {}, {}, []],
        outputs: {
          preview: {
            images: [
              {
                filename: "qa-preview.png",
                subfolder: "qa",
                type: "output",
              },
            ],
          },
        },
        status: { status_str: "success", completed: true, messages: [] },
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/view") {
    console.log(
      `[Mock ComfyUI] served image filename=${url.searchParams.get("filename") ?? ""}`,
    );
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": String(preview.length),
    });
    response.end(preview);
    return;
  }

  if (request.method === "POST" && url.pathname === "/interrupt") {
    request.resume();
    request.on("end", () => json(response, 200, {}));
    return;
  }

  json(response, 404, { error: "Not found" });
});

server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }

  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"),
  );
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  console.log(`[Mock ComfyUI] websocket connected: ${request.url ?? "/ws"}`);

  setTimeout(() => {
    if (socket.destroyed) {
      return;
    }
    send(socket, {
      type: "progress",
      data: { prompt_id: promptId, value: 1, max: 1, node: "preview" },
    });
    send(socket, {
      type: "executing",
      data: { prompt_id: promptId, node: null },
    });
    console.log(`[Mock ComfyUI] completed prompt_id=${promptId}`);
  }, 250);
});

server.listen(port, host, () => {
  console.log(`[Mock ComfyUI] listening at http://${host}:${String(port)}`);
});

function shutdown() {
  for (const socket of sockets) {
    socket.destroy();
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
