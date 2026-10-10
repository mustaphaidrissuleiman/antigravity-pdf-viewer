// PDF Viewer Frontend for Antigravity Side Panel
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.js';
}

// Elements
const fileInput = document.getElementById('fileInput');
const workspaceSelect = document.getElementById('workspaceSelect');
const docToolbar = document.getElementById('docToolbar');
const docNameEl = document.getElementById('docName');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageNumInput = document.getElementById('pageNumInput');
const pageCountEl = document.getElementById('pageCount');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomLevelText = document.getElementById('zoomLevelText');
const fitWidthBtn = document.getElementById('fitWidthBtn');
const modeToggleBtn = document.getElementById('modeToggleBtn');
const askAgentBtn = document.getElementById('askAgentBtn');
const emptyState = document.getElementById('emptyState');
const dropzone = document.getElementById('dropzone');
const workspaceList = document.getElementById('workspaceList');
const workspaceItems = document.getElementById('workspaceItems');
const pagesContainer = document.getElementById('pagesContainer');
const loadingOverlay = document.getElementById('loadingOverlay');
const toastEl = document.getElementById('toast');

// State
let currentDoc = null;
let currentDocName = '';
let currentDocPath = null;
let currentPageNum = 1;
let currentScale = 1.0;
let isContinuous = false;
let isRendering = false;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function init() {
  setupEventListeners();
  await loadWorkspacePdfs();

  // Try to restore last opened PDF if available
  try {
    const res = await window.sidecar?.fetch?.('/api/get-state', { method: 'GET' });
    const state = await res?.json?.();
    if (state?.lastOpenedPath) {
      await loadPdfByPath(state.lastOpenedPath, false);
    }
  } catch (err) {
    console.debug('Could not load previous state', err);
  }
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------

function setupEventListeners() {
  // File input picker
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = '';
  });

  // Drag & drop
  dropzone.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover'].forEach((type) => {
    window.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((type) => {
    window.addEventListener(type, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type === 'application/pdf') {
      loadFile(file);
    } else if (file) {
      showToast('Please drop a valid .pdf file');
    }
  });

  // Navigation
  prevPageBtn.addEventListener('click', () => changePage(currentPageNum - 1));
  nextPageBtn.addEventListener('click', () => changePage(currentPageNum + 1));

  pageNumInput.addEventListener('change', () => {
    const num = parseInt(pageNumInput.value, 10);
    if (!isNaN(num)) changePage(num);
  });

  // Zoom
  zoomInBtn.addEventListener('click', () => setScale(currentScale + 0.2));
  zoomOutBtn.addEventListener('click', () => setScale(Math.max(0.4, currentScale - 0.2)));
  fitWidthBtn.addEventListener('click', fitToWidth);

  // Mode toggle
  modeToggleBtn.addEventListener('click', () => {
    isContinuous = !isContinuous;
    modeToggleBtn.textContent = isContinuous ? 'Scroll' : 'Single';
    renderView();
  });

  // Workspace dropdown selector
  workspaceSelect.addEventListener('change', (e) => {
    const path = e.target.value;
    if (path) loadPdfByPath(path);
  });

  // Ask agent integration
  askAgentBtn.addEventListener('click', () => {
    if (!currentDoc) return;
    const msg = currentDocPath
      ? `Please review the document at "${currentDocPath}". Summarize its key points and structure.`
      : `I've opened "${currentDocName}". Could you help me analyze its contents?`;

    if (window.sidecar?.agent?.sendMessage && window.sidecar?.conversationId) {
      window.sidecar.agent.sendMessage(msg);
      showToast('Prompt sent to Antigravity conversation!');
    } else {
      showToast('Active conversation required to chat with agent.');
    }
  });

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') changePage(currentPageNum - 1);
    if (e.key === 'ArrowRight') changePage(currentPageNum + 1);
    if (e.key === '+' || e.key === '=') setScale(currentScale + 0.2);
    if (e.key === '-') setScale(Math.max(0.4, currentScale - 0.2));
  });

  // Listen for workspace folder changes from host
  if (window.sidecar?.onWorkspaceChange) {
    window.sidecar.onWorkspaceChange(() => loadWorkspacePdfs());
  }
}

// ---------------------------------------------------------------------------
// Loading PDFs
// ---------------------------------------------------------------------------

async function loadFile(file) {
  showLoading(true);
  try {
    const arrayBuffer = await file.arrayBuffer();
    await displayPdfData(new Uint8Array(arrayBuffer), file.name, null);
  } catch (err) {
    showToast(`Error opening PDF: ${err.message}`);
  } finally {
    showLoading(false);
  }
}

async function loadPdfByPath(path, notify = true) {
  showLoading(true);
  try {
    const res = await window.sidecar?.fetch?.('/api/load-pdf', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    const data = await res?.json?.();

    if (!data?.success) {
      if (notify) showToast(data?.error || 'Could not load PDF');
      return;
    }

    const binary = atob(data.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    await displayPdfData(bytes, data.name, data.path);

    // Save as last opened
    window.sidecar?.fetch?.('/api/save-state', {
      method: 'POST',
      body: JSON.stringify({ lastOpenedPath: data.path }),
    });
  } catch (err) {
    if (notify) showToast(`Failed to load file: ${err.message}`);
  } finally {
    showLoading(false);
  }
}

async function displayPdfData(uint8Array, name, path) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js library is not loaded');
  }

  const doc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
  currentDoc = doc;
  currentDocName = name;
  currentDocPath = path;
  currentPageNum = 1;

  // Update UI headers
  docNameEl.textContent = name;
  docNameEl.title = path || name;
  pageCountEl.textContent = doc.numPages;
  pageNumInput.max = doc.numPages;
  pageNumInput.value = 1;

  // Show toolbar & pages, hide empty state
  emptyState.hidden = true;
  docToolbar.hidden = false;
  pagesContainer.hidden = false;

  // Initial fit width
  await fitToWidth();
}

// ---------------------------------------------------------------------------
// Rendering View
// ---------------------------------------------------------------------------

async function renderView() {
  if (!currentDoc || isRendering) return;
  isRendering = true;
  pagesContainer.innerHTML = '';

  try {
    if (isContinuous) {
      // Continuous vertical scroll mode
      for (let i = 1; i <= currentDoc.numPages; i++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'canvas-wrapper';
        const canvas = document.createElement('canvas');
        canvas.id = `page-canvas-${i}`;
        wrapper.appendChild(canvas);
        pagesContainer.appendChild(wrapper);
        await renderSinglePage(i, canvas);
      }
    } else {
      // Single page mode
      const wrapper = document.createElement('div');
      wrapper.className = 'canvas-wrapper';
      const canvas = document.createElement('canvas');
      canvas.id = `page-canvas-${currentPageNum}`;
      wrapper.appendChild(canvas);
      pagesContainer.appendChild(wrapper);
      await renderSinglePage(currentPageNum, canvas);
    }
  } finally {
    isRendering = false;
  }
}

async function renderSinglePage(pageNumber, canvas) {
  const page = await currentDoc.getPage(pageNumber);
  const pixelRatio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: currentScale });

  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(pixelRatio, pixelRatio);

  await page.render({
    canvasContext: ctx,
    viewport: viewport,
  }).promise;
}

// ---------------------------------------------------------------------------
// Controls (Page, Zoom)
// ---------------------------------------------------------------------------

function changePage(num) {
  if (!currentDoc) return;
  const target = Math.max(1, Math.min(num, currentDoc.numPages));
  if (target === currentPageNum && !isContinuous) return;

  currentPageNum = target;
  pageNumInput.value = target;

  if (isContinuous) {
    const targetCanvas = document.getElementById(`page-canvas-${target}`);
    targetCanvas?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    renderView();
  }
}

function setScale(scale) {
  currentScale = Math.round(scale * 10) / 10;
  zoomLevelText.textContent = `${Math.round(currentScale * 100)}%`;
  renderView();
}

async function fitToWidth() {
  if (!currentDoc) return;
  const page = await currentDoc.getPage(currentPageNum);
  const containerWidth = document.getElementById('viewerContainer').clientWidth - 48;
  const baseViewport = page.getViewport({ scale: 1.0 });
  const scale = containerWidth / baseViewport.width;
  setScale(Math.max(0.4, scale));
}

// ---------------------------------------------------------------------------
// Workspace PDF Discovery
// ---------------------------------------------------------------------------

async function loadWorkspacePdfs() {
  try {
    const uris = (await window.sidecar?.getWorkspaceUris?.()) || [];
    if (!uris.length) return;

    const res = await window.sidecar?.fetch?.('/api/workspace-pdfs', {
      method: 'POST',
      body: JSON.stringify({ workspaceUris: uris }),
    });
    const data = await res?.json?.();
    const pdfs = data?.pdfs || [];

    if (pdfs.length > 0) {
      // Populate select dropdown
      workspaceSelect.innerHTML = '<option value="" disabled selected>Workspace PDFs...</option>';
      pdfs.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.path;
        opt.textContent = p.name;
        workspaceSelect.appendChild(opt);
      });
      workspaceSelect.hidden = false;

      // Populate empty-state list
      workspaceItems.innerHTML = '';
      pdfs.slice(0, 5).forEach((p) => {
        const btn = document.createElement('button');
        btn.className = 'pdf-item-btn';
        btn.innerHTML = `
          <span class="pdf-item-name">${escapeHtml(p.name)}</span>
          <span class="pdf-item-size">${formatBytes(p.size)}</span>
        `;
        btn.addEventListener('click', () => loadPdfByPath(p.path));
        workspaceItems.appendChild(btn);
      });
      workspaceList.hidden = false;
    }
  } catch (err) {
    console.debug('Failed to list workspace PDFs', err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showLoading(show) {
  loadingOverlay.hidden = !show;
}

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 3000);
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[tag] || tag));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// Kickoff
init();
