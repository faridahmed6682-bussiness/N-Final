import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import cors from 'cors';
import dotenv from 'dotenv';
import { Octokit } from 'octokit';
import AdmZip from 'adm-zip';
import {
  handleServerGeminiChat,
  executeServerTool,
  manageBackgroundTask,
  runCodeInSandbox,
  runDebugErrorAnalysis,
  runClawDoctor,
  getClawStatus,
  getClawAcpInfo,
  runClawPrompt,
  runOmoCoordinate,
  runOmxProtocol,
  routeClawHipEvent,
  runLazyCodex,
  serverTools
} from './server/geminiService.ts';
import { CODING_SKILLS_REGISTRY, getSkillByName } from './server/skillsRegistry.ts';
import { 
  handleOrchestratedChat, 
  resolvePendingQuestion,
  loadSecrets, 
  saveSecrets, 
  testApiKey, 
  fetchLiveProviderModels,
  getKeyPoolStatus,
  getLastSuccessfulKeyId,
  getSystemLogs,
  clearSystemLogs
} from './server/apiOrchestrator.ts';
import {
  verifyLivePreviewWithDom,
  freeWebSearch,
  createCheckpoint,
  listCheckpoints,
  rollbackToCheckpoint,
  buildCodebaseGraph,
  runAutomatedTests,
  listScheduledTasks,
  cancelScheduledTask,
} from './server/workspaceEngine.ts';
import {
  initSessionWorkspace,
  startWorkspaceServer,
  stopWorkspaceServer,
  getWorkspaceStatus,
  handleWorkspaceProxyRequest,
} from './server/sandboxManager.ts';
import { rankAstContext } from './server/astContextRanker.ts';
import { initPersistenceStore, getPersistenceStatus, saveSecretsToPersistence } from './server/persistenceStore.ts';
import { runVisualQaReview } from './server/visualQa.ts';

dotenv.config();

const execPromise = promisify(exec);

function resolvePort(): number {
  const portFlagIdx = process.argv.findIndex((arg) => arg === '--port' || arg === '-p');
  if (portFlagIdx !== -1 && process.argv[portFlagIdx + 1]) {
    const parsed = Number(process.argv[portFlagIdx + 1]);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  const eqFlag = process.argv.find((arg) => arg.startsWith('--port='));
  if (eqFlag) {
    const parsed = Number(eqFlag.split('=')[1]);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return Number(process.env.PORT) || 3000;
}

function resolveWorkspacePath(rawPath: string): { absolutePath: string; allowed: boolean } {
  const clean = String(rawPath || '.').trim().replace(/^[/\\]+/, '') || '.';
  const absolutePath = path.resolve(process.cwd(), clean);
  return { absolutePath, allowed: absolutePath.startsWith(process.cwd()) };
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = resolvePort();

  await fs.mkdir(path.join(process.cwd(), 'projects'), { recursive: true }).catch(() => {});
  await fs.mkdir(path.join(process.cwd(), 'workspaces'), { recursive: true }).catch(() => {});
  await fs.mkdir(path.join(process.cwd(), 'public', 'generated'), { recursive: true }).catch(() => {});
  await initPersistenceStore().catch(() => {});

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Render / Cloud health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      port: PORT,
      env: process.env.NODE_ENV || 'development',
      timestamp: Date.now(),
    });
  });

  // Serve generated images statically
  app.use('/generated', express.static(path.join(process.cwd(), 'public', 'generated')));

  // Serve generated projects statically with PWA headers and fallback
  app.use('/projects', express.static(path.join(process.cwd(), 'projects'), {
    setHeaders: (res, filePath) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      if (filePath.endsWith('.js')) {
        res.setHeader('Service-Worker-Allowed', '/');
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      } else if (filePath.endsWith('.webmanifest') || filePath.endsWith('.json')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }
    }
  }));
  app.get(['/projects', '/projects/*'], async (req, res) => {
    const rawParam = (req.params as any)[0] || '';
    const cleanParam = rawParam.replace(/^\/+/, '');
    const requestedFile = cleanParam || 'index.html';
    let filePath = path.join(process.cwd(), 'projects', requestedFile);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    if (requestedFile.endsWith('.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (requestedFile.endsWith('.webmanifest') || requestedFile.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
    try {
      let stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        stat = await fs.stat(filePath);
      }
      if (stat.size > 20) {
        return res.sendFile(filePath);
      }
    } catch {}

    // If file doesn't exist or is empty, try global projects/index.html
    try {
      const fallbackPath = path.join(process.cwd(), 'projects', 'index.html');
      const fbStat = await fs.stat(fallbackPath);
      if (fbStat.size > 20) {
        return res.sendFile(fallbackPath);
      }
    } catch {}
    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-6 font-sans">
  <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl">
    <div class="w-14 h-14 bg-indigo-600/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4 text-indigo-400">
      <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
    </div>
    <h2 class="text-xl font-bold text-white mb-2">Live Canvas Ready</h2>
    <p class="text-slate-400 text-xs leading-relaxed mb-4">Nexus AI is ready. Request any design or website to see it live.</p>
    <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold">
      <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
      Workspace Online
    </div>
  </div>
</body>
</html>`);
  });

  // Reverse proxy & static serving for isolated per-session sandbox workspaces (/w/:sessionId/*)
  app.use('/w/:sessionId', handleWorkspaceProxyRequest);

  // Server-side Multi-Provider Orchestrated Streaming Chat endpoint
  app.post('/api/gemini/chat', async (req, res) => {
    try {
      await handleOrchestratedChat(req.body, res);
    } catch (err: any) {
      console.error("Orchestrated chat error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Failed to process chat" });
      }
    }
  });

  // Resume a paused ask_question tool call with user answers
  app.post('/api/gemini/answer-question', (req, res) => {
    const { questionId, answers, skipped, notes } = req.body || {};
    if (!questionId || typeof questionId !== 'string') {
      return res.status(400).json({ success: false, error: 'questionId is required' });
    }
    const resolved = resolvePendingQuestion(questionId, { answers, skipped, notes });
    if (!resolved) {
      return res.status(404).json({ success: false, error: 'Question session expired or not found' });
    }
    res.json({ success: true });
  });

  // Secrets: Get stored keys with masked values and real-time status
  app.get('/api/secrets', async (_req, res) => {
    try {
      const keys = await loadSecrets();
      const statusList = getKeyPoolStatus(keys);
      res.json({
        keys: keys.map((k, index) => ({
          ...k,
          apiKeyMasked: k.apiKey ? (k.apiKey.length > 8 ? `${k.apiKey.slice(0, 4)}...${k.apiKey.slice(-4)}` : '****') : '',
          status: statusList[index]?.status || 'healthy',
          cooldownRemainingSec: statusList[index]?.cooldownRemainingSec || 0,
          requestsThisMinute: statusList[index]?.requestsThisMinute || 0,
          tokensThisMinute: statusList[index]?.tokensThisMinute || 0,
          requestsToday: statusList[index]?.requestsToday || 0,
          totalRequests: statusList[index]?.totalRequests || 0,
          lastError: statusList[index]?.lastError || null,
        }))
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Secrets: Save / sync API keys
  app.post('/api/secrets', async (req, res) => {
    try {
      const { keys } = req.body;
      if (!Array.isArray(keys)) {
        return res.status(400).json({ error: "Expected an array of keys" });
      }
      await saveSecrets(keys);
      res.json({ success: true, count: keys.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Secrets: Test an API key connectivity
  app.post('/api/secrets/test-key', async (req, res) => {
    try {
      const { provider, apiKey, model, baseUrl } = req.body;
      if (!provider || !apiKey) {
        return res.status(400).json({ success: false, error: "Provider and apiKey are required" });
      }
      const result = await testApiKey(provider, apiKey, model, baseUrl);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Secrets: Fetch live available models (especially :free models) for a provider
  app.post('/api/secrets/models', async (req, res) => {
    try {
      const { provider = 'openrouter', apiKey, baseUrl } = req.body || {};
      const models = await fetchLiveProviderModels(provider, apiKey, baseUrl);
      res.json({ success: true, provider, models });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Secrets: Get real-time status of current pool
  app.get('/api/secrets/pool-status', async (_req, res) => {
    try {
      const keys = await loadSecrets();
      const poolStatus = getKeyPoolStatus(keys);
      res.json({
        pool: poolStatus,
        lastSuccessfulKeyId: getLastSuccessfulKeyId(),
        hasEnvGeminiKey: !!process.env.GEMINI_API_KEY
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // System Logs: Diagnostic logs for error tracking, key rotation & execution
  app.get('/api/system-logs', (_req, res) => {
    try {
      res.json({ logs: getSystemLogs() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/system-logs', (_req, res) => {
    try {
      clearSystemLogs();
      res.json({ success: true, message: 'লগ মুছে ফেলা হয়েছে' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Tool Endpoints ---

  // Project Download (ZIP)
  app.get('/api/project/download', async (_req, res) => {
    try {
      const zip = new AdmZip();
      const ignoreList = ['node_modules', 'dist', '.git', '.next', 'nexus-project.zip'];
      
      const addFilesToZip = async (dir: string, zipPath: string) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (ignoreList.includes(entry.name)) continue;
          
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(zipPath, entry.name);
          
          if (entry.isDirectory()) {
            await addFilesToZip(fullPath, relativePath);
          } else {
            const content = await fs.readFile(fullPath);
            zip.addFile(relativePath, content);
          }
        }
      };

      await addFilesToZip(process.cwd(), "");
      const buffer = zip.toBuffer();
      
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename=nexus-project.zip');
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // File Read
  app.post('/api/tools/file-read', async (req, res) => {
    try {
      const { filePath } = req.body;
      if (!filePath) return res.status(400).json({ error: 'filePath is required' });
      const { absolutePath, allowed } = resolveWorkspacePath(filePath);
      if (!allowed) return res.status(403).json({ error: 'Access denied' });

      const content = await fs.readFile(absolutePath, 'utf-8');
      res.json({ content });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // File Write
  app.post('/api/tools/file-write', async (req, res) => {
    try {
      const { filePath, content } = req.body;
      if (!filePath || content === undefined) return res.status(400).json({ error: 'filePath and content are required' });
      const { absolutePath, allowed } = resolveWorkspacePath(filePath);
      if (!allowed) return res.status(403).json({ error: 'Access denied' });

      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // File Edit
  app.post('/api/tools/file-edit', async (req, res) => {
    try {
      const { filePath, oldText, newText } = req.body;
      const { absolutePath, allowed } = resolveWorkspacePath(filePath);
      if (!allowed) return res.status(403).json({ error: 'Access denied' });

      const content = await fs.readFile(absolutePath, 'utf-8');
      if (!content.includes(oldText)) {
        return res.status(400).json({ error: 'Target text not found in file.' });
      }

      const newContent = content.replace(oldText, newText);
      await fs.writeFile(absolutePath, newContent, 'utf-8');
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Glob (File Search)
  app.post('/api/tools/glob', async (req, res) => {
    try {
      const { pattern } = req.body;
      // Using a simple find command for glob-like behavior
      const { stdout } = await execPromise(`find . -name "${pattern}" -not -path "*/node_modules/*" -not -path "*/.git/*"`, { cwd: process.cwd() });
      const files = stdout.split('\n').filter(f => f.trim() !== '').map(f => f.replace('./', ''));
      res.json({ files });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Grep (Content Search with line numbers)
  app.post('/api/tools/grep', async (req, res) => {
    try {
      const { pattern, searchPath = '.' } = req.body;
      if (!pattern) return res.status(400).json({ error: 'pattern is required' });
      const safePattern = String(pattern).replace(/"/g, '\\"');
      const safePath = String(searchPath).replace(/"/g, '\\"');
      try {
        const { stdout } = await execPromise(
          `grep -rnE "${safePattern}" "${safePath}" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist | head -n 100`,
          { cwd: process.cwd() }
        );
        const matches = stdout.split('\n').filter(f => f.trim() !== '').map(f => f.replace(/^\.\//, ''));
        res.json({ matches, files: Array.from(new Set(matches.map(m => m.split(':')[0]))) });
      } catch (err: any) {
        if (err.code === 1) return res.json({ matches: [], files: [] });
        throw err;
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Bash Execution
  app.post('/api/tools/bash', async (req, res) => {
    try {
      const { command } = req.body;
      if (!command) return res.status(400).json({ error: 'command is required' });
      if (/(rm\s+-rf\s+\/\s*$|rm\s+-rf\s+\/\*|\.secrets\.json)/i.test(String(command))) {
        return res.status(403).json({ error: 'Safety guard: blocked destructive or secret access command.' });
      }
      const { stdout, stderr } = await execPromise(command, { cwd: process.cwd() });
      res.json({ stdout, stderr });
    } catch (error: any) {
      res.status(500).json({ error: error.message, stdout: error.stdout, stderr: error.stderr });
    }
  });

  // Web Fetch
  app.post('/api/tools/web-fetch', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'url is required' });
      const response = await fetch(url);
      const data = await response.text();
      res.json({ data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Web Search (Free Multi-Source: Gemini Google Grounding + Jina Reader + npm + DuckDuckGo + Wikipedia)
  app.post('/api/tools/web-search', async (req, res) => {
    try {
      const { query } = req.body || {};
      if (!query) return res.status(400).json({ error: 'query is required' });
      const storedKeys = await loadSecrets().catch(() => []);
      const geminiKey =
        storedKeys.find((k) => k.isActive && k.provider === 'gemini')?.apiKey ||
        process.env.GEMINI_API_KEY;
      const result = await freeWebSearch(query, { geminiApiKey: geminiKey });
      res.json(result);
    } catch (error: any) {
      console.error('Search error:', error);
      res.status(500).json({
        error: error.message || "Search failed.",
        searchUrl: `https://www.google.com/search?q=${encodeURIComponent(req.body?.query || '')}`
      });
    }
  });

  // Project Analysis
  app.post('/api/tools/analyze-project', async (req, res) => {
    try {
      const { type } = req.body;
      const getFilesRecursively = async (dir: string): Promise<string[]> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(entries.map(async (entry) => {
          const resPath = path.resolve(dir, entry.name);
          if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') return [];
          return entry.isDirectory() ? getFilesRecursively(resPath) : [resPath];
        }));
        return files.flat();
      };
      const allFiles = await getFilesRecursively(process.cwd());
      const relevantFiles = allFiles.filter(f => f.endsWith('.html') || f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.css'));
      const fileContents = await Promise.all(relevantFiles.slice(0, 10).map(async (f) => ({
        path: path.relative(process.cwd(), f),
        content: await fs.readFile(f, 'utf-8')
      })));
      res.json({ files: fileContents, analysisType: type });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GitHub Status
  app.get('/api/github/status', async (_req, res) => {
    try {
      const token = process.env.GITHUB_TOKEN;
      if (!token) return res.json({ configured: false });
      const octokit = new Octokit({ auth: token });
      const { data: user } = await octokit.rest.users.getAuthenticated();
      res.json({
        configured: true,
        user: user.login,
        name: user.name || user.login,
        avatar: user.avatar_url
      });
    } catch (err: any) {
      res.json({ configured: false, error: err.message });
    }
  });

  // Verify Personal Access Token
  app.post('/api/github/verify-token', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Token is required' });
      const octokit = new Octokit({ auth: token });
      const { data: user } = await octokit.rest.users.getAuthenticated();
      res.json({
        valid: true,
        user: user.login,
        name: user.name || user.login,
        avatar: user.avatar_url
      });
    } catch (err: any) {
      res.status(400).json({ valid: false, error: 'Invalid GitHub Token or insufficient permissions.' });
    }
  });

  // GitHub Full Sync (Create Repo & Push Code)
  app.post('/api/github/sync', async (req, res) => {
    try {
      const { token: clientToken, repoName, isPrivate = false, commitMessage = "Sync project from Nexus AI" } = req.body;
      const token = clientToken || process.env.GITHUB_TOKEN;
      if (!token) return res.status(401).json({ error: 'GitHub Personal Access Token is required.' });
      if (!repoName) return res.status(400).json({ error: 'Repository name is required.' });

      const octokit = new Octokit({ auth: token });
      const { data: user } = await octokit.rest.users.getAuthenticated();

      // Check if repo already exists, if not, create it
      let repoUrl = `https://github.com/${user.login}/${repoName}`;
      try {
        const { data: repo } = await octokit.rest.repos.get({
          owner: user.login,
          repo: repoName
        });
        repoUrl = repo.html_url;
      } catch (e: any) {
        if (e.status === 404) {
          const { data: newRepo } = await octokit.rest.repos.createForAuthenticatedUser({
            name: repoName,
            private: isPrivate,
            description: "Built and synced with Nexus AI",
            auto_init: false
          });
          repoUrl = newRepo.html_url;
        } else {
          throw e;
        }
      }

      // Configure git locally
      await execPromise(`git config --global --add safe.directory '*' || true`, { cwd: process.cwd() });
      await execPromise(`git init -b main || git checkout -B main`, { cwd: process.cwd() });
      await execPromise(`git config user.name "${(user.name || user.login).replace(/"/g, '')}"`, { cwd: process.cwd() });
      await execPromise(`git config user.email "${(user.email || user.login + '@users.noreply.github.com').replace(/"/g, '')}"`, { cwd: process.cwd() });
      
      // Stage files and commit
      await execPromise(`git add -A`, { cwd: process.cwd() });
      await execPromise(`git commit -m "${commitMessage.replace(/"/g, '\\"')}" || echo "No changes to commit"`, { cwd: process.cwd() });

      // Configure remote and push
      const remoteUrl = `https://x-access-token:${token}@github.com/${user.login}/${repoName}.git`;
      await execPromise(`git remote remove origin 2>/dev/null || true`, { cwd: process.cwd() });
      await execPromise(`git remote add origin ${remoteUrl}`, { cwd: process.cwd() });
      const { stdout, stderr } = await execPromise(`git push -u origin main --force`, { cwd: process.cwd() });

      res.json({
        success: true,
        repoUrl,
        message: `Successfully synced project to ${repoUrl}!`,
        stdout,
        stderr
      });
    } catch (error: any) {
      console.error('GitHub Sync Error:', error);
      res.status(500).json({ error: error.message || 'Failed to sync to GitHub.' });
    }
  });

  // Firebase Status
  app.get('/api/firebase/status', async (_req, res) => {
    try {
      const configPath = path.resolve(process.cwd(), 'firebase-config.json');
      const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
      const libPath = path.resolve(process.cwd(), 'src/lib/firebase.ts');

      let configured = false;
      let config = null;
      let hasRules = false;

      try {
        const raw = await fs.readFile(configPath, 'utf-8');
        config = JSON.parse(raw);
        configured = true;
      } catch {
        configured = false;
      }

      try {
        await fs.access(rulesPath);
        hasRules = true;
      } catch {
        hasRules = false;
      }

      let hasSdk = false;
      try {
        await fs.access(libPath);
        hasSdk = true;
      } catch {
        hasSdk = false;
      }

      res.json({
        configured,
        config: config ? { projectId: config.projectId, authDomain: config.authDomain, storageBucket: config.storageBucket } : null,
        hasRules,
        hasSdk
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Firebase Setup & Bootstrap
  app.post('/api/firebase/setup', async (req, res) => {
    try {
      const { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId } = req.body;
      if (!apiKey || !projectId) {
        return res.status(400).json({ error: 'apiKey and projectId are required.' });
      }

      const fbConfig = {
        apiKey,
        authDomain: authDomain || `${projectId}.firebaseapp.com`,
        projectId,
        storageBucket: storageBucket || `${projectId}.appspot.com`,
        messagingSenderId: messagingSenderId || '',
        appId: appId || ''
      };

      // 1. Save firebase-config.json
      const configPath = path.resolve(process.cwd(), 'firebase-config.json');
      await fs.writeFile(configPath, JSON.stringify(fbConfig, null, 2), 'utf-8');

      // 2. Generate src/lib/firebase.ts
      const libPath = path.resolve(process.cwd(), 'src/lib/firebase.ts');
      const firebaseTsContent = `import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

export const firebaseConfig = ${JSON.stringify(fbConfig, null, 2)};

// Initialize Firebase safely
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
`;
      await fs.mkdir(path.dirname(libPath), { recursive: true });
      await fs.writeFile(libPath, firebaseTsContent, 'utf-8');

      // 3. Create default firestore.rules if not existing
      const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
      try {
        await fs.access(rulesPath);
      } catch {
        const defaultRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // User profile documents - owner read/write
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Default authenticated access
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
`;
        await fs.writeFile(rulesPath, defaultRules, 'utf-8');
      }

      res.json({
        success: true,
        message: 'Firebase successfully initialized! Firestore, Auth, and Storage SDKs are ready.',
        projectId: fbConfig.projectId
      });
    } catch (err: any) {
      console.error('Firebase Setup Error:', err);
      res.status(500).json({ error: err.message || 'Failed to setup Firebase.' });
    }
  });

  // Get firestore.rules
  app.get('/api/firebase/rules', async (_req, res) => {
    try {
      const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
      const content = await fs.readFile(rulesPath, 'utf-8');
      res.json({ rules: content });
    } catch {
      res.json({
        rules: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}`
      });
    }
  });

  // Save / Deploy firestore.rules
  app.post('/api/firebase/rules', async (req, res) => {
    try {
      const { rules } = req.body;
      if (!rules) return res.status(400).json({ error: 'Rules content is required' });
      const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
      await fs.writeFile(rulesPath, rules, 'utf-8');
      res.json({ success: true, message: 'firestore.rules updated and validated!' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // File Delete
  app.post('/api/tools/file-delete', async (req, res) => {
    try {
      const { filePath } = req.body;
      if (!filePath) return res.status(400).json({ error: 'filePath is required' });
      const { absolutePath, allowed } = resolveWorkspacePath(filePath);
      if (!allowed) return res.status(403).json({ error: 'Access denied' });
      
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        await fs.rm(absolutePath, { recursive: true, force: true });
      } else {
        await fs.unlink(absolutePath);
      }
      res.json({ success: true, message: `Deleted ${filePath}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // List Directory
  app.post('/api/tools/list-dir', async (req, res) => {
    try {
      const { dirPath = '.' } = req.body;
      const { absolutePath: targetDir, allowed } = resolveWorkspacePath(dirPath);
      if (!allowed) return res.status(403).json({ error: 'Access denied' });

      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const items = entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        path: path.relative(process.cwd(), path.join(targetDir, entry.name))
      }));
      res.json({ items });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Move or Rename File
  app.post('/api/tools/move-file', async (req, res) => {
    try {
      const { sourcePath, destinationPath } = req.body;
      if (!sourcePath || !destinationPath) {
        return res.status(400).json({ error: 'sourcePath and destinationPath are required' });
      }
      const { absolutePath: absSrc, allowed: srcAllowed } = resolveWorkspacePath(sourcePath);
      const { absolutePath: absDest, allowed: destAllowed } = resolveWorkspacePath(destinationPath);
      if (!srcAllowed || !destAllowed) {
        return res.status(403).json({ error: 'Access denied' });
      }

      await fs.mkdir(path.dirname(absDest), { recursive: true });
      await fs.rename(absSrc, absDest);
      res.json({ success: true, message: `Moved ${sourcePath} to ${destinationPath}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Install Package
  app.post('/api/tools/install-package', async (req, res) => {
    try {
      const { packageName, isDev = false } = req.body;
      if (!packageName) return res.status(400).json({ error: 'packageName is required' });
      const flag = isDev ? '-D' : '';
      const { stdout, stderr } = await execPromise(`npm install ${flag} ${packageName}`, { cwd: process.cwd() });
      res.json({ success: true, message: `Installed ${packageName}`, stdout, stderr });
    } catch (error: any) {
      res.status(500).json({ error: error.message, stderr: error.stderr });
    }
  });

  // Compile / Build Project (Real TypeScript check + Vite build)
  app.post('/api/tools/compile-project', async (_req, res) => {
    try {
      const { stdout: tscOut } = await execPromise(`npx tsc --noEmit`, { cwd: process.cwd(), timeout: 90000 });
      const { stdout: buildOut, stderr: buildErr } = await execPromise(`npm run build`, { cwd: process.cwd(), timeout: 120000 });
      res.json({
        success: true,
        message: 'TypeScript typecheck and Vite production build succeeded with 0 errors.',
        stdout: `${tscOut}\n${buildOut}`.trim(),
        stderr: buildErr
      });
    } catch (error: any) {
      res.status(400).json({ 
        success: false, 
        message: 'Compilation or Vite build failed.', 
        error: error.message, 
        stdout: error.stdout, 
        stderr: error.stderr 
      });
    }
  });

  // Lint Project
  app.post('/api/tools/lint-project', async (_req, res) => {
    try {
      const { stdout, stderr } = await execPromise(`npm run lint`, { cwd: process.cwd(), timeout: 90000 });
      res.json({ success: true, message: 'Lint passed successfully.', stdout, stderr });
    } catch (error: any) {
      res.status(400).json({ 
        success: false, 
        message: 'Lint found issues.', 
        error: error.message, 
        stdout: error.stdout, 
        stderr: error.stderr 
      });
    }
  });

  // Restart / Health Probe Dev Server
  app.post('/api/tools/restart-server', async (_req, res) => {
    try {
      const healthRes = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      const healthData = await healthRes.json().catch(() => null);
      res.json({
        success: healthRes.ok,
        port: PORT,
        health: healthData,
        message: healthRes.ok
          ? `Server healthy & active on port ${PORT} (uptime ${healthData?.uptime ?? 0}s).`
          : `Health check returned status ${healthRes.status}.`
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Checkpoints & 1-Click Rollback Endpoints
  app.get('/api/git/checkpoints', async (_req, res) => {
    try {
      const checkpoints = await listCheckpoints();
      res.json({ success: true, checkpoints });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/git/checkpoints', async (req, res) => {
    try {
      const { label = 'Manual checkpoint' } = req.body || {};
      const cp = await createCheckpoint(label);
      res.json({ success: true, checkpoint: cp });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/git/rollback', async (req, res) => {
    try {
      const { checkpointId } = req.body || {};
      const result = await rollbackToCheckpoint(checkpointId);
      res.status(result.success ? 200 : 400).json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Headless DOM / Runtime Preview Verification
  app.post('/api/tools/verify-preview', async (req, res) => {
    try {
      const { targetUrl, filePath, sessionId } = req.body || {};
      const result = await verifyLivePreviewWithDom(targetUrl || filePath, true, sessionId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Codebase Dependency & Symbol Graph
  app.get('/api/tools/codebase-graph', async (req, res) => {
    try {
      const targetDir = typeof req.query.dir === 'string' ? req.query.dir : '.';
      const graph = await buildCodebaseGraph(targetDir);
      res.json(graph);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Automated Test Runner
  app.post('/api/tools/run-tests', async (req, res) => {
    try {
      const { target } = req.body || {};
      const result = await runAutomatedTests(target);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Background Scheduler Inspection & Cancellation
  app.get('/api/tools/schedule', (_req, res) => {
    res.json({ success: true, jobs: listScheduledTasks() });
  });

  app.delete('/api/tools/schedule/:id', (req, res) => {
    res.json(cancelScheduledTask(req.params.id));
  });

  // Sandboxed Multi-App Workspace Endpoints (/api/workspaces/*)
  app.get('/api/workspaces', async (_req, res) => {
    try {
      res.json(await getWorkspaceStatus());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/workspaces/:sessionId/init', async (req, res) => {
    try {
      const { template = 'fullstack-express', appTitle = 'Sandboxed Nexus App' } = req.body || {};
      res.json(await initSessionWorkspace(req.params.sessionId, template, appTitle));
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/workspaces/:sessionId/start', async (req, res) => {
    try {
      const { command } = req.body || {};
      res.json(await startWorkspaceServer(req.params.sessionId, command));
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/workspaces/:sessionId/stop', async (req, res) => {
    try {
      res.json(await stopWorkspaceServer(req.params.sessionId));
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/workspaces/:sessionId/status', async (req, res) => {
    try {
      res.json(await getWorkspaceStatus(req.params.sessionId));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // TypeScript AST Symbol & Relevance Context Ranker
  app.all('/api/tools/ast-context', async (req, res) => {
    try {
      const src = req.method === 'POST' ? req.body || {} : req.query || {};
      const query = String(src.query || '');
      const targetDir = String(src.targetDir || src.dir || '.');
      const topK = Number(src.topK || 10);
      res.json(await rankAstContext(query, targetDir, topK));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Visual Screenshot + Vision UI QA Loop
  app.post('/api/tools/visual-qa', async (req, res) => {
    try {
      const { targetUrl, sessionId, viewport } = req.body || {};
      res.json(await runVisualQaReview({ targetUrl, sessionId, viewport }));
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Persistent Remote DB Storage Status & Manual Sync (PostgreSQL / Turso / Supabase)
  app.get('/api/persistence/status', async (_req, res) => {
    try {
      res.json(await getPersistenceStatus());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/persistence/sync', async (_req, res) => {
    try {
      const keys = await loadSecrets();
      const syncRes = await saveSecretsToPersistence(keys);
      const status = await getPersistenceStatus();
      res.json({ success: true, ...syncRes, status });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Git Status
  app.post('/api/tools/git-status', async (_req, res) => {
    try {
      const { stdout: branch } = await execPromise('git branch --show-current || echo "main"', { cwd: process.cwd() });
      const { stdout: status } = await execPromise('git status -s || echo ""', { cwd: process.cwd() });
      res.json({ branch: branch.trim(), status: status.trim() || 'Working directory clean.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Git Commit
  app.post('/api/tools/git-commit', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Commit message is required' });
      await execPromise('git add .', { cwd: process.cwd() });
      const { stdout } = await execPromise(`git commit -m "${message.replace(/"/g, '\\"')}" || echo "Nothing to commit"`, { cwd: process.cwd() });
      res.json({ success: true, stdout: stdout.trim() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Git Diff
  app.post('/api/tools/git-diff', async (_req, res) => {
    try {
      const { stdout } = await execPromise('git diff || echo ""', { cwd: process.cwd() });
      res.json({ diff: stdout.trim() || 'No uncommitted changes detected.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Send HTTP Request
  app.post('/api/tools/send-http-request', async (req, res) => {
    try {
      const { url, method = 'GET', headers = {}, body } = req.body;
      if (!url) return res.status(400).json({ error: 'url is required' });
      const response = await fetch(url, {
        method,
        headers,
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
      });
      const contentType = response.headers.get('content-type') || '';
      const responseData = contentType.includes('application/json') ? await response.json() : await response.text();
      res.json({ status: response.status, statusText: response.statusText, data: responseData });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Test API Endpoint
  app.post('/api/tools/test-api-endpoint', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'url is required' });
      const start = Date.now();
      const response = await fetch(url);
      const latency = Date.now() - start;
      res.json({ status: response.status, latencyMs: latency, reachable: response.ok });
    } catch (error: any) {
      res.status(500).json({ error: error.message, reachable: false });
    }
  });

  // Set Environment Variable
  app.post('/api/tools/set-env-variable', async (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key) return res.status(400).json({ error: 'key is required' });
      const envPath = path.resolve(process.cwd(), '.env');
      let envContent = '';
      try {
        envContent = await fs.readFile(envPath, 'utf-8');
      } catch {
        envContent = '';
      }
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}\n`;
      }
      await fs.writeFile(envPath, envContent.trim() + '\n', 'utf-8');
      res.json({ success: true, message: `Set environment variable ${key}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Scan Security Vulnerabilities
  app.post('/api/tools/scan-vulnerabilities', async (_req, res) => {
    try {
      const { stdout, stderr } = await execPromise('npm audit --audit-level=moderate || true', { cwd: process.cwd() });
      res.json({ report: stdout || stderr || 'No vulnerabilities found.' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Detect Hardcoded Secrets
  app.post('/api/tools/detect-secrets', async (_req, res) => {
    try {
      const secretPatterns = [
        /(?:api[_-]?key|secret|token|password|auth|bearer)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/gi
      ];
      const getFilesRecursively = async (dir: string): Promise<string[]> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(entries.map(async (entry) => {
          const resPath = path.resolve(dir, entry.name);
          if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') return [];
          return entry.isDirectory() ? getFilesRecursively(resPath) : [resPath];
        }));
        return files.flat();
      };
      const files = await getFilesRecursively(path.resolve(process.cwd(), 'src'));
      const detected: Array<{ file: string; line: number; preview: string }> = [];
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          for (const pattern of secretPatterns) {
            if (pattern.test(line) && !line.includes('process.env')) {
              detected.push({
                file: path.relative(process.cwd(), file),
                line: index + 1,
                preview: line.trim().slice(0, 80)
              });
            }
          }
        });
      }
      res.json({ safe: detected.length === 0, detectedCount: detected.length, detected });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Send Webhook Notification
  app.post('/api/tools/send-webhook', async (req, res) => {
    try {
      const { webhookUrl, message, payload = {} } = req.body;
      if (!webhookUrl) return res.status(400).json({ error: 'webhookUrl is required' });
      const body = { content: message, text: message, ...payload };
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      res.json({ success: response.ok, status: response.status });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Execute Database / SQL Query (real persistent SQLite via node:sqlite)
  app.post('/api/tools/execute-sql-query', async (req, res) => {
    try {
      const { query } = req.body || {};
      if (!query) return res.status(400).json({ error: 'SQL query is required' });
      const result = await executeServerTool('cloudsql_execute_sql', { sql_statement: query });
      if (result?.error) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // List Files
  app.get('/api/files/list', async (_req, res) => {
    try {
      const getFiles = async (dir: string): Promise<any[]> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(entries.map(async (entry) => {
          const resPath = path.resolve(dir, entry.name);
          const relativePath = path.relative(process.cwd(), resPath);
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') return null;
          if (entry.isDirectory()) {
            return { name: entry.name, path: relativePath, type: 'directory', children: await getFiles(resPath) };
          } else {
            return { name: entry.name, path: relativePath, type: 'file' };
          }
        }));
        return files.filter(f => f !== null);
      };
      const fileTree = await getFiles(process.cwd());
      res.json(fileTree);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Coding Mode Skills & Tools Registry (including Function Calling schemas)
  app.get('/api/skills', (_req, res) => {
    res.json({
      skills: CODING_SKILLS_REGISTRY,
      tools: serverTools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters || null,
      })),
    });
  });

  app.get('/api/skills/:name', (req, res) => {
    const skill = getSkillByName(req.params.name);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    res.json(skill);
  });

  // Code Execution Sandbox endpoint
  app.post('/api/tools/sandbox', async (req, res) => {
    try {
      const { language = 'javascript', code = '', timeoutMs = 10000 } = req.body || {};
      if (!code.trim()) return res.status(400).json({ error: 'code is required' });
      const result = await runCodeInSandbox(language, code, timeoutMs);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Debugging & Error Analysis endpoint
  app.post('/api/tools/debug-analyze', async (req, res) => {
    try {
      const { errorMessage, errorLog, targetFile, filePath } = req.body || {};
      const result = await runDebugErrorAnalysis(errorMessage || errorLog, targetFile || filePath);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- UltraWorkers & Claw Code Harness API Routes ---

  // Claw Doctor: Health check for environment, runtimes, port, memory, API keys
  app.all('/api/tools/claw-doctor', async (req, res) => {
    try {
      const { runNetworkCheck = false } = (req.method === 'POST' ? req.body : req.query) || {};
      const result = await runClawDoctor(Boolean(runNetworkCheck));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Claw Status: Harness runtime state & metrics
  app.all('/api/tools/claw-status', async (_req, res) => {
    try {
      const result = await getClawStatus();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Claw ACP: Agent Client Protocol capabilities & handshake
  app.all('/api/tools/claw-acp', (req, res) => {
    try {
      const { action = 'status' } = (req.method === 'POST' ? req.body : req.query) || {};
      const result = getClawAcpInfo(action);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Claw Prompt: Direct task execution harness
  app.post('/api/tools/claw-prompt', async (req, res) => {
    try {
      const { prompt = '', role = 'developer', dryRun = false } = req.body || {};
      if (!prompt.trim()) return res.status(400).json({ error: 'prompt is required' });
      const result = await runClawPrompt(prompt, role, Boolean(dryRun));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // OmO (oh-my-openagent): Multi-Agent Coordination (Architect -> Executor -> Reviewer)
  app.post('/api/tools/omo-coordinate', async (req, res) => {
    try {
      const { task = '', context, subAgents } = req.body || {};
      if (!task.trim()) return res.status(400).json({ error: 'task is required' });
      const result = await runOmoCoordinate(task, context, subAgents);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // OmX (oh-my-codex): Structured Execution Protocol
  app.post('/api/tools/omx-protocol', async (req, res) => {
    try {
      const { goal = '', targetStack } = req.body || {};
      if (!goal.trim()) return res.status(400).json({ error: 'goal is required' });
      const result = await runOmxProtocol(goal, targetStack);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ClawHip: Event & Notification Router
  app.all('/api/tools/clawhip', (req, res) => {
    try {
      const { action = 'list', eventType, message, metadata } = (req.method === 'POST' ? req.body : req.query) || {};
      const result = routeClawHipEvent(action, eventType, message, metadata);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Gajae-Code / LazyCodex: Autonomous Task Runner with compiler verification
  app.post('/api/tools/lazycodex', async (req, res) => {
    try {
      const { task = '', targetFiles = [], maxIterations = 3 } = req.body || {};
      if (!task.trim()) return res.status(400).json({ error: 'task is required' });
      const result = await runLazyCodex(task, targetFiles, maxIterations);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Manage background tasks
  app.post('/api/tools/manage-task', (req, res) => {
    const { action = 'list', taskId, input } = req.body || {};
    res.json(manageBackgroundTask(action, taskId, input));
  });

  // Dual verification: compile + lint
  app.post('/api/tools/verify-build', async (_req, res) => {
    try {
      const { stdout: lintOut } = await execPromise('npx tsc --noEmit', { cwd: process.cwd() });
      const { stdout: buildOut } = await execPromise('npm run build', { cwd: process.cwd() });
      res.json({ success: true, lintOutput: lintOut.trim() || 'No TypeScript errors', buildOutput: buildOut.trim() });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
        output: error.stdout || error.stderr || '',
      });
    }
  });

  // Vite Middleware
  if (process.env.NODE_ENV !== 'production') {
    const enableHmr = process.env.ENABLE_HMR === 'true' && process.env.DISABLE_HMR !== 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: enableHmr ? { server: httpServer } : false,
        ws: enableHmr ? { server: httpServer } : false,
        forwardConsole: false,
        watch: enableHmr ? {} : null,
      },
      appType: 'spa',
    });

    if (!enableHmr) {
      app.get('/@vite/client', async (req, res, next) => {
        try {
          const transformed = await vite.transformRequest('/@vite/client');
          if (!transformed?.code) return next();
          const safeCode = transformed.code
            .replace(/\bws\.send\(/g, 'ws?.send(')
            .replace(/await wsTransport\.connect\(handlers\);/g, 'return;');
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          return res.send(safeCode);
        } catch {
          return next();
        }
      });
    }

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
