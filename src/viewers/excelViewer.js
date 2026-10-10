import { escapeHtml } from '../utils/safeHtml.js';
import * as XLSX from 'xlsx';
import { icons } from '../icons.js';
import { downloadBlob } from '../utils/fileHelpers.js';

export class ExcelViewer {
  constructor(container, toolbarContainer) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.workbook = null;
    this.currentSheetName = '';
    this.sheetData = [];
    this.filteredData = [];
    this.currentPage = 1;
    this.pageSize = 150;
    this.searchQuery = '';
  }

  async render(arrayBuffer, filename = 'spreadsheet.xlsx') {
    this.filename = filename;
    this.container.innerHTML = `<div class="viewer-loading"><div class="spinner"></div><p>Parsing spreadsheet...</p></div>`;

    // Process parsing in microtask
    await new Promise(r => setTimeout(r, 10));

    try {
      this.workbook = XLSX.read(arrayBuffer, { type: 'array', cellFormula: true, cellDates: true });
      if (!this.workbook.SheetNames.length) {
        throw new Error('Workbook contains no sheets.');
      }

      this.currentSheetName = this.workbook.SheetNames[0];
      this.loadCurrentSheet();
      this.renderUI();
    } catch (err) {
      this.container.innerHTML = `
        <div class="viewer-error">
          <div class="error-icon">${icons.fileSpreadsheet}</div>
          <h3>Failed to open spreadsheet</h3>
          <p>${escapeHtml(err.message || 'The file could not be parsed as a valid spreadsheet.')}</p>
        </div>
      `;
    }
  }

  loadCurrentSheet() {
    const sheet = this.workbook.Sheets[this.currentSheetName];
    if (!sheet) {
      this.sheetData = [];
      this.filteredData = [];
      return;
    }

    // Convert sheet to 2D array
    this.sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    this.currentPage = 1;
    this.applySearchFilter();
  }

  applySearchFilter() {
    if (!this.searchQuery.trim()) {
      this.filteredData = this.sheetData;
    } else {
      const q = this.searchQuery.toLowerCase();
      this.filteredData = this.sheetData.filter(row =>
        row.some(cell => String(cell).toLowerCase().includes(q))
      );
    }
  }

  renderUI() {
    this.renderToolbar();
    this.renderGrid();
  }

  renderToolbar() {
    this.toolbarContainer.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'excel-toolbar';

    // Sheet tabs
    const sheetTabs = document.createElement('div');
    sheetTabs.className = 'excel-sheet-tabs';
    this.workbook.SheetNames.forEach(sheetName => {
      const btn = document.createElement('button');
      btn.className = `excel-sheet-tab ${sheetName === this.currentSheetName ? 'active' : ''}`;
      btn.textContent = sheetName;
      btn.onclick = () => {
        if (this.currentSheetName !== sheetName) {
          this.currentSheetName = sheetName;
          this.loadCurrentSheet();
          this.renderUI();
        }
      };
      sheetTabs.appendChild(btn);
    });
    toolbar.appendChild(sheetTabs);

    // Search bar
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'toolbar-search';
    searchWrapper.innerHTML = `
      <span class="search-icon">${icons.search}</span>
      <input type="text" placeholder="Filter rows..." value="${escapeHtml(this.searchQuery)}" />
      ${this.searchQuery ? `<button class="search-clear-btn">${icons.close}</button>` : ''}
    `;

    const input = searchWrapper.querySelector('input');
    input.oninput = (e) => {
      this.searchQuery = e.target.value;
      this.currentPage = 1;
      this.applySearchFilter();
      this.renderGrid();
      const badge = this.toolbarContainer.querySelector('.toolbar-badge');
      if (badge) badge.textContent = `${this.filteredData.length} / ${this.sheetData.length} rows`;
    };

    const clearBtn = searchWrapper.querySelector('.search-clear-btn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        this.searchQuery = '';
        this.currentPage = 1;
        this.applySearchFilter();
        this.renderUI();
      };
    }
    toolbar.appendChild(searchWrapper);

    // Stats badge
    const totalRows = this.sheetData.length;
    const showingRows = this.filteredData.length;
    const statsBadge = document.createElement('div');
    statsBadge.className = 'toolbar-badge';
    statsBadge.textContent = `${showingRows}${showingRows !== totalRows ? ` / ${totalRows}` : ''} rows`;
    toolbar.appendChild(statsBadge);

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'toolbar-actions';

    // Copy table button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-icon';
    copyBtn.title = 'Copy visible table as TSV';
    copyBtn.innerHTML = icons.copy;
    copyBtn.onclick = () => this.copyTable();
    actions.appendChild(copyBtn);

    // Export CSV button
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn-icon';
    exportBtn.title = 'Export sheet to CSV';
    
    
    

    
    
  }

  

  

  

  

  
}
