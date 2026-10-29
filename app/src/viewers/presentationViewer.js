import { escapeHtml } from '../utils/safeHtml.js';
import JSZip from 'jszip';
import { icons } from '../icons.js';
import { formatFileSize } from '../utils/fileHelpers.js';

// PowerPoint slides are positioned shapes, not a text flow. Reproducing layout,
// themes, animations and transitions is out of scope; this reads the slide's text,
// tables, pictures and speaker notes in shape order, like the legacy DOC viewer.
const MAX_SLIDES = 500;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const resolved = [];
  for (const part of (base + target).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

function paragraphText(paragraph) {
  let text = '';
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      if (child.tagName === 'a:t') text += child.textContent;
      else if (child.tagName === 'a:br') text += '\n';
      else walk(child);
    }
  };
  walk(paragraph);
  return text;
}

function collectShapes(node, out) {
  for (const child of node.children) {
    if (child.tagName === 'p:sp') out.push({ kind: 'text', element: child });
    else if (child.tagName === 'p:pic') out.push({ kind: 'image', element: child });
    else if (child.tagName === 'p:graphicFrame') out.push({ kind: 'frame', element: child });
    else if (child.tagName === 'p:grpSp') collectShapes(child, out);
  }
}

export class PresentationViewer {
  constructor(container, toolbarContainer) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.zip = null;
    this.slides = [];
    this.index = 0;
    this.ratio = 16 / 9;
    this.imageUrls = [];
    this.slideGeneration = 0;
  }

  async readXml(path) {
    const entry = this.zip.file(path);
    if (!entry) return null;
    const doc = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`Could not parse ${path}.`);
    return doc;
  }

  async relationships(path) {
    const doc = await this.readXml(path);
    const map = new Map();
    if (!doc) return map;
    for (const node of doc.getElementsByTagName('Relationship')) {
      map.set(node.getAttribute('Id'), { target: node.getAttribute('Target'), type: node.getAttribute('Type') || '' });
    }
    return map;
  }

  async render(arrayBuffer, filename = 'presentation.pptx') {
    this.filename = filename;
    this.container.innerHTML = '<div class="viewer-loading"><div class="spinner"></div><p>Reading presentation...</p></div>';
    try {
      const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
      if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
        throw new Error('Legacy binary .ppt is not supported. Convert it to .pptx with PowerPoint or LibreOffice.');
      }
      this.zip = await JSZip.loadAsync(bytes);
      const presentation = await this.readXml('ppt/presentation.xml');
      if (!presentation) throw new Error('This is not a PowerPoint presentation: ppt/presentation.xml is missing.');

      const size = presentation.getElementsByTagName('p:sldSz')[0];
      const width = Number(size?.getAttribute('cx'));
      const height = Number(size?.getAttribute('cy'));
      if (width > 0 && height > 0) this.ratio = width / height;

      const rels = await this.relationships('ppt/_rels/presentation.xml.rels');
      this.slides = [...presentation.getElementsByTagName('p:sldId')]
        .map(node => rels.get(node.getAttribute('r:id'))?.target)
        .filter(Boolean)
        .map(target => resolvePath('ppt/', target));
      this.truncated = this.slides.length > MAX_SLIDES;
      this.slides = this.slides.slice(0, MAX_SLIDES);
      if (!this.slides.length) throw new Error('The presentation contains no slides.');

      this.index = 0;
      this.renderToolbar();
      await this.showSlide(0);
    } catch (error) {
      this.showError(error.message || 'The file could not be parsed as a valid PPTX.');
    }
  }

  showError(message) {
    this.container.innerHTML = `
      <div class="viewer-error">
        <div class="error-icon">${icons.filePresentation}</div>
        <h3>Failed to open presentation</h3>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  goTo(index) {
    this.showSlide(index).catch(error => this.showError(error.message));
  }

  async showSlide(index) {
    if (!this.slides.length) return;
    this.index = Math.max(0, Math.min(this.slides.length - 1, index));
    const generation = ++this.slideGeneration;
    this.releaseImages();
    this.updateIndicator();

    const path = this.slides[this.index];
    const doc = await this.readXml(path);
    if (generation !== this.slideGeneration || this.destroyed) return;
    if (!doc) throw new Error(`Slide ${this.index + 1} is missing from the archive.`);
    const rels = await this.relationships(path.replace(/([^/]+)$/, '_rels/$1.rels'));
    if (generation !== this.slideGeneration || this.destroyed) return;

    const card = document.createElement('div');
    card.className = 'pptx-slide';
    card.style.aspectRatio = String(this.ratio);
    card.setAttribute('aria-label', `Slide ${this.index + 1}`);

    const notice = document.createElement('p');
    notice.className = 'legacy-doc-notice';
    notice.textContent = 'PowerPoint · Text and image view. Original slide layout, themes, animations and transitions are not shown.';
    card.appendChild(notice);

    const tree = doc.getElementsByTagName('p:spTree')[0];
    const shapes = [];
    if (tree) collectShapes(tree, shapes);
    for (const shape of shapes) {
      if (generation !== this.slideGeneration || this.destroyed) return;
      if (shape.kind === 'text') this.appendText(card, shape.element);
      else if (shape.kind === 'frame') this.appendTable(card, shape.element);
      else if (shape.kind === 'image') await this.appendImage(card, shape.element, rels, path, generation);
    }

    await this.appendNotes(card, rels, path, generation);
    if (generation !== this.slideGeneration || this.destroyed) return;
    this.container.replaceChildren(card);
  }

  appendText(card, shape) {
    const placeholder = shape.getElementsByTagName('p:ph')[0]?.getAttribute('type');
    const isTitle = placeholder === 'title' || placeholder === 'ctrTitle';
    const paragraphs = [...shape.getElementsByTagName('a:p')]
      .map(paragraphText)
      .filter(text => text.trim());
    if (!paragraphs.length) return;
    const block = document.createElement(isTitle ? 'h2' : 'div');
    block.className = isTitle ? 'pptx-title' : 'pptx-body';
    for (const text of paragraphs) {
      const line = document.createElement('p');
      line.textContent = text;
      block.appendChild(line);
    }
    card.appendChild(block);
  }

  appendTable(card, frame) {
    const source = frame.getElementsByTagName('a:tbl')[0];
    if (!source) return;
    const table = document.createElement('table');
    table.className = 'pptx-table';
    for (const row of source.getElementsByTagName('a:tr')) {
      const tr = document.createElement('tr');
      for (const cell of row.getElementsByTagName('a:tc')) {
        const td = document.createElement('td');
        td.textContent = [...cell.getElementsByTagName('a:p')].map(paragraphText).join('\n');
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    if (table.rows.length) card.appendChild(table);
  }

  async appendImage(card, picture, rels, slidePath, generation) {
    const blip = picture.getElementsByTagName('a:blip')[0];
    const embed = blip?.getAttribute('r:embed');
    const relationship = embed ? rels.get(embed) : null;
    if (!relationship) return;
    const entry = this.zip.file(resolvePath(slidePath.replace(/[^/]+$/, ''), relationship.target));
    if (!entry) return;
    const declared = entry._data?.uncompressedSize ?? 0;
    if (declared > MAX_IMAGE_BYTES) {
      const skipped = document.createElement('p');
      skipped.className = 'pptx-skipped';
      skipped.textContent = `Image skipped: it expands to ${formatFileSize(declared)}, past the 32 MB limit.`;
      card.appendChild(skipped);
      return;
    }
    const blob = await entry.async('blob');
    if (generation !== this.slideGeneration || this.destroyed) return;
    const url = URL.createObjectURL(blob);
    this.imageUrls.push(url);
    const image = document.createElement('img');
    image.className = 'pptx-image';
    image.src = url;
    image.alt = picture.getElementsByTagName('p:cNvPr')[0]?.getAttribute('name') || 'Slide image';
    card.appendChild(image);
  }

  async appendNotes(card, rels, slidePath, generation) {
    const notesRel = [...rels.values()].find(rel => rel.type.endsWith('/notesSlide'));
    if (!notesRel) return;
    const doc = await this.readXml(resolvePath(slidePath.replace(/[^/]+$/, ''), notesRel.target));
    if (generation !== this.slideGeneration || this.destroyed || !doc) return;
    const lines = [];
    for (const shape of doc.getElementsByTagName('p:sp')) {
      // Slide-number, date and footer placeholders are chrome, not speaker notes.
      const type = shape.getElementsByTagName('p:ph')[0]?.getAttribute('type');
      if (type && type !== 'body') continue;
      for (const paragraph of shape.getElementsByTagName('a:p')) {
        const text = paragraphText(paragraph);
        if (text.trim()) lines.push(text);
      }
    }
    if (!lines.length) return;
    const details = document.createElement('details');
    details.className = 'pptx-notes';
    const summary = document.createElement('summary');
    summary.textContent = 'Speaker notes';
    const body = document.createElement('pre');
    body.textContent = lines.join('\n');
    details.append(summary, body);
    card.appendChild(details);
  }

  releaseImages() {
    for (const url of this.imageUrls) URL.revokeObjectURL(url);
    this.imageUrls = [];
  }

  renderToolbar() {
    this.toolbarContainer.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'pptx-toolbar';

    const nav = document.createElement('div');
    nav.className = 'toolbar-nav-group';
    nav.innerHTML = `
      <button class="btn-icon" id="pptx-prev" title="Previous slide" aria-label="Previous slide">${icons.chevronLeft}</button>
      <div class="pdf-page-indicator">
        <input type="number" aria-label="Slide number" id="pptx-slide-input" value="1" min="1" max="${this.slides.length}" />
        <span>/ ${this.slides.length}</span>
      </div>
      <button class="btn-icon" id="pptx-next" title="Next slide" aria-label="Next slide">${icons.chevronRight}</button>
    `;
    nav.querySelector('#pptx-prev').onclick = () => this.goTo(this.index - 1);
    nav.querySelector('#pptx-next').onclick = () => this.goTo(this.index + 1);
    const input = nav.querySelector('#pptx-slide-input');
    input.onchange = event => {
      const value = parseInt(event.target.value, 10);
      if (value >= 1 && value <= this.slides.length) this.goTo(value - 1);
      else input.value = this.index + 1;
    };
    toolbar.appendChild(nav);

    const badge = document.createElement('div');
    badge.className = 'toolbar-badge';
    badge.textContent = 'PPTX · Text and images';
    toolbar.appendChild(badge);

    if (this.truncated) {
      const limit = document.createElement('div');
      limit.className = 'toolbar-badge';
      limit.textContent = `Limited to the first ${MAX_SLIDES} slides`;
      toolbar.appendChild(limit);
    }

    this.toolbarContainer.appendChild(toolbar);
    this.updateIndicator();
  }

  updateIndicator() {
    const input = this.toolbarContainer.querySelector('#pptx-slide-input');
    if (input && document.activeElement !== input) input.value = this.index + 1;
    const prev = this.toolbarContainer.querySelector('#pptx-prev');
    const next = this.toolbarContainer.querySelector('#pptx-next');
    if (prev) prev.disabled = this.index <= 0;
    if (next) next.disabled = this.index >= this.slides.length - 1;
  }

  suspend() {
    this.slideGeneration++;
    this.releaseImages();
    this.container.replaceChildren();
  }

  resume() {
    if (!this.container.childElementCount && this.slides.length) {
      this.showSlide(this.index).catch(error => this.showError(error.message));
    }
  }

  destroy() {
    this.destroyed = true;
    this.slideGeneration++;
    this.releaseImages();
    this.zip = null;
    this.slides = [];
    this.container.replaceChildren();
    this.toolbarContainer.replaceChildren();
  }
}