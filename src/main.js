import './style.css';
import { escapeHtml } from './utils/safeHtml.js';
import 'highlight.js/styles/github-dark.css';
import { TextEditor } from './utils/textEditor.js';

import { icons } from './icons.js';
import {
  detectFileType,
  FILE_TYPES,
  getFileTypeIcon,
  formatFileSize,
  readFileAsArrayBuffer,
  readFileAsText,
  readFileAsDataURL
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
    this.applyTheme(this.theme);
    this.applySidebarState();
    this.setupSidebarResize();
    this.bindEvents();
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
    window.desktop?.onFile(({ name, bytes, filePath, editToken }) => this.loadFile(new File([bytes], name), filePath, editToken));
    window.desktop?.onMedia(async ({ name, size, filePath, mediaToken, url }) => {
      const existing = this.tabs.find(tab => tab.filePath?.toLowerCase() === filePath.toLowerCase());
      if (existing) await this.closeTab(existing.id);
      this.createTab({ name, size, type: FILE_TYPES.MEDIA, data: url, filePath, mediaToken });
      this.renderRecentFiles();
    });
    window.desktop?.onRequestClose(async () => {
      for (const tab of this.tabs) if (tab.viewer?.editor && !await tab.viewer.editor.canClose()) return;
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

  async loadFile(file, filePath = null, editToken = null) {
    const type = detectFileType(file.name, file.type);
    let data;
    let editMeta = null;

    try {
      if (file.size > 256 * 1024 * 1024) throw new Error('Files larger than 256 MB are not supported.');
      if (type === FILE_TYPES.UNKNOWN) throw new Error('Unsupported file format. Choose a document, text file, image, media file or ZIP.');
      if (/\.(doc|rtf)$/i.test(file.name)) throw new Error('Please convert this legacy document to DOCX using Word or LibreOffice.');
      if (type === FILE_TYPES.IMAGE || type === FILE_TYPES.MEDIA) {
        data = URL.createObjectURL(file);
      } else if (type === FILE_TYPES.MARKDOWN || type === FILE_TYPES.CODE) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
        let validUtf8 = true;
        try { data = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { validUtf8 = false; data = await readFileAsText(file); }
        editMeta = { eligible: validUtf8 && !data.includes('\0') && file.size <= 2 * 1024 * 1024, bom, token: editToken, lineEnding: data.includes('\r\n') ? '\r\n' : '\n' };
      } else {
        // Excel, Word, PDF, Zip
        data = await readFileAsArrayBuffer(file);
      }

      const existing = filePath && this.tabs.find(tab => tab.filePath?.toLowerCase() === filePath.toLowerCase());
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
    this.tabsContainer.innerHTML = '';

    this.tabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.dataset.tabId = tab.id;
      tabEl.dataset.fullName = tab.name;
      tabEl.className = `file-tab ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabEl.innerHTML = `
        <span class="tab-icon">${getFileTypeIcon(tab.type)}</span>
        <span class="tab-title" title="${escapeHtml(tab.name)}">${tab.viewer?.editor?.dirty ? '● ' : ''}${escapeHtml(tab.name)}</span>
        <span class="tab-close" title="Close">${icons.close}</span>
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
        this.loadFile(new File([nestedFile.buffer], nestedFile.name));
      });
      await tab.viewer.render(tab.data, tab.name);
      if ([FILE_TYPES.CODE, FILE_TYPES.MARKDOWN].includes(tab.type) && window.desktop) {
        new TextEditor(tab.viewer, tab.editMeta || { eligible: new TextEncoder().encode(tab.viewer.rawText).byteLength <= 2 * 1024 * 1024, bom: false, lineEnding: '\n' }, result => {
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
      if ([FILE_TYPES.EXCEL, FILE_TYPES.WORD, FILE_TYPES.CODE, FILE_TYPES.MARKDOWN].includes(tab.type)) tab.data = null;
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
            Drag and drop any file here, or click Browse to view spreadsheets, documents, PDFs, code, or images instantly.
          </p>
          <button class="btn-primary" id="btn-hero-browse">
            ${icons.upload} Browse Files
          </button>
          <div class="supported-formats-pills">
            <span class="format-pill">.xlsx</span>
            <span class="format-pill">.csv</span>
            <span class="format-pill">.docx</span>
            <span class="format-pill">.pdf</span>
            <span class="format-pill">.md</span>
            <span class="format-pill">.json</span>
            <span class="format-pill">.py</span>
            <span class="format-pill">.js</span>
            <span class="format-pill">.png</span>
            <span class="format-pill">.zip</span>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-hero-browse')?.addEventListener('click', () => {
      this.openFilePicker();
    });

    document.getElementById('hero-dropzone')?.addEventListener('click', (e) => {
      if (e.target.closest('#btn-hero-browse')) return;
      this.openFilePicker();
    });
  }

  

  

  

  

  
}

// Boot application

