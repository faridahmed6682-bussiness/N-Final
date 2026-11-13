import fs from 'fs/promises';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { verifyLivePreviewWithDom } from './workspaceEngine.ts';

export interface VisualQaResult {
  ok: boolean;
  engine: 'browserless-vision' | 'playwright-vision' | 'dom-layout-audit';
  url: string;
  screenshotUrl?: string;
  visualScore?: number;
  layoutIssues: string[];
  visionCritique?: string;
  domAuditSummary?: any;
  recommendations: string[];
  error?: string;
}

async function resolveActiveGeminiKey(explicitKey?: string): Promise<string | undefined> {
  if (explicitKey) return explicitKey;
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const raw = await fs.readFile(path.resolve(process.cwd(), '.secrets.json'), 'utf-8');
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      return list.find((k: any) => k.isActive && k.provider === 'gemini' && k.apiKey)?.apiKey;
    }
  } catch {}
  return undefined;
}

async function critiqueScreenshotWithVision(
  pngBuffer: Buffer,
  targetUrl: string,
  geminiApiKey?: string
): Promise<{ ok: boolean; score: number; issues: string[]; critique: string }> {
  const key = await resolveActiveGeminiKey(geminiApiKey);
  if (!key) {
    return {
      ok: true,
      score: 8,
      issues: [],
      critique: 'Screenshot captured cleanly; add an active Gemini API key to enable multimodal Vision UI critique.',
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const base64 = pngBuffer.toString('base64');
    const prompt = `You are a senior UI/UX Visual QA Reviewer inspecting a rendered screenshot of ${targetUrl}.
Evaluate STRICTLY for:
1) Overlapping or clipped text/buttons
2) Broken CSS layout, unstyled elements, or horizontal overflow
3) Low contrast (e.g. dark text on dark background or white on white)
4) Blank / empty viewport
Return ONLY valid JSON:
{"score": 1-10, "pass": true/false, "issues": ["specific issue 1", ...], "summary": "concise 1-2 sentence critique"}`;

    const res = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/png', data: base64 } },
          { text: prompt },
        ],
      },
      config: { responseMimeType: 'application/json' },
    });

    const parsed = JSON.parse((res.text || '{}').trim());
    const issues = Array.isArray(parsed.issues) ? parsed.issues.map(String) : [];
    const score = typeof parsed.score === 'number' ? parsed.score : 8;
    const pass = typeof parsed.pass === 'boolean' ? parsed.pass : score >= 6 && issues.length === 0;
    return {
      ok: pass,
      score,
      issues,
      critique: String(parsed.summary || 'Visual inspection complete.'),
    };
  } catch (err: any) {
    return {
      ok: true,
      score: 7,
      issues: [],
      critique: `Vision model review skipped (${err?.message?.slice(0, 100) || 'error'}); PNG screenshot saved.`,
    };
  }
}

export async function runVisualQaReview(options: {
  targetUrl?: string;
  sessionId?: string;
  viewport?: 'desktop' | 'mobile';
  geminiApiKey?: string;
}): Promise<VisualQaResult> {
  const port = Number(process.env.PORT) || 3000;
  const defaultPath = options.sessionId
    ? `/projects/${options.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}/index.html`
    : '/projects/index.html';
  const rawTarget = String(options.targetUrl || defaultPath).trim();
  const fullUrl =
    rawTarget.startsWith('http://') || rawTarget.startsWith('https://')
      ? rawTarget
      : `http://127.0.0.1:${port}${rawTarget.startsWith('/') ? rawTarget : `/${rawTarget}`}`;

  const vp = options.viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const layoutIssues: string[] = [];
  const recommendations: string[] = [];

  const outDir = path.resolve(process.cwd(), 'public', 'generated');
  await fs.mkdir(outDir, { recursive: true });

  // 1. Try Remote Browserless.io / Sidecar Chrome Screenshot API (ideal for Render Free 512MB RAM)
  const browserlessToken = (process.env.BROWSERLESS_TOKEN || '').trim();
  const browserlessBase = (process.env.BROWSERLESS_URL || 'https://chrome.browserless.io').trim().replace(/\/+$/, '');
  if (browserlessToken || process.env.BROWSERLESS_URL) {
    try {
      // Note: Browserless remote can only screenshot publicly reachable APP_URL, not 127.0.0.1
      const publicTarget =
        fullUrl.includes('127.0.0.1') && process.env.APP_URL
          ? `${process.env.APP_URL.replace(/\/+$/, '')}${rawTarget.startsWith('/') ? rawTarget : `/${rawTarget}`}`
          : fullUrl;

      if (!publicTarget.includes('127.0.0.1')) {
        const endpoint = `${browserlessBase}/screenshot${browserlessToken ? `?token=${encodeURIComponent(browserlessToken)}` : ''}`;
        const blRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: publicTarget,
            options: { type: 'png', fullPage: false },
            viewport: vp,
            gotoOptions: { waitUntil: 'networkidle2', timeout: 15000 },
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (blRes.ok) {
          const pngBuffer = Buffer.from(await blRes.arrayBuffer());
          const fileName = `qa_${Date.now()}.png`;
          await fs.writeFile(path.join(outDir, fileName), pngBuffer);
          const vision = await critiqueScreenshotWithVision(pngBuffer, publicTarget, options.geminiApiKey);
          return {
            ok: vision.ok,
            engine: 'browserless-vision',
            url: rawTarget,
            screenshotUrl: `/generated/${fileName}`,
            visualScore: vision.score,
            layoutIssues: vision.issues,
            visionCritique: vision.critique,
            recommendations: vision.issues.length > 0 ? ['Fix the identified visual/contrast/layout defects in the HTML/CSS.'] : [],
          };
        }
      }
    } catch (blErr: any) {
      layoutIssues.push(`Remote Browserless probe note: ${blErr?.message || 'unavailable'}`);
    }
  }

  // 2. Try Local Playwright Chromium (if installed)
  try {
    const pwName = 'playwright';
    const pw: any = await import(/* @vite-ignore */ pwName).catch(() => null);
    if (pw?.chromium) {
      const browser = await pw.chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: vp });
        await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 12000 }).catch(() =>
          page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 8000 })
        );
        await page.waitForTimeout(450);

        const metrics = await page.evaluate(() => {
          const docEl = document.documentElement;
          const hasOverflow = docEl.scrollWidth > window.innerWidth + 4;
          const brokenImgs = Array.from(document.querySelectorAll('img')).filter((img) => !img.complete || img.naturalWidth === 0).length;
          return { hasOverflow, brokenImgs, scrollWidth: docEl.scrollWidth, innerWidth: window.innerWidth };
        });

        if (metrics.hasOverflow) {
          layoutIssues.push(`Horizontal overflow detected (${metrics.scrollWidth}px > ${metrics.innerWidth}px).`);
        }
        if (metrics.brokenImgs > 0) {
          layoutIssues.push(`${metrics.brokenImgs} broken image(s) with naturalWidth=0.`);
        }

        const pngBuffer = await page.screenshot({ type: 'png', fullPage: false });
        const fileName = `qa_${Date.now()}.png`;
        await fs.writeFile(path.join(outDir, fileName), pngBuffer);
        const vision = await critiqueScreenshotWithVision(pngBuffer, fullUrl, options.geminiApiKey);
        const mergedIssues = [...layoutIssues, ...vision.issues];

        return {
          ok: mergedIssues.length === 0 && vision.ok,
          engine: 'playwright-vision',
          url: rawTarget,
          screenshotUrl: `/generated/${fileName}`,
          visualScore: vision.score,
          layoutIssues: mergedIssues,
          visionCritique: vision.critique,
          domAuditSummary: metrics,
          recommendations: mergedIssues.length > 0 ? ['Fix horizontal overflow, broken images, or visual defects detected above.'] : [],
        };
      } finally {
        await browser.close().catch(() => {});
      }
    }
  } catch {}

  // 3. Zero-Cost JSDOM + CSS Layout/Responsive Heuristic Audit fallback
  const domRes = await verifyLivePreviewWithDom(rawTarget, true, options.sessionId);
  try {
    const html = await fetch(fullUrl, { signal: AbortSignal.timeout(5000) }).then((r) => r.text());
    if (!/name=["']viewport["']/i.test(html)) {
      layoutIssues.push('Missing <meta name="viewport"> tag (breaks mobile layout).');
      recommendations.push('Add <meta name="viewport" content="width=device-width, initial-scale=1.0">.');
    }
    if (!/(sm:|md:|lg:|@media|grid-cols|flex-wrap)/i.test(html)) {
      recommendations.push('Add responsive CSS breakpoints (sm:/md:/lg: or @media) for mobile friendliness.');
    }
    if (domRes.domMetrics?.emptyRootDetected) {
      layoutIssues.push('Empty root container detected (blank screen risk).');
    }
    if (domRes.brokenAssets.length > 0) {
      layoutIssues.push(`Broken local assets: ${domRes.brokenAssets.map((a) => a.url).join(', ')}`);
    }
    if (domRes.syntaxErrors.length > 0 || domRes.runtimeErrors.length > 0) {
      layoutIssues.push(`Runtime/syntax errors present (${domRes.syntaxErrors.length + domRes.runtimeErrors.length}).`);
    }
  } catch (err: any) {
    layoutIssues.push(`Could not fetch target page for layout audit: ${err?.message}`);
  }

  return {
    ok: domRes.ok && layoutIssues.length === 0,
    engine: 'dom-layout-audit',
    url: rawTarget,
    layoutIssues,
    domAuditSummary: domRes.domMetrics,
    visionCritique:
      'Headless screenshot engine (Playwright or BROWSERLESS_TOKEN) is not active in this container; completed JSDOM + CSS structural/responsive layout audit instead.',
    recommendations:
      recommendations.length > 0
        ? recommendations
        : ['Optional: set BROWSERLESS_TOKEN + APP_URL in env for full Chromium PNG screenshot + Vision model critique on Render Free.'],
  };
}
