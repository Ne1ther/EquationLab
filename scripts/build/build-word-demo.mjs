import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {createDocx,NS} from '../../src/document.mjs';
import {equationReference} from '../../src/layout.mjs';
const formulas=[
 ['匀速运动','s=s_0+vt'],
 ['匀加速运动','s=v_0t+\\frac{1}{2}at^2'],
 ['勾股定理','a^2+b^2=c^2'],
 ['一元二次方程','ax^2+bx+c=0'],
 ['求根公式（a 不为零）','x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}'],
 ['等比数列求和（q 不等于 1）','S_n=\\frac{a_1(1-q^n)}{1-q}'],
 ['指数函数','y=e^{kx}'],
 ['三角恒等式','\\sin^2x+\\cos^2x=1'],
 ['均方根','x_r=\\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}x_i^2}'],
 ['相对误差（x₀ 不为零）','\\varepsilon=\\frac{|x-x_0|}{|x_0|}'],
 ['导数的定义',"f'(x)=\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h}"],
 ['幂函数求导','\\frac{d}{dx}x^n=nx^{n-1}'],
 ['乘积法则',"(uv)'=u'v+uv'"],
 ['定积分','\\int_0^1x^2\\,dx=\\frac{1}{3}'],
 ['微积分基本定理','\\int_a^bf(x)\\,dx=F(b)-F(a)'],
 ['分部积分','\\int u\\,dv=uv-\\int v\\,du'],
 ['指数函数的级数','e^x=\\sum_{n=0}^{\\infty}\\frac{x^n}{n!}'],
 ['几何级数（|x| < 1）','\\sum_{n=0}^{\\infty}x^n=\\frac{1}{1-x}'],
 ['高斯积分','\\int_{-\\infty}^{\\infty}e^{-x^2}\\,dx=\\sqrt{\\pi}'],
 ['二阶泰勒近似（h 趋近于零）',"f(x+h)\\approx f(x)+hf'(x)+\\frac{h^2}{2}f''(x)"],
 ['二阶矩阵','A=\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}'],
 ['二阶行列式','\\det A=ad-bc'],
 ['线性方程组','A\\mathbf{x}=\\mathbf{b}'],
 ['特征值与特征向量','A\\mathbf{v}=\\lambda\\mathbf{v}'],
 ['向量内积','\\mathbf{x}\\cdot\\mathbf{y}=\\sum_{i=1}^n x_i y_i'],
 ['向量的二范数','\\left\\|\\mathbf{x}\\right\\|_2=\\sqrt{\\sum_{i=1}^n x_i^2}'],
 ['样本均值','\\bar{x}=\\frac{1}{n}\\sum_{i=1}^n x_i'],
 ['样本方差（n > 1）','s^2=\\frac{1}{n-1}\\sum_{i=1}^n(x_i-\\bar{x})^2'],
 ['正态分布密度（σ > 0）','p(x)=\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}'],
 ['最小二乘目标','J(\\theta)=\\sum_{i=1}^n(y_i-f(x_i;\\theta))^2']
];
const out=path.resolve(process.argv[2]||'docs/examples');await fs.mkdir(out,{recursive:true});
const equations=formulas.map(([label,latex],i)=>({latex,label:label+' / '+String(i+1).padStart(2,'0'),layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:Math.floor(i/10)+1,section:1,equation:i%10+1,bookmarkName:'EL_DEMO_'+String(i+1).padStart(2,'0')}}));
const bytes=await createDocx(equations,{fragment:true});const zip=await JSZip.loadAsync(bytes),doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'text/xml'),body=doc.getElementsByTagNameNS(NS.w,'body')[0];
const parse=xml=>doc.importNode(new DOMParser().parseFromString('<root xmlns:w="'+NS.w+'">'+xml+'</root>','text/xml').documentElement.firstChild,true);
const paragraph=(s,kind='body')=>parse('<w:p><w:pPr>'+ (kind==='title'?'<w:jc w:val="center"/><w:spacing w:after="240"/>':kind==='heading'?'<w:keepNext/><w:spacing w:before="240" w:after="120"/>':'<w:spacing w:after="120" w:line="360" w:lineRule="auto"/>')+'</w:pPr><w:r><w:rPr>'+(kind==='title'?'<w:b/><w:sz w:val="36"/>':kind==='heading'?'<w:b/><w:sz w:val="28"/>':'')+'</w:rPr><w:t>'+s.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</w:t></w:r></w:p>');
body.insertBefore(paragraph('Equation Lab · 30 个公式','title'),body.firstChild);
const intro=paragraph('这是一份可以直接打开、编辑的 Word 演示。正文用宋体小四，公式使用默认字体；每节十个公式，编号按节从 1 开始。');body.insertBefore(intro,body.childNodes[1]);
body.insertBefore(parse('<w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:t>交叉引用示例：</w:t></w:r>'+equationReference('EL_DEMO_09',{cachedText:'(1.9)',prefix:'均方根见式 '})+'<w:r><w:t>；</w:t></w:r>'+equationReference('EL_DEMO_26',{cachedText:'(3.6)',prefix:'二范数见式 '})+'<w:r><w:t>。</w:t></w:r></w:p>'),intro.nextSibling);
for(const [i,name] of [[0,'1  基础公式与根式'],[10,'2  微积分与级数'],[20,'3  线性代数与统计']]){const label=[...body.getElementsByTagNameNS(NS.w,'p')].find(p=>p.textContent===equations[i].label);const h=paragraph(name,'heading');if(i>0)h.getElementsByTagNameNS(NS.w,'pPr')[0].appendChild(parse('<w:pageBreakBefore/>'));body.insertBefore(h,label);}
for(const p of [...body.getElementsByTagNameNS(NS.w,'p')])if(equations.some(e=>e.label===p.textContent))p.insertBefore(parse('<w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0"/></w:pPr>'),p.firstChild);
zip.file('word/document.xml',new XMLSerializer().serializeToString(doc));
let styles=(await zip.file('word/styles.xml').async('string')).replace('<w:spacing w:before="120" w:after="120"/>','<w:spacing w:before="60" w:after="60"/>');styles=styles.replace('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>','<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>');zip.file('word/styles.xml',styles);
zip.file('word/settings.xml',(await zip.file('word/settings.xml').async('string')).replace('<w:updateFields w:val="true"/>',''));
const dest=path.join(out,'equation-lab-30-formulas.docx');await fs.writeFile(dest,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));console.log(dest);
