import { escapeHtml } from '../utils/safeHtml.js';
import JSZip from 'jszip';
import { icons } from '../icons.js';
import { formatFileSize, getFileTypeIcon, detectFileType, downloadBlob, MAX_DOCUMENT_BYTES } from '../utils/fileHelpers.js';

// A few megabytes of ZIP can declare gigabytes of output. Bound both the row count
// and any single decompression before allocating it.
const MAX_LISTED_ENTRIES = 2000;

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
    if (clearBtn) {
      clearBtn.onclick = () => {
        this.searchQuery = '';
        this.renderToolbar();
        this.renderList();
      };
    }
    toolbar.appendChild(searchWrapper);

    this.toolbarContainer.appendChild(toolbar);
  }

  renderList() {
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'zip-viewer-container';

    let filtered = this.entries;
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      filtered = this.entries.filter(e => e.path.toLowerCase().includes(q));
    }

    if (!filtered.length) {
      wrapper.innerHTML = `<div class="empty-sheet-msg"><p>No files match "${escapeHtml(this.searchQuery)}"</p></div>`;
      this.container.appendChild(wrapper);
      return;
    }

    const listed = filtered.slice(0, MAX_LISTED_ENTRIES);
    if (filtered.length > listed.length) {
      const notice = document.createElement('p');
      notice.className = 'zip-limit-notice';
      notice.textContent = `Showing the first ${MAX_LISTED_ENTRIES} of ${filtered.length} entries. Use the filter to narrow the list.`;
      wrapper.appendChild(notice);
    }

    const table = document.createElement('table');
    table.className = 'zip-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Name</th>
          <th>Size</th>
          <th>Date</th>
          <th style="text-align: right;">Action</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    listed.forEach(item => {
      const tr = document.createElement('tr');
      const fileType = detectFileType(item.name);
      const icon = item.dir ? icons.fileArchive : getFileTypeIcon(fileType);

      tr.innerHTML = `
        <td class="zip-name-col">
          <span class="zip-entry-icon">${icon}</span>
          <span class="zip-entry-path ${item.dir ? 'is-dir' : ''}">${escapeHtml(item.path)}</span>
        </td>
        <td class="zip-size-col">${item.dir ? '—' : formatFileSize(item.size)}</td>
        <td class="zip-date-col">${item.date ? new Date(item.date).toLocaleDateString() : '—'}</td>
        <td class="zip-actions-col">
          ${!item.dir ? `
            <button class="btn-text btn-preview" title="Preview inside app">View</button>
            <button class="btn-icon btn-download" title="Extract and download">${icons.download}</button>
          ` : ''}
        </td>
      `;

      if (!item.dir) {
        const previewBtn = tr.querySelector('.btn-preview');
        if (previewBtn) {
          previewBtn.onclick = async () => {
            try {
              this.guardEntrySize(item);
              const buffer = await item.entry.async('arraybuffer');
              this.onOpenFileCallback?.({ name: item.name, buffer, size: item.size });
            } catch (error) { this.showEntryError(error.message); }
          };
        }

        const downloadBtn = tr.querySelector('.btn-download');
        if (downloadBtn) {
          downloadBtn.onclick = async () => {
            try {
              this.guardEntrySize(item);
              const blob = await item.entry.async('blob');
              downloadBlob(blob, item.name);
            } catch (error) { this.showEntryError(error.message); }
          };
        }
      }

      tbody.appendChild(tr);
    });

    wrapper.appendChild(table);
    this.container.appendChild(wrapper);
  }

  guardEntrySize(item) {
    if (item.size > MAX_DOCUMENT_BYTES) {
      throw new Error(`"${item.name}" expands to ${formatFileSize(item.size)}, past the 256 MB limit. Extract it with an archive tool instead.`);
    }
  }

  showEntryError(message) {
    this.toolbarContainer.querySelector('.zip-entry-error')?.remove();
    const error = document.createElement('span');
    error.className = 'edit-error zip-entry-error';
    error.setAttribute('role', 'status');
    error.textContent = message;
    error.title = message;
    this.toolbarContainer.appendChild(error);
  }

  destroy() {
    this.zip = null;
    this.entries = [];
    this.container.replaceChildren();
    this.toolbarContainer.replaceChildren();
  }
}
