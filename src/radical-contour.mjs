/** Continuous radical outlines, in em coordinates with a downward y axis.
 * U221A outlines follow KaTeX 0.16.22 src/svgGeometry.js (MIT), themselves
 * derived from KaTeX Main/Size1–4. The tall hook follows MathJax 3.2.2's
 * tex-size4 U23B7 (Apache-2.0). We omit KaTeX's overlapping brush rectangle:
 * the vinculum is part of the same closed contour, with the requested rule.
 * The caller owns all layout dimensions; no equation/model data is changed.
 */
export function radicalContour({width,height,stemWidth,rule}) {
 if(![width,height,stemWidth,rule].every(Number.isFinite)||width<=0||height<=0||stemWidth<=0||rule<0||rule>=height)throw Error('Invalid radical dimensions');
 const normalized=height/(stemWidth/1.056),size=normalized<=1.12?'main':normalized<=1.5?'size1':normalized<=2.1?'size2':normalized<=2.7?'size3':normalized<=3.3?'size4':'tall';
 const base={main:1,size1:1.2,size2:1.8,size3:2.4,size4:3,tall:normalized}[size];
 const sx=stemWidth/(size==='main'?.833:1.056),extra=size==='tall'?rule/sx*1000-40:(rule*base-height*.04)/(height-rule)*1000,sy=size==='tall'?sx:height/(base+extra/1000),end=width/sx*1000,t=rule/sy*1000;
 const e=extra,h=height/sy*1000;
 let d;
 if(size==='main')d=`M95 ${622+e}c-2.7 0-7.17-2.7-13.5-8c-5.8-5.3-9.5-10-9.5-14c0-2 .3-3.3 1-4c1.3-2.7 23.83-20.7 67.5-54c44.2-33.3 65.8-50.3 66.5-51c1.3-1.3 3-2 5-2c4.7 0 8.7 3.3 12 10s173 378 173 378c.7 0 35.3-71 104-213c68.7-142 137.5-285 206.5-429c69-144 104.5-217.7 106.5-221l${e/2.075} ${-e}c5.3-9.3 12-14 20-14H${end}v${t}H845.2724s-225.272 467-225.272 467s-235 486-235 486c-2.7 4.7-9 7-19 7c-6 0-10-1-12-3s-194-422-194-422s-65 47-65 47Z`;
 else if(size==='size1')d=`M263 ${601+e}c.7 0 18 39.7 52 119c34 79.3 68.167 158.7 102.5 238c34.3 79.3 51.8 119.3 52.5 120c340-704.7 510.7-1060.3 512-1067l${e/2.084} ${-e}c4.7-7.3 11-11 19-11H${end}v${t}H1012.3s-271.3 567-271.3 567c-38.7 80.7-84 175-136 283c-52 108-89.167 185.3-111.5 232c-22.3 46.7-33.8 70.3-34.5 71c-4.7 4.7-12.3 7-23 7s-12-1-12-1s-109-253-109-253c-72.7-168-109.3-252-110-252c-10.7 8-22 16.7-34 26c-22 17.3-33.3 26-34 26s-26-26-26-26s76-59 76-59s76-60 76-60Z`;
 else if(size==='size2')d=`M983 ${10+e}l${e/3.13} ${-e}c4-6.7 10-10 18-10H${end}v${t}H1013.1s-83.4 268-264.1 840c-180.7 572-277 876.3-289 913c-4.7 4.7-12.7 7-24 7s-12 0-12 0c-1.3-3.3-3.7-11.7-7-25c-35.3-125.3-106.7-373.3-214-744c-10 12-21 25-33 39s-32 39-32 39c-6-5.3-15-14-27-26s25-30 25-30c26.7-32.7 52-63 76-91s52-60 52-60s208 722 208 722c56-175.3 126.3-397.3 211-666c84.7-268.7 153.8-488.2 207.5-658.5c53.7-170.3 84.5-266.8 92.5-289.5Z`;
 else if(size==='size3')d=`M424 ${2398+e}c-1.3-.7-38.5-172-111.5-514c-73-342-109.8-513.3-110.5-514c0-2-10.7 14.3-32 49c-4.7 7.3-9.8 15.7-15.5 25c-5.7 9.3-9.8 16-12.5 20s-5 7-5 7c-4-3.3-8.3-7.7-13-13s-13-13-13-13s76-122 76-122s77-121 77-121s209 968 209 968c0-2 84.7-361.7 254-1079c169.3-717.3 254.7-1077.7 256-1081l${e/4.223} ${-e}c4-6.7 10-10 18-10H${end}v${t}H1014.6s-87.3 378.7-272.6 1166c-185.3 787.3-279.3 1182.3-282 1185c-2 6-10 9-24 9c-8 0-12-.7-12-2Z`;
 else if(size==='size4')d=`M473 ${2713+e}c339.3-1799.3 509.3-2700 510-2702l${e/5.298} ${-e}c3.3-7.3 9.3-11 18-11H${end}v${t}H1017.7s-90.5 478-276.2 1466c-185.7 988-279.5 1483-281.5 1485c-2 6-10 9-24 9c-8 0-12-.7-12-2c0-1.3-5.3-32-16-92c-50.7-293.3-119.7-693.3-207-1200c0-1.3-5.3 8.7-16 30c-10.7 21.3-21.3 42.7-32 64s-16 33-16 33s-26-26-26-26s76-153 76-153s77-151 77-151c.7 .7 35.7 202 105 604c67.3 400.7 102 602.7 104 606Z`;
 else d=`M702 0H${end}V${t}H742V${h-14}Q740 ${h-12} 737 ${h-9}T733 ${h-5}T730 ${h-3}T724 ${h-1}T714 ${h}H702L222 ${h-1454}L180 ${h-1369}Q138 ${h-1284} 137 ${h-1284}Q131 ${h-1289} 124 ${h-1297}L111 ${h-1310}L265 ${h-1621}L702 ${h-299}Z`;
 return {d,scaleX:sx/1000,scaleY:sy/1000,size,rule,width,height,stemWidth};
}
