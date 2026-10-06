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
    
    
    
  }

  

  

  

  

  

  

  

  
}
