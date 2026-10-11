import hljs from 'highlight.js/lib/core';

const grammars = import.meta.glob(['../../../node_modules/highlight.js/es/languages/*.js', '!../../../node_modules/highlight.js/es/languages/*.js.js'], {
  import: 'default'
});
const aliases = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python',
  html: 'xml', htm: 'xml', yml: 'yaml', sh: 'bash',
  bat: 'dos', cmd: 'dos', ps1: 'powershell', h: 'c', hpp: 'cpp',
  cs: 'csharp', kt: 'kotlin', rs: 'rust', rb: 'ruby', toml: 'ini',
  'c++': 'cpp', 'c#': 'csharp', shell: 'bash', patch: 'diff'
};

export async function loadCodeLanguage(extension) {
  const language = aliases[extension] || extension;
  if (!language) return null;
  if (!hljs.getLanguage(language)) {
    const load = grammars[`../../../node_modules/highlight.js/es/languages/${language}.js`];
    if (!load) return null;
    hljs.registerLanguage(language, await load());
  }
  return language;
}

export { hljs };

