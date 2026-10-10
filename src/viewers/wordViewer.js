import { sanitizeDocument } from '../utils/safeHtml.js';
import { escapeHtml } from '../utils/safeHtml.js';
import * as docx from 'docx-preview';
import { icons } from '../icons.js';

export class WordViewer {
  constructor(container, toolbarContainer) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.zoom = 100;
    this.viewMode = 'paged'; // 'paged' or 'fluid'
    this.docBody = null;
    this.headings = [];
  }

  async render(arrayBuffer, filename = 'document.docx') {
    this.filename = filename;
    this.container.innerHTML = `<div class="viewer-loading"><div class="spinner"></div><p>Rendering Word document...</p></div>`;

    // Yield execution for responsive UI
    await new Promise(r => setTimeout(r, 20));

    try {
      this.container.innerHTML = `
        <div class="word-viewer-wrapper ${this.viewMode}">
          <div class="word-canvas-scale" style="transform: scale(${this.zoom / 100}); transform-origin: top center;">
            <div class="word-content-container"></div>
          </div>
        </div>
      `;

      const targetEl = this.container.querySelector('.word-content-container');

      await docx.renderAsync(arrayBuffer, targetEl, null, {
        className: 'docx-rendered', inWrapper: true,
        ignoreWidth: false, ignoreHeight: false, breakPages: true, useBase64URL: true
      });

      this.extractHeadings(targetEl);
      this.renderToolbar();
    } catch (err) {
      this.container.innerHTML = `
        <div class="viewer-error">
          <div class="error-icon">${icons.fileWord}</div>
          <h3>Failed to open Word document</h3>
          <p>${escapeHtml(err.message || 'The document format is corrupted or unsupported.')}</p>
        </div>
      `;
    }
  }

  extractHeadings(rootEl) {
    this.headings = [];
    const elements = rootEl.querySelectorAll('h1, h2, h3, h4, .docx_heading1, .docx_heading2, .docx_heading3');
    elements.forEach((el, index) => {
      const text = el.textContent.trim();
      if (text) {
        const id = `heading-${index}`;
        el.id = id;
        this.headings.push({
          id,
          text,
          level: el.tagName.startsWith('H') ? parseInt(el.tagName.substring(1), 10) : 2
        });
      }
    });
  }

  renderToolbar() {
    this.toolbarContainer.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'word-toolbar';

    // View mode switch
    const modeSwitch = document.createElement('div');
    modeSwitch.className = 'toolbar-button-group';
    modeSwitch.innerHTML = `
      <button class="btn-group-item ${this.viewMode === 'paged' ? 'active' : ''}" id="mode-paged">Page Layout</button>
      <button class="btn-group-item ${this.viewMode === 'fluid' ? 'active' : ''}" id="mode-fluid">Continuous</button>
    `;

    modeSwitch.querySelector('#mode-paged').onclick = () => {
      this.viewMode = 'paged';
      const wrapper = this.container.querySelector('.word-viewer-wrapper');
      
      
    };

    
    

    // Zoom controls
    
    
    

    

    

    
    

    // Print button
    
    
    
    
    
    

    
  }

  
}
