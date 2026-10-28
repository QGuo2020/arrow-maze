/**
 * 零依赖本地静态服务器。
 * 因为项目使用 ES Modules，直接双击 index.html 会被浏览器的 file:// 安全策略拦截，
 * 所以用 `npm start` 起一个最小服务器即可。
 */
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 4173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

/** 把 URL 安全地映射到项目目录内的文件。 */
function resolveFilePath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relativePath);
  const isInsideRoot = filePath === ROOT || filePath.startsWith(`${ROOT}${path.sep}`);
  if (!isInsideRoot) return null;

  return filePath;
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  const filePath = resolveFilePath(req.url || '/');
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    let finalPath = filePath;
    const fileStat = await stat(finalPath);
    if (fileStat.isDirectory()) finalPath = path.join(finalPath, 'index.html');

    const body = await readFile(finalPath);
    const ext = path.extname(finalPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请用 PORT=4174 npm start 换一个端口。`);
  } else {
    console.error('服务器启动失败：', error);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log('\n  ARROW MAZE · Step 01');
  console.log(`  Local:   http://localhost:${PORT}`);

  // 绑定 0.0.0.0 时同时打印局域网地址，方便手机扫码/输入后测试触摸。
  if (HOST === '0.0.0.0') {
    for (const interfaces of Object.values(os.networkInterfaces())) {
      for (const info of interfaces || []) {
        if (info.family === 'IPv4' && !info.internal) {
          console.log(`  Network: http://${info.address}:${PORT}`);
        }
      }
    }
  }
  console.log('\n  按 Ctrl+C 停止服务器。\n');
});
