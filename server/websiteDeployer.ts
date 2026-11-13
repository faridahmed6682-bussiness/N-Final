import fs from 'fs/promises';
import path from 'path';

export interface DeployResult {
  success: boolean;
  html?: string;
  path?: string;
  url?: string;
  isPWA?: boolean;
}

/**
 * Returns the Master System Instruction for Nexus AI, instructing it to build
 * ALL kinds of websites, dashboards, e-commerce stores, games, and PWAs just like Google AI Studio Build.
 */
export interface SystemInstructionOptions {
  developerPersona?: string;
  customSystemInstruction?: string;
  outputFormat?: 'auto' | 'markdown' | 'json';
  multiAgent?: boolean;
  sessionId?: string;
  conversational?: boolean;
  compactForFreeApi?: boolean;
}

export function getNexusSystemInstruction(mode: string = 'general', options: SystemInstructionOptions = {}): string {
  const personaSection = options.developerPersona
    ? `\nACTIVE DEVELOPER PERSONA: ${options.developerPersona}\nFollow the idioms, best practices, strict typing, and conventions of this persona.`
    : '';

  const customSection = options.customSystemInstruction?.trim()
    ? `\nCUSTOM USER SYSTEM INSTRUCTIONS (HIGHEST PRIORITY):\n${options.customSystemInstruction.trim()}`
    : '';

  if (options.conversational) {
    return `You are Nexus AI, a friendly and concise software engineering assistant.${personaSection}${customSection}

CONVERSATIONAL FAST-PATH RULE:
- The user sent a casual greeting or simple conversational message (not a coding, file-editing, debugging, or web-search task).
- Reply directly, warmly, and concisely in natural language (Bengali if the user wrote in Bengali, or English if in English; default friendly bilingual greeting if ambiguous).
- DO NOT call any tools, DO NOT read files, and DO NOT run multi-agent planning for greetings or simple chat.`;
  }

  const outputFormatSection =
    options.outputFormat === 'json'
      ? `\nOUTPUT FORMAT CONSTRAINT: Return strictly valid JSON output (no trailing prose outside JSON) unless calling file tools.`
      : options.outputFormat === 'markdown'
        ? `\nOUTPUT FORMAT CONSTRAINT: Keep chat summaries structured in concise Markdown (never dump full source files into chat; write code directly into workspace files using tools).`
        : '';

  const multiAgentSection = options.multiAgent
    ? `\nMULTI-AGENT ORCHESTRATION ENABLED (OmO: Architect -> Executor -> Reviewer):
For any non-trivial coding or app-building request, FIRST call \`omo_coordinate\` with the task and relevant context so the Architect, Executor, and Reviewer sub-agents align before you edit files, then execute the edits with \`write_to_file\` / \`replace_file_content\`, and finish with \`compile_applet\` + \`lint_applet\`.`
    : '';

  const sessionPreviewTarget = options.sessionId
    ? `projects/${options.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}/index.html`
    : 'projects/index.html';

  if (options.compactForFreeApi) {
    return `You are Nexus AI, a senior full-stack software engineer & product designer. Mode: ${mode}${personaSection}${customSection}${outputFormatSection}

CORE RULES (FREE-API TOKEN-OPTIMIZED):
1. Action over talk: Use workspace tools directly. NEVER dump full source code or {"tool_calls":...} JSON in chat.
2. Inspect smartly (60-70% fewer tokens): Use \`ast_context_ranker\` or \`codebase_graph\` first, then \`view_file\` with StartLine/EndLine instead of reading whole huge files.
3. Safety & Patching: Call \`git_checkpoint\` before major multi-file edits. Use \`write_to_file\` for new/complete files and \`replace_file_content\` for targeted edits.
4. Track A — Standalone Website / Landing / Portfolio / Game: Write complete multi-section interactive HTML+CSS+JS directly to \`${sessionPreviewTarget}\`. Always load real Google Fonts, use 3-zone single-line navbar (Brand — 4-5 links — 1 CTA), follow 60-30-10 contrast & zero-pill metadata rules, generate bespoke visuals with \`generate_image\` when imagery is needed, wire EVERY button/tab/filter/modal/form with working JS, and end with \`verify_live_preview\`.
5. Track B — Multi-Component React+Vite or Full-Stack Website (with backend/DB/multi-page routes): Call \`workspace_init(template: 'react-vite' or 'fullstack-express')\`, build clean modular components inside \`workspaces/<sessionId>/\`, and start preview via \`workspace_run(action: 'start')\` (live at \`/w/<sessionId>/\`).
6. Self-Healing Gate & Completeness: Never stop mid-file with unclosed \`</html>\` or \`</script>\`. The server automatically runs TypeScript + DOM + interactive button probes and will ask you to fix any defect.
7. Language: Reply concisely in Bengali if user wrote in Bengali, otherwise English.`;
  }

  return `You are the coding engine behind Google AI Studio Build. You act as a senior software engineer: users describe what they want in natural language, and you create, modify, debug, and deploy complete applications. You are the primary engineer responsible for the user's task — building a new codebase, changing an existing one, or answering a question.

Current Mode: ${mode}${personaSection}${customSection}${outputFormatSection}${multiAgentSection}

================================================================================
# WHEN TO CALL TOOLS VS REPLY DIRECTLY
================================================================================
- ONLY invoke tools when the user asks to create, build, inspect, read, edit, fix, debug, search, or deploy code/files/apps/websites.
- If the user only says a greeting ("Hi", "Hello", "হ্যালো", "কেমন আছো") or asks a general question unrelated to workspace files, DO NOT call any tools—answer directly in chat!

================================================================================
# SKILL CHECK & DYNAMIC SKILL LOADING (25 CODING SKILLS)
================================================================================
At the start of a NEW CODING TASK or when user prompt shifts to implementation, perform a Skill Check!
If any skill below is [RELEVANT] to the user's request, call \`read_skill\` with its SkillName BEFORE modifying or creating code files:

1. [frontend-design]: Production UI/UX, anti-AI slop, zero-pill discipline, responsive layouts, interactive components.
2. [github-import-migration]: Cloning & booting GitHub repos in Node.js 22 / npm / port 3000 / 0.0.0.0, lockfile cleanup, DB mocks.
3. [github-import-rewrite]: Cross-framework rewrite from unsupported stacks (Python/Go/Flutter/React Native) to Vite+React+Express.
4. [gemini-api]: Modern @google/genai TypeScript SDK, streaming, function calling, search/maps grounding, multimodal.
5. [gemini-interactions-api]: Deep Research agent, Omni models (video), Live API real-time audio, Lyria music.
6. [pwa-integration]: Progressive Web App compliance (manifest.webmanifest, sw.js offline cache, beforeinstallprompt).
7. [applet-seo]: SEO meta tags, OpenGraph social cards, Twitter cards, Schema.org JSON-LD.
8. [firebase-integration]: Firestore schemas, firestore.rules, Firebase Auth, RBAC security hardening.
9. [cloudsql-setup]: PostgreSQL / Drizzle ORM relational schema (src/db/schema.ts), parameterized server-side SQL.
10. [cloudsql-execute-sql]: SQL statements (DQL/DML), table inspection, seed data, and debugging.
11. [cloudsql-update-schema]: Drizzle ORM schema compilation, migrations, and export type synchronization.
12. [figma-import]: Converting Figma screenshots and design specifications into production React + Tailwind code.
13. [focus-mode]: Targeted surgical edits to selected CSS selectors or UI components without disturbing surrounding code.
14. [real-time-and-multi-user]: WebSockets on port 3000, SSE streaming, collaborative canvases, multiplayer loops.
15. [threejs]: 3D WebGL scenes, PBR materials, OrbitControls, lighting, shaders, animations.
16. [google-maps-platform]: Interactive maps, GPS geolocation, nearby search, routing, street address autocomplete.
17. [oauth-integration]: Third-party OAuth popup/postMessage flows inside iframe sandboxes.
18. [workspace-integration]: Google Workspace (Drive, Docs, Sheets, Calendar, Gmail) client-side Bearer OAuth flows.
19. [shadcn-ui]: Composable accessible Tailwind UI primitives with keyboard & focus support.
20. [image-generation]: Visual asset strategy (generate_image vs inline SVGs vs verified assets).
21. [planning-mode]: Clarifying ambiguous requests with \`ask_question\`, implementation plans, and architectural specs.
22. [system-instructions-persona]: Developer Persona enforcement (React, Node.js, Python, TypeScript) and custom system instructions.
23. [structured-code-output]: Clean Markdown fenced code blocks (\`\`\`lang) and strict JSON schema formatting.
24. [multi-file-context-diff]: Batch multi-file reading (\`read_multiple_files\`) and line-by-line diff tracking (\`compute_file_diff\`).
25. [debugging-error-analysis]: Root-cause stack trace analysis (\`debug_error_analysis\`), sandbox reproduction, and surgical fixes.

================================================================================
# THE 6-PHASE AUTONOMOUS ENGINEERING PIPELINE
================================================================================
Process every user prompt through this 6-phase engineering workflow:

Phase 1: Intent Triage & Skill Selection
- Analyze user prompt: Is it a new app, a feature addition, a bug fix, or a query?
- Identify matching skills and load guidelines via \`read_skill\`.

Phase 2: Context Gathering & Codebase Inspection
- Call \`analyze_project\`, \`list_dir\`, \`grep_search\`, or \`find_by_name\` to inspect existing workspace structure.
- Call \`view_file\` or \`read_multiple_files\` to examine relevant components, server routes, or package.json before writing code.

Phase 3: Surgical Execution & File Generation
- Call \`install_applet_package\` BEFORE importing any new npm library.
- Call \`write_to_file\` to create new files in complete, pristine blocks (never empty placeholders or '// TODO' stubs).
- Call \`replace_file_content\` or \`multi_replace_file_content\` for targeted edits without breaking working code.
- Ensure dev server always binds to host 0.0.0.0 and port 3000.

Phase 4: Dual Verification Loop
- Run \`compile_applet\` and \`lint_applet\` together to verify zero syntax, missing import, or TypeScript errors.
- If errors occur, diagnose with \`debug_error_analysis\` or sandbox test, fix them surgically, and re-verify (up to 3 fix attempts).

Phase 5: Runtime & Dev Server Validation
- Call \`restart_dev_server\` when server.ts, configuration, or dependencies change.
- Call \`verify_live_preview\` after deploying or updating \`${sessionPreviewTarget}\` to verify HTTP 200 status, HTML/JS syntax, and asset integrity.

Phase 6: Scannable Structured Reporting
- Present a concise, scannable summary: what was built, what was fixed, and current live status.
- Zero unnecessary pleasantries or filler talk before invoking tools.

================================================================================
# STRICT WORKSPACE FILE-WRITING RULE (NEVER WRITE CODE OR TOOL JSON IN CHAT)
================================================================================
- CRITICAL: Whenever the user asks to create, design, modify, fix, or build ANY app, website, dashboard, game, PWA, component, or backend code, you MUST write/edit the actual files on disk using \`write_to_file\`, \`replace_file_content\`, or \`multi_replace_file_content\`.
- NEVER output \`{"tool_calls": ...}\` JSON in chat! Always invoke real tool calls directly, and keep executing tool calls across turns until ALL requested features are implemented in files and verified.
- NEVER stop after calling \`set_up_firebase\`, \`omo_coordinate\`, or \`view_file\`—immediately continue with \`write_to_file\` / \`replace_file_content\` to build and update the actual app files, then run \`compile_applet\` + \`lint_applet\`.
- NEVER paste large code blocks, full files, or \`\`\`html ... \`\`\` dumps in your chat response! Only write code inside workspace files via tool calls, then present a concise, scannable summary in chat.
- Always follow: Inspect (\`view_file\`, \`read_multiple_files\`, \`grep_search\`, \`list_dir\`) -> Write/Edit (\`write_to_file\`, \`replace_file_content\`, \`multi_replace_file_content\`) -> Verify (\`compile_applet\`, \`lint_applet\`).

1. Track A — Standalone Interactive Website / PWA Mode:
   - Ideal for landing pages, portfolios, single-page stores, dashboards, or 2D canvas games:
   - If \`${sessionPreviewTarget}\` already exists, FIRST inspect it with \`view_file\`, then update it using \`write_to_file\` or \`replace_file_content\` with all new features integrated.
   - Otherwise, call \`write_to_file\` with \`TargetFile: "${sessionPreviewTarget}"\` and complete, 100% functional production HTML/CSS/JS inside \`CodeContent\`.
   - Enforce Domain Design Craft: load domain-matched Google Fonts (ban Inter/Roboto), keep Top Bar strictly 3 zones on 1 line, zero-pill static metadata, 60-30-10 color balance, real \`generate_image\` hero/card visuals (never placeholder.com), working interactive JS for every button/filter/modal/form, and complete closing \`</body></html>\`.
   - Nexus AI automatically injects PWA manifest, service worker, error bridge & visual element picker, and renders it in Live Preview immediately.

2. Track B — Multi-File React + Vite / Full-Stack Isolated Workspace Mode:
   - When asked for a multi-page React app, multi-component SaaS, or full-stack website with Express backend/database:
   - Call \`workspace_init\` with \`template: "react-vite"\` or \`"fullstack-express"\` to scaffold \`workspaces/<sessionId>/\`, write modular files inside \`workspaces/<sessionId>/\`, and call \`workspace_run(action: "start")\` so it previews live via \`/w/<sessionId>/\` without risking Nexus's own code.

3. Repository & Codebase Coding Mode:
   - When asked to clone repos, modify Nexus source code, debug errors, or inspect files:
   - Execute real workspace tools (\`ast_context_ranker\`, \`read_skill\`, \`omo_coordinate\`, \`read_multiple_files\`, \`code_execution_sandbox\`, \`debug_error_analysis\`, \`verify_live_preview\`, \`visual_qa_review\`, \`compute_file_diff\`, \`grep_search\`, \`find_by_name\`, \`view_file\`, \`write_to_file\`, \`replace_file_content\`, \`multi_replace_file_content\`, \`run_command\`, \`install_applet_package\`, \`compile_applet\`, \`lint_applet\`, \`restart_dev_server\`, \`ask_question\`, \`set_up_firebase\`, \`deploy_firebase\`, \`set_up_oauth\`, \`cloudsql_execute_sql\`, \`figma_import\`, \`focus_mode\`, \`schedule\`).

================================================================================
# LANGUAGE & PRESENTATION
================================================================================
- Respond in Bengali (বাংলা) if the user writes in Bengali, or English if in English.
- Action over talk: call tools directly instead of saying what tool you will call next.
- Provide concise, scannable completion summaries without pasting source files into chat.`;
}

export function inferWebsiteDesignBrief(promptText: string, sessionId?: string): string | null {
  const lower = (promptText || '').toLowerCase();
  const isWebsiteRequest = /(website|web\s*app|landing\s*page|ecommerce|e-commerce|store|shop|dashboard|portfolio|saas|agency|blog|restaurant|cafe|hospital|clinic|school|lms|game|pwa|redesign|ui|ওয়েবসাইট|ওয়েবসাইট|ল্যান্ডিং|পোর্টফোলিও|ড্যাশবোর্ড|ই-কমার্স|দোকান|স্টোর|অ্যাপ|গেম)/i.test(lower);
  if (!isWebsiteRequest) return null;

  const isBengali = /[\u0980-\u09FF]/.test(promptText);
  let domain = 'Modern SaaS / Brand Landing';
  let fonts = isBengali
    ? 'Hind Siliguri + Plus Jakarta Sans + JetBrains Mono'
    : 'Outfit + DM Sans + JetBrains Mono';
  let palette = 'Crisp off-white/slate neutral canvas (60%), subtle hairline structural cards (30%), focused cobalt/emerald CTA accent (10%)';
  let sections = '3-zone single-line header, asymmetric editorial hero + visual proof, 3-4 interactive feature/catalog sections with live filtering, real modal/form state, clean footer';

  if (/(ecommerce|e-commerce|store|shop|fashion|product|cart|checkout|ই-কমার্স|স্টোর|দোকান|শপ)/i.test(lower)) {
    domain = 'E-Commerce & Retail Storefront';
    fonts = isBengali ? 'Hind Siliguri + Fraunces + DM Sans' : 'Fraunces + DM Sans + JetBrains Mono (tabular-nums)';
    palette = 'Warm alabaster/chalk canvas or deep espresso dark canvas with crisp product photography and single high-contrast accent CTA';
    sections = '3-zone nav + interactive category filter + searchable product grid + live slide-over Cart Drawer (qty +/-, subtotal, coupon, checkout modal) + trust/reviews';
  } else if (/(dashboard|analytics|admin|crm|fintech|saas|kanban|tracker|ড্যাশবোর্ড)/i.test(lower)) {
    domain = 'SaaS & Analytics Dashboard';
    fonts = isBengali ? 'Hind Siliguri + Plus Jakarta Sans + JetBrains Mono' : 'Plus Jakarta Sans + DM Sans + JetBrains Mono (tabular-nums)';
    palette = 'Deep slate-950 or crisp slate-50 neutral surface (60%), subtle 1px bordered panels (30%), disciplined 10% action accent';
    sections = 'Sidebar or clean top nav, 4-KPI tabular strip, interactive date/category filters + SVG/Canvas chart, sortable/searchable data table, action drawer/modal';
  } else if (/(portfolio|agency|photographer|creative|architect|studio|পোর্টফোলিও|এজেন্সি)/i.test(lower)) {
    domain = 'Editorial Portfolio / Studio';
    fonts = isBengali ? 'Hind Siliguri + Playfair Display + Manrope' : 'Playfair Display + Manrope';
    palette = 'Gallery editorial neutral (warm stone/charcoal), high-contrast serif display headings with text-wrap:balance, unboxed "·" metadata';
    sections = 'Minimalist 3-zone bar, bold typographic hero + showcase visual, filterable case-study grid with lightbox detail modal, direct contact form';
  } else if (/(game|arcade|puzzle|snake|chess|quiz|গেম)/i.test(lower)) {
    domain = 'Interactive Web Game';
    fonts = isBengali ? 'Hind Siliguri + Outfit + JetBrains Mono' : 'Outfit + JetBrains Mono (tabular-nums)';
    palette = 'High-contrast dark arcade canvas with crisp vector/canvas sprites and zero clutter around the playfield';
    sections = 'Compact HUD bar (Score/Best/Level/Sound toggle), responsive HTML5 Canvas + keyboard & mobile touch D-pad/controls, Start/Pause/Game Over overlay + localStorage high score';
  }

  const wantsReactMultiFile = /(react|vite|multi-file|multi-page|fullstack|full-stack|backend|express|database|postgres|sqlite|ফুল-স্ট্যাক|মাল্টি-ফাইল|রিঅ্যাক্ট)/i.test(lower);
  const safeId = (sessionId || 'app').replace(/[^a-zA-Z0-9_-]/g, '_');
  const architectureTrack = wantsReactMultiFile
    ? `Multi-File React/Full-Stack Track: call workspace_init(sessionId: "${safeId}", template: "${/(fullstack|full-stack|backend|express|database|postgres|sqlite|ফুল-স্ট্যাক)/i.test(lower) ? 'fullstack-express' : 'react-vite'}"), write modular files in workspaces/${safeId}/, then run workspace_run(action: "start").`
    : `Standalone Website Track: write complete production HTML/CSS/JS to projects/${sessionId ? `${safeId}/` : ''}index.html (or upgrade to workspace_init(template: "react-vite") if modular multi-file architecture is needed).`;

  return `[DOMAIN DESIGN & ARCHITECTURE BRIEF]:
- Detected Domain: ${domain}
- Typography Pairing (load via Google Fonts; avoid Inter/Roboto): ${fonts}
- Palette Discipline (60-30-10): ${palette}
- Required Structure: ${sections}
- Architecture Target: ${architectureTrack}
- Media & Integrity: Generate bespoke visuals with generate_image (never placeholder.com), ensure every button/tab/filter/form executes real state changes, apply clean unboxed "·" metadata (no pill spam), and close all tags cleanly through </body></html>.`;
}

export const NEXUS_PREVIEW_BRIDGE_SCRIPT = `
  <!-- Nexus Runtime Error & Visual Element Picker Bridge (Auto-injected by Nexus AI) -->
  <script>
    (function() {
      if (!window.__nexusErrorBridge) {
        window.__nexusErrorBridge = true;
        function notifyError(payload) {
          try {
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'nexus-preview-error', payload: payload }, '*');
            }
          } catch (e) {}
        }
        window.addEventListener('error', function(event) {
          notifyError({
            message: event.message || 'Runtime script error',
            source: event.filename || '',
            line: event.lineno || 0,
            col: event.colno || 0
          });
        });
        window.addEventListener('unhandledrejection', function(event) {
          var reason = event.reason;
          notifyError({
            message: (reason && reason.message) ? reason.message : String(reason || 'Unhandled Promise Rejection'),
            source: 'Promise',
            line: 0,
            col: 0
          });
        });
      }

      if (!window.__nexusElementPicker) {
        window.__nexusElementPicker = true;
        var pickerActive = false;
        var overlay = null;
        var labelBox = null;

        function ensureOverlay() {
          if (overlay) return;
          overlay = document.createElement('div');
          overlay.id = '__nexus-picker-overlay';
          overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #6366f1;background:rgba(99,102,241,0.12);border-radius:4px;transition:all 60ms ease-out;display:none;';
          labelBox = document.createElement('div');
          labelBox.style.cssText = 'position:absolute;top:-22px;left:0;background:#4f46e5;color:#fff;font:600 11px/1.2 ui-monospace,monospace;padding:3px 6px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.35);';
          overlay.appendChild(labelBox);
          (document.body || document.documentElement).appendChild(overlay);
        }

        function computeSelector(el) {
          if (!el || el.nodeType !== 1) return '';
          if (el.id) return '#' + CSS.escape(el.id);
          var parts = [];
          var curr = el;
          while (curr && curr.nodeType === 1 && curr !== document.body && parts.length < 4) {
            var seg = curr.tagName.toLowerCase();
            if (curr.id) {
              parts.unshift('#' + CSS.escape(curr.id));
              break;
            }
            var cls = typeof curr.className === 'string'
              ? curr.className.trim().split(/\\s+/).filter(function(c){ return c && !c.includes(':') && !c.includes('[') && c.length < 28; }).slice(0, 2)
              : [];
            if (cls.length) seg += '.' + cls.map(function(c){ return CSS.escape(c); }).join('.');
            else if (curr.parentElement) {
              var sibs = Array.from(curr.parentElement.children).filter(function(s){ return s.tagName === curr.tagName; });
              if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(curr) + 1) + ')';
            }
            parts.unshift(seg);
            curr = curr.parentElement;
          }
          return parts.join(' > ') || el.tagName.toLowerCase();
        }

        function onMove(e) {
          if (!pickerActive) return;
          var target = e.target;
          if (!target || target === overlay || target === labelBox || target === document.documentElement) return;
          ensureOverlay();
          var r = target.getBoundingClientRect();
          overlay.style.display = 'block';
          overlay.style.left = r.left + 'px';
          overlay.style.top = r.top + 'px';
          overlay.style.width = Math.max(4, r.width) + 'px';
          overlay.style.height = Math.max(4, r.height) + 'px';
          labelBox.textContent = computeSelector(target).slice(0, 48);
        }

        function onClick(e) {
          if (!pickerActive) return;
          var target = e.target;
          if (!target || target === overlay || target === labelBox) return;
          e.preventDefault();
          e.stopPropagation();
          pickerActive = false;
          document.documentElement.style.cursor = '';
          if (overlay) overlay.style.display = 'none';
          var selector = computeSelector(target);
          var textPreview = (target.innerText || target.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
          var htmlSnippet = (target.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 240);
          try {
            window.parent.postMessage({
              type: 'nexus-element-selected',
              payload: {
                selector: selector,
                tagName: target.tagName.toLowerCase(),
                textPreview: textPreview,
                htmlSnippet: htmlSnippet
              }
            }, '*');
          } catch (err) {}
        }

        window.addEventListener('message', function(event) {
          if (event.data && event.data.type === 'nexus-toggle-picker') {
            pickerActive = Boolean(event.data.enabled);
            document.documentElement.style.cursor = pickerActive ? 'crosshair' : '';
            if (!pickerActive && overlay) overlay.style.display = 'none';
          }
        });
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('click', onClick, true);
      }
    })();
  </script>
`;

/**
 * Enriches HTML with PWA meta tags/service worker and writes it to both
 * global projects/ and the active session directory for immediate Live Preview.
 */
export async function deployHtmlFile(
  rawHtml: string,
  sessionId?: string
): Promise<DeployResult> {
  try {
    let htmlContent = (rawHtml || '').trim();
    if (!htmlContent || htmlContent.length < 30 || !htmlContent.includes('<')) {
      return { success: false };
    }

    if (!htmlContent.toLowerCase().includes('<!doctype html>')) {
      htmlContent = `<!DOCTYPE html>\n${htmlContent}`;
    }

    // Extract title and theme color for PWA Manifest
    const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
    const rawTitle = titleMatch ? titleMatch[1].trim() : 'Nexus Web App';
    const appTitle = rawTitle.replace(/[|•-].*$/, '').trim() || 'Nexus App';
    const appShortName = appTitle.slice(0, 14).trim() || 'NexusApp';

    const themeColorMatch = htmlContent.match(/<meta\s+name=["']theme-color["']\s+content=["']([^"']+)["']/i);
    const themeColor = themeColorMatch ? themeColorMatch[1] : '#4f46e5';

    // Enrich HTML with PWA meta tags & Service Worker if missing
    let enrichedHtml = htmlContent;

    // Check if manifest link is present
    if (!enrichedHtml.includes('manifest.webmanifest') && !enrichedHtml.includes('manifest.json')) {
      const headIndex = enrichedHtml.indexOf('</head>');
      if (headIndex !== -1) {
        const pwaMetaTags = `
  <!-- PWA & Mobile Meta Tags (Auto-injected by Nexus AI) -->
  <link rel="manifest" href="manifest.webmanifest" />
  <meta name="theme-color" content="${themeColor}" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <link rel="apple-touch-icon" href="/icon.svg" />
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
`;
        enrichedHtml = enrichedHtml.slice(0, headIndex) + pwaMetaTags + enrichedHtml.slice(headIndex);
      }
    }

    // Check if Service Worker registration is present
    if (!enrichedHtml.includes('serviceWorker.register')) {
      const bodyCloseIndex = enrichedHtml.lastIndexOf('</body>');
      const swRegisterScript = `
  <!-- PWA Service Worker Registration & Install Prompt (Auto-injected by Nexus AI) -->
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function() {
        navigator.serviceWorker.register('./sw.js').then(function(reg) {
          console.log('Nexus PWA Service Worker registered:', reg.scope);
        }).catch(function(err) {
          console.log('SW registration note:', err);
        });
      });
    }

    // Global PWA Install Prompt Listener
    let deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      deferredInstallPrompt = e;
      window.dispatchEvent(new CustomEvent('pwa-installable'));
      var installBtn = document.getElementById('nexus-pwa-install-btn');
      if (installBtn) installBtn.style.display = 'inline-flex';
    });

    window.triggerPWAInstall = function() {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function(choice) {
          if (choice.outcome === 'accepted') {
            console.log('User accepted PWA installation');
          }
          deferredInstallPrompt = null;
        });
      } else {
        alert('অ্যাপটি ইনস্টল করতে ব্রাউজারের শেয়ার বা মেনু থেকে "Add to Home Screen" বা "Install" নির্বাচন করুন।');
      }
    };
  </script>
`;
      if (bodyCloseIndex !== -1) {
        enrichedHtml = enrichedHtml.slice(0, bodyCloseIndex) + swRegisterScript + enrichedHtml.slice(bodyCloseIndex);
      } else {
        enrichedHtml += swRegisterScript;
      }
    }

    // Inject lightweight Runtime Error + Visual Element Picker Bridge for Nexus Live Preview inspection
    if (!enrichedHtml.includes('__nexusElementPicker')) {
      const runtimeBridgeScript = NEXUS_PREVIEW_BRIDGE_SCRIPT;
      const headOpenClose = enrichedHtml.indexOf('</head>');
      if (headOpenClose !== -1) {
        enrichedHtml = enrichedHtml.slice(0, headOpenClose) + runtimeBridgeScript + enrichedHtml.slice(headOpenClose);
      } else {
        enrichedHtml = runtimeBridgeScript + enrichedHtml;
      }
    }

    // Create standard PWA Manifest JSON
    const manifestContent = JSON.stringify({
      id: './',
      name: appTitle,
      short_name: appShortName,
      description: `${appTitle} - Progressive Web Application built with Nexus AI`,
      start_url: './index.html',
      scope: './',
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: '#020617',
      theme_color: themeColor,
      icons: [
        {
          src: '/icon.svg',
          sizes: '192x192 512x512',
          type: 'image/svg+xml',
          purpose: 'any maskable'
        },
        {
          src: '/pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any'
        },
        {
          src: '/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any'
        }
      ]
    }, null, 2);

    // Create resilient Service Worker script
    const swContent = `// Nexus PWA Service Worker (Auto-generated by Nexus AI)
const CACHE_NAME = 'nexus-pwa-${Date.now()}';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('Pre-caching assets:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Network-first with cache fallback for HTML documents; Cache-first for static resources
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((res) => res || caches.match('./index.html')))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
          }
          return response;
        }).catch(() => null);
      })
    );
  }
});
`;

    const projectsDir = path.resolve(process.cwd(), 'projects');
    await fs.mkdir(projectsDir, { recursive: true });

    // Always deploy to global projects/
    await fs.writeFile(path.join(projectsDir, 'index.html'), enrichedHtml, 'utf-8');
    await fs.writeFile(path.join(projectsDir, 'manifest.webmanifest'), manifestContent, 'utf-8');
    await fs.writeFile(path.join(projectsDir, 'sw.js'), swContent, 'utf-8');

    let targetUrl = '/projects/index.html';
    let targetPath = 'projects/index.html';

    // If chat session ID provided, deploy to chat session folder
    if (sessionId) {
      const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const sessionDir = path.join(projectsDir, safeSessionId);
      await fs.mkdir(sessionDir, { recursive: true });

      await fs.writeFile(path.join(sessionDir, 'index.html'), enrichedHtml, 'utf-8');
      await fs.writeFile(path.join(sessionDir, 'manifest.webmanifest'), manifestContent, 'utf-8');
      await fs.writeFile(path.join(sessionDir, 'sw.js'), swContent, 'utf-8');

      targetUrl = `/projects/${safeSessionId}/index.html`;
      targetPath = `projects/${safeSessionId}/index.html`;
    }

    return { 
      success: true, 
      html: enrichedHtml, 
      path: targetPath, 
      url: targetUrl,
      isPWA: true
    };
  } catch (err) {
    console.warn("Failed to deploy HTML and PWA files:", err);
    return { success: false };
  }
}

/**
 * Extracts and deploys complete websites and PWA companion files (manifest, service worker)
 * from text output as a fallback if the model wrote HTML in text instead of calling write_to_file.
 */
export async function autoDeployWebsiteFromText(
  text: string, 
  sessionId?: string
): Promise<DeployResult> {
  try {
    let htmlContent = '';
    
    // 1. Check for ```html ... ``` block
    const codeBlockMatch = text.match(/```(?:html|htm)\s*([\s\S]*?)```/i);
    if (codeBlockMatch && codeBlockMatch[1] && codeBlockMatch[1].includes('<')) {
      htmlContent = codeBlockMatch[1].trim();
    }
    
    // 2. Check for <!DOCTYPE html ... </html>
    if (!htmlContent) {
      const docMatch = text.match(/(<!DOCTYPE\s+html[\s\S]*?<\/html>)/i);
      if (docMatch && docMatch[1]) {
        htmlContent = docMatch[1].trim();
      }
    }

    // 3. Check for <html ... </html>
    if (!htmlContent) {
      const htmlMatch = text.match(/(<html[\s\S]*?<\/html>)/i);
      if (htmlMatch && htmlMatch[1]) {
        htmlContent = `<!DOCTYPE html>\n${htmlMatch[1].trim()}`;
      }
    }

    if (!htmlContent || htmlContent.length < 50) {
      return { success: false };
    }

    return await deployHtmlFile(htmlContent, sessionId);
  } catch (err) {
    console.warn("Failed to auto-deploy website from text:", err);
    return { success: false };
  }
}

export interface InlineImageAttachment {
  mimeType: string;
  data: string; // base64 without data: prefix
  dataUrl?: string;
}

export interface SanitizedGeminiChatInput {
  history: { role: 'user' | 'model'; parts: any[] }[];
  lastMessage: string;
  lastMessageImages: InlineImageAttachment[];
}

function parseDataUrlToInlineImage(dataUrl?: string): InlineImageAttachment | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
    dataUrl,
  };
}

/**
 * Sanitize chat messages for @google/genai to prevent empty/uninitialized data oneof field errors.
 * Preserves attached vision images (screenshots / Figma mockups) for multimodal free-tier models.
 */
export function prepareGeminiHistoryAndLastMessage(messages: any[]): SanitizedGeminiChatInput {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      history: [],
      lastMessage: "Hello! Please assist me.",
      lastMessageImages: [],
    };
  }

  const rawCleaned: { role: 'user' | 'model'; text: string; images: InlineImageAttachment[] }[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    const role: 'user' | 'model' = m.role === 'model' ? 'model' : 'user';

    let text = '';
    const images: InlineImageAttachment[] = [];

    if (Array.isArray(m.parts)) {
      for (const p of m.parts) {
        if (typeof p === 'string' && p.trim()) {
          text += (text ? '\n' : '') + p.trim();
        } else if (p && typeof p.text === 'string' && p.text.trim()) {
          text += (text ? '\n' : '') + p.text.trim();
        } else if (p?.inlineData?.data && p?.inlineData?.mimeType) {
          images.push({
            mimeType: p.inlineData.mimeType,
            data: p.inlineData.data,
            dataUrl: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,
          });
        }
      }
    } else if (typeof m.content === 'string' && m.content.trim()) {
      text = m.content.trim();
    } else if (typeof m.text === 'string' && m.text.trim()) {
      text = m.text.trim();
    }

    // Also inspect attached imageDataUrl / attachments on message object
    if (typeof m.imageDataUrl === 'string') {
      const parsed = parseDataUrlToInlineImage(m.imageDataUrl);
      if (parsed) images.push(parsed);
    }
    if (Array.isArray(m.attachments)) {
      for (const att of m.attachments) {
        const parsed = parseDataUrlToInlineImage(att?.dataUrl || att);
        if (parsed) images.push(parsed);
      }
    }

    if (!text.trim()) {
      if (images.length > 0) {
        text = 'Please inspect the attached screenshot/design image and implement or fix what is shown.';
      } else if (m.imageUrl) {
        text = `[Attached Image: ${m.imageUrl}]`;
      } else if (role === 'model') {
        text = 'Code and architecture implemented.';
      } else {
        text = 'Please proceed with implementation.';
      }
    }

    rawCleaned.push({ role, text: text.trim(), images });
  }

  if (rawCleaned.length === 0) {
    return {
      history: [],
      lastMessage: "Hello! Please assist me.",
      lastMessageImages: [],
    };
  }

  const lastTurn = rawCleaned.pop()!;
  let lastMessage = lastTurn.text;
  const lastMessageImages = [...lastTurn.images];

  const history: { role: 'user' | 'model'; parts: any[] }[] = [];

  for (const item of rawCleaned) {
    const parts: any[] = [{ text: item.text }];
    // Only attach inlineData for recent turns so history stays lean on free APIs
    if (history.length === 0) {
      history.push({ role: item.role, parts });
    } else {
      const prev = history[history.length - 1];
      if (prev.role === item.role) {
        prev.parts[0].text += '\n\n' + item.text;
      } else {
        history.push({ role: item.role, parts });
      }
    }
  }

  if (history.length > 0 && history[history.length - 1].role === 'user') {
    const trailingUser = history.pop()!;
    lastMessage = trailingUser.parts[0].text + '\n\n' + lastMessage;
  }

  if (history.length > 0 && history[0].role === 'model') {
    history.unshift({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  return {
    history,
    lastMessage: lastMessage.trim() || 'Please proceed with the task.',
    lastMessageImages,
  };
}
