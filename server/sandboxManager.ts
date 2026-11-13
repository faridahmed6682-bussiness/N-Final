import fs from 'fs/promises';
import path from 'path';
import net from 'net';
import { spawn, type ChildProcess } from 'child_process';
import type { Request, Response } from 'express';
import { NEXUS_PREVIEW_BRIDGE_SCRIPT } from './websiteDeployer.ts';

export type WorkspaceTemplate = 'static' | 'react-vite' | 'fullstack-express';

export interface WorkspaceRuntime {
  sessionId: string;
  dir: string;
  port: number;
  pid?: number;
  command: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  proxyUrl: string;
  startedAt: number;
  logs: string[];
  process?: ChildProcess;
}

const WORKSPACES_ROOT = path.resolve(process.cwd(), 'workspaces');
const activeWorkspaces = new Map<string, WorkspaceRuntime>();
const MAX_CONCURRENT_SUBSERVERS = 3; // Memory-safe for Render Free 512MB RAM

export function sanitizeSessionId(sessionId: string = 'default'): string {
  return String(sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

export function getWorkspaceDir(sessionId: string): string {
  return path.join(WORKSPACES_ROOT, sanitizeSessionId(sessionId));
}

async function allocateEphemeralPort(startPort = 4120, endPort = 4399): Promise<number> {
  const used = new Set(Array.from(activeWorkspaces.values()).map((w) => w.port));
  for (let p = startPort; p <= endPort; p++) {
    if (used.has(p)) continue;
    const available = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => {
        srv.close(() => resolve(true));
      });
      srv.listen(p, '127.0.0.1');
    });
    if (available) return p;
  }
  throw new Error('No free ephemeral port available for sandbox sub-server.');
}

export async function initSessionWorkspace(
  sessionId: string = 'default',
  template: WorkspaceTemplate = 'fullstack-express',
  appTitle: string = 'Sandboxed Nexus App'
): Promise<{
  success: boolean;
  sessionId: string;
  workspacePath: string;
  proxyUrl: string;
  template: WorkspaceTemplate;
  createdFiles: string[];
}> {
  const safeId = sanitizeSessionId(sessionId);
  const wsDir = getWorkspaceDir(safeId);
  await fs.mkdir(wsDir, { recursive: true });
  const createdFiles: string[] = [];

  if (template === 'static') {
    const indexPath = path.join(wsDir, 'index.html');
    const exists = await fs.access(indexPath).then(() => true).catch(() => false);
    if (!exists) {
      await fs.writeFile(
        indexPath,
        `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${appTitle}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-6">
  <main class="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
    <h1 class="text-2xl font-bold text-white">${appTitle}</h1>
    <p class="mt-2 text-sm text-slate-400">Isolated workspace ready at workspaces/${safeId}/</p>
  </main>
</body>
</html>`,
        'utf-8'
      );
      createdFiles.push(`workspaces/${safeId}/index.html`);
    }
  } else if (template === 'react-vite') {
    await fs.mkdir(path.join(wsDir, 'src'), { recursive: true });
    const files: Record<string, string> = {
      'package.json': JSON.stringify(
        {
          name: `nexus-ws-${safeId}`,
          private: true,
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'vite build',
          },
        },
        null,
        2
      ),
      'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
`,
      'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appTitle}</title>
  </head>
  <body class="bg-slate-950 text-slate-100">
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
`,
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/index.css': `@import "tailwindcss";\n`,
      'src/App.tsx': `import React, { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white">${appTitle}</h1>
        <p className="mt-2 text-sm text-slate-400">Isolated React + Vite sandbox workspace (${safeId}).</p>
        <button
          onClick={() => setCount((c) => c + 1)}
          className="mt-6 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition"
        >
          Interactive Counter: {count}
        </button>
      </div>
    </main>
  );
}
`,
    };
    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(wsDir, rel);
      const exists = await fs.access(target).then(() => true).catch(() => false);
      if (!exists) {
        await fs.writeFile(target, content, 'utf-8');
        createdFiles.push(`workspaces/${safeId}/${rel}`);
      }
    }
  } else {
    await fs.mkdir(path.join(wsDir, 'public'), { recursive: true });
    const files: Record<string, string> = {
      'package.json': JSON.stringify(
        {
          name: `nexus-fullstack-${safeId}`,
          private: true,
          type: 'module',
          scripts: {
            dev: 'tsx server.ts',
            start: 'node server.ts',
          },
        },
        null,
        2
      ),
      'server.ts': `import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 4120;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, workspace: '${safeId}', port: PORT, uptime: Math.round(process.uptime()) });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log('Sandbox sub-server listening on port', PORT);
});
`,
      'public/index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${appTitle}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-6">
  <main class="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
    <h1 class="text-2xl font-bold text-white">${appTitle}</h1>
    <p class="mt-2 text-sm text-slate-400">Sandboxed Full-Stack Express Workspace (${safeId})</p>
    <div id="api-status" class="mt-5 rounded-xl bg-slate-950 border border-slate-800 p-4 text-xs font-mono text-emerald-400">
      Probing sandbox API...
    </div>
  </main>
  <script>
    fetch('./api/health')
      .then(r => r.json())
      .then(d => {
        document.getElementById('api-status').textContent = 'API Health OK: ' + JSON.stringify(d);
      })
      .catch(e => {
        document.getElementById('api-status').textContent = 'API check note: ' + e.message;
      });
  </script>
</body>
</html>
`,
    };
    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(wsDir, rel);
      const exists = await fs.access(target).then(() => true).catch(() => false);
      if (!exists) {
        await fs.writeFile(target, content, 'utf-8');
        createdFiles.push(`workspaces/${safeId}/${rel}`);
      }
    }
  }

  return {
    success: true,
    sessionId: safeId,
    workspacePath: `workspaces/${safeId}`,
    proxyUrl: `/w/${safeId}/`,
    template,
    createdFiles,
  };
}

export async function startWorkspaceServer(
  sessionId: string = 'default',
  customCommand?: string
): Promise<{
  success: boolean;
  sessionId: string;
  status: string;
  port?: number;
  proxyUrl: string;
  logs?: string[];
  error?: string;
}> {
  const safeId = sanitizeSessionId(sessionId);
  const wsDir = getWorkspaceDir(safeId);
  const proxyUrl = `/w/${safeId}/`;

  const exists = await fs.access(wsDir).then(() => true).catch(() => false);
  if (!exists) {
    return {
      success: false,
      sessionId: safeId,
      status: 'missing',
      proxyUrl,
      error: `Workspace workspaces/${safeId} does not exist yet. Call workspace_init first.`,
    };
  }

  // Reuse if already running
  const existing = activeWorkspaces.get(safeId);
  if (existing && existing.status === 'running' && existing.process && !existing.process.killed) {
    return {
      success: true,
      sessionId: safeId,
      status: 'running',
      port: existing.port,
      proxyUrl,
      logs: existing.logs.slice(-15),
    };
  }

  // Enforce memory-safe cap on Render Free by evicting oldest sub-server
  if (activeWorkspaces.size >= MAX_CONCURRENT_SUBSERVERS) {
    const oldest = Array.from(activeWorkspaces.values()).sort((a, b) => a.startedAt - b.startedAt)[0];
    if (oldest) {
      await stopWorkspaceServer(oldest.sessionId);
    }
  }

  const hasServerTs = await fs.access(path.join(wsDir, 'server.ts')).then(() => true).catch(() => false);
  const hasServerJs = await fs.access(path.join(wsDir, 'server.js')).then(() => true).catch(() => false);
  const hasVite = await fs.access(path.join(wsDir, 'vite.config.ts')).then(() => true).catch(() => false);

  const port = await allocateEphemeralPort();
  let cmd = customCommand?.trim();
  if (!cmd) {
    if (hasServerTs) cmd = `npx tsx server.ts`;
    else if (hasServerJs) cmd = `node server.js`;
    else if (hasVite) cmd = `npx vite --port ${port} --host 127.0.0.1`;
    else {
      // Static workspace: no background daemon needed, /w/:sessionId/ serves static files directly
      return {
        success: true,
        sessionId: safeId,
        status: 'static_ready',
        proxyUrl,
      };
    }
  }

  const rootNodeModules = path.resolve(process.cwd(), 'node_modules');
  const child = spawn('bash', ['-c', cmd], {
    cwd: wsDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_PATH: [process.env.NODE_PATH, rootNodeModules].filter(Boolean).join(':'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const runtime: WorkspaceRuntime = {
    sessionId: safeId,
    dir: wsDir,
    port,
    pid: child.pid,
    command: cmd,
    status: 'starting',
    proxyUrl,
    startedAt: Date.now(),
    logs: [],
    process: child,
  };
  activeWorkspaces.set(safeId, runtime);

  const pushLog = (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const l of lines) {
      runtime.logs.push(l.slice(0, 300));
      if (runtime.logs.length > 60) runtime.logs.shift();
    }
  };
  child.stdout?.on('data', pushLog);
  child.stderr?.on('data', pushLog);
  child.on('exit', (code) => {
    runtime.status = code === 0 ? 'stopped' : 'error';
  });

  // Poll 127.0.0.1:port up to 8s until listening
  let listening = false;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (runtime.status === 'error' || runtime.status === 'stopped') break;
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
      if (probe.status > 0) {
        listening = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 350));
  }

  if (listening) {
    runtime.status = 'running';
    return {
      success: true,
      sessionId: safeId,
      status: 'running',
      port,
      proxyUrl,
      logs: runtime.logs.slice(-12),
    };
  }

  return {
    success: false,
    sessionId: safeId,
    status: runtime.status,
    port,
    proxyUrl,
    logs: runtime.logs.slice(-20),
    error: `Sub-server failed to bind port ${port} within 8s.`,
  };
}

export async function stopWorkspaceServer(sessionId: string): Promise<{ success: boolean; sessionId: string }> {
  const safeId = sanitizeSessionId(sessionId);
  const rt = activeWorkspaces.get(safeId);
  if (rt?.process && !rt.process.killed) {
    try {
      rt.process.kill('SIGTERM');
    } catch {}
  }
  activeWorkspaces.delete(safeId);
  return { success: true, sessionId: safeId };
}

export async function getWorkspaceStatus(sessionId?: string) {
  if (sessionId) {
    const safeId = sanitizeSessionId(sessionId);
    const rt = activeWorkspaces.get(safeId);
    const wsDir = getWorkspaceDir(safeId);
    const exists = await fs.access(wsDir).then(() => true).catch(() => false);
    return {
      sessionId: safeId,
      exists,
      proxyUrl: `/w/${safeId}/`,
      running: rt?.status === 'running',
      port: rt?.port,
      status: rt?.status || (exists ? 'idle' : 'missing'),
      logs: rt?.logs?.slice(-15) || [],
    };
  }

  const dirs = await fs.readdir(WORKSPACES_ROOT, { withFileTypes: true }).catch(() => []);
  return {
    workspaces: dirs
      .filter((d) => d.isDirectory())
      .map((d) => {
        const rt = activeWorkspaces.get(d.name);
        return {
          sessionId: d.name,
          proxyUrl: `/w/${d.name}/`,
          status: rt?.status || 'idle',
          port: rt?.port,
        };
      }),
  };
}

// Express middleware to reverse-proxy /w/:sessionId/* -> running sub-server OR static workspace folder
export async function handleWorkspaceProxyRequest(req: Request, res: Response) {
  const safeId = sanitizeSessionId(req.params.sessionId);
  const wsDir = getWorkspaceDir(safeId);
  const rt = activeWorkspaces.get(safeId);

  // Strip /w/:sessionId prefix cleanly
  const prefix = `/w/${req.params.sessionId}`;
  const rawRemaining = req.originalUrl.startsWith(prefix)
    ? req.originalUrl.slice(prefix.length) || '/'
    : req.url || '/';
  const targetSubPath = rawRemaining.startsWith('/') ? rawRemaining : `/${rawRemaining}`;

  if (rt && rt.status === 'running') {
    try {
      const targetUrl = `http://127.0.0.1:${rt.port}${targetSubPath}`;
      const fwdHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (k === 'host' || k === 'connection' || k === 'content-length') continue;
        if (typeof v === 'string') fwdHeaders[k] = v;
      }
      const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase());
      const bodyPayload =
        hasBody && req.body !== undefined
          ? typeof req.body === 'string'
            ? req.body
            : JSON.stringify(req.body)
          : undefined;
      if (bodyPayload && !fwdHeaders['content-type']) {
        fwdHeaders['content-type'] = 'application/json';
      }

      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: fwdHeaders,
        body: bodyPayload,
        signal: AbortSignal.timeout(10000),
      });

      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type') || '';
      upstream.headers.forEach((val, key) => {
        if (!['transfer-encoding', 'content-encoding', 'content-length'].includes(key.toLowerCase())) {
          res.setHeader(key, val);
        }
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (contentType.includes('text/html')) {
        let html = buf.toString('utf-8');
        if (!html.includes('__nexusElementPicker')) {
          const idx = html.indexOf('</head>');
          html = idx !== -1
            ? html.slice(0, idx) + NEXUS_PREVIEW_BRIDGE_SCRIPT + html.slice(idx)
            : NEXUS_PREVIEW_BRIDGE_SCRIPT + html;
        }
        res.send(html);
        return;
      }
      res.send(buf);
      return;
    } catch (err: any) {
      res.status(502).json({ error: `Sandbox proxy upstream error: ${err?.message}` });
      return;
    }
  }

  // Fallback static serving from dist/ -> public/ -> workspace root
  const cleanFile = targetSubPath.split('?')[0].replace(/^\/+/, '') || 'index.html';
  const candidates = [
    path.join(wsDir, 'dist', cleanFile),
    path.join(wsDir, 'public', cleanFile),
    path.join(wsDir, cleanFile),
    path.join(wsDir, 'dist', 'index.html'),
    path.join(wsDir, 'public', 'index.html'),
    path.join(wsDir, 'index.html'),
  ];
  for (const cand of candidates) {
    if (!cand.startsWith(wsDir)) continue;
    try {
      const st = await fs.stat(cand);
      if (st.isFile()) {
        if (cand.endsWith('.html')) {
          let html = await fs.readFile(cand, 'utf-8');
          if (!html.includes('__nexusElementPicker')) {
            const idx = html.indexOf('</head>');
            html = idx !== -1
              ? html.slice(0, idx) + NEXUS_PREVIEW_BRIDGE_SCRIPT + html.slice(idx)
              : NEXUS_PREVIEW_BRIDGE_SCRIPT + html;
          }
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.send(html);
          return;
        }
        res.sendFile(cand);
        return;
      }
    } catch {}
  }

  res.status(404).send(`Workspace "${safeId}" has no running server or index.html yet.`);
}
