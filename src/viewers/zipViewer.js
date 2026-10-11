import { escapeHtml } from '../utils/safeHtml.js';
import JSZip from 'jszip';
import { icons } from '../icons.js';
import { formatFileSize, getFileTypeIcon, detectFileType, downloadBlob } from '../utils/fileHelpers.js';

export class ZipViewer {
  constructor(container, toolbarContainer, onOpenFileCallback) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.onOpenFileCallback = onOpenFileCallback;
    this.zip = null;
    this.entries = [];
    this.searchQuery = '';
  }

  async render(arrayBuffer, filename = 'archive.zip') {
    this.filename = filename;
    this.container.innerHTML = `<div class="viewer-loading"><div class="spinner"></div><p>Scanning archive contents...</p></div>`;

    try {
      this.zip = await JSZip.loadAsync(arrayBuffer);
      this.entries = [];

      this.zip.forEach((relativePath, zipEntry) => {
        this.entries.push({
          path: relativePath,
          name: relativePath.split('/').filter(Boolean).pop() || relativePath,
          dir: zipEntry.dir,
          date: zipEntry.date,
          size: zipEntry._data ? zipEntry._data.uncompressedSize : 0,
          entry: zipEntry
        });
      });

      // Sort folders first, then alphabetically
      this.entries.sort((a, b) => {
        if (a.dir && !b.dir) return -1;
        if (!a.dir && b.dir) return 1;
        return a.path.localeCompare(b.path);
      });

      this.renderToolbar();
      this.renderList();
    } catch (err) {
      this.container.innerHTML = `
        <div class="viewer-error">
          <div class="error-icon">${icons.fileArchive}</div>
          <h3>Failed to read ZIP archive</h3>
          <p>${escapeHtml(err.message || 'The archive file is corrupted or not a valid ZIP.')}</p>
        </div>
      `;
    }
  }

  renderToolbar() {
    this.toolbarContainer.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'zip-toolbar';

    // File count badge
    const badge = document.createElement('div');
    badge.className = 'toolbar-badge';
    badge.textContent = `${this.entries.length} items in archive`;
    toolbar.appendChild(badge);

    // Search input
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'toolbar-search';
    searchWrapper.innerHTML = `
      <span class="search-icon">${icons.search}</span>
      <input type="text" placeholder="Filter archive files..." value="${escapeHtml(this.searchQuery)}" />
      ${this.searchQuery ? `<button class="search-clear-btn">${icons.close}</button>` : ''}
    `;

    const input = searchWrapper.querySelector('input');
    input.oninput = (e) => {
      this.searchQuery = e.target.value;
      this.renderList();
    };

    const clearBtn = searchWrapper.querySelector('.search-clear-btn');
    
    

    
  }

  
}
