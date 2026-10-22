// Only interface labels change. LaTeX, native settings, selection, undo history
// and the Word session stay in the existing editor instance.
window.setWorkbenchLanguage = language => {
 const english = language === 'en';
 window.workbenchEnglish = english;
 MathfieldElement.locale = english ? 'en' : 'zh-cn';
 document.documentElement.lang = english ? 'en' : 'zh-Hans';
 const labels = {
  wordPreview: ['Word 排版预览', 'Word preview'],
  latexSource: ['LaTeX 源码', 'LaTeX source'],
  previewPlaceholder: ['输入公式后，查看实际字体与字号。', 'Enter an equation to preview its font and size.']
 };
 for (const [key, pair] of Object.entries(labels)) {
  const label = document.querySelector(`[data-interface="${key}"]`);
  if (label) label.textContent = pair[english ? 1 : 0];
 }
 for (const [id, pair] of Object.entries({
  'mode-characters': ['保留结构 · 替换字符', 'Preserve structure · Replace characters'],
  'mode-rebuild': ['编辑公式结构', 'Edit equation structure']
 })) document.getElementById(id).textContent = pair[english ? 1 : 0];
 document.getElementById('copy-latex').textContent = english ? 'Copy LaTeX' : '复制 LaTeX';
 document.getElementById('copy-latex').setAttribute('aria-label', english ? 'Copy LaTeX' : '复制 LaTeX');
 document.getElementById('latex').setAttribute('aria-label', english ? 'LaTeX source' : 'LaTeX 源码');
 document.getElementById('formula').setAttribute('aria-label', english ? 'Visual equation editor' : '公式可视化编辑区');
 document.getElementById('word-preview-zoom').setAttribute('aria-label', english ? 'Preview zoom' : '预览缩放');
 const preview = document.getElementById('desktop-font-preview-image');
 if (preview) preview.alt = english ? 'Equation preview using native fonts and sizes' : '按原生字体字号生成的公式预览';
 const note = document.getElementById('mode-note');
 if (document.body.classList.contains('character-mode')) note.textContent = english
  ? 'Replace character bytes while preserving native structure, styles and companion data. Supports digits, Latin letters and verified Greek encodings.'
  : '只修改字符字节，保留原生结构、样式和伴随数据。支持数字、英文字母及已确认编码的希腊字母。';
 for (const input of document.querySelectorAll('#character-editor input')) input.setAttribute('aria-label', english
  ? `Replace character at ${input.dataset.offset}` : `替换字符，位置 ${input.dataset.offset}`);
 window.syncWordEditorControls?.();
};
