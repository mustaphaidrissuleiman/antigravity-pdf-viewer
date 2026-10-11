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
const agentPromptDrawer = document.getElementById('agentPromptDrawer');
const promptDocName = document.getElementById('promptDocName');
const closePromptDrawerBtn = document.getElementById('closePromptDrawerBtn');
const agentPromptInput = document.getElementById('agentPromptInput');
const submitPromptBtn = document.getElementById('submitPromptBtn');
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
// Initialization & URL Detection
// ---------------------------------------------------------------------------

async function checkUrlParams() {
  try {
    const url = new URL(window.location.href);
    let fileParam = url.searchParams.get('file') || url.searchParams.get('path');
    if (!fileParam && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''));
      fileParam = hashParams.get('file') || hashParams.get('path');
    }
    if (fileParam && fileParam !== currentDocPath) {
      await loadPdfByPath(fileParam, true);
      return true;
    }
  } catch (err) {
    console.debug('Failed to parse URL params', err);
  }
  return false;
}

async function init() {
  setupEventListeners();

  const loadedFromUrl = await checkUrlParams();

  await loadWorkspacePdfs();

  // Try to restore last opened PDF if none was passed via URL
  if (!loadedFromUrl) {
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

  // Ask agent integration - Toggles prompt drawer
  askAgentBtn.addEventListener('click', () => {
    togglePromptDrawer();
  });

  if (closePromptDrawerBtn) {
    closePromptDrawerBtn.addEventListener('click', () => {
      togglePromptDrawer(false);
    });
  }

  if (submitPromptBtn) {
    submitPromptBtn.addEventListener('click', () => {
      askAgent(agentPromptInput?.value);
    });
  }

  // Quick prompt chips
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (agentPromptInput) {
        agentPromptInput.value = chip.dataset.prompt || '';
        agentPromptInput.focus();
      }
    });
  });

  // Submit on Enter (Shift+Enter for newline) & Escape to close drawer
  if (agentPromptInput) {
    agentPromptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        askAgent(agentPromptInput.value);
      } else if (e.key === 'Escape') {
        togglePromptDrawer(false);
      }
    });
  }

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') changePage(currentPageNum - 1);
    if (e.key === 'ArrowRight') changePage(currentPageNum + 1);
    if (e.key === '+' || e.key === '=') setScale(currentScale + 0.2);
    if (e.key === '-') setScale(Math.max(0.4, currentScale - 0.2));
  });

  // Listen for workspace folder changes from host
  if (window.sidecar?.onWorkspaceChange) {
    window.sidecar.onWorkspaceChange((newUris) => loadWorkspacePdfs(newUris));
  }

  // Listen for URL or navigation changes
  window.addEventListener('popstate', () => checkUrlParams());
  window.addEventListener('hashchange', () => checkUrlParams());

  // Poll in case the host updates iframe URL without reload
  let lastCheckedUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastCheckedUrl) {
      lastCheckedUrl = window.location.href;
      checkUrlParams();
    }
  }, 500);

  // Listen for postMessage from Antigravity host
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && (data.file || data.path)) {
      loadPdfByPath(data.file || data.path, true);
    }
  });
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
    const uris = (await window.sidecar?.getWorkspaceUris?.()) || [];
    const res = await window.sidecar?.fetch?.('/api/load-pdf', {
      method: 'POST',
      body: JSON.stringify({ path, workspaceUris: uris }),
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
  if (promptDocName) promptDocName.textContent = name;
  pageCountEl.textContent = doc.numPages;
  pageNumInput.max = doc.numPages;
  pageNumInput.value = 1;

  // Show toolbar & pages, hide empty state
  emptyState.hidden = true;
  docToolbar.hidden = false;
  pagesContainer.hidden = false;
  clearPageCache();
  pagesContainer.innerHTML = '';

  // Initial fit width
  await fitToWidth();
}

// ---------------------------------------------------------------------------
// Rendering View
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Smooth Rendering Engine & Page Caching
// ---------------------------------------------------------------------------

const pageCache = new Map(); // key: `${pageNum}_${scale}` -> HTMLDivElement
const renderPromises = new Map(); // key: `${pageNum}_${scale}` -> Promise
let prefetchTimer = null;
let continuousObserver = null;

function clearPageCache() {
  pageCache.clear();
  renderPromises.clear();
  clearTimeout(prefetchTimer);
  if (continuousObserver) {
    continuousObserver.disconnect();
    continuousObserver = null;
  }
}

async function getOrRenderPageElement(pageNum, scale) {
  const cacheKey = `${pageNum}_${scale}`;
  if (pageCache.has(cacheKey)) {
    return pageCache.get(cacheKey);
  }

  // Deduplicate in-flight render promises
  if (renderPromises.has(cacheKey)) {
    return renderPromises.get(cacheKey);
  }

  const promise = (async () => {
    const page = await currentDoc.getPage(pageNum);
    const pixelRatio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale });

    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-wrapper';
    wrapper.id = `page-wrapper-${pageNum}`;
    wrapper.dataset.pageNum = String(pageNum);

    const canvas = document.createElement('canvas');
    canvas.id = `page-canvas-${pageNum}`;
    wrapper.appendChild(canvas);

    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    wrapper.style.width = `${Math.floor(viewport.width)}px`;
    wrapper.style.minHeight = `${Math.floor(viewport.height)}px`;

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.scale(pixelRatio, pixelRatio);

    await page.render({
      canvasContext: ctx,
      viewport: viewport,
    }).promise;

    pageCache.set(cacheKey, wrapper);
    renderPromises.delete(cacheKey);

    // Evict distant pages if cache grows too large (keep memory optimal)
    if (pageCache.size > 12) {
      for (const [k, el] of pageCache.entries()) {
        const p = parseInt(k.split('_')[0], 10);
        if (Math.abs(p - currentPageNum) > 3) {
          if (el.parentNode) el.remove();
          pageCache.delete(k);
        }
      }
    }

    return wrapper;
  })();

  renderPromises.set(cacheKey, promise);
  return promise;
}

function prefetchNeighbors(pageNum, scale) {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    if (!currentDoc || isContinuous) return;
    if (pageNum + 1 <= currentDoc.numPages) {
      getOrRenderPageElement(pageNum + 1, scale).catch(() => {});
    }
    if (pageNum - 1 >= 1) {
      getOrRenderPageElement(pageNum - 1, scale).catch(() => {});
    }
  }, 60);
}

// ---------------------------------------------------------------------------
// Rendering View (Single & Continuous Modes)
// ---------------------------------------------------------------------------

async function renderView() {
  if (!currentDoc || isRendering) return;
  isRendering = true;

  try {
    if (isContinuous) {
      await renderContinuousView();
    } else {
      await showSinglePage(currentPageNum);
    }
  } finally {
    isRendering = false;
  }
}

async function showSinglePage(pageNum) {
  const target = Math.max(1, Math.min(pageNum, currentDoc.numPages));
  currentPageNum = target;
  pageNumInput.value = target;

  const targetWrapper = await getOrRenderPageElement(target, currentScale);

  // If container does not contain targetWrapper, append it
  if (!pagesContainer.contains(targetWrapper)) {
    pagesContainer.appendChild(targetWrapper);
  }

  // Smoothly swap visibility: hide others, show target (Zero flicker!)
  Array.from(pagesContainer.children).forEach((child) => {
    if (child === targetWrapper) {
      child.classList.remove('page-hidden');
      child.style.opacity = '1';
    } else {
      child.classList.add('page-hidden');
    }
  });

  // Pre-render adjacent pages in the background
  prefetchNeighbors(target, currentScale);
}

async function renderContinuousView() {
  pagesContainer.innerHTML = '';
  clearPageCache();

  // Create lightweight placeholders with exact dimensions for all pages
  const firstPage = await currentDoc.getPage(1);
  const sampleViewport = firstPage.getViewport({ scale: currentScale });
  const estimatedWidth = Math.floor(sampleViewport.width);
  const estimatedHeight = Math.floor(sampleViewport.height);

  const placeholders = [];
  for (let i = 1; i <= currentDoc.numPages; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-wrapper page-placeholder';
    wrapper.id = `page-wrapper-${i}`;
    wrapper.dataset.pageNum = String(i);
    wrapper.style.width = `${estimatedWidth}px`;
    wrapper.style.height = `${estimatedHeight}px`;
    pagesContainer.appendChild(wrapper);
    placeholders.push(wrapper);
  }

  // Set up IntersectionObserver to lazily render visible pages
  if (continuousObserver) continuousObserver.disconnect();
  continuousObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const pageNum = parseInt(entry.target.dataset.pageNum, 10);
      if (entry.isIntersecting) {
        // Update current page number as user scrolls
        currentPageNum = pageNum;
        pageNumInput.value = pageNum;

        // Render page if not already rendered
        if (!entry.target.querySelector('canvas')) {
          getOrRenderPageElement(pageNum, currentScale).then((renderedWrapper) => {
            if (entry.target.parentNode) {
              renderedWrapper.classList.remove('page-placeholder');
              entry.target.parentNode.replaceChild(renderedWrapper, entry.target);
              continuousObserver.observe(renderedWrapper);
            }
          }).catch(() => {});
        }
      }
    });
  }, {
    root: document.getElementById('viewerContainer'),
    rootMargin: '300px 0px',
    threshold: 0.1,
  });

  placeholders.forEach((el) => continuousObserver.observe(el));

  // Render initial page immediately
  await getOrRenderPageElement(1, currentScale).then((rendered) => {
    if (placeholders[0] && placeholders[0].parentNode) {
      placeholders[0].parentNode.replaceChild(rendered, placeholders[0]);
      continuousObserver.observe(rendered);
    }
  });
}

// ---------------------------------------------------------------------------
// Controls (Page, Zoom)
// ---------------------------------------------------------------------------

async function changePage(num) {
  if (!currentDoc) return;
  const target = Math.max(1, Math.min(num, currentDoc.numPages));
  if (target === currentPageNum && !isContinuous) return;

  if (isContinuous) {
    const targetElement = document.getElementById(`page-wrapper-${target}`);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      currentPageNum = target;
      pageNumInput.value = target;
    }
  } else {
    await showSinglePage(target);
  }
}

async function setScale(scale) {
  currentScale = Math.round(scale * 10) / 10;
  zoomLevelText.textContent = `${Math.round(currentScale * 100)}%`;
  clearPageCache();
  pagesContainer.innerHTML = '';
  await renderView();
}

async function fitToWidth() {
  if (!currentDoc) return;
  const page = await currentDoc.getPage(currentPageNum);
  const containerWidth = document.getElementById('viewerContainer').clientWidth - 48;
  const baseViewport = page.getViewport({ scale: 1.0 });
  const scale = containerWidth / baseViewport.width;
  await setScale(Math.max(0.4, scale));
}

// ---------------------------------------------------------------------------
// Workspace PDF Discovery
// ---------------------------------------------------------------------------

async function loadWorkspacePdfs(explicitUris) {
  try {
    const uris = (Array.isArray(explicitUris) && explicitUris.length > 0)
      ? explicitUris
      : (await window.sidecar?.getWorkspaceUris?.()) || [];

    if (!uris.length) {
      workspaceSelect.hidden = true;
      workspaceList.hidden = true;
      return;
    }

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
// Agent Actions (Prompt Drawer & New Chat Pane)
// ---------------------------------------------------------------------------

function togglePromptDrawer(forceOpen) {
  if (!currentDoc) {
    showToast('Please open a PDF document first');
    return;
  }
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : (agentPromptDrawer ? agentPromptDrawer.hidden : false);
  if (!agentPromptDrawer) return;

  if (shouldOpen) {
    if (promptDocName) promptDocName.textContent = currentDocName;
    agentPromptDrawer.hidden = false;
    if (askAgentBtn) askAgentBtn.classList.add('active');
    setTimeout(() => {
      if (agentPromptInput) {
        agentPromptInput.focus();
        agentPromptInput.select();
      }
    }, 50);
  } else {
    agentPromptDrawer.hidden = true;
    if (askAgentBtn) askAgentBtn.classList.remove('active');
  }
}

async function askAgent(customPrompt) {
  if (!currentDoc) {
    showToast('Please open a PDF document first');
    return;
  }

  showLoading(true);
  showToast('Sending prompt to Antigravity...');

  try {
    const docRef = currentDocPath
      ? `"${currentDocName}" (located at: ${currentDocPath})`
      : `document "${currentDocName}"`;

    let promptText = '';
    if (customPrompt && customPrompt.trim()) {
      promptText = `Regarding ${docRef}:\n\n${customPrompt.trim()}`;
    } else {
      promptText = `Regarding ${docRef}:\nPlease analyze this document and summarize its key points and takeaways.`;
    }

    if (window.sidecar?.agent?.sendMessage) {
      if (window.sidecar.conversationId) {
        await window.sidecar.agent.sendMessage(promptText, window.sidecar.conversationId);
      } else {
        await window.sidecar.agent.sendMessage(promptText);
      }
      showToast('Prompt sent to chat!');
      if (agentPromptInput) agentPromptInput.value = '';
    } else if (window.sidecar?.agent?.startConversation) {
      await window.sidecar.agent.startConversation(promptText);
      showToast('Prompt sent to Antigravity!');
      if (agentPromptInput) agentPromptInput.value = '';
    } else {
      showToast('Agent bridge connecting...');
    }
  } catch (err) {
    showToast(`Could not send prompt: ${err.message}`);
  } finally {
    showLoading(false);
    togglePromptDrawer(false);
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
