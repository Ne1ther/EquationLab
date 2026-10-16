/* Shared by the Word ribbon and task pane. No document access at module load. */
(() => {
 const groups=[
  {id:'Insert',label:'插入公式',icon:'inline',commands:['insert-inline','insert-display','insert-right','insert-left','edit-selected','symbols']},
  {id:'Numbering',label:'编号与引用',icon:'number',commands:['insert-number','insert-reference','update-fields','number-format']},
  {id:'Navigate',label:'章节与导航',icon:'chapter',commands:['chapter-section','previous-equation','next-equation']},
  {id:'Format',label:'格式与工具',icon:'typography',commands:['typography','spacing','document-equations','conversion-export']},
  {id:'Help',label:'帮助',icon:'help',commands:['help','capabilities']}
 ];
 const definitions=[
  ['insert-inline','行内公式','inline','editor','insert-layout','准备行内公式；编辑并通过原生检查后，在空白光标处插入。',{layout:'inline'}],
  ['insert-display','居中公式','display','editor','insert-layout','准备独立居中的原生 MathType 公式。',{layout:'display'}],
  ['insert-right','右侧编号','number-right','editor','insert-layout','准备独立公式及右侧 Equation Lab 编号（SEQ EquationLab）。',{layout:'numbered-right'}],
  ['insert-left','左侧编号','number-left','editor','insert-layout','准备独立公式及左侧 Equation Lab 编号（SEQ EquationLab）。',{layout:'numbered-left'}],
  ['edit-selected','编辑选中','edit','editor','read','读取当前选中的 MathType 对象；写回前复核原选区与内容。',{word:true,minimum:'1.3',execute:'read'}],
  ['symbols','数学符号','symbols','editor','word-symbols','在 Word 的空白光标处插入 Unicode 数学符号；不是 MathType OLE 公式。',{}],
  ['insert-number','独立编号','number','layout','standalone-number','在空白光标处插入独立 Equation Lab 编号，可被交叉引用。',{word:true,minimum:'1.3',execute:'standalone-number'}],
  ['insert-reference','插入引用','reference','document','reference-target','刷新 Equation Lab 编号目标并定位到引用选择器；选择后确认插入。',{word:true,execute:'reference-picker'}],
  ['update-fields','更新编号','refresh','document','update','更新正文的 Equation Lab SEQ 与 REF EL_ 域；不改原版 MathType 的 MTEqn 域。',{word:true,minimum:'1.5',execute:'update'}],
  ['number-format','编号格式','number','layout','number-format','设置新编号格式及选中独立公式的编排；不会批量改写原版 MathType 编号。',{}],
  ['chapter-section','章 / 节设置','chapter','layout','chapter','设置明确的 Equation Lab 章、节与计数重置；不等同于 Word 分节符。',{}],
  ['previous-equation','上一公式','previous','document','objects','选择光标前的正文 MathType 公式；到达边界时保持原选区。',{word:true,minimum:'1.3',execute:'previous'}],
  ['next-equation','下一公式','next','document','objects','选择光标后的正文 MathType 公式；到达边界时保持原选区。',{word:true,minimum:'1.3',execute:'next'}],
  ['typography','字体与字号','typography','editor','typography-panel','打开当前公式的 12 类字体样式和五类字号；沿用公式自身设置。',{}],
  ['spacing','间距设置','spacing','editor','spacing-panel','打开 30 项原生间距与三个额外字号；预览尚未全部采用这些设置。',{}],
  ['document-equations','文档公式','document','document','objects','读取正文 MathType 对象与可引用的 Equation Lab 编号。',{word:true,execute:'scan'}],
  ['conversion-export','转换与导出','export','editor','conversion-panel','当前公式 LaTeX、原生字体 SVG 图形与 .eqp 偏好导出；显示批量转换、MathPage 等尚缺的能力。',{}],
  ['help','使用帮助','help','help','help-guide','打开 Equation Lab 的插入、编辑、编号及安全选区说明。',{}],
  ['capabilities','功能范围','help','help','capability-list','查看原版 Word 命令对应范围，以及尚未实现的能力。',{}]
 ];
 const commands=definitions.map(([id,label,icon,pane,target,description,options])=>Object.freeze({id,label,icon,pane,target,description,...options,ribbonId:'EquationLab.'+id,functionName:'EquationLab_'+id.replaceAll('-','_')}));
 const unsupported=[
  ['手写公式','原版 W05；当前没有手写识别器。'],
  ['下一章 / 下一节','原版 W10–W11 的动态章节递增尚未实现；可使用明确的章 / 节设置。'],
  ['修改 / 删除章节分隔','原版 W13；尚未实现最近章节标记的定位与修改。'],
  ['浏览类型','原版 W16 的公式 / 编号 / 章节三种浏览类型未齐；目前仅浏览正文 MathType 对象。'],
  ['批量格式化','原版 W18；当前字体字号与间距只应用到正在编辑的公式。'],
  ['批量转换','原版 W19 的 OMML、MathML、EQ 域及文本范围转换尚未实现。'],
  ['批量公式导出','原版 W20 的多公式文件导出尚未实现；目前可导出当前公式的 SVG 图形、LaTeX 文本及 .eqp 偏好。'],
  ['发布 MathPage','原版 W21 的整篇文档网页发布尚未实现。'],
  ['TeX 切换','原版 W22 的 Word 范围原位 TeX ↔ OLE 切换尚未实现；LaTeX 面板只编辑当前公式。'],
  ['原版编号域迁移','当前编号 / 引用只处理 Equation Lab 的域与书签，不改写 MTEqn、MTChap、MTSec 或 MTPlaceRef。'],
  ['原版粘贴拦截','原版 W33 的 Word 粘贴 MathML 拦截尚未实现。'],
  ['原版厂商服务','原版 W25–W32 中的激活、购买、邮件及 Word 选项属于厂商或宿主服务；未仿造或代发消息。']
 ];
 function get(id){return commands.find(command=>command.id===id);}
 function availability(command,{ready=false,busy=false,supports=()=>false}={}){
  if(!command)return {enabled:false,reason:'未知命令'};
  if(busy)return {enabled:false,reason:'正在处理另一项操作，请稍候。'};
  if(command.word&&!ready)return {enabled:false,reason:'此操作需要在 Word 中运行。'};
  if(command.minimum&&ready&&!supports('WordApi',command.minimum))return {enabled:false,reason:'此操作需要 WordApi '+command.minimum+'。'};
  return {enabled:true,reason:command.description};
 }
 function createDispatcher({state,showPane,focus,execute,prepare}){
  return async id=>{
   const command=get(id),available=availability(command,state());
   if(!available.enabled)throw Error(available.reason);
   await showPane(command.pane);
   if(command.layout)await prepare(command.layout);
   if(command.execute)await execute(command.execute);
   focus(command.target);
   return command;
  };
 }
 globalThis.EquationLabCommands=Object.freeze({groups,commands,unsupported,get,availability,createDispatcher});
})();
