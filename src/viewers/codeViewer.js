import { escapeHtml } from '../utils/safeHtml.js';
import { selectedDocumentText } from '../utils/selectedText.js';
import { hljs, loadCodeLanguage } from '../utils/codeLanguages.js';
import { icons } from '../icons.js';
import { getFileExtension } from '../utils/fileHelpers.js';

export class CodeViewer {
  constructor(container, toolbarContainer) {
    this.container = container;
    this.toolbarContainer = toolbarContainer;
    this.rawText = '';
    this.filename = '';
    this.wrapLines = true;
    this.showLineNumbers = true;
    this.searchQuery = '';
    this.isJson = false;
    this.isFormattedJson = false;
    this.highlightedLines = null;
  }

  async render(text, filename = 'code.txt') {
    this.filename = filename;
    this.rawText = typeof text === 'string' ? text : new TextDecoder().decode(text);
    const ext = getFileExtension(filename);
    this.language = await loadCodeLanguage(ext);
    this.isJson = ext === 'json' || this.rawText.trim().startsWith('{') || this.rawText.trim().startsWith('[');

    this.renderToolbar();
    this.renderContent();
  }

  renderToolbar() {
    this.toolbarContainer.innerHTML = '';
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';

    // Language badge
    const ext = getFileExtension(this.filename);
    const badge = document.createElement('div');
    badge.className = 'toolbar-badge lang-badge';
    badge.textContent = (ext ? ext.toUpperCase() : 'TEXT');
    toolbar.appendChild(badge);

    // Line & char counts
    const lineCount = this.rawText.split('\n').length;
    const charCount = this.rawText.length;
    const statsBadge = document.createElement('div');
    statsBadge.className = 'toolbar-badge';
    statsBadge.textContent = `${lineCount} lines • ${charCount.toLocaleString()} chars`;
    toolbar.appendChild(statsBadge);

    // Search bar
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'toolbar-search';
    searchWrapper.innerHTML = `
      <span class="search-icon">${icons.search}</span>
      <input type="text" placeholder="Find in file..." value="${escapeHtml(this.searchQuery)}" />
      ${this.searchQuery ? `<button class="search-clear-btn">${icons.close}</button>` : ''}
    `;

    const input = searchWrapper.querySelector('input');
    input.oninput = (e) => {
      this.searchQuery = e.target.value;
      this.renderSearch();
    };

    const clearBtn = searchWrapper.querySelector('.search-clear-btn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        this.searchQuery = '';
        this.renderToolbar();
        this.renderContent();
      };
    }
    toolbar.appendChild(searchWrapper);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'toolbar-actions';

    // JSON pretty format button if JSON
    if (this.isJson) {
      const formatBtn = document.createElement('button');
      formatBtn.className = `btn-text ${this.isFormattedJson ? 'active' : ''}`;
      formatBtn.textContent = this.isFormattedJson ? 'Compact JSON' : 'Pretty JSON';
      formatBtn.onclick = () => {
        try {
          if (!this.isFormattedJson) {
            const parsed = JSON.parse(this.rawText);
            this.rawText = JSON.stringify(parsed, null, 2);
            this.isFormattedJson = true;
          } else {
            const parsed = JSON.parse(this.rawText);
            this.rawText = JSON.stringify(parsed);
            this.isFormattedJson = false;
          }
          this.renderToolbar();
          this.highlightedLines = null;
          this.renderContent();
        } catch (e) {
          alert('Invalid JSON: ' + e.message);
        }
      };
      controls.appendChild(formatBtn);
    }

    // Wrap toggle
    const wrapBtn = document.createElement('button');
    wrapBtn.className = `btn-icon ${this.wrapLines ? 'active' : ''}`;
    wrapBtn.title = this.wrapLines ? 'Disable line wrap' : 'Enable line wrap';
    wrapBtn.innerHTML = icons.wrap;
    wrapBtn.onclick = () => {
      this.wrapLines = !this.wrapLines;
      this.renderContent();
      wrapBtn.classList.toggle('active', this.wrapLines);
    };
    controls.appendChild(wrapBtn);

    // Copy text
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-icon document-copy';
    copyBtn.title = 'Copy selected text, or all text';
    copyBtn.innerHTML = icons.copy;
    copyBtn.onmousedown = event => event.preventDefault();
    copyBtn.onclick = async () => {
      const selected = selectedDocumentText(this.container);
      try {
        await navigator.clipboard.writeText(selected ?? this.editor?.text ?? this.rawText);
        this.showToast(selected !== null ? 'Selected text copied!' : 'All text copied!');
      } catch { this.showToast('Could not copy text. Try Ctrl+C.'); }
    };
    controls.appendChild(copyBtn);

    toolbar.appendChild(controls);
    this.toolbarContainer.appendChild(toolbar);
    this.editor?.renderButtons();
  }

  renderContent() {
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = `code-viewer-container ${this.wrapLines ? 'wrap-lines' : 'no-wrap'}`;

    const lines = this.rawText.split('\n');
    const validLang = this.language;

    const pre = document.createElement('pre');
    pre.className = 'code-block';

    // Reuse syntax work when searching or toggling wrap. Very large files stay plain.
    if (!this.highlightedLines) this.highlightedLines = lines.map(line => {
      let highlighted = '';
      if (validLang && this.rawText.length <= 1_000_000) {
        try {
          highlighted = hljs.highlight(line, { language: validLang }).value;
        } catch {
          highlighted = this.escapeHtml(line);
        }
      } else {
        highlighted = this.escapeHtml(line);
      }
      return highlighted;
    });
    const linesHtml = lines.map((line, idx) => {
      const highlighted = this.highlightedLines[idx];
      return `<div class="code-line"><span class="line-num">${idx + 1}</span><span class="line-code">${highlighted || '&nbsp;'}</span></div>`;
    }).join('');

    pre.innerHTML = linesHtml;
    
    
    
    
    
  }

  

  

  

  
  

  

  
}
