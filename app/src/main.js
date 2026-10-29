const pathKey = value => window.desktop?.platform === 'win32' ? value?.toLowerCase() : value;
import './style.css';
import { escapeHtml } from './utils/safeHtml.js';
import 'highlight.js/styles/github-dark.css';
import { TextEditor } from './utils/textEditor.js';

import { icons } from './icons.js';
import {
  detectFileType,
  sniffFileType,
  describeUnsupported,
  utf16Encoding,
  FILE_TYPES,
  MAX_DOCUMENT_BYTES,
  SNIFF_BYTES,
  getFileTypeIcon,
  formatFileSize
} from './utils/fileHelpers.js';
import {
  getRecentFiles,
  addRecentFile,
  clearRecentFiles,
  getStoredTheme,
  setStoredTheme,
  getStoredSidebarState,
  getStoredSidebarWidth,
  setStoredSidebarWidth,
  setStoredSidebarState
} from './utils/storage.js';

const viewerModules = {
  excel: () => import('./viewers/excelViewer.js'),
  word: () => import('./viewers/wordViewer.js'),
  pdf: () => import('./viewers/pdfViewer.js'),
  markdown: () => import('./viewers/markdownViewer.js'),
  code: () => import('./viewers/codeViewer.js'),
  image: () => import('./viewers/imageViewer.js'),
  media: () => import('./viewers/mediaViewer.js'),
  zip: () => import('./viewers/zipViewer.js')
};

class OmniViewApp {
  constructor() {
    this.tabs = [];
    this.activeTabId = null;
    this.theme = getStoredTheme();
    this.sidebarOpen = getStoredSidebarState();
    this.sidebarWidth = getStoredSidebarWidth();

    // DOM Elements
    this.fileInput = document.getElementById('file-picker-input');
    this.tabsContainer = document.getElementById('header-tabs-list');
    this.sidebar = document.getElementById('app-sidebar');
    this.recentListEl = document.getElementById('recent-files-list');
    this.sidebarDetailsEl = document.getElementById('sidebar-file-details');
    this.contextToolbar = document.getElementById('context-toolbar');
    this.viewerCanvas = document.getElementById('viewer-canvas');
    this.dropOverlay = document.getElementById('drop-overlay');
    this.statusFilename = document.getElementById('status-filename');
    this.statusType = document.getElementById('status-type');
    this.statusSize = document.getElementById('status-size');
    this.themeSelect = document.getElementById('theme-select');
    this.lastDarkTheme = this.theme === 'light' ? 'dark' : this.theme;
    this.themeToggleBtn = document.getElementById('btn-toggle-theme');
    this.sidebarToggleBtn = document.getElementById('btn-toggle-sidebar');

  }

  init() {
    document.documentElement.classList.add(`platform-${window.desktop?.platform || "browser"}`);
    this.applyTheme(this.theme);
    this.applySidebarState();
    this.setupSidebarResize();
    this.bindEvents();
    this.bindTabKeys();
    this.tabsResizeObserver = new ResizeObserver(() => this.fitTabs());
    this.tabsResizeObserver.observe(this.tabsContainer);
    document.addEventListener('selectionchange', () => {
      const tab = this.tabs.find(tab => tab.id === this.activeTabId);
      const selection = window.getSelection();
      const area = tab?.surface?.querySelector('.text-editor');
      const selected = (area && area.selectionEnd > area.selectionStart) || (!!selection && !selection.isCollapsed && tab?.surface?.contains(selection.anchorNode) && tab.surface.contains(selection.focusNode));
      this.contextToolbar.querySelectorAll('.document-copy').forEach(button => button.classList.toggle('selection-ready', selected));
    });
    document.addEventListener('select', () => document.dispatchEvent(new Event('selectionchange')), true);
    window.addEventListener('beforeunload', event => {
      if (this.tabs.some(tab => tab.viewer?.editor?.dirty)) { event.preventDefault(); event.returnValue = false; }
    });
    this.applyFontSize(localStorage.getItem('multiviewer_font_size') || '1');
    this.renderRecentFiles();
    this.renderWelcomeScreen();
    const showUpdate = result => {
      const notice = document.getElementById('update-notice');
      notice.hidden = result.status !== 'available';
      if (!notice.hidden) document.getElementById('update-message').textContent = `OmniView ${result.latestVersion} is available. You’re using ${result.currentVersion}.`;
    };
    document.getElementById('btn-view-update').onclick = () => window.desktop?.openUpdateRelease();
    document.getElementById('btn-dismiss-update').onclick = () => { document.getElementById('update-notice').hidden = true; };
    window.desktop?.onUpdateStatus(showUpdate);
    window.desktop?.checkUpdates().then(showUpdate).catch(() => {});
  }

  applyTheme(theme) {
    if (!['dark', 'midnight', 'graphite', 'forest', 'violet', 'ember', 'light'].includes(theme)) theme = 'dark';
    this.theme = theme;
    if (theme !== 'light') this.lastDarkTheme = theme;
    if (this.themeSelect) this.themeSelect.value = theme;
    document.documentElement.setAttribute('data-theme', theme);
    setStoredTheme(theme);
    this.sizeThemePicker();
    if (this.themeToggleBtn) {
      this.themeToggleBtn.innerHTML = theme !== 'light' ? icons.sun : icons.moon;
      this.themeToggleBtn.title = theme !== 'light' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
  }

  applyFontSize(value) {
    if (!['0.8', '0.9', '1', '1.1', '1.25', '1.5'].includes(String(value))) value = '1';
    document.documentElement.style.setProperty('--font-scale', value);
    document.getElementById('font-size-select').value = value;
    localStorage.setItem('multiviewer_font_size', value);
    this.sizeThemePicker();
  }

  sizeThemePicker() {
    if (!this.themeSelect) return;
    const context = document.createElement('canvas').getContext('2d');
    context.font = getComputedStyle(this.themeSelect).font;
    this.themeSelect.style.width = `${Math.ceil(context.measureText(this.themeSelect.selectedOptions[0].textContent).width + 26)}px`;
  }

  applySidebarState() {
    if (this.sidebar) {
      this.sidebar.classList.toggle('collapsed', !this.sidebarOpen);
    }
    setStoredSidebarState(this.sidebarOpen);
  }

  setupSidebarResize() {
    const handle = document.createElement('div');
    handle.id = 'sidebar-resize-handle';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', 'Resize left panel');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.tabIndex = 0;
    this.sidebar.after(handle);
    const setWidth = width => {
      const maximum = Math.min(520, Math.max(180, document.querySelector('.app-body').clientWidth - 480));
      this.sidebarWidth = Math.max(180, Math.min(maximum, width));
      document.documentElement.style.setProperty('--sidebar-width', `${this.sidebarWidth}px`);
      handle.setAttribute('aria-valuenow', Math.round(this.sidebarWidth));
      handle.setAttribute('aria-valuemin', '180');
      handle.setAttribute('aria-valuemax', maximum);
      setStoredSidebarWidth(this.sidebarWidth);
    };
    setWidth(this.sidebarWidth);
    let dragging = false;
    handle.onpointerdown = event => {
      if (event.button !== 0 || !this.sidebarOpen) return;
      dragging = true;
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing-sidebar');
      event.preventDefault();
    };
    handle.onpointermove = event => {
      if (dragging) setWidth(event.clientX - this.sidebar.getBoundingClientRect().left);
    };
    const stop = () => { dragging = false; document.body.classList.remove('resizing-sidebar'); };
    handle.onpointerup = stop;
    handle.onpointercancel = stop;
    handle.onlostpointercapture = stop;
    handle.ondblclick = () => setWidth(280);
    handle.onkeydown = event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        setWidth(this.sidebarWidth + (event.key === 'ArrowRight' ? 20 : -20));
      } else if (event.key === 'Home') { event.preventDefault(); setWidth(280); }
    };
    window.addEventListener('resize', () => setWidth(this.sidebarWidth));
  }

  openFilePicker() {
    if (window.desktop) window.desktop.openFiles();
    else this.fileInput?.click();
  }

  async printActiveDocument() {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab) return;
    try {
      if (tab.viewer?.print) await tab.viewer.print();
      else if (window.desktop) await window.desktop.print();
      else window.print();
    } catch (error) {
      alert('Could not print: ' + error.message);
    }
  }

  bindEvents() {
    document.querySelectorAll('[data-menu]').forEach(button => {
      button.onclick = () => {
        const rect = button.getBoundingClientRect();
        window.desktop?.showMenu(button.dataset.menu, rect.left, rect.bottom);
      };
    });
    // File.arrayBuffer() resolves asynchronously; preserve native selection order.
    let fileOpenQueue = Promise.resolve();
    window.desktop?.onFile(({ name, bytes, filePath, editToken }) => {
      // The bytes already crossed IPC; wrapping them in a File would copy them twice more.
      const source = { name, size: bytes.byteLength, type: '' };
      fileOpenQueue = fileOpenQueue.catch(() => {}).then(() => this.loadFile(source, filePath, editToken, bytes));
    });
    window.desktop?.onMedia(async ({ name, size, filePath, mediaToken, url }) => {
      const existing = this.tabs.find(tab => pathKey(tab.filePath) === pathKey(filePath));
      if (existing) await this.closeTab(existing.id);
      this.createTab({ name, size, type: FILE_TYPES.MEDIA, data: url, filePath, mediaToken });
      this.renderRecentFiles();
    });
    window.desktop?.onRequestClose(async () => {
      for (const tab of this.tabs) if (tab.viewer?.editor && !await tab.viewer.editor.canClose()) { window.desktop.cancelClose(); return; }
      window.desktop.allowClose();
    });
    window.desktop?.onRequestReload(async () => {
      for (const tab of this.tabs) if (tab.viewer?.editor && !await tab.viewer.editor.canClose()) { window.desktop.cancelReload(); return; }
      window.desktop.allowReload();
    });
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); this.tabs.find(tab => tab.id === this.activeTabId)?.viewer?.editor?.save(event.shiftKey);
      }
    });
    document.getElementById('font-size-select').onchange = event => this.applyFontSize(event.target.value);
    document.getElementById('tabs-left').onclick = () => this.tabsContainer.scrollBy({ left: -this.tabsContainer.clientWidth * 0.8 });
    document.getElementById('tabs-right').onclick = () => this.tabsContainer.scrollBy({ left: this.tabsContainer.clientWidth * 0.8 });
    this.tabsContainer.onwheel = event => {
      if (this.tabsContainer.scrollWidth > this.tabsContainer.clientWidth) {
        event.preventDefault(); this.tabsContainer.scrollLeft += event.deltaY || event.deltaX;
      }
    };
    window.addEventListener('focus', () => this.renderRecentFiles());
    window.desktop?.onPrint(() => this.printActiveDocument());
    window.desktop?.onSave(saveAs => this.tabs.find(tab => tab.id === this.activeTabId)?.viewer?.editor?.save(saveAs));
    window.desktop?.onClose(() => this.activeTabId && this.closeTab(this.activeTabId));
    // Open file button
    document.getElementById('btn-open-file')?.addEventListener('click', () => {
      this.openFilePicker();
    });

    this.fileInput?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (!window.desktop || !await window.desktop.openDropped(files)) files.forEach(f => this.loadFile(f));
      this.fileInput.value = '';
    });

    this.themeSelect?.addEventListener('change', event => this.applyTheme(event.target.value));

    // Theme toggle
    this.themeToggleBtn?.addEventListener('click', () => {
      this.applyTheme(this.theme === 'light' ? this.lastDarkTheme : 'light');
    });

    // Sidebar toggle
    this.sidebarToggleBtn?.addEventListener('click', () => {
      this.sidebarOpen = !this.sidebarOpen;
      this.applySidebarState();
    });

    // Clear recent files
    document.getElementById('btn-clear-recent')?.addEventListener('click', async () => {
      await window.desktop?.clearRecents();
      clearRecentFiles();
      this.renderRecentFiles();
    });

    // Global Drag and Drop
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropOverlay?.classList.add('active');
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.relatedTarget === null || e.clientX === 0) {
        this.dropOverlay?.classList.remove('active');
      }
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropOverlay?.classList.remove('active');
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) {
        if (!window.desktop || !await window.desktop.openDropped(files)) files.forEach(f => this.loadFile(f));
      }
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        if (window.desktop) window.desktop.fullscreen();
        else if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'p') {
          e.preventDefault();
          this.printActiveDocument();
        }
        if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          this.openFilePicker();
        } else if (e.key === 'w' || e.key === 'W') {
          e.preventDefault();
          if (this.activeTabId) this.closeTab(this.activeTabId);
        } else if (e.key === 'b' || e.key === 'B') {
          e.preventDefault();
          this.sidebarOpen = !this.sidebarOpen;
          this.applySidebarState();
        }
      }
    });
  }

  async loadFile(file, filePath = null, editToken = null, rawBytes = null) {
    let type = detectFileType(file.name, file.type);
    let data;
    let editMeta = null;
    const readBytes = async () => rawBytes ?? new Uint8Array(await file.arrayBuffer());

    try {
      if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Files larger than 256 MB are not supported.');
      if (/\.rtf$/i.test(file.name)) throw new Error('Please convert RTF to DOCX using Word or LibreOffice.');
      if (/\.doc$/i.test(file.name) && file.size > 32 * 1024 * 1024) throw new Error('Legacy DOC viewing is limited to 32 MB.');
      if (type === FILE_TYPES.UNKNOWN) {
        const header = rawBytes ? rawBytes.subarray(0, SNIFF_BYTES) : new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
        type = sniffFileType(header);
        if (type === FILE_TYPES.UNKNOWN) throw new Error(describeUnsupported(header, file.name));
      }
      if (type === FILE_TYPES.IMAGE || type === FILE_TYPES.MEDIA) {
        data = URL.createObjectURL(rawBytes ? new Blob([rawBytes]) : file);
      } else if (type === FILE_TYPES.MARKDOWN || type === FILE_TYPES.CODE) {
        const bytes = await readBytes();
        const encoding = utf16Encoding(bytes);
        const bom = !encoding && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
        let validUtf8 = true;
        try { data = new TextDecoder(encoding || 'utf-8', { fatal: true }).decode(bytes); }
        catch { validUtf8 = false; data = new TextDecoder('utf-8').decode(bytes); }
        // UTF-16 stays read-only: saving would silently re-encode it as UTF-8.
        editMeta = { eligible: !encoding && validUtf8 && !data.includes('\0') && file.size <= 2 * 1024 * 1024, bom, token: editToken, lineEnding: data.includes('\r\n') ? '\r\n' : '\n' };
      } else {
        data = await readBytes();
      }

      const existing = filePath && this.tabs.find(tab => pathKey(tab.filePath) === pathKey(filePath));
      if (existing && !await this.closeTab(existing.id)) return;
      this.createTab({
        name: file.name,
        type: type,
        size: file.size,
        data: data,
        filePath,
        editMeta,
        objectUrl: (type === FILE_TYPES.IMAGE || type === FILE_TYPES.MEDIA) ? data : null
      });

      if (!window.desktop) addRecentFile({
        name: file.name,
        type: type,
        size: file.size
      });
      this.renderRecentFiles();
    } catch (err) {
      alert(`Could not read "${file.name}": ` + err.message);
    }
  }

  createTab({ name, type, size, data, objectUrl = null, filePath = null, editMeta = null, mediaToken = null }) {
    const id = 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const newTab = { id, name, type, size, data, objectUrl, filePath, editMeta, mediaToken };
    this.tabs.push(newTab);
    this.renderTabsList();
    this.activateTab(id);
  }

  activateTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    this.tabs.find(t => t.id === this.activeTabId)?.viewer?.mediaEl?.pause();
    if (this.activeTabId !== tabId) this.tabs.find(t => t.id === this.activeTabId)?.viewer?.suspend?.();
    this.activeTabId = tabId;
    this.renderTabsList();
    clearTimeout(this.viewTimer);
    this.viewerCanvas.replaceChildren(tab.surface);
    this.contextToolbar.replaceChildren(tab.toolbar);
    // Coalesce rapid tab changes and multi-file opening before allocating a preview.
    if (tab.type === FILE_TYPES.MEDIA || tab.viewer?.editor?.editing) this.renderActiveDocument(tab);
    else this.viewTimer = setTimeout(() => {
      if (!tab.closed && this.activeTabId === tab.id) this.renderActiveDocument(tab);
    }, 50);
    this.updateStatus(tab);
    this.updateSidebarDetails(tab);
  }

  async closeTab(tabId) {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    const tab = this.tabs[index];
    if (tab.viewer?.editor && !await tab.viewer.editor.canClose()) return false;
    const currentIndex = this.tabs.indexOf(tab);
    if (currentIndex < 0) return true;
    window.desktop?.releaseEditFile(tab.viewer?.editor?.meta.token || tab.editMeta?.token);
    if (tab.mediaToken) window.desktop.releaseMedia(tab.mediaToken);
    tab.closed = true;
    tab.viewer?.destroy?.();
    tab.viewer?.mediaEl?.pause();
    if (tab.objectUrl) URL.revokeObjectURL(tab.objectUrl);
    this.tabs.splice(currentIndex, 1);

    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const nextTab = this.tabs[Math.max(0, currentIndex - 1)];
        this.activateTab(nextTab.id);
      } else {
        this.activeTabId = null;
        this.renderTabsList();
        this.renderWelcomeScreen();
        this.clearStatus();
        this.clearSidebarDetails();
      }
    } else {
      this.renderTabsList();
    }
    return true;
  }

  renderTabsList() {
    if (!this.tabsContainer) return;
    const hadTabFocus = this.tabsContainer.contains(document.activeElement);
    this.tabsContainer.innerHTML = '';

    this.tabs.forEach(tab => {
      const active = tab.id === this.activeTabId;
      const tabEl = document.createElement('div');
      tabEl.dataset.tabId = tab.id;
      tabEl.dataset.fullName = tab.name;
      tabEl.className = `file-tab ${active ? 'active' : ''}`;
      tabEl.setAttribute('role', 'tab');
      tabEl.setAttribute('aria-selected', String(active));
      tabEl.setAttribute('aria-label', tab.name);
      tabEl.tabIndex = active ? 0 : -1;
      tabEl.innerHTML = `
        <span class="tab-icon" aria-hidden="true">${getFileTypeIcon(tab.type)}</span>
        <span class="tab-title" title="${escapeHtml(tab.name)}">${tab.viewer?.editor?.dirty ? '● ' : ''}${escapeHtml(tab.name)}</span>
        <button type="button" class="tab-close" tabindex="-1" title="Close" aria-label="Close ${escapeHtml(tab.name)}">${icons.close}</button>
      `;

      tabEl.onclick = () => this.activateTab(tab.id);

      const closeBtn = tabEl.querySelector('.tab-close');
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      };

      this.tabsContainer.appendChild(tabEl);
    });
    this.tabsContainer.querySelector('.file-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.fitTabs();
    if (hadTabFocus) this.focusActiveTab();
  }

  focusActiveTab() {
    this.tabsContainer.querySelector('.file-tab.active')?.focus();
  }

  bindTabKeys() {
    this.tabsContainer.setAttribute('role', 'tablist');
    this.tabsContainer.setAttribute('aria-label', 'Open documents');
    this.tabsContainer.addEventListener('keydown', event => {
      const tabs = [...this.tabsContainer.querySelectorAll('.file-tab')];
      const current = tabs.indexOf(document.activeElement?.closest('.file-tab'));
      if (current < 0) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        Promise.resolve(this.closeTab(tabs[current].dataset.tabId)).then(() => this.focusActiveTab());
        return;
      }
      const next = event.key === 'ArrowRight' ? (current + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
        : null;
      if (next === null) return;
      event.preventDefault();
      this.activateTab(tabs[next].dataset.tabId);
      this.focusActiveTab();
    });
  }

  fitTabs() {
    const tabs = [...this.tabsContainer.children];
    this.tabsContainer.classList.remove('compact-tabs');
    for (const tab of tabs) {
      tab.style.width = '';
      const name = tab.dataset.fullName;
      const dirty = this.tabs.find(item => item.id === tab.dataset.tabId)?.viewer?.editor?.dirty;
      tab.querySelector('.tab-title').textContent = `${dirty ? '● ' : ''}${name.length > 20 ? name.slice(0, 20) + '…' : name}`;
      tab.dataset.normalWidth = Math.ceil(tab.getBoundingClientRect().width);
    }
    if (tabs.reduce((sum, tab) => sum + Number(tab.dataset.normalWidth) + 4, 0) > this.tabsContainer.clientWidth) {
      this.tabsContainer.classList.add('compact-tabs');
      for (const tab of tabs) {
        tab.style.width = '';
        const name = tab.dataset.fullName;
        const dirty = this.tabs.find(item => item.id === tab.dataset.tabId)?.viewer?.editor?.dirty;
        tab.querySelector('.tab-title').textContent = `${dirty ? '● ' : ''}${name.length > 10 ? name.slice(0, 10) + '…' : name}`;
      }
    }
    this.tabsContainer.querySelector('.file-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  async renderActiveDocument(tab) {
    if (!tab.surface) {
      tab.surface = document.createElement('div');
      tab.surface.className = 'document-surface';
      tab.toolbar = document.createElement('div');
      tab.surface.innerHTML = '<div class="viewer-loading"><div class="spinner"></div><p>Opening file…</p></div>';
    }
    this.viewerCanvas.replaceChildren(tab.surface);
    this.contextToolbar.replaceChildren(tab.toolbar);
    if (tab.started) { tab.viewer?.resume?.(); return; }
    tab.started = true;
    try {
      const module = await viewerModules[tab.type]();
      if (tab.closed) return;
      if (this.activeTabId !== tab.id) { tab.started = false; return; }
      const Viewer = Object.values(module)[0];
      tab.viewer = new Viewer(tab.surface, tab.toolbar, nestedFile => {
        const bytes = new Uint8Array(nestedFile.buffer);
        this.loadFile({ name: nestedFile.name, size: bytes.byteLength, type: '' }, null, null, bytes);
      });
      await tab.viewer.render(tab.data, tab.name);
      if ([FILE_TYPES.CODE, FILE_TYPES.MARKDOWN].includes(tab.type) && window.desktop) {
        new TextEditor(tab.viewer, tab.editMeta, result => {
          if (tab.closed) { window.desktop.releaseEditFile(result.token); return; }
          tab.name = result.name; tab.filePath = result.path;
          this.renderTabsList();
          if (this.activeTabId === tab.id) { this.updateStatus(tab); this.updateSidebarDetails(tab); }
          this.renderRecentFiles();
        }, dirty => {
          const title = this.tabsContainer.querySelector(`[data-tab-id="${tab.id}"] .tab-title`);
          const limit = this.tabsContainer.classList.contains('compact-tabs') ? 10 : 20;
          if (title) title.textContent = `${dirty ? '● ' : ''}${tab.name.slice(0, limit)}${tab.name.length > limit ? '…' : ''}`;
        });
      }
      // Parsed viewers own their state; do not keep an extra original file buffer.
      if ([FILE_TYPES.EXCEL, FILE_TYPES.WORD, FILE_TYPES.CODE, FILE_TYPES.MARKDOWN, FILE_TYPES.PDF, FILE_TYPES.ZIP].includes(tab.type)) tab.data = null;
      if (tab.closed) tab.viewer.destroy?.();
      else if (this.activeTabId !== tab.id) tab.viewer.suspend?.();
    } catch (error) {
      tab.surface.innerHTML = `<div class="viewer-error"><h3>Could not open file</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  renderWelcomeScreen() {
    this.contextToolbar.innerHTML = '';
    this.viewerCanvas.innerHTML = `
      <div class="empty-state-container">
        <div class="drop-hero-box" id="hero-dropzone">
          <div class="hero-icon-circle">${icons.upload}</div>
          <h2 class="hero-title">Any File. One Viewer.</h2>
          <p class="hero-subtitle">
            Drag and drop any file here, or click Browse to view spreadsheets, documents, PDFs, code, images or media instantly.
          </p>
          <button class="btn-primary" id="btn-hero-browse">
            ${icons.upload} Browse Files
          </button>
          <div class="supported-formats-pills">
            <span class="format-pill">.pdf</span>
            <span class="format-pill">.docx</span>
            <span class="format-pill">.doc</span>
            <span class="format-pill">.xlsx</span>
            <span class="format-pill">.csv</span>
            <span class="format-pill">.md</span>
            <span class="format-pill">.txt</span>
            <span class="format-pill">.png</span>
            <span class="format-pill">.mp4</span>
            <span class="format-pill">.mp3</span>
            <span class="format-pill">.zip</span>
          </div>
        </div>
        <p class="project-support">Enjoying OmniView? <button id="btn-star-project">★ Star on GitHub</button></p>
      </div>
    `;

    document.getElementById('btn-hero-browse')?.addEventListener('click', () => {
      this.openFilePicker();
    });
    document.getElementById('btn-star-project').onclick = () => {
      if (window.desktop) window.desktop.supportProject();
      else window.open('https://github.com/4Raisan/OmniView', '_blank', 'noopener,noreferrer');
    };

    document.getElementById('hero-dropzone')?.addEventListener('click', (e) => {
      if (e.target.closest('#btn-hero-browse')) return;
      this.openFilePicker();
    });
  }

  async renderRecentFiles() {
    const generation = this.recentGeneration = (this.recentGeneration || 0) + 1;
    const list = window.desktop ? await window.desktop.recentFiles() : getRecentFiles();
    if (generation !== this.recentGeneration) return;
    if (!this.recentListEl) return;
    this.recentListEl.innerHTML = '';

    if (!list.length) {
      this.recentListEl.innerHTML = `
        <div style="padding: 16px 12px; color: var(--text-muted); font-size: 12px; text-align: center;">
          No recent files yet
        </div>
      `;
      return;
    }

    list.forEach(item => {
      item.type ||= detectFileType(item.name);
      const el = document.createElement('div');
      el.className = 'recent-file-item';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.title = item.path ? `${item.path}${item.missing ? ' — file moved or deleted' : ''}` : 'Choose this file again from disk';
      const reopen = () => {
        if (window.desktop && item.id) window.desktop.openRecent(item.id);
        else this.openFilePicker();
      };
      el.onclick = reopen;
      el.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); reopen(); } };
      el.innerHTML = `
        <span>${getFileTypeIcon(item.type)}</span>
        <div class="recent-item-info">
          <span class="recent-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
          <span class="recent-item-meta">${item.missing ? 'Moved or deleted' : formatFileSize(item.size)}</span>
        </div>
      `;
      this.recentListEl.appendChild(el);
    });
  }

  updateStatus(tab) {
    if (this.statusFilename) this.statusFilename.textContent = tab.name;
    if (this.statusType) this.statusType.textContent = tab.type.toUpperCase();
    if (this.statusSize) this.statusSize.textContent = formatFileSize(tab.size);
  }

  clearStatus() {
    if (this.statusFilename) this.statusFilename.textContent = 'No file open';
    if (this.statusType) this.statusType.textContent = 'READY';
    if (this.statusSize) this.statusSize.textContent = '0 B';
  }

  updateSidebarDetails(tab) {
    if (!this.sidebarDetailsEl) return;
    this.sidebarDetailsEl.innerHTML = `
      <h4>Active File</h4>
      <div class="file-meta-row"><span>Name:</span><span title="${escapeHtml(tab.name)}">${escapeHtml(tab.name)}</span></div>
      <div class="file-meta-row"><span>Type:</span><span>${tab.type.toUpperCase()}</span></div>
      <div class="file-meta-row"><span>Size:</span><span>${formatFileSize(tab.size)}</span></div>
    `;
  }

  clearSidebarDetails() {
    if (!this.sidebarDetailsEl) return;
    this.sidebarDetailsEl.innerHTML = `
      <h4>Active File</h4>
      <div style="color: var(--text-muted); font-size: 11px;">No active document</div>
    `;
  }
}

// Boot application
window.addEventListener('DOMContentLoaded', () => {
  const app = new OmniViewApp();
  app.init();
});
