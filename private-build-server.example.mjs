/**
 * OPTIONAL private build API example for ModDevTool.
 * © 2026 Puziko & Beliash — not open source; use only on infrastructure you control.
 *
 * This is a skeleton: it accepts the same JSON shape as collectMdtBuildRequest()
 * and returns a packaged project. Wire a real Gradle/MDK worker here if you run
 * a closed build farm (Docker + JDK + Forge/Fabric MDK).
 *
 * Run: node private-build-server.example.mjs
 * Point the HTML page at it:
 *   window.MDT_BUILD_ENDPOINT = 'http://127.0.0.1:8787/build';
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MDT_BUILD_PORT) || 8787;
const HOST = process.env.MDT_BUILD_HOST || '127.0.0.1';           // по умолчанию только локально
const ALLOWED_ORIGIN = process.env.MDT_ALLOWED_ORIGIN || '';      // например https://example.com ; пусто = CORS выключен
const MAX_BODY = 1024 * 1024;                                     // 1 МБ — защита от переполнения памяти

const server = http.createServer(async (req, res) => {
  if (ALLOWED_ORIGIN && req.headers.origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/build') {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }

    const payload = body && typeof body === 'object' ? (body.payload || body) : null;
    if (!payload || typeof payload !== 'object' || typeof payload.name !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_payload' }));
      return;
    }
    const jobId = randomUUID();

    // TODO: enqueue real Gradle job for payload.name / platform / items.
    // Until then, acknowledge the job so the client can show status.
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jobId,
      status: 'accepted',
      message: 'Queue worker not configured. Use local MDTJarBuilder or attach MDK worker.',
      echo: {
        name: String(payload.name).slice(0, 64),
        platform: payload.platform,
        minecraftVersion: payload.minecraftVersion,
        itemCount: Array.isArray(payload.items) ? payload.items.length : 0
      }
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`MDT private build API on http://${HOST}:${PORT}/build`);
});
