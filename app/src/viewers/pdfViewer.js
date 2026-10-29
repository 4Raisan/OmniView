import { escapeHtml } from '../utils/safeHtml.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { icons } from '../icons.js';
import { downloadBlob } from '../utils/fileHelpers.js';

// Setup worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const SCREEN_PIXEL_BUDGET = 8_000_000;
// Bound the whole print job, not one page: 300 pages at 8M pixels each is gigabytes.
const PRINT_PIXEL_BUDGET = 200_000_000;

let textLayerStyles;
function loadTextLayerStyles() {
  textLayerStyles ??= new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('pdf-assets/text-layer.css', document.baseURI).href;
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
  return textLayerStyles;
}

export class PdfViewer {
  constructor(container, toolbarContainer) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.pdfDoc = null;
    this.currentPageNum = 1;
    this.scale = 1.25;
    this.rotation = 0;
    this.rendering = false;
    this.pages = [];
    this.pageTops = null;
    this.pageHeights = null;
    this.renderQueue = new Set();
    this.renderGeneration = 0;
    this.findQuery = '';
    this.findMatches = [];
    this.matchIndex = -1;
    this.findGeneration = 0;
  }

  async render(data, filename = 'document.pdf') {
    this.filename = filename;
    this.container.innerHTML = `<div class="viewer-loading"><div class="spinner"></div><p>Rendering PDF...</p></div>`;

    try {
      await loadTextLayerStyles();
      const loadingTask = this.loadingTask = pdfjsLib.getDocument({
        data,
        cMapUrl: new URL('pdf-assets/cmaps/', document.baseURI).href,
        standardFontDataUrl: new URL('pdf-assets/standard_fonts/', document.baseURI).href,
        wasmUrl: new URL('pdf-assets/wasm/', document.baseURI).href,
        cMapPacked: true
      });
      // onPassword lives on the loading task, not in the getDocument parameters.
      loadingTask.onPassword = (callback, reason) => this.requestPassword(callback, reason);

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
      if (this.destroyed) return;
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

  requestPassword(callback, reason) {
    const form = document.createElement('form');
    form.className = 'pdf-password-form';
    const heading = document.createElement('h3');
    heading.textContent = 'This PDF is password protected';
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'PDF password');
    const error = document.createElement('p');
    error.className = 'pdf-password-error';
    error.setAttribute('role', 'status');
    error.textContent = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD ? 'That password was not correct. Try again.' : '';
    const unlock = document.createElement('button');
    unlock.type = 'submit'; unlock.className = 'btn-primary'; unlock.textContent = 'Unlock';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn-text'; cancel.textContent = 'Cancel';
    form.append(heading, input, error, unlock, cancel);
    form.onsubmit = event => {
      event.preventDefault();
      this.container.innerHTML = '<div class="viewer-loading"><div class="spinner"></div><p>Unlocking PDF...</p></div>';
      callback(input.value);
    };
    cancel.onclick = () => {
      this.destroyed = true;
      this.loadingTask?.destroy().catch(() => {});
      this.container.innerHTML = '<div class="viewer-error"><h3>Password required</h3><p>This PDF cannot be opened without its password.</p></div>';
    };
    this.container.replaceChildren(form);
    input.focus();
  }

  async print() {
    if (!this.pdfDoc || this.printing) return;
    this.printing = true;
    const printArea = document.createElement('div');
    const printUrls = [];
    printArea.className = 'pdf-print-pages';
    document.body.append(printArea);
    try {
      const perPageBudget = Math.min(SCREEN_PIXEL_BUDGET, PRINT_PIXEL_BUDGET / this.pdfDoc.numPages);
      for (let number = 1; number <= this.pdfDoc.numPages; number++) {
        const page = await this.pdfDoc.getPage(number);
        const rotation = (page.rotate + this.rotation) % 360;
        const dimensions = page.getViewport({ scale: 1, rotation });
        const printScale = Math.min(1.5, Math.sqrt(perPageBudget / (dimensions.width * dimensions.height)));
        const viewport = page.getViewport({ scale: printScale, rotation });
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
        page.cleanup();
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
    this.findGeneration++;
    clearTimeout(this.findTimer);
    this.renderTask?.cancel();
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.scrollFrame);
    this.loadingTask?.destroy().catch(() => {});
    for (const item of this.pages) item.canvas.width = item.canvas.height = 0;
    this.renderQueue.clear();
    this.pages = [];
    this.pageTops = null;
    this.pageHeights = null;
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
      item.textLayer.replaceChildren();
      item.textDivs = null;
      item.page?.cleanup();
    }
  }

  resume() {
    this.suspended = false;
    this.queueVisiblePages();
  }

  async setupContainer() {
    this.container.innerHTML = '<div class="pdf-viewer-wrapper" tabindex="0" aria-label="PDF pages"></div>';
    this.scrollArea = this.container.firstElementChild;
    const first = await this.pdfDoc.getPage(1);
    if (this.destroyed) return;
    const base = first.getViewport({ scale: 1 });
    const fragment = document.createDocumentFragment();
    for (let number = 1; number <= this.pdfDoc.numPages; number++) {
      const section = document.createElement('section');
      section.className = 'pdf-page';
      section.dataset.page = number;
      section.setAttribute('aria-label', `Page ${number}`);
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      if (number === 1) canvas.id = 'pdf-canvas';
      const textLayer = document.createElement('div');
      textLayer.className = 'textLayer';
      section.append(canvas, textLayer);
      // Only page 1 is fetched up front; the rest use its size until scrolled near.
      this.pages.push({
        page: number === 1 ? first : null, section, canvas, textLayer,
        rendered: false, width: base.width, height: base.height, textDivs: null, textPromise: null
      });
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

  sizeSection(item) {
    const swapped = this.rotation % 180 !== 0;
    const width = (swapped ? item.height : item.width) * this.scale;
    const height = (swapped ? item.width : item.height) * this.scale;
    item.section.style.width = `${Math.floor(width)}px`;
    item.section.style.height = `${Math.floor(height)}px`;
  }

  async ensurePage(index) {
    const item = this.pages[index];
    if (!item.page) {
      item.page = await this.pdfDoc.getPage(index + 1);
      const viewport = item.page.getViewport({ scale: 1 });
      if (Math.abs(viewport.width - item.width) > 0.5 || Math.abs(viewport.height - item.height) > 0.5) {
        item.width = viewport.width;
        item.height = viewport.height;
        this.sizeSection(item);
        this.pageTops = null;
        this.pageHeights = null;
      }
    }
    return item;
  }

  pageText(item) {
    item.textPromise ??= item.page.getTextContent();
    return item.textPromise;
  }

  layoutPages() {
    this.renderGeneration++;
    this.pageTops = null;
    this.pageHeights = null;
    this.renderTask?.cancel();
    this.renderQueue.clear();
    for (const item of this.pages) {
      this.sizeSection(item);
      item.canvas.width = item.canvas.height = 0;
      item.canvas.style.width = '100%';
      item.canvas.style.height = '100%';
      item.rendered = false;
      item.section.classList.remove('rendered');
      item.textLayer.replaceChildren();
      item.textDivs = null;
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

  // Measured once per layout, in scroll-content coordinates. Scroll tracking and
  // visibility then cost arithmetic instead of a forced layout read per page.
  pageGeometry() {
    if (!this.pageTops) {
      const areaTop = this.scrollArea.getBoundingClientRect().top;
      const scrollTop = this.scrollArea.scrollTop;
      this.pageTops = [];
      this.pageHeights = [];
      for (const item of this.pages) {
        const rect = item.section.getBoundingClientRect();
        this.pageTops.push(rect.top - areaTop + scrollTop);
        this.pageHeights.push(rect.height);
      }
    }
    return this.pageTops;
  }

  trackCurrentPage() {
    if (!this.scrollArea.clientHeight) return;
    const { scrollTop, scrollHeight, clientHeight } = this.scrollArea;
    if (scrollTop > 0 && scrollHeight - clientHeight - scrollTop <= 2) {
      this.currentPageNum = this.pdfDoc.numPages;
      this.updatePageIndicator();
      return;
    }
    // The page straddling the viewport centre is the current one. A top-edge rule
    // disagrees with scrolling a search match into the middle of the view.
    const tops = this.pageGeometry();
    const middle = scrollTop + clientHeight / 2;
    let low = 0, high = tops.length - 1, current = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (tops[mid] <= middle) { current = mid; low = mid + 1; } else high = mid - 1;
    }
    this.currentPageNum = current + 1;
    this.updatePageIndicator();
  }

  queueVisiblePages() {
    if (!this.scrollArea?.clientHeight || this.destroyed || this.suspended) return;
    const tops = this.pageGeometry();
    const { scrollTop, clientHeight } = this.scrollArea;
    const viewTop = scrollTop - 600;
    const viewBottom = scrollTop + clientHeight + 600;
    const keepTop = scrollTop - 2000;
    const keepBottom = scrollTop + clientHeight + 2000;
    for (let index = 0; index < this.pages.length; index++) {
      const top = tops[index];
      const bottom = top + this.pageHeights[index];
      const item = this.pages[index];
      if (bottom >= viewTop && top <= viewBottom) {
        if (!item.rendered) this.renderQueue.add(index);
      } else {
        this.renderQueue.delete(index);
        // Release far-away canvases; retain the page-sized placeholder.
        if (item.rendered && (bottom < keepTop || top > keepBottom)) {
          item.canvas.width = item.canvas.height = 0;
          item.rendered = false;
          item.section.classList.remove('rendered');
          item.textLayer.replaceChildren();
          item.textDivs = null;
          item.page?.cleanup();
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
        await this.ensurePage(index);
        if (generation !== this.renderGeneration || this.destroyed || this.suspended) continue;
        const viewport = item.page.getViewport({ scale: this.scale, rotation: (item.page.rotate + this.rotation) % 360 });
        // Bound one screen canvas to 32 MB even on high-DPI displays at high zoom.
        const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(SCREEN_PIXEL_BUDGET / (viewport.width * viewport.height)));
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
            await this.renderTextLayer(item, viewport, generation);
          }
        } catch (error) {
          if (error.name !== 'RenderingCancelledException' && !this.destroyed) {
            console.error('PDF page rendering failed', error);
          }
        } finally {
          this.renderTask = null;
          if (this.suspended || this.destroyed) {
            item.canvas.width = item.canvas.height = 0;
            item.page?.cleanup();
          }
        }
      }
    } finally { this.rendering = false; }
  }

  async renderTextLayer(item, viewport, generation) {
    const textContent = await this.pageText(item);
    if (generation !== this.renderGeneration || this.destroyed || this.suspended || !item.rendered) return;
    item.textLayer.replaceChildren();
    const layer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: item.textLayer, viewport });
    await layer.render();
    if (generation !== this.renderGeneration || this.destroyed || this.suspended) return;
    item.textDivs = layer.textDivs;
    this.highlightPage(item);
    this.scrollToMatch(item);
  }

  async runFind(query) {
    const generation = ++this.findGeneration;
    this.findQuery = query;
    this.findMatches = [];
    this.matchIndex = -1;
    this.clearHighlights();
    if (!query.trim() || !this.pdfDoc) { this.updateFindCount(); return; }
    const needle = query.toLowerCase();
    const total = this.pdfDoc.numPages;
    const start = this.currentPageNum - 1;
    // Scan outward from the current page so the nearest hit is found first.
    for (let offset = 0; offset < total; offset++) {
      if (generation !== this.findGeneration || this.destroyed) return;
      const index = (start + offset) % total;
      const item = await this.ensurePage(index);
      if (generation !== this.findGeneration || this.destroyed) return;
      const text = await this.pageText(item);
      const joined = text.items.map(entry => entry.str).join(' ').toLowerCase();
      let at = joined.indexOf(needle);
      while (at !== -1) {
        this.findMatches.push(index);
        at = joined.indexOf(needle, at + needle.length);
      }
      this.updateFindCount();
      if (this.findMatches.length && this.matchIndex === -1) {
        this.matchIndex = 0;
        this.updateFindCount();
        // Highlight now if the page is already rendered; navigating re-highlights
        // through renderTextLayer once the page comes into view.
        this.highlightPage(item);
        this.renderPage(index + 1);
        this.scrollToMatch(item);
      }
      // Yield regularly so a long document does not block typing.
      if (offset % 10 === 9) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (generation === this.findGeneration) this.updateFindCount();
  }

  stepMatch(delta) {
    if (!this.findMatches.length) return;
    this.matchIndex = (this.matchIndex + delta + this.findMatches.length) % this.findMatches.length;
    const item = this.pages[this.findMatches[this.matchIndex]];
    this.updateFindCount();
    this.highlightPage(item);
    this.renderPage(this.findMatches[this.matchIndex] + 1);
    this.scrollToMatch(item);
  }

  scrollToMatch(item) {
    if (this.matchIndex < 0 || this.findMatches[this.matchIndex] !== this.pages.indexOf(item)) return;
    const mark = item.textLayer.querySelector('mark.pdf-match');
    if (mark) mark.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  clearHighlights() {
    for (const item of this.pages) {
      if (!item.textDivs) continue;
      for (const div of item.textDivs) {
        if (div.querySelector('mark.pdf-match')) div.textContent = div.dataset.original ?? div.textContent;
      }
    }
  }

  highlightPage(item) {
    const query = this.findQuery;
    if (!query.trim() || !item.textDivs) return;
    const needle = query.toLowerCase();
    for (const div of item.textDivs) {
      const text = div.textContent;
      const lower = text.toLowerCase();
      if (!lower.includes(needle)) continue;
      div.dataset.original = text;
      const fragment = document.createDocumentFragment();
      let start = 0, index;
      while ((index = lower.indexOf(needle, start)) !== -1) {
        fragment.append(document.createTextNode(text.slice(start, index)));
        const mark = document.createElement('mark');
        mark.className = 'pdf-match';
        mark.textContent = text.slice(index, index + needle.length);
        fragment.append(mark);
        start = index + needle.length;
      }
      fragment.append(document.createTextNode(text.slice(start)));
      div.replaceChildren(fragment);
    }
  }

  updateFindCount() {
    const counter = this.toolbarContainer.querySelector('.pdf-find-count');
    if (!counter) return;
    const total = this.findMatches.length;
    counter.textContent = !this.findQuery.trim() ? '' : total ? `${this.matchIndex + 1} / ${total}` : 'No matches';
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

    // Full-text search across the document
    const findWrapper = document.createElement('div');
    findWrapper.className = 'toolbar-search';
    findWrapper.innerHTML = `<span class="search-icon">${icons.search}</span>`;
    const find = document.createElement('input');
    find.type = 'text';
    find.placeholder = 'Find in PDF…';
    find.setAttribute('aria-label', 'Find in PDF');
    find.value = this.findQuery;
    find.oninput = () => {
      clearTimeout(this.findTimer);
      this.findTimer = setTimeout(() => this.runFind(find.value), 300);
    };
    find.onkeydown = event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.stepMatch(event.shiftKey ? -1 : 1);
    };
    findWrapper.append(find);
    toolbar.appendChild(findWrapper);

    const findNav = document.createElement('div');
    findNav.className = 'toolbar-find-group';
    findNav.innerHTML = `
      <button class="btn-icon" id="pdf-match-prev" title="Previous match" aria-label="Previous match">${icons.chevronLeft}</button>
      <button class="btn-icon" id="pdf-match-next" title="Next match" aria-label="Next match">${icons.chevronRight}</button>
    `;
    findNav.querySelector('#pdf-match-prev').onclick = () => this.stepMatch(-1);
    findNav.querySelector('#pdf-match-next').onclick = () => this.stepMatch(1);
    toolbar.appendChild(findNav);

    const count = document.createElement('span');
    count.className = 'pdf-find-count toolbar-badge';
    toolbar.appendChild(count);

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
    // Ask the worker for the original bytes instead of retaining a second full copy.
    downloadBtn.onclick = async () => {
      try {
        const bytes = await this.pdfDoc.getData();
        downloadBlob(new Blob([bytes], { type: 'application/pdf' }), this.filename);
      } catch (error) { alert('Could not export the PDF: ' + error.message); }
    };
    actionsGroup.appendChild(downloadBtn);

    toolbar.appendChild(actionsGroup);
    this.toolbarContainer.appendChild(toolbar);
    this.updateFindCount();
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