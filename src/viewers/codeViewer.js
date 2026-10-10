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
      
      
      
    }

    // Wrap toggle
    
    
    
    
    
    

    // Copy text
    
    
    
    
    
    
    

    
    
    
  }

  

  

  

  

  
  

  

  
}
