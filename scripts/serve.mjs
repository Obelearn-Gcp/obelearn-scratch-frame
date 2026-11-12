import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const port = Number(process.env.PORT || 4400);
const BASE = "/scratch-gui/";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".hex": "text/plain",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".tflite": "application/octet-stream",
  ".binarypb": "application/octet-stream",
  ".data": "application/octet-stream",
};

const hostPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>Scratch frame host</title>
<style>body{margin:0;font:14px system-ui}header{padding:8px;display:flex;gap:8px;align-items:center}iframe{border:0;width:100vw;height:calc(100vh - 48px)}</style>
</head><body>
<header><strong>ObeLearn host (dev)</strong>
<button id="get">Get .sb3</button>
<input id="file" type="file" accept=".sb3">
<span id="log"></span></header>
<iframe id="frame" src="${BASE}index.html" sandbox="allow-scripts" allow="" title="Scratch"></iframe>
<script>
const frame = document.getElementById("frame");
const log = (text) => { document.getElementById("log").textContent = text; console.log("[host]", text); };
window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow) return;
  const data = event.data || {};
  if (data.type === "scratch:sb3") {
    log("sb3 " + data.size_bytes + " bytes");
    const url = URL.createObjectURL(new Blob([data.sb3], { type: "application/x.scratch.sb3" }));
    const a = document.createElement("a"); a.href = url; a.download = "project.sb3"; a.click();
    return;
  }
  log(data.type + (data.message ? ": " + data.message : ""));
});
document.getElementById("get").onclick = () => frame.contentWindow.postMessage({ type: "scratch:get-sb3", requestId: "r" + Date.now() }, "*");
document.getElementById("file").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const sb3 = await file.arrayBuffer();
  frame.contentWindow.postMessage({ type: "scratch:load", mode: "edit", sb3 }, "*", [sb3]);
};
</script></body></html>`;

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (path === "/" || path === "/host.html") {
    res.writeHead(200, { "content-type": types[".html"] });
    res.end(hostPage);
    return;
  }
  if (!path.startsWith(BASE)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const relative = normalize(path.slice(BASE.length) || "index.html");
  if (relative.startsWith("..")) {
    res.writeHead(400);
    res.end();
    return;
  }
  const file = join(buildDir, relative);
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "access-control-allow-origin": "*" });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`host page: http://localhost:${port}/host.html`);
  console.log(`frame:     http://localhost:${port}${BASE}index.html`);
});
