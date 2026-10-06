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
    
    
    
    
    
  }

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  

  
}

// Boot application

