import React from 'react';
import {enter, move, mix, palette as C} from './motion';

type TextProps={x:number;y:number;children:React.ReactNode;size?:number;fill?:string;weight?:number;anchor?:'start'|'middle'|'end';mono?:boolean};
export function Text({x,y,children,size=28,fill=C.ink,weight=400,anchor='start',mono=false}:TextProps) {
  return <text x={x} y={y} fontSize={size} fill={fill} fontWeight={weight} textAnchor={anchor} fontFamily={mono?'ConceptMono':'ConceptGeist'}>{children}</text>;
}
export function Symbol({x=0,y=0,size=70,fill=C.mint}:{x?:number;y?:number;size?:number;fill?:string}) {
  return <g transform={`translate(${x} ${y}) scale(${size/96})`} fill={fill}><path d="M12 10H26V86H12Z"/><path d="M32 10H57C70 10 78 17 78 27C78 37 70 44 57 44H32V32H57C62 32 64 30 64 27C64 24 62 22 57 22H32Z"/><path d="M32 52H61C74 52 82 59 82 69C82 79 74 86 61 86H32V74H61C66 74 68 72 68 69C68 66 66 64 61 64H32Z"/></g>;
}
export function BondCard({status='Repaying',step=0,title='Your business',next=false}:{status?:string;step?:number;title?:string;next?:boolean}) {
  return <g>
    <rect x={6} y={12} width={560} height={590} rx={32} fill="#7B96891A"/>
    <rect width={560} height={590} rx={32} fill="white" stroke={C.line} strokeWidth={2}/>
    <rect x={30} y={30} width={500} height={144} rx={18} fill={C.ink}/>
    <Symbol x={50} y={54} size={74}/>
    <Text x={144} y={83} size={32} weight={600} fill={C.paper}>{title}</Text>
    <Text x={144} y={126} size={22} fill={C.mint}>Onchain revenue</Text>
    <Text x={34} y={238} size={43} weight={600}>{next?'Next revenue bond':'Revenue bond'}</Text>
    <rect x={34} y={264} width={218} height={45} rx={22} fill={C.mint}/>
    <Text x={54} y={295} size={23} weight={600}>{status}</Text>
    <Text x={34} y={364} size={24} fill={C.muted}>Revenue share</Text>
    <g opacity={1-step}><Text x={526} y={364} size={24} anchor="end">Defined by you</Text></g>
    <g opacity={step} transform={`translate(0 ${12*(1-step)})`}><rect x={338} y={331} width={188} height={47} rx={23} fill={C.mint}/><Text x={432} y={363} size={24} anchor="middle" weight={600}>Steps up ↑</Text></g>
    <Text x={34} y={410} size={24} fill={C.muted}>Repayment cap</Text><Text x={526} y={410} size={24} anchor="end">Set in the bond</Text>
    <path d="M34 438H526" stroke={C.line} strokeWidth={2}/>
    <Text x={34} y={489} size={23}>{next?'Terms for your next chapter':'Revenue toward repayment'}</Text>
    <rect x={34} y={516} width={492} height={14} rx={7} fill="#EDF1EB"/>
    <rect x={34} y={516} width={next?98:330} height={14} rx={7} fill={C.green}/>
  </g>;
}
export function Person({x,y,r=32}:{x:number;y:number;r?:number}) {
  return <g transform={`translate(${x} ${y}) scale(${r/32})`}><circle r={32} fill={C.mint}/><circle cy={-9} r={7} fill={C.ink}/><path d="M-13 16C-13 0 13 0 13 16" fill="none" stroke={C.ink} strokeWidth={4} strokeLinecap="round"/></g>;
}
export function Reveal({f,at=0,children}:{f:number;at?:number;children:React.ReactNode}) {
  const p=enter(f,at);return <g opacity={p} transform={`translate(0 ${16*(1-p)})`}>{children}</g>;
}
function Packet({f,at,x1,y1,x2,y2,dark=false}:{f:number;at:number;x1:number;y1:number;x2:number;y2:number;dark?:boolean}) {
  const p=move(f,at);return <circle cx={mix(x1,x2,p)} cy={mix(y1,y2,p)} r={8} fill={dark?C.mint:C.green} opacity={f>=at&&f<at+18?1:0}/>;
}
function Path({d,dark=false,dash=false}:{d:string;dark?:boolean;dash?:boolean}) {return <path d={d} fill="none" stroke={dark?'#8BA399':C.muted} strokeWidth={2} strokeDasharray={dash?'6 8':undefined}/>}

export function Reprise({f,dark=false}:{f:number;dark?:boolean}) {
  return <g>{[125,290,455].map((y,i)=><g key={y}><Path d={`M490 280H560V${y}H670`} dark={dark}/><Person x={700} y={y}/>{[0,45,90,135,180].map(at=><Packet key={at} f={f} at={at+i*7} x1={500} y1={y} x2={658} y2={y} dark={dark}/>)}</g>)}<Text x={700} y={545} size={24} fill={dark?'#C2CEC7':C.muted} anchor="middle">Investors</Text></g>;
}
export function Stages({f}:{f:number}) {
  const split=move(f,27), missed=move(f,180), earned=move(f,105);
  return <g>
    <Reveal f={f} at={10}><Text x={440} y={64} size={24} mono fill={C.muted}>The raise</Text>
      <rect x={440} y={90} width={490} height={30} rx={15} fill="#DCE4DC"/>
      <rect x={440} y={90} width={205} height={30} rx={15} fill={C.green}/>
      <rect x={mix(645,663,split)} y={90} width={267} height={30} rx={15} fill={C.mint}/>
      <Path d="M545 120V188H397"/><Path d="M800 120V188"/>
      <Text x={440} y={237} size={34} weight={550}>Available now</Text>
      <Text x={440} y={278} size={25} fill={C.muted}>To the business</Text>
      <Packet f={f} at={43} x1={540} y1={188} x2={355} y2={188}/>
    </Reveal>
    <Reveal f={f} at={54}><rect x={440} y={320} width={490} height={178} rx={20} fill="#FFFFFFAA" stroke={C.line}/>
      <Text x={466} y={364} size={25} fill={C.muted}>The rest waits</Text>
      <Text x={466} y={409} size={31} weight={550}>Revenue milestone</Text>
      <g opacity={1-missed}><Text x={466} y={459} size={25}>{earned>.5?'Meet it → capital releases':'Set in the bond'}</Text></g>
      <g opacity={missed}><Text x={466} y={459} size={25}>Miss it → unreleased capital returns</Text></g>
    </Reveal>
    <Reveal f={f} at={180}><Path d="M685 498V554H515"/><Person x={470} y={554} r={26}/><Text x={530} y={598} size={24} fill={C.muted}>Back to investors</Text><Packet f={f} at={200} x1={680} y1={554} x2={500} y2={554}/></Reveal>
  </g>;
}
export function Trigger({f}:{f:number}) {
  const draw=move(f,45),check=enter(f,108);
  return <g><Reveal f={f} at={9}>
    <Text x={470} y={67} size={26} fill={C.mint}>Revenue</Text>
    <Path d="M470 102V338H960" dark/>
    <Path d="M470 217H960" dark dash/>
    <Text x={960} y={197} size={22} fill="#C2CEC7" anchor="end">Level set in the bond</Text>
    <path d="M480 150L550 130L620 155L690 143L750 186L810 256L870 277L950 286" stroke={C.mint} strokeWidth={6} fill="none" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1-draw}/>
    <g opacity={check}><circle cx={810} cy={256} r={12} fill={C.mint}/><Text x={470} y={395} size={26} fill={C.paper}>Below the level at the check</Text></g>
    <g opacity={enter(f,124)}><rect x={470} y={432} width={470} height={70} rx={35} fill={C.mint}/><Text x={705} y={478} size={28} weight={550} anchor="middle">Investor share steps up ↑</Text></g>
    <Text x={470} y={552} size={23} fill="#C2CEC7">When a performance trigger is enabled</Text>
  </Reveal></g>;
}
export function Vaults({f}:{f:number}) {
  const p=move(f,28);
  return <g><Reveal f={f} at={6}><rect x={145} y={65} width={740} height={445} rx={34} fill="#FFFFFF6B" stroke="#A9BEB2" strokeWidth={2}/><Text x={180} y={112} size={28} weight={550}>One vault</Text></Reveal>
    {[0,1].map(i=><g key={i} opacity={enter(f,12+i*6)} transform={`translate(${mix(710+i*90,420+i*230,p)} ${mix(-20+i*80,130,p)}) scale(.36)`}><BondCard title={i?'Another business':'A business'}/></g>)}
    <Reveal f={f} at={58}><Text x={515} y={420} size={27} anchor="middle">Across a portfolio of revenue bonds</Text><Text x={515} y={467} size={23} fill={C.muted} anchor="middle">One deposit</Text>
    {[245,515,785].map((x,i)=><g key={x}><Path d={`M515 510V536H${x}V566`}/><Person x={x} y={597} r={29}/><Packet f={f} at={84+i*6} x1={x} y1={563} x2={515} y2={510}/></g>)}
    </Reveal></g>;
}
export function Explain({f}:{f:number}) {
  const p=move(f,15);
  return <g><g opacity={p} transform={`translate(${mix(285,335,p)} 15)`}>
    <rect width={635} height={450} rx={24} fill="#FFFFFFC7" stroke={C.line}/>
    <Text x={34} y={54} size={23} mono fill={C.muted}>In plain words</Text>
    <Text x={34} y={123} size={34} weight={500}>A share of this business’s</Text>
    <Text x={34} y={169} size={34} weight={500}>revenue goes toward repaying</Text>
    <Text x={34} y={215} size={34} weight={500}>you, up to the bond’s cap.</Text>
    <path d="M34 265H600" stroke={C.line}/>
    <Text x={34} y={312} size={24} fill={C.muted}>What could go wrong?</Text>
    <Text x={34} y={357} size={28}>Revenue may fall.</Text>
    <Text x={34} y={397} size={28}>You may not be fully repaid.</Text>
  </g>
  <Reveal f={f} at={55}><Path d="M35 541H925"/>
    {['Raising','Released','Repaying','Maturity','Settled'].map((word,i)=><g key={word}><circle cx={35+i*222.5} cy={541} r={i===2?12:6} fill={i<=2?C.green:'#B9C8BF'}/><Text x={35+i*222.5} y={589} size={24} anchor={i===0?'start':i===4?'end':'middle'} weight={i===2?600:400}>{word}</Text></g>)}
    <rect x={400} y={486} width={150} height={34} rx={17} fill={C.mint}/><Text x={475} y={510} size={20} anchor="middle">you are here</Text>
  </Reveal></g>;
}
export function Record({f}:{f:number}) {
  const p=move(f,108);
  return <g><Reveal f={f} at={15}><Text x={340} y={116} size={26} weight={550}>Onchain record</Text></Reveal>
    {[0,1,2,3].map(i=><Reveal key={i} f={f} at={25+i*19}><rect x={340} y={145+i*73} width={245} height={58} rx={12} fill="white" stroke={C.line}/><circle cx={367} cy={174+i*73} r={13} fill={C.mint}/><path d={`M360 ${174+i*73}l5 5 9-11`} stroke={C.ink} strokeWidth={2.5} fill="none"/><Text x={391} y={183+i*73} size={23}>Repaid</Text></Reveal>)}
    <g opacity={p} transform={`translate(630 ${mix(100,42,p)}) scale(.62)`}><BondCard status="Set your terms" next/></g>
    <Reveal f={f} at={135}><Text x={0} y={572} size={25} fill={C.muted}>A record investors can assess.</Text><Text x={0} y={608} size={23} fill={C.muted}>Future funding is a new decision.</Text></Reveal>
  </g>;
}
export function Builders({f}:{f:number}) {
  return <g><Reveal f={f} at={12}>
    <rect x={0} y={110} width={510} height={290} rx={24} fill="#18211E" stroke="#61796D"/>
    <Text x={30} y={158} size={22} mono fill="#B1C8BC">Your app</Text>
    <Text x={30} y={231} size={30} mono fill={C.mint}>contract MyApp</Text>
    <Text x={30} y={277} size={30} mono fill={C.paper}>is BondrailEarner</Text>
    <Text x={30} y={350} size={24} mono fill="#B1C8BC">{'{ … }'}</Text>
    <Path d="M510 267H560" dark/>
    {[40,85,130,175].map(at=><Packet key={at} f={f} at={at} x1={503} y1={267} x2={566} y2={267} dark/>)}
    <Text x={253} y={474} size={28} anchor="middle" fill={C.mint}>Fees flow into the bond</Text>
    <Text x={253} y={517} size={23} anchor="middle" fill="#C2CEC7">Native revenue integration</Text>
  </Reveal></g>;
}
