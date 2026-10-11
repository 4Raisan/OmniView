import { escapeHtml } from '../utils/safeHtml.js';
import { icons } from '../icons.js';
import { getFileExtension } from '../utils/fileHelpers.js';

export class MediaViewer {
  constructor(container, toolbarContainer) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.mediaEl = null;
  }

  async render(dataUrl, filename = 'media.mp4') {
    this.dataUrl = dataUrl;
    this.filename = filename;
    const ext = getFileExtension(filename);
    const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext);

    this.container.innerHTML = `
      <div class="media-viewer-container">
        <div class="media-player-box">
          ${isAudio ? `
            <div class="audio-visualizer-card">
              <div class="audio-icon-pulse">${icons.fileMedia}</div>
              <div class="audio-title">${escapeHtml(filename)}</div>
              <audio id="media-element" controls src="${dataUrl}"></audio>
            </div>
          ` : `
            <video id="media-element" controls playsinline src="${dataUrl}"></video>
          `}
        </div>
      </div>
    `;

    this.mediaEl = this.container.querySelector('#media-element');
    this.mediaEl.preload = 'metadata';
    this.renderToolbar();
  }

  suspend() {
    if (!this.mediaEl || this.suspended) return;
    this.position = this.mediaEl.currentTime;
    this.rate = this.mediaEl.playbackRate;
    this.mediaEl.pause();
    this.mediaEl.removeAttribute('src');
    this.mediaEl.load();
    this.suspended = true;
  }

  resume() {
    if (!this.suspended || !this.mediaEl) return;
    this.suspended = false;
    this.mediaEl.src = this.dataUrl;
    this.mediaEl.playbackRate = this.rate || 1;
    this.mediaEl.addEventListener('loadedmetadata', () => {
      if (this.mediaEl && Number.isFinite(this.mediaEl.duration)) this.mediaEl.currentTime = Math.min(this.position || 0, this.mediaEl.duration);
    }, { once: true });
  }

  renderToolbar() {
    this.toolbarContainer.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'media-toolbar';

    // Speed selector
    const speedGroup = document.createElement('div');
    speedGroup.className = 'toolbar-button-group';
    const speeds = [0.5, 1.0, 1.25, 1.5, 2.0];
    speedGroup.innerHTML = speeds.map(s =>
      `<button class="btn-group-item ${s === 1.0 ? 'active' : ''}" data-speed="${s}">${s}x</button>`
    ).join('');

    speedGroup.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        speedGroup.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (this.mediaEl) {
          this.mediaEl.playbackRate = parseFloat(btn.dataset.speed);
        }
      };
    });
    toolbar.appendChild(speedGroup);

    this.toolbarContainer.appendChild(toolbar);
  }

  destroy() {
    this.mediaEl?.pause();
    this.mediaEl?.removeAttribute('src');
    this.mediaEl?.load();
    this.mediaEl = null;
  }
}
