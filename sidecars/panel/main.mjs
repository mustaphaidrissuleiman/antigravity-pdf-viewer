import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || join(HERE, '.data');
const STATE_FILE = join(DATA_DIR, 'state.json');

const app = new SidecarApp();

// ---------------------------------------------------------------------------
// Static files & Routes
// ---------------------------------------------------------------------------

const readLocal = (name) => readFileSync(join(HERE, name), 'utf8');

const serveIndex = () => readLocal('index.html');
const serveAppJs = () => readLocal('app.js');
const serveStyles = () => new Response(readLocal('styles.css'), { contentType: 'text/css' });

let cachedPdfJs = null;
let cachedWorker = null;

const servePdfJs = () => {
  if (!cachedPdfJs) cachedPdfJs = readLocal('lib/pdf.js');
  return cachedPdfJs;
};

const serveWorker = () => {
  if (!cachedWorker) cachedWorker = readLocal('lib/pdf.worker.js');
  return cachedWorker;
};

// Root & alternate entrypoints
app.page('/', serveIndex);
app.page('/index.html', serveIndex);
app.page('/open', serveIndex);
app.page('/viewer', serveIndex);
app.page('/panel', serveIndex);
app.page('/panel/', serveIndex);
app.page('/panel/index.html', serveIndex);

// App scripts & styles
app.page('/app.js', serveAppJs);
app.page('/panel/app.js', serveAppJs);

app.api('/styles.css', serveStyles, 'GET');
app.api('/panel/styles.css', serveStyles, 'GET');

// Vendored PDF.js libraries
app.page('/lib/pdf.js', servePdfJs);
app.page('/panel/lib/pdf.js', servePdfJs);

app.page('/lib/pdf.worker.js', serveWorker);
app.page('/panel/lib/pdf.worker.js', serveWorker);

// ---------------------------------------------------------------------------
// Path Resolution Helper
// ---------------------------------------------------------------------------

function searchForPdfByName(dirPath, targetName, maxDepth = 4, currentDepth = 0) {
  if (currentDepth > maxDepth || !existsSync(dirPath)) return null;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') continue;
      const full = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const found = searchForPdfByName(full, targetName, maxDepth, currentDepth + 1);
        if (found) return found;
      } else if (entry.isFile() && entry.name.toLowerCase() === targetName.toLowerCase()) {
        return full;
      }
    }
  } catch {}
  return null;
}

function isPdfFile(filePath) {
  return typeof filePath === 'string' && filePath.toLowerCase().endsWith('.pdf');
}

function resolvePdfPath(inputPath, workspaceUris = []) {
  if (!inputPath || typeof inputPath !== 'string') return null;

  let cleaned = inputPath.trim();

  // Strip wrapping quotes (double, single, backticks)
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
      (cleaned.startsWith('`') && cleaned.endsWith('`'))) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Handle file:// URIs
  if (cleaned.startsWith('file://')) {
    try {
      cleaned = fileURLToPath(cleaned);
    } catch {
      cleaned = cleaned.replace(/^file:\/\//, '');
    }
  }

  // Handle tilde ~
  if (cleaned === '~' || cleaned.startsWith('~/')) {
    cleaned = join(homedir(), cleaned.slice(2));
  }

  // 1. Check raw path directly (must be a PDF)
  if (existsSync(cleaned) && statSync(cleaned).isFile() && isPdfFile(cleaned)) {
    return cleaned;
  }

  // 2. Check URL-decoded path
  try {
    const decoded = decodeURIComponent(cleaned);
    if (existsSync(decoded) && statSync(decoded).isFile() && isPdfFile(decoded)) {
      return decoded;
    }
  } catch {}

  // 3. Candidate base directories
  const candidateBases = [];

  if (Array.isArray(workspaceUris)) {
    for (const uri of workspaceUris) {
      try {
        const p = uri.startsWith('file://') ? fileURLToPath(uri) : decodeURIComponent(uri);
        if (existsSync(p)) candidateBases.push(p);
      } catch {}
    }
  }

  candidateBases.push(process.cwd());
  candidateBases.push(join(homedir(), '.gemini/antigravity/scratch'));
  candidateBases.push(join(homedir(), 'Downloads'));
  candidateBases.push(join(homedir(), 'Documents'));
  candidateBases.push(join(homedir(), 'Desktop'));

  // Test joining with candidate bases
  for (const base of candidateBases) {
    if (!existsSync(base)) continue;
    try {
      const candidate = join(base, cleaned);
      if (existsSync(candidate) && statSync(candidate).isFile() && isPdfFile(candidate)) {
        return candidate;
      }
      const decodedCandidate = join(base, decodeURIComponent(cleaned));
      if (existsSync(decodedCandidate) && statSync(decodedCandidate).isFile() && isPdfFile(decodedCandidate)) {
        return decodedCandidate;
      }
    } catch {}
  }

  // 4. Fuzzy fallback: search by basename in candidate bases
  // Handles cases where spaces or parentheses truncated the markdown link
  const targetBaseName = basename(cleaned);
  if (targetBaseName && isPdfFile(targetBaseName)) {
    for (const base of candidateBases) {
      if (!existsSync(base)) continue;
      const found = searchForPdfByName(base, targetBaseName, 4);
      if (found) return found;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// APIs
// ---------------------------------------------------------------------------

const handleStatus = () => ({ ok: true, version: '1.2.0' });

const handleGetState = () => {
  if (!existsSync(STATE_FILE)) return { lastOpenedPath: null };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastOpenedPath: null };
  }
};

const handleSaveState = (data) => {
  mkdirSync(DATA_DIR, { recursive: true });
  const state = { lastOpenedPath: data?.lastOpenedPath || null, savedAt: Date.now() };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  return state;
};

const handleWorkspacePdfs = (data) => {
  const uris = Array.isArray(data?.workspaceUris) ? data.workspaceUris : [];
  const folders = [];

  for (const uri of uris) {
    try {
      const folderPath = uri.startsWith('file://') ? fileURLToPath(uri) : decodeURIComponent(uri);
      if (existsSync(folderPath)) folders.push(folderPath);
    } catch {}
  }

  // Include known project & scratch folders
  folders.push(join(homedir(), '.gemini/antigravity/scratch'));

  const results = [];
  const checkedFolders = new Set();
  for (const folder of folders) {
    if (checkedFolders.has(folder) || !existsSync(folder)) continue;
    checkedFolders.add(folder);
    results.push(...findPdfs(folder, 4, 0));
  }

  const seen = new Set();
  const unique = [];
  for (const p of results) {
    if (!seen.has(p.path)) {
      seen.add(p.path);
      unique.push(p);
    }
  }
  unique.sort((a, b) => b.mtime - a.mtime);
  return { pdfs: unique };
};

// Binary streaming route for raw PDF content (handles arbitrary file sizes smoothly)
const handleRawPdf = (data) => {
  const resolved = resolvePdfPath(data?.path, data?.workspaceUris);
  if (!resolved || !isPdfFile(resolved)) {
    return new Response(JSON.stringify({ error: `File not found or not a PDF: ${data?.path || ''}` }), {
      contentType: 'application/json',
      status: 404,
    });
  }
  const buffer = readFileSync(resolved);
  return new Response(buffer, {
    contentType: 'application/pdf',
    headers: {
      'Content-Disposition': `inline; filename="${basename(resolved)}"`,
    },
  });
};

const handleLoadPdf = (data) => {
  let inputPath = data?.path;
  if (!inputPath) return { success: false, error: 'No path specified' };

  try {
    const resolved = resolvePdfPath(inputPath, data?.workspaceUris);
    if (!resolved || !isPdfFile(resolved)) {
      return { success: false, error: `File not found or not a PDF: ${inputPath}` };
    }

    const stat = statSync(resolved);
    if (!stat.isFile()) {
      return { success: false, error: 'Path is not a regular file' };
    }

    // Embed base64 for files up to 12MB; larger files stream via /api/raw-pdf
    let base64 = null;
    if (stat.size <= 12 * 1024 * 1024) {
      const buffer = readFileSync(resolved);
      base64 = buffer.toString('base64');
    }

    return {
      success: true,
      name: basename(resolved),
      path: resolved,
      base64,
      size: stat.size,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

// Register API routes for both GET and POST, and for /api/* and /panel/api/*
app.api('/api/status', handleStatus, 'GET');
app.api('/panel/api/status', handleStatus, 'GET');

app.api('/api/get-state', handleGetState, 'GET');
app.api('/panel/api/get-state', handleGetState, 'GET');

app.api('/api/save-state', handleSaveState, 'POST');
app.api('/api/save-state', handleSaveState, 'GET');
app.api('/panel/api/save-state', handleSaveState, 'POST');
app.api('/panel/api/save-state', handleSaveState, 'GET');

app.api('/api/workspace-pdfs', handleWorkspacePdfs, 'GET');
app.api('/api/workspace-pdfs', handleWorkspacePdfs, 'POST');
app.api('/panel/api/workspace-pdfs', handleWorkspacePdfs, 'GET');
app.api('/panel/api/workspace-pdfs', handleWorkspacePdfs, 'POST');

app.api('/api/raw-pdf', handleRawPdf, 'GET');
app.api('/panel/api/raw-pdf', handleRawPdf, 'GET');

app.api('/api/load-pdf', handleLoadPdf, 'GET');
app.api('/api/load-pdf', handleLoadPdf, 'POST');
app.api('/panel/api/load-pdf', handleLoadPdf, 'GET');
app.api('/panel/api/load-pdf', handleLoadPdf, 'POST');

function findPdfs(dirPath, maxDepth, currentDepth) {
  const pdfs = [];
  if (currentDepth > maxDepth || !existsSync(dirPath)) return pdfs;

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor') {
        continue;
      }
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        pdfs.push(...findPdfs(fullPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        const s = statSync(fullPath);
        pdfs.push({
          name: entry.name,
          path: fullPath,
          size: s.size,
          mtime: s.mtimeMs,
        });
      }
    }
  } catch {}
  return pdfs;
}

app.run();
