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
    
    
    
    

    // Search bar
    
    
    

    
    

    
    
    

    // Stats badge
    
    
    
    
    
    

    // Action buttons
    
    

    // Copy table button
    
    
    
    
    
    

    // Export CSV button
    
    
    
    
    
    

    
    
  }

  

  

  

  

  
}
