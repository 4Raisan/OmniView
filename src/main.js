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
      
    });
    
    
    
    
    
    
    
    
    
    
    
    
    
    // Open file button
    

    

    

    // Theme toggle
    

    // Sidebar toggle
    

    // Clear recent files
    

    // Global Drag and Drop
    

    

    

    // Global Keyboard Shortcuts
    
  }

  

  

  

  

  

  

  

  

  

  

  

  

  
}

// Boot application

