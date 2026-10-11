const LIMIT = 2 * 1024 * 1024;
export class TextEditor {
  constructor(viewer, meta, onSaved, onDirty) {
    this.viewer = viewer;
    this.meta = meta;
    this.base = viewer.rawText.replace(/\r\n/g, '\n');
    this.onSaved = onSaved;
    this.onDirty = onDirty;
    viewer.editor = this;
    this.renderButtons();
  }
  get text() { return this.editing ? this.area.value : this.viewer.rawText; }
  get dirty() { return !!this.changed && this.text.replace(/\r\n/g, '\n') !== this.base; }
  renderButtons() {
    const toolbar = this.viewer.toolbarContainer.firstElementChild;
    if (!toolbar) return;
    toolbar.querySelectorAll('.toolbar-button-group').forEach(group => { group.hidden = this.editing; group.style.display = this.editing ? 'none' : ''; });
    toolbar.querySelectorAll('input').forEach(input => { input.disabled = !!this.editing && !input.classList.contains('md-find'); });
    toolbar.querySelectorAll('button:not(.document-copy)').forEach(button => {
      if (!button.closest('.text-edit-controls')) button.disabled = !!this.editing;
    });
    toolbar.querySelector('.text-edit-controls')?.remove();
    const group = document.createElement('div');
    group.className = 'text-edit-controls';
    const edit = document.createElement('button');
    edit.className = 'btn-text'; edit.textContent = this.editing ? 'Preview' : 'Edit';
    edit.disabled = !this.meta.eligible;
    edit.title = this.meta.eligible ? 'Edit text (up to 2 MB)' : 'Editing requires a valid UTF-8 file up to 2 MB';
    edit.onclick = () => this.toggle(); group.append(edit);
    if (this.editing && this.viewer.renderLivePreview) {
      const split = document.createElement('button'); split.className = 'btn-text'; split.textContent = this.liveSplit ? 'Text only' : 'Live split';
      split.onclick = () => { this.liveSplit = !this.liveSplit;   }; 
      
    }
    
     
     
    
    
  }
  
  
  
  
  
  
  
  
}
