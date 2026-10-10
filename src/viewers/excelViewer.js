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
    exportBtn.innerHTML = icons.download;
    exportBtn.onclick = () => this.exportCSV();
    actions.appendChild(exportBtn);

    toolbar.appendChild(actions);
    this.toolbarContainer.appendChild(toolbar);
  }

  renderGrid() {
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'excel-viewer-container';

    if (!this.filteredData || this.filteredData.length === 0) {
      wrapper.innerHTML = `
        <div class="empty-sheet-msg">
          <p>${this.searchQuery ? 'No rows match your filter.' : 'This sheet is empty.'}</p>
        </div>
      `;
      this.container.appendChild(wrapper);
      return;
    }

    // Determine max columns
    let maxCols = 0;
    for (let i = 0; i < this.filteredData.length; i++) {
      if (this.filteredData[i] && this.filteredData[i].length > maxCols) {
        maxCols = this.filteredData[i].length;
      }
    }
    maxCols = Math.max(maxCols, 1);

    // Pagination slice
    const totalPages = Math.ceil(this.filteredData.length / this.pageSize);
    const startIdx = (this.currentPage - 1) * this.pageSize;
    const endIdx = Math.min(startIdx + this.pageSize, this.filteredData.length);
    const pageRows = this.filteredData.slice(startIdx, endIdx);

    // Table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'excel-table-scroll';

    const table = document.createElement('table');
    table.className = 'excel-grid';

    // Header row with Column letters (A, B, C...)
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    // Top-left origin cell
    const originCell = document.createElement('th');
    originCell.className = 'excel-origin-cell';
    originCell.textContent = '';
    headerRow.appendChild(originCell);

    for (let c = 0; c < maxCols; c++) {
      const th = document.createElement('th');
      th.className = 'excel-col-header';
      th.textContent = this.getColumnLetter(c);
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Table body
    const tbody = document.createElement('tbody');
    pageRows.forEach((row, rowOffset) => {
      const actualRowIndex = startIdx + rowOffset + 1;
      const tr = document.createElement('tr');

      // Row number header
      const rowHeader = document.createElement('th');
      rowHeader.className = 'excel-row-header';
      rowHeader.textContent = actualRowIndex;
      tr.appendChild(rowHeader);

      for (let c = 0; c < maxCols; c++) {
        
        
        
        
        
      }
      
    });
    
    
    

    // Pagination footer if more than 1 page
    

    
  }

  

  

  

  
}
