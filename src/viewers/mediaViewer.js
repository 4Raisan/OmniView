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
    
    
    
    
  }

  

  
}
