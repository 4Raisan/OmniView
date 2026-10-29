import { escapeHtml } from '../utils/safeHtml.js';
import * as XLSX from 'xlsx';
import { icons } from '../icons.js';
import { downloadBlob } from '../utils/fileHelpers.js';

// Excel allows 1,048,576 x 16,384 cells. Materialising that as JS arrays is not
// survivable, so bound what is read and say so in the toolbar.
const MAX_SHEET_ROWS = 200_000;
const MAX_SHEET_COLUMNS = 512;

export class ExcelViewer {
  constructor(container, toolbarContainer) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.workbook = null;
    this.currentSheetName = '';
    this.sheetData = [];
    this.sheetTypes = [];
    this.filteredData = [];
    this.filteredTypes = [];
    this.truncated = false;
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
      this.workbook = XLSX.read(arrayBuffer, { type: 'array', cellFormula: true, cellDates: true, cellNF: true });
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
    if (!sheet || !sheet['!ref']) {
      this.sheetData = [];
      this.sheetTypes = [];
      this.truncated = false;
      this.currentPage = 1;
      this.applySearchFilter();
      return;
    }

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const lastRow = Math.min(range.e.r, range.s.r + MAX_SHEET_ROWS - 1);
    const lastColumn = Math.min(range.e.c, range.s.c + MAX_SHEET_COLUMNS - 1);
    this.truncated = lastRow < range.e.r || lastColumn < range.e.c;
    const rows = [];
    const types = [];
    for (let r = range.s.r; r <= lastRow; r++) {
      const row = [];
      const typeRow = [];
      for (let c = range.s.c; c <= lastColumn; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        // format_cell applies the workbook's own number format and date style;
        // textContent on a raw Date would print "Mon Oct 13 2026 00:00:00 GMT+...".
        row.push(cell ? XLSX.utils.format_cell(cell) : '');
        typeRow.push(cell?.t === 'n');
      }
      rows.push(row);
      types.push(typeRow);
    }
    this.sheetData = rows;
    this.sheetTypes = types;
    this.currentPage = 1;
    this.applySearchFilter();
  }

  applySearchFilter() {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) {
      this.filteredData = this.sheetData;
      this.filteredTypes = this.sheetTypes;
      return;
    }
    this.filteredData = [];
    this.filteredTypes = [];
    for (let index = 0; index < this.sheetData.length; index++) {
      if (this.sheetData[index].some(cell => String(cell).toLowerCase().includes(query))) {
        this.filteredData.push(this.sheetData[index]);
        this.filteredTypes.push(this.sheetTypes[index]);
      }
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
      clearTimeout(this.searchTimer);
      // Scanning every cell of a large sheet on each keystroke freezes the UI.
      this.searchTimer = setTimeout(() => {
        this.currentPage = 1;
        this.applySearchFilter();
        this.renderGrid();
        const badge = this.toolbarContainer.querySelector('.excel-row-count');
        if (badge) badge.textContent = `${this.filteredData.length} / ${this.sheetData.length} rows`;
      }, 150);
    };

    const clearBtn = searchWrapper.querySelector('.search-clear-btn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        clearTimeout(this.searchTimer);
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
    statsBadge.className = 'toolbar-badge excel-row-count';
    statsBadge.textContent = `${showingRows}${showingRows !== totalRows ? ` / ${totalRows}` : ''} rows`;
    toolbar.appendChild(statsBadge);

    if (this.truncated) {
      const limitBadge = document.createElement('div');
      limitBadge.className = 'toolbar-badge excel-limit';
      limitBadge.textContent = `Limited to ${MAX_SHEET_ROWS.toLocaleString()} rows × ${MAX_SHEET_COLUMNS} columns`;
      limitBadge.title = 'This sheet is larger than the viewer reads. Open it in a spreadsheet application for the full range.';
      toolbar.appendChild(limitBadge);
    }

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'toolbar-actions';

    // Copy table button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-icon';
    copyBtn.title = 'Copy all filtered rows as TSV';
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
        const td = document.createElement('td');
        const val = row && row[c] !== undefined ? row[c] : '';
        td.textContent = val;
        if (this.filteredTypes[startIdx + rowOffset]?.[c]) td.classList.add('num-cell');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrapper.appendChild(tableWrap);

    // Pagination footer if more than 1 page
    if (totalPages > 1) {
      const footer = document.createElement('div');
      footer.className = 'excel-pagination';
      footer.innerHTML = `
        <button class="btn-icon" ${this.currentPage <= 1 ? 'disabled' : ''} id="prev-page">${icons.chevronLeft}</button>
        <span>Page <strong>${this.currentPage}</strong> of <strong>${totalPages}</strong> (${this.filteredData.length} total rows)</span>
        <button class="btn-icon" ${this.currentPage >= totalPages ? 'disabled' : ''} id="next-page">${icons.chevronRight}</button>
      `;

      footer.querySelector('#prev-page').onclick = () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.renderGrid();
        }
      };

      footer.querySelector('#next-page').onclick = () => {
        if (this.currentPage < totalPages) {
          this.currentPage++;
          this.renderGrid();
        }
      };

      wrapper.appendChild(footer);
    }

    this.container.appendChild(wrapper);
  }

  getColumnLetter(colIndex) {
    let letter = '';
    let temp = colIndex;
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  }

  copyTable() {
    if (!this.filteredData.length) return;
    const tsv = this.filteredData.map(row => row.join('\t')).join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      this.showToast('Table copied to clipboard!');
    });
  }

  exportCSV() {
    const sheet = this.workbook.Sheets[this.currentSheetName];
    if (!sheet) return;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const cleanName = (this.filename.replace(/\.[^/.]+$/, '') || 'sheet') + `_${this.currentSheetName}.csv`;
    downloadBlob(blob, cleanName);
  }

  showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  destroy() {
    clearTimeout(this.searchTimer);
    this.workbook = null;
    this.sheetData = [];
    this.sheetTypes = [];
    this.filteredData = [];
    this.filteredTypes = [];
    this.container.replaceChildren();
    this.toolbarContainer.replaceChildren();
  }
}
