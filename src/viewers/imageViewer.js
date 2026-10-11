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
    

    // Rotate
    
    
    
    
    
    

    
  }

  

  

  
}
