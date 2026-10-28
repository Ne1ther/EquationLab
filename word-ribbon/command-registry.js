/* Native Word Ribbon command labels, groups and shared artwork. */
(() => {
 const groups=[
  {id:'Insert',label:'插入公式',icon:'inline',commands:['insert-inline','insert-display','insert-right','insert-left','edit-selected','symbols']},
  {id:'Numbering',label:'编号与引用',icon:'number',commands:['insert-number','insert-reference','update-fields','number-format']},
  {id:'Navigate',label:'章节与导航',icon:'chapter',commands:['chapter-section','previous-equation','next-equation']},
  {id:'Format',label:'格式与工具',icon:'typography',commands:['typography','spacing','document-equations','conversion-export']},
  {id:'Help',label:'帮助',icon:'help',commands:['help','capabilities']}
 ];
 const definitions=[
  ['insert-inline','行内公式','inline','准备行内公式；编辑并通过原生检查后，在空白光标处插入。'],
  ['insert-display','居中公式','display','准备独立居中的原生 MathType 公式。'],
  ['insert-right','右侧编号','number-right','准备独立公式及右侧 Equation Lab 编号（SEQ EquationLab）。'],
  ['insert-left','左侧编号','number-left','准备独立公式及左侧 Equation Lab 编号（SEQ EquationLab）。'],
  ['edit-selected','编辑选中','edit','读取当前选中的 MathType 对象；写回前复核原选区与内容。'],
  ['symbols','数学符号','symbols','在 Word 的空白光标处插入 Unicode 数学符号；不是 MathType OLE 公式。'],
  ['insert-number','独立编号','number','在空白光标处插入独立 Equation Lab 编号，可被交叉引用。'],
  ['insert-reference','插入引用','reference','刷新 Equation Lab 编号目标并定位到引用选择器；选择后确认插入。'],
  ['update-fields','更新编号','refresh','更新正文的 Equation Lab SEQ 与 REF EL_ 域；不改原版 MathType 的 MTEqn 域。'],
  ['number-format','编号格式','number-format','设置新编号格式及选中独立公式的编排；不会批量改写原版 MathType 编号。'],
  ['chapter-section','章 / 节设置','chapter','设置明确的 Equation Lab 章、节与计数重置；不等同于 Word 分节符。'],
  ['previous-equation','上一公式','previous','选择光标前的正文 MathType 公式；到达边界时保持原选区。'],
  ['next-equation','下一公式','next','选择光标后的正文 MathType 公式；到达边界时保持原选区。'],
  ['typography','字体与字号','typography','打开当前公式的 12 类字体样式和五类字号；沿用公式自身设置。'],
  ['spacing','间距设置','spacing','打开 30 项原生间距与三个额外字号；预览尚未全部采用这些设置。'],
  ['document-equations','文档公式','document','读取正文 MathType 对象与可引用的 Equation Lab 编号。'],
  ['conversion-export','转换与导出','export','当前公式 LaTeX、原生字体 SVG 图形与 .eqp 偏好导出；显示批量转换、MathPage 等尚缺的能力。'],
  ['help','使用帮助','help','打开 Equation Lab 的插入、编辑、编号及安全选区说明。'],
  ['capabilities','功能范围','capabilities','查看原版 Word 命令对应范围，以及尚未实现的能力。']
 ];
 const commands=definitions.map(([id,label,icon,description])=>Object.freeze({id,label,icon,description}));
 function get(id){return commands.find(command=>command.id===id);}
 globalThis.EquationLabCommands=Object.freeze({groups,commands,get});
})();
