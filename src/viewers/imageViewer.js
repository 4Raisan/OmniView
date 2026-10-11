import { escapeHtml } from '../utils/safeHtml.js';
import { icons } from '../icons.js';

export class ImageViewer {
  constructor(container, toolbarContainer) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.zoom = 1;
    this.rotation = 0;
    this.imgWidth = 0;
    this.imgHeight = 0;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
  }

  async render(dataUrl, filename = 'image.png') {
    this.filename = filename;
    this.zoom = 1;
    this.rotation = 0;
    this.panX = 0;
    this.panY = 0;

    this.container.innerHTML = `
      <div class="image-viewer-container">
        <div class="image-stage">
          <img class="viewer-img" src="${dataUrl}" alt="${escapeHtml(filename)}" draggable="false" />
        </div>
      </div>
    `;

    const img = this.container.querySelector('.viewer-img');
    img.onload = () => {
      this.imgWidth = img.naturalWidth;
      this.imgHeight = img.naturalHeight;
      this.fitToScreen();
      this.renderToolbar();
      this.setupPanAndZoom();
    };
    img.onerror = () => {
      this.container.innerHTML = '<div class="viewer-error"><h3>Could not decode image</h3><p>The file may be damaged or unsupported.</p></div>';
    };
  }

  renderToolbar() {
    this.toolbarContainer.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'image-toolbar';

    // Dimension badge
    const badge = document.createElement('div');
    badge.className = 'toolbar-badge';
    badge.textContent = `${this.imgWidth} × ${this.imgHeight} px`;
    toolbar.appendChild(badge);

    // Zoom controls
    const zoomGroup = document.createElement('div');
    zoomGroup.className = 'toolbar-zoom-group';
    zoomGroup.innerHTML = `
      <button class="btn-icon" id="img-zoom-out" title="Zoom out">${icons.zoomOut}</button>
      <span class="zoom-display">${Math.round(this.zoom * 100)}%</span>
      <button class="btn-icon" id="img-zoom-in" title="Zoom in">${icons.zoomIn}</button>
      <button class="btn-text" id="img-fit">Fit Screen</button>
      <button class="btn-text" id="img-actual">100%</button>
    `;

    zoomGroup.querySelector('#img-zoom-out').onclick = () => {
      this.zoom = Math.max(0.1, this.zoom - 0.2);
      this.updateTransform();
    };

    zoomGroup.querySelector('#img-zoom-in').onclick = () => {
      this.zoom = Math.min(6.0, this.zoom + 0.2);
      this.updateTransform();
    };

    zoomGroup.querySelector('#img-fit').onclick = () => {
      this.fitToScreen();
    };

    zoomGroup.querySelector('#img-actual').onclick = () => {
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.updateTransform();
    };
    toolbar.appendChild(zoomGroup);

    // Rotate
    const rotateBtn = document.createElement('button');
    rotateBtn.className = 'btn-icon';
    rotateBtn.title = 'Rotate Clockwise';
    rotateBtn.innerHTML = icons.rotate;
    rotateBtn.onclick = () => {
      this.rotation = (this.rotation + 90) % 360;
      this.updateTransform();
    };
    toolbar.appendChild(rotateBtn);

    this.toolbarContainer.appendChild(toolbar);
  }

  fitToScreen() {
    const container = this.container.querySelector('.image-viewer-container');
    if (!container || !this.imgWidth) return;
    const availW = container.clientWidth - 40;
    const availH = container.clientHeight - 40;
    const scaleX = availW / this.imgWidth;
    const scaleY = availH / this.imgHeight;
    this.zoom = Math.max(0.1, Math.min(scaleX, scaleY, 1.0));
    this.panX = 0;
    this.panY = 0;
    this.updateTransform();
  }

  setupPanAndZoom() {
    const stage = this.container.querySelector('.image-stage');
    const img = this.container.querySelector('.viewer-img');
    if (!stage || !img) return;

    // Mouse wheel zoom
    stage.onwheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      const newZoom = Math.min(6.0, Math.max(0.1, this.zoom + delta));
      this.zoom = newZoom;
      this.updateTransform();
    };

    // Pan with mouse drag
    stage.onpointerdown = (e) => {
      if (e.button !== 0) return; // Left click only
      stage.setPointerCapture(e.pointerId);
      this.isDragging = true;
      this.dragStartX = e.clientX - this.panX;
      this.dragStartY = e.clientY - this.panY;
      stage.style.cursor = 'grabbing';
    };

    stage.onpointermove = (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.dragStartX;
      this.panY = e.clientY - this.dragStartY;
      this.updateTransform();
    };

    stage.onpointerup = () => {
      if (this.isDragging) {
        this.isDragging = false;
        stage.style.cursor = 'grab';
      }
    };
  }

  updateTransform() {
    const img = this.container.querySelector('.viewer-img');
    if (img) {
      img.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom}) rotate(${this.rotation}deg)`;
    }
    const display = this.toolbarContainer.querySelector('.zoom-display');
    if (display) {
      display.textContent = `${Math.round(this.zoom * 100)}%`;
    }
  }
}
