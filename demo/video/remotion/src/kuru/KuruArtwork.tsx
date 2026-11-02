import React from 'react';
import {enter, move, mix, palette as C} from '../concepts/motion';
import {Person, Symbol, Text} from '../concepts/Artwork';

type Point=[number,number];

function Path({d,dark=false,dash=false,width=2}:{d:string;dark?:boolean;dash?:boolean;width?:number}) {
  return <path d={d} fill="none" stroke={dark?'#8BA399':C.muted} strokeWidth={width} strokeDasharray={dash?'7 9':undefined} strokeLinecap="round"/>;
}

export function ClaimToken({x=0,y=0,scale=1,rot=0,muted=false,label='claim'}:{x?:number;y?:number;scale?:number;rot?:number;muted?:boolean;label?:string}) {
  return <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale})`}>
    <rect width={142} height={54} rx={15} fill={muted?'#DCE4DC':C.mint} stroke={muted?C.line:'none'} strokeWidth={2}/>
    <Symbol x={13} y={13} size={28} fill={muted?C.muted:C.ink}/>
    <Text x={52} y={35} size={20} mono weight={500} fill={muted?C.muted:C.ink}>{label}</Text>
  </g>;
}

function UsdcPill({x,y,scale=1,opacity=1}:{x:number;y:number;scale?:number;opacity?:number}) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
    <rect x={-54} y={-22} width={108} height={44} rx={22} fill={C.ink}/>
    <Text x={0} y={8} size={19} mono weight={500} fill={C.mint} anchor="middle">USDC</Text>
  </g>;
}

function Packet({f,at,x1,y1,x2,y2,dark=false,size=8}:{f:number;at:number;x1:number;y1:number;x2:number;y2:number;dark?:boolean;size?:number}) {
  const p=move(f,at,26);
  return <circle cx={mix(x1,x2,p)} cy={mix(y1,y2,p)} r={size} fill={dark?C.mint:C.green} opacity={f>=at&&f<at+30?1:0}/>;
}

export function HookArt({f}:{f:number}) {
  const line=move(f,8,24);
  const now=enter(f,18), maturity=enter(f,34);
  return <g>
    <Text x={60} y={52} size={22} mono fill="#B4C9BD">A bond before maturity</Text>
    <Path d={`M60 330H${mix(60,900,line)}`} dark width={2}/>
    <g opacity={enter(f,6)}>
      <g opacity={enter(f,14)} transform={`translate(${mix(170,190,enter(f,14))} ${mix(205,170,enter(f,14))})`}><ClaimToken rot={-6} muted/></g>
      <g opacity={enter(f,22)} transform={`translate(${mix(250,272,enter(f,22))} ${mix(170,135,enter(f,22))})`}><ClaimToken rot={2}/></g>
      <g opacity={enter(f,30)} transform={`translate(${mix(330,356,enter(f,30))} ${mix(205,170,enter(f,30))})`}><ClaimToken rot={7} muted/></g>
    </g>
    <g opacity={now}>
      <circle cx={240} cy={330} r={13} fill={C.mint}/>
      <circle cx={240} cy={330} r={22} fill="none" stroke={C.mint} strokeWidth={2} opacity={.35}/>
      <Text x={240} y={378} size={20} mono fill="#C2CEC7" anchor="middle">now</Text>
    </g>
    <g opacity={maturity}>
      <circle cx={790} cy={330} r={13} fill="none" stroke={C.mint} strokeWidth={3}/>
      <Text x={790} y={378} size={20} mono fill="#C2CEC7" anchor="middle">maturity</Text>
    </g>
    <g opacity={enter(f,58)}>
      <path d="M240 288H790" stroke="#8BA399" strokeWidth={2} strokeDasharray="2 8" strokeLinecap="round"/>
      <path d="M240 278V298M790 278V298" stroke="#8BA399" strokeWidth={2}/>
      <Text x={515} y={258} size={19} mono fill="#8BA399" anchor="middle">the wait</Text>
    </g>
  </g>;
}

export function ClaimsArt({f}:{f:number}) {
  return <g>
    <g opacity={enter(f,10)}>
      <Text x={552} y={64} size={21} mono fill={C.muted}>claims</Text>
      <Path d="M470 292C520 292 515 120 552 120" dash/>
    </g>
    {[0,1,2].map(i=><g key={i} opacity={enter(f,22+i*13)} transform={`translate(${mix(540,560,enter(f,22+i*13))} ${120+i*82+10*(1-enter(f,22+i*13))})`}>
      <ClaimToken rot={i===1?0:(i===0?-4:4)} muted={i===1?false:true}/>
    </g>)}
    <g opacity={enter(f,68)}>
      <Text x={552} y={412} size={21} mono fill={C.muted}>Repayments, split into claims</Text>
    </g>
  </g>;
}

export function MarketArt({f}:{f:number}) {
  const bids=[210,172,136,104,74], asks=[74,108,142,178,214];
  return <g>
    <g opacity={enter(f,8)}>
      <rect x={360} y={0} width={580} height={420} rx={26} fill="#FFFFFFC7" stroke={C.line} strokeWidth={2}/>
      <Text x={392} y={56} size={23} mono fill={C.muted}>Claims / USDC</Text>
      <text x={908} y={60} fontSize={35} fontWeight={600} letterSpacing="-.03em" textAnchor="end" fontFamily="ConceptGeist" fill={C.ink}>Kuru</text>
      <path d="M392 88H908" stroke={C.line} strokeWidth={2}/>
      <Text x={392} y={128} size={20} mono fill={C.muted}>Bids</Text>
      <Text x={908} y={128} size={20} mono fill={C.muted} anchor="end">Asks</Text>
    </g>
    {bids.map((w,i)=><g key={`b${i}`} opacity={enter(f,22+i*7)}>
      <rect x={392} y={152+i*46} width={w*move(f,22+i*7,14)} height={22} rx={6} fill={C.green}/>
    </g>)}
    {asks.map((w,i)=><g key={`a${i}`} opacity={enter(f,26+i*7)}>
      <rect x={908-w*move(f,26+i*7,14)} y={152+i*46} width={w*move(f,26+i*7,14)} height={22} rx={6} fill={C.mint}/>
    </g>)}
    <g opacity={enter(f,72)}>
      <path d="M650 152V374" stroke={C.line} strokeWidth={2} strokeDasharray="4 8"/>
      <Text x={650} y={404} size={19} mono fill={C.muted} anchor="middle">open market</Text>
    </g>
  </g>;
}

export function ExitArt({f}:{f:number}) {
  const pass=move(f,52,42), pay=move(f,112,42);
  const claimX=mix(500,745,pass), claimY=mix(178,178,pass);
  const usdcX=mix(745,500,pay), usdcY=mix(288,288,pay);
  return <g>
    <g opacity={enter(f,6)}>
      <Path d="M500 160H745" dash/>
      <Path d="M500 306H745" dash/>
      <path d="M736 152L748 160L736 168" fill="none" stroke={C.mint} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M509 298L497 306L509 314" fill="none" stroke={C.green} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>
      <Text x={622} y={140} size={20} mono fill={C.muted} anchor="middle">claims</Text>
      <Text x={622} y={344} size={20} mono fill={C.muted} anchor="middle">USDC</Text>
    </g>
    <g opacity={enter(f,10)}>
      <Person x={430} y={232} r={44}/>
      <Person x={800} y={232} r={44}/>
      <Text x={430} y={310} size={22} mono fill={C.muted} anchor="middle">You</Text>
      <Text x={800} y={310} size={22} mono fill={C.muted} anchor="middle">Another investor</Text>
    </g>
    <g opacity={f>=52&&f<98?1:0}><ClaimToken x={claimX-36} y={claimY-22} scale={.52} label="claim"/></g>
    <g opacity={f>=112&&f<160?1:0}><UsdcPill x={usdcX} y={usdcY} scale={.78}/></g>
    {[0,18,36].map(at=><Packet key={at} f={f} at={52+at} x1={500} y1={178} x2={745} y2={178} size={5}/>)}
    {[0,18,36].map(at=><Packet key={at} f={f} at={112+at} x1={745} y1={288} x2={500} y2={288} size={5}/>)}
    <g opacity={enter(f,170)}>
      <Text x={615} y={412} size={22} mono fill={C.muted} anchor="middle">A buyer takes the other side</Text>
    </g>
  </g>;
}

const revenue:[Point,Point,Point,Point,Point,Point,Point,Point]=[[60,210],[180,185],[300,190],[420,130],[540,110],[660,175],[780,205],[900,225]];
const price:[Point,Point,Point,Point,Point,Point,Point,Point]=[[60,236],[180,226],[300,206],[420,180],[540,170],[660,201],[780,226],[900,238]];

function samplePath(points:Point[],x:number) {
  for(let i=1;i<points.length;i++) {
    const [x0,y0]=points[i-1],[x1,y1]=points[i];
    if(x<=x1) return mix(y0,y1,(x-x0)/(x1-x0));
  }
  return points[points.length-1][1];
}
function linePath(points:Point[]) {
  return points.map((point,i)=>`${i?'L':'M'}${point[0]} ${point[1]}`).join('');
}

export function PriceArt({f}:{f:number}) {
  const p=move(f,25,115);
  const x=mix(60,900,p);
  const markerY=samplePath(price,x);
  return <g>
    <g opacity={enter(f,8)}>
      <path d="M60 36V270H920" fill="none" stroke={C.line} strokeWidth={2}/>
      <path d="M72 36H112" stroke={C.green} strokeWidth={5} strokeLinecap="round"/>
      <Text x={124} y={44} size={21} fill={C.muted}>Revenue</Text>
      <circle cx={320} cy={37} r={7} fill={C.mint}/>
      <Text x={338} y={44} size={21} fill={C.muted}>Claim price</Text>
      <Text x={920} y={298} size={19} mono fill={C.muted} anchor="end">expected repayment</Text>
    </g>
    <clipPath id="kuruChartReveal"><rect x={0} y={0} width={Math.max(0,x)} height={400}/></clipPath>
    <g clipPath="url(#kuruChartReveal)">
      <path d={linePath(revenue)} fill="none" stroke={C.green} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round"/>
      <path d={linePath(price)} fill="none" stroke={C.mint} strokeWidth={4} strokeDasharray="8 8" strokeLinecap="round"/>
    </g>
    <g opacity={p>0?1:0}>
      <path d={`M${x} ${markerY}V270`} stroke={C.muted} strokeWidth={1.5} strokeDasharray="4 7"/>
      <circle cx={x} cy={markerY} r={12} fill={C.mint} stroke={C.ink} strokeWidth={2}/>
      <circle cx={x} cy={markerY} r={21} fill="none" stroke={C.mint} strokeWidth={2} opacity={.4}/>
    </g>
  </g>;
}

export function HonestArt({f}:{f:number}) {
  return <g>
    <g opacity={enter(f,8)}>
      <rect x={0} y={0} width={580} height={270} rx={24} fill="#FFFFFF0D" stroke="#61796D" strokeWidth={2}/>
      <Text x={32} y={50} size={22} mono fill="#B4C9BD">Claims / USDC</Text>
      <Text x={548} y={50} size={22} mono fill="#B4C9BD" anchor="end">Bids</Text>
      <path d="M32 78H548" stroke="#61796D" strokeWidth={2}/>
      {[132,80].map((w,i)=><rect key={w} x={32} y={110+i*44} width={w*enter(f,22+i*10)} height={20} rx={6} fill={C.green} opacity={.5}/>)}
      <Text x={32} y={242} size={21} mono fill="#8BA399">Buyers may be few.</Text>
    </g>
    <g opacity={enter(f,36)}>
      <UsdcPill x={700} y={118} scale={.9}/>
      <ClaimToken x={650} y={168} scale={.72} muted/>
      <path d="M690 240C760 240 760 168 746 140" fill="none" stroke="#61796D" strokeWidth={2} strokeDasharray="6 8" strokeLinecap="round"/>
      <path d="M738 150L746 138L754 150" fill="none" stroke="#61796D" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
      <Text x={700} y={282} size={19} mono fill="#8BA399" anchor="middle">a sale needs a buyer</Text>
    </g>
  </g>;
}
