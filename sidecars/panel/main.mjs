import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || join(HERE, '.data');
const STATE_FILE = join(DATA_DIR, 'state.json');

const app = new SidecarApp();

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

const readLocal = (name) => readFileSync(join(HERE, name), 'utf8');

app.page('/', () => readLocal('index.html'));
app.page('/open', () => readLocal('index.html'));
app.page('/viewer', () => readLocal('index.html'));
app.page('/app.js', () => readLocal('app.js'));
app.api('/styles.css', () => new Response(readLocal('styles.css'), { contentType: 'text/css' }), 'GET');

// Cache large libraries in memory
let cachedPdfJs = null;
let cachedWorker = null;

app.page('/lib/pdf.js', () => {
  if (!cachedPdfJs) {
    cachedPdfJs = readLocal('lib/pdf.js');
  }
  return cachedPdfJs;
});

app.page('/lib/pdf.worker.js', () => {
  if (!cachedWorker) {
    cachedWorker = readLocal('lib/pdf.worker.js');
  }
  return cachedWorker;
});

// ---------------------------------------------------------------------------
// APIs
// ---------------------------------------------------------------------------

app.api('/api/status', () => ({ ok: true, version: '1.0.0' }), 'GET');

app.api('/api/get-state', () => {
  if (!existsSync(STATE_FILE)) return { lastOpenedPath: null };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastOpenedPath: null };
  }
}, 'GET');

app.api('/api/save-state', (data) => {
  mkdirSync(DATA_DIR, { recursive: true });
  const state = { lastOpenedPath: data?.lastOpenedPath || null, savedAt: Date.now() };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  return state;
});

app.api('/api/workspace-pdfs', (data) => {
  const uris = Array.isArray(data?.workspaceUris) ? data.workspaceUris : [];
  const results = [];

  for (const uri of uris) {
    let folderPath = uri;
    try {
      if (uri.startsWith('file://')) {
        folderPath = fileURLToPath(uri);
      } else {
        folderPath = decodeURIComponent(uri);
      }
    } catch {
      continue;
    }
    const found = findPdfs(folderPath, 5, 0);
    results.push(...found);
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
});

app.api('/api/load-pdf', (data) => {
  let targetPath = data?.path;
  if (!targetPath) return { success: false, error: 'No path specified' };

  try {
    if (targetPath.startsWith('file://')) {
      targetPath = fileURLToPath(targetPath);
    } else {
      targetPath = decodeURIComponent(targetPath);
    }

    if (!existsSync(targetPath)) {
      // If relative, check against workspace URIs
      const uris = Array.isArray(data?.workspaceUris) ? data.workspaceUris : [];
      for (const uri of uris) {
        try {
          const base = uri.startsWith('file://') ? fileURLToPath(uri) : decodeURIComponent(uri);
          const candidate = join(base, targetPath);
          if (existsSync(candidate)) {
            targetPath = candidate;
            break;
          }
        } catch {}
      }
    }

    if (!existsSync(targetPath)) {
      return { success: false, error: `File not found: ${targetPath}` };
    }
    const stat = statSync(targetPath);
    if (!stat.isFile()) {
      return { success: false, error: 'Path is not a regular file' };
    }

    const buffer = readFileSync(targetPath);
    return {
      success: true,
      name: basename(targetPath),
      path: targetPath,
      base64: buffer.toString('base64'),
      size: buffer.length,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

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
  } catch {
    // Ignore permission or unreadable errors
  }
  return pdfs;
}

app.run();
