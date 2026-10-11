import { escapeHtml } from '../utils/safeHtml.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { icons } from '../icons.js';
import { downloadBlob } from '../utils/fileHelpers.js';

// Setup worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export class PdfViewer {
  constructor(container, toolbarContainer) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.pdfDoc = null;
    this.currentPageNum = 1;
    this.scale = 1.25;
    this.rotation = 0;
    this.rendering = false;
    this.pendingPageNum = null;
    this.rawBuffer = null;
    this.pages = [];
    this.renderQueue = new Set();
    this.renderGeneration = 0;
  }

  async render(arrayBuffer, filename = 'document.pdf') {
    this.filename = filename;
    this.rawBuffer = arrayBuffer;
    this.container.innerHTML = `<div class="viewer-loading"><div class="spinner"></div><p>Rendering PDF...</p></div>`;

    try {
      const loadingTask = this.loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer.slice(0)),
        cMapUrl: new URL('pdf-assets/cmaps/', document.baseURI).href,
        standardFontDataUrl: new URL('pdf-assets/standard_fonts/', document.baseURI).href,
        wasmUrl: new URL('pdf-assets/wasm/', document.baseURI).href,
        cMapPacked: true
      });

      this.pdfDoc = await loadingTask.promise;
      if (this.destroyed) return;
      this.currentPageNum = 1;
      this.rotation = 0;

      await this.setupContainer();
      if (this.destroyed) return;
      this.renderToolbar();
      this.updatePageIndicator();
      this.queueVisiblePages();
    } catch (err) {
      console.error('PDF error:', err);
      this.container.innerHTML = `
        <div class="viewer-error">
          <div class="error-icon">${icons.filePdf}</div>
          <h3>Failed to open PDF</h3>
          <p>${escapeHtml(err.message || 'The PDF file could not be parsed.')}</p>
        </div>
      `;
    }
  }

  async print() {
    if (!this.pdfDoc || this.printing) return;
    this.printing = true;
    const printArea = document.createElement('div');
    const printUrls = [];
    printArea.className = 'pdf-print-pages';
    document.body.append(printArea);
    try {
      for (let number = 1; number <= this.pdfDoc.numPages; number++) {
        const page = await this.pdfDoc.getPage(number);
        const dimensions = page.getViewport({ scale: 1, rotation: this.rotation });
        const printScale = Math.min(1.5, Math.sqrt(8_000_000 / (dimensions.width * dimensions.height)));
        const viewport = page.getViewport({ scale: printScale, rotation: this.rotation });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const image = document.createElement('img');
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        if (!blob) throw new Error('Could not prepare the page for printing.');
        image.src = URL.createObjectURL(blob);
        printUrls.push(image.src);
        await image.decode();
        printArea.append(image);
        canvas.width = canvas.height = 0;
      }
      document.body.classList.add('printing-pdf');
      if (window.desktop) await window.desktop.print();
      else window.print();
    } finally {
      document.body.classList.remove('printing-pdf');
      printArea.remove();
      printUrls.forEach(url => URL.revokeObjectURL(url));
      this.printing = false;
    }
  }

  destroy() {
    this.destroyed = true;
    this.renderGeneration++;
    this.renderTask?.cancel();
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.scrollFrame);
    this.loadingTask?.destroy().catch(() => {});
    for (const item of this.pages) item.canvas.width = item.canvas.height = 0;
    this.renderQueue.clear();
  }

  suspend() {
    this.suspended = true;
    this.renderGeneration++;
    this.renderTask?.cancel();
    this.renderQueue.clear();
    for (const item of this.pages) {
      item.canvas.width = item.canvas.height = 0;
      item.rendered = false;
      item.section.classList.remove('rendered');
      item.page.cleanup();
    }
  }

  resume() {
    this.suspended = false;
    this.queueVisiblePages();
  }

  async setupContainer() {
    this.container.innerHTML = '<div class="pdf-viewer-wrapper" tabindex="0" aria-label="PDF pages"></div>';
    this.scrollArea = this.container.firstElementChild;
    const fragment = document.createDocumentFragment();
    for (let number = 1; number <= this.pdfDoc.numPages; number++) {
      const page = await this.pdfDoc.getPage(number);
      if (this.destroyed) return;
      const section = document.createElement('section');
      section.className = 'pdf-page';
      section.dataset.page = number;
      section.setAttribute('aria-label', `Page ${number}`);
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      if (number === 1) canvas.id = 'pdf-canvas';
      section.append(canvas);
      this.pages.push({ page, section, canvas, rendered: false });
      fragment.append(section);
    }
    this.scrollArea.append(fragment);
    this.layoutPages();
    this.scrollArea.addEventListener('scroll', () => {
      cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = requestAnimationFrame(() => {
        this.trackCurrentPage();
        this.queueVisiblePages();
      });
    });
    this.resizeObserver = new ResizeObserver(() => this.queueVisiblePages());
    this.resizeObserver.observe(this.scrollArea);
  }

  layoutPages() {
    this.renderGeneration++;
    this.renderTask?.cancel();
    this.renderQueue.clear();
    for (const item of this.pages) {
      const viewport = item.page.getViewport({ scale: this.scale, rotation: this.rotation });
      item.section.style.width = `${Math.floor(viewport.width)}px`;
      item.section.style.height = `${Math.floor(viewport.height)}px`;
      item.canvas.width = item.canvas.height = 0;
      item.canvas.style.width = '100%';
      item.canvas.style.height = '100%';
      item.rendered = false;
      item.section.classList.remove('rendered');
    }
    this.layoutScale = this.scale;
    this.layoutRotation = this.rotation;
  }

  async renderPage(number) {
    if (!this.scrollArea || this.destroyed) return;
    number = Math.max(1, Math.min(this.pdfDoc.numPages, number));
    if (this.layoutScale !== this.scale || this.layoutRotation !== this.rotation) this.layoutPages();
    this.currentPageNum = number;
    const item = this.pages[number - 1];
    this.scrollArea.scrollTop += item.section.getBoundingClientRect().top - this.scrollArea.getBoundingClientRect().top - 24;
    this.updatePageIndicator();
    this.queueVisiblePages();
  }

  trackCurrentPage() {
    if (!this.scrollArea.clientHeight) return;
    if (this.scrollArea.scrollTop > 0 && this.scrollArea.scrollHeight - this.scrollArea.clientHeight - this.scrollArea.scrollTop <= 2) {
      this.currentPageNum = this.pdfDoc.numPages;
      this.updatePageIndicator();
      return;
    }
    const top = this.scrollArea.getBoundingClientRect().top + 40;
    let current = 1;
    for (const item of this.pages) {
      if (item.section.getBoundingClientRect().top <= top) current = Number(item.section.dataset.page);
      else break;
    }
    this.currentPageNum = current;
    this.updatePageIndicator();
  }

  queueVisiblePages() {
    if (!this.scrollArea?.clientHeight || this.destroyed || this.suspended) return;
    const bounds = this.scrollArea.getBoundingClientRect();
    for (let index = 0; index < this.pages.length; index++) {
      const item = this.pages[index];
      const rect = item.section.getBoundingClientRect();
      if (rect.bottom >= bounds.top - 600 && rect.top <= bounds.bottom + 600) {
        if (!item.rendered) this.renderQueue.add(index);
      } else {
        this.renderQueue.delete(index);
        // Release far-away canvases; retain the page-sized placeholder.
        if (item.rendered && (rect.bottom < bounds.top - 2000 || rect.top > bounds.bottom + 2000)) {
          item.canvas.width = item.canvas.height = 0;
          item.rendered = false;
          item.section.classList.remove('rendered');
          item.page.cleanup();
        }
      }
    }
    this.flushRenderQueue();
  }

  async flushRenderQueue() {
    if (this.rendering || this.destroyed || this.suspended) return;
    this.rendering = true;
    try {
      while (this.renderQueue.size && !this.destroyed && !this.suspended) {
        const index = this.renderQueue.values().next().value;
        this.renderQueue.delete(index);
        const item = this.pages[index];
        if (item.rendered) continue;
        const generation = this.renderGeneration;
        const viewport = item.page.getViewport({ scale: this.scale, rotation: this.rotation });
        // Bound one screen canvas to 32 MB even on high-DPI displays at high zoom.
        const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
        item.canvas.width = Math.floor(viewport.width * dpr);
        item.canvas.height = Math.floor(viewport.height * dpr);
        try {
          this.renderTask = item.page.render({
            canvasContext: item.canvas.getContext('2d', { alpha: false }), viewport,
            transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0]
          });
          await this.renderTask.promise;
          if (generation === this.renderGeneration) {
            item.rendered = true;
            item.section.classList.add('rendered');
          }
        } catch (error) {
          if (error.name !== 'RenderingCancelledException' && !this.destroyed) {
            console.error('PDF page rendering failed', error);
          }
        } finally {
          this.renderTask = null;
          if (this.suspended || this.destroyed) {
            item.canvas.width = item.canvas.height = 0;
            item.page.cleanup();
          }
        }
      }
    } finally { this.rendering = false; }
  }

  renderToolbar() {
    this.toolbarContainer.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'pdf-toolbar';

    // Page navigation
    const navGroup = document.createElement('div');
    navGroup.className = 'toolbar-nav-group';
    navGroup.innerHTML = `
      <button class="btn-icon" id="pdf-prev" title="Previous page" aria-label="Previous page">${icons.chevronLeft}</button>
      <div class="pdf-page-indicator">
        <input type="number" aria-label="Page number" id="pdf-page-input" value="${this.currentPageNum}" min="1" max="${this.pdfDoc.numPages}" />
        <span>/ ${this.pdfDoc.numPages}</span>
      </div>
      <button class="btn-icon" id="pdf-next" title="Next page" aria-label="Next page">${icons.chevronRight}</button>
    `;

    navGroup.querySelector('#pdf-prev').onclick = () => {
      if (this.currentPageNum > 1) {
        this.renderPage(this.currentPageNum - 1);
      }
    };

    navGroup.querySelector('#pdf-next').onclick = () => {
      if (this.currentPageNum < this.pdfDoc.numPages) {
        this.renderPage(this.currentPageNum + 1);
      }
    };

    const input = navGroup.querySelector('#pdf-page-input');
    input.onchange = (e) => {
      const val = parseInt(e.target.value, 10);
      if (val >= 1 && val <= this.pdfDoc.numPages) {
        this.renderPage(val);
      } else {
        input.value = this.currentPageNum;
      }
    };
    toolbar.appendChild(navGroup);

    // Zoom controls
    const zoomGroup = document.createElement('div');
    zoomGroup.className = 'toolbar-zoom-group';
    zoomGroup.innerHTML = `
      <button class="btn-icon" id="pdf-zoom-out" title="Zoom out">${icons.zoomOut}</button>
      <span class="zoom-display">${Math.round(this.scale * 100)}%</span>
      <button class="btn-icon" id="pdf-zoom-in" title="Zoom in">${icons.zoomIn}</button>
      <button class="btn-text" id="pdf-fit-width">Fit Width</button>
    `;

    zoomGroup.querySelector('#pdf-zoom-out').onclick = () => {
      if (this.scale > 0.4) {
        this.scale = Math.max(0.4, this.scale - 0.2);
        this.renderPage(this.currentPageNum);
        this.updateZoomDisplay();
      }
    };

    zoomGroup.querySelector('#pdf-zoom-in').onclick = () => {
      if (this.scale < 3.0) {
        this.scale = Math.min(3.0, this.scale + 0.2);
        this.renderPage(this.currentPageNum);
        this.updateZoomDisplay();
      }
    };

    zoomGroup.querySelector('#pdf-fit-width').onclick = async () => {
      const page = await this.pdfDoc.getPage(this.currentPageNum);
      const viewport = page.getViewport({ scale: 1.0, rotation: this.rotation });
      const containerWidth = this.scrollArea.clientWidth - 48;
      if (containerWidth > 0 && viewport.width > 0) {
        this.scale = Math.min(2.5, Math.max(0.5, containerWidth / viewport.width));
        this.renderPage(this.currentPageNum);
        this.updateZoomDisplay();
      }
    };
    toolbar.appendChild(zoomGroup);

    // Rotate button
    const rotateBtn = document.createElement('button');
    rotateBtn.className = 'btn-icon';
    rotateBtn.title = 'Rotate Clockwise';
    rotateBtn.innerHTML = icons.rotate;
    rotateBtn.onclick = () => {
      this.rotation = (this.rotation + 90) % 360;
      this.renderPage(this.currentPageNum);
    };
    toolbar.appendChild(rotateBtn);

    // Print & Download
    const actionsGroup = document.createElement('div');
    actionsGroup.className = 'toolbar-actions';

    const printBtn = document.createElement('button');
    printBtn.className = 'btn-icon';
    printBtn.title = 'Print PDF';
    printBtn.innerHTML = icons.printer;
    printBtn.onclick = () => this.print().catch(error => alert(error.message));
    actionsGroup.appendChild(printBtn);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn-icon';
    downloadBtn.title = 'Download PDF';
    downloadBtn.innerHTML = icons.download;
    downloadBtn.onclick = () => {
      const blob = new Blob([this.rawBuffer], { type: 'application/pdf' });
      downloadBlob(blob, this.filename);
    };
    actionsGroup.appendChild(downloadBtn);

    toolbar.appendChild(actionsGroup);
    this.toolbarContainer.appendChild(toolbar);
  }

  updatePageIndicator() {
    const input = this.toolbarContainer.querySelector('#pdf-page-input');
    if (input && document.activeElement !== input) input.value = this.currentPageNum;
    const prevBtn = this.toolbarContainer.querySelector('#pdf-prev');
    const nextBtn = this.toolbarContainer.querySelector('#pdf-next');
    if (prevBtn) prevBtn.disabled = this.currentPageNum <= 1;
    if (nextBtn) nextBtn.disabled = this.currentPageNum >= this.pdfDoc.numPages;
  }

  updateZoomDisplay() {
    const display = this.toolbarContainer.querySelector('.zoom-display');
    if (display) {
      display.textContent = `${Math.round(this.scale * 100)}%`;
    }
  }
}
