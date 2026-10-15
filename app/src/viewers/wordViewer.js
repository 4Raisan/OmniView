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
      this.legacy = /\.doc$/i.test(filename);
      if (this.legacy) {
        await this.renderLegacy(arrayBuffer);
        return;
      }
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

  async renderLegacy(arrayBuffer) {
    if (!window.desktop?.readLegacyDoc) throw new Error('Legacy DOC viewing is available in the desktop app.');
    const sections = await window.desktop.readLegacyDoc(new Uint8Array(arrayBuffer));
    this.container.innerHTML = '<div class="word-viewer-wrapper fluid"><div class="word-canvas-scale"><article class="legacy-doc-content"></article></div></div>';
    const target = this.container.querySelector('.legacy-doc-content');
    const notice = document.createElement('p');
    notice.className = 'legacy-doc-notice';
    notice.textContent = 'Legacy DOC · Text view. Original page layout, images and formatting are not shown.';
    target.append(notice);
    for (const section of sections) {
      if (section.title !== 'Document') {
        const heading = document.createElement('h2'); heading.textContent = section.title; target.append(heading);
      }
      const text = document.createElement('pre'); text.textContent = section.text; target.append(text);
    }
    this.renderToolbar();
    this.updateZoom();
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
      if (wrapper) {
        wrapper.classList.remove('fluid');
        wrapper.classList.add('paged');
      }
      this.renderToolbar();
    };

    modeSwitch.querySelector('#mode-fluid').onclick = () => {
      this.viewMode = 'fluid';
      const wrapper = this.container.querySelector('.word-viewer-wrapper');
      if (wrapper) {
        wrapper.classList.remove('paged');
        wrapper.classList.add('fluid');
      }
      this.renderToolbar();
    };
    if (!this.legacy) toolbar.appendChild(modeSwitch);
    else {
      const badge = document.createElement('span'); badge.className = 'toolbar-badge'; badge.textContent = 'DOC · Text view'; toolbar.append(badge);
    }

    // Zoom controls
    const zoomGroup = document.createElement('div');
    zoomGroup.className = 'toolbar-zoom-group';
    zoomGroup.innerHTML = `
      <button class="btn-icon" id="zoom-out" title="Zoom out">${icons.zoomOut}</button>
      <span class="zoom-display">${this.zoom}%</span>
      <button class="btn-icon" id="zoom-in" title="Zoom in">${icons.zoomIn}</button>
      <button class="btn-text" id="zoom-reset" title="Reset Zoom">100%</button>
    `;

    zoomGroup.querySelector('#zoom-out').onclick = () => {
      if (this.zoom > 40) {
        this.zoom -= 15;
        this.updateZoom();
      }
    };

    zoomGroup.querySelector('#zoom-in').onclick = () => {
      if (this.zoom < 250) {
        this.zoom += 15;
        this.updateZoom();
      }
    };

    zoomGroup.querySelector('#zoom-reset').onclick = () => {
      this.zoom = 100;
      this.updateZoom();
    };
    toolbar.appendChild(zoomGroup);

    // Print button
    const printBtn = document.createElement('button');
    printBtn.className = 'btn-icon';
    printBtn.title = 'Print or save to PDF';
    printBtn.innerHTML = icons.printer;
    printBtn.onclick = () => window.print();
    toolbar.appendChild(printBtn);

    this.toolbarContainer.appendChild(toolbar);
  }

  updateZoom() {
    const scaleEl = this.container.querySelector('.word-canvas-scale');
    if (scaleEl) {
      scaleEl.style.transform = `scale(${this.zoom / 100})`;
    }
    const display = this.toolbarContainer.querySelector('.zoom-display');
    if (display) {
      display.textContent = `${this.zoom}%`;
    }
  }
}
