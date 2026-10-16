import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Audio, Img, continueRender, delayRender, interpolate, interpolateColors, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {BondCard, Builders, Explain, Record, Reprise, Stages, Trigger, Vaults} from './Artwork';
import {FRAMES, FPS, cardPose, enter, move, palette as C, timeline, visible} from './motion';
export const conceptsDurationInFrames=FRAMES;

function Marker({children,p=1,underline=false}:{children:React.ReactNode;p?:number;underline?:boolean}) {
  return <span style={{position:'relative',display:'inline-block',whiteSpace:'nowrap'}}><span style={{position:'absolute',left:-5,right:-5,bottom:underline?-4:1,height:underline?7:'87%',background:C.mint,borderRadius:underline?'60% 35% 40% 25%':'6px',transform:`scaleX(${p}) ${underline?'rotate(-1.2deg)':''}`,transformOrigin:'left'}}/><span style={{position:'relative',color:underline?undefined:C.ink}}>{children}</span></span>;
}
function Line({text,accent,p,underline=false}:{text:string;accent:string;p:number;underline?:boolean}) {
  if(!accent||!text.includes(accent)) return <>{text}</>;
  const [a,b]=text.split(accent);return <>{a}<Marker p={p} underline={underline}>{accent}</Marker>{b}</>;
}
function Fonts() {
  const [handle]=useState(()=>delayRender('Load local brand fonts'));
  useEffect(()=>{Promise.all([document.fonts.load('400 30px ConceptGeist'),document.fonts.load('600 30px ConceptGeist'),document.fonts.load('400 30px ConceptMono')]).then(()=>continueRender(handle)).catch(error=>{throw error;});},[handle]);
  return <style>{`@font-face{font-family:ConceptGeist;src:url('${staticFile('concepts/Geist.woff2')}');font-weight:100 900;font-display:block;}@font-face{font-family:ConceptMono;src:url('${staticFile('concepts/GeistMono.woff2')}');font-weight:400;font-display:block;}`}</style>;
}
export function Concepts() {
  const frame=useCurrentFrame(), {width}=useVideoConfig(),square=width===1080;
  let darkness=0;
  for (const beat of timeline.beats) {if(frame>=beat.start*FPS) darkness=interpolate(move(frame,beat.start*FPS),[0,1],[darkness,beat.dark?1:0]);}
  const color=interpolateColors(darkness,[0,1],[C.ink,C.paper]);
  const muted=interpolateColors(darkness,[0,1],[C.muted,'#B4C9BD']);
  const pose=cardPose(frame),diagramScale=square?.92:.95, diagramX=square?70:140,diagramY=square?430:270;
  const step=move(frame,16*FPS+124)*(1-move(frame,24*FPS));
  const cardOpacity=1-move(frame,64*FPS);
  const closingMove=move(frame,56*FPS);
  const cardX=interpolate(closingMove,[0,1],[diagramX+pose.x*diagramScale,width-(square?210:300)]);
  const cardY=interpolate(closingMove,[0,1],[diagramY+pose.y*diagramScale,65]);
  const cardScale=interpolate(closingMove,[0,1],[pose.scale*diagramScale,.17]);
  const headerOpacity=1-move(frame,70*FPS);
  const illustrationOpacity=1-move(frame,56*FPS);
  return <AbsoluteFill style={{fontFamily:'ConceptGeist',background:C.paper,color,overflow:'hidden'}}>
    <Fonts/><Audio src={staticFile('concepts/music.wav')}/>
    <AbsoluteFill style={{background:'radial-gradient(ellipse at 1% 0%, #9FE8CA88, transparent 53%), radial-gradient(ellipse at 98% 100%, #9FE8CA77, transparent 53%), linear-gradient(120deg,#F6F5EF,#ECECE6 53%,#F6F5EF)'}}/>
    <AbsoluteFill style={{opacity:darkness,background:'radial-gradient(ellipse at 10% 10%, #334A3F, transparent 65%), linear-gradient(120deg,#202A27,#17221E)'}}/>
    <div style={{position:'absolute',left:square?65:132,top:68,width:230,height:58,opacity:headerOpacity}}>
      <Img src={staticFile('concepts/logo-light.svg')} style={{position:'absolute',width:'100%',opacity:1-darkness}}/>
      <Img src={staticFile('concepts/logo-dark.svg')} style={{position:'absolute',width:'100%',opacity:darkness}}/>
    </div>
    {timeline.beats.slice(0,8).map(beat=>{
      const opacity=visible(frame,beat.start,beat.end);if(!opacity)return null;
      const f=frame-beat.start*FPS;
      return <div key={beat.id} style={{position:'absolute',left:square?70:1130,top:square?165:340,width:square?940:700,opacity,transform:`translateY(${18*(1-enter(f,0))}px)`}}>
        <div style={{fontFamily:'ConceptMono',fontSize:square?22:23,color:muted,marginBottom:square?20:30}}>{beat.label}</div>
        <div style={{fontSize:square?62:68,fontWeight:550,letterSpacing:'-.045em',lineHeight:1.19}}>
          {beat.lines.map((line,i)=><div key={line} style={{opacity:enter(f,i*4),transform:`translateY(${12*(1-enter(f,i*4))}px)`}}><Line text={line} accent={beat.accent} p={move(f,8+i*4)} underline={beat.id==='hook'}/></div>)}
        </div>
      </div>;
    })}
    <svg width={width} height={1080} style={{position:'absolute',inset:0,overflow:'visible'}}>
      <g transform={`translate(${diagramX} ${diagramY}) scale(${diagramScale})`}>
        {timeline.beats.slice(0,8).map(beat=>{
          const opacity=visible(frame,beat.start,beat.end);if(!opacity)return null;
          const f=frame-beat.start*FPS;
          const art:React.ReactNode=({reprise:<Reprise f={f}/>,hook:<Reprise f={f} dark/>,stages:<Stages f={f}/>,trigger:<Trigger f={f}/>,vaults:<Vaults f={f}/>,explain:<Explain f={f}/>,record:<Record f={f}/>,builders:<Builders f={f}/>} as {[key:string]:React.ReactNode})[beat.id];
          return <g key={beat.id} opacity={opacity}>{art}</g>;
        })}
      </g>
      <g opacity={cardOpacity} transform={`translate(${cardX} ${cardY}) scale(${cardScale})`}><BondCard step={step}/></g>
    </svg>
    <div style={{position:'absolute',left:square?70:140,bottom:square?39:92,fontFamily:'ConceptMono',fontSize:20,color:muted,opacity:illustrationOpacity}}>How it works · illustration</div>
    <Difference frame={frame} square={square}/>
    <Rhythm frame={frame} square={square}/>
    <div style={{position:'absolute',inset:0,opacity:enter(frame,70*FPS+9,9),transform:`translateY(${18*(1-enter(frame,70*FPS))}px)`,color:C.paper,textAlign:'center'}}>
      <Img src={staticFile('concepts/logo-dark.svg')} style={{position:'absolute',width:square?720:780,left:(width-(square?720:780))/2,top:square?280:275}}/>
      <div style={{position:'absolute',top:535,left:50,right:50,fontSize:square?43:48,lineHeight:1.25,letterSpacing:'-.025em'}}>{square?<>Revenue bonds<br/>for onchain businesses.</>:'Revenue bonds for onchain businesses.'}</div>
      <div style={{position:'absolute',top:square?750:700,left:0,right:0,fontSize:30,color:C.mint,opacity:enter(frame,70*FPS+12)}}>bondrail.vercel.app · @useBondrail</div>
      <div style={{position:'absolute',top:square?823:780,left:0,right:0,fontSize:22,color:'#B4C9BD',opacity:enter(frame,70*FPS+18)}}>Live on Monad testnet</div>
    </div>
  </AbsoluteFill>;
}
function Difference({frame,square}:{frame:number;square:boolean}) {
  const f=frame-56*FPS,opacity=visible(frame,56,64);if(!opacity)return null;
  const entries=['Capital in stages.','Repaid from revenue.','Every bond explains itself.'];
  return <div style={{position:'absolute',left:square?70:260,right:square?70:260,top:square?230:245,opacity,color:C.paper}}>
    <div style={{fontSize:square?56:66,letterSpacing:'-.045em',marginBottom:48,lineHeight:1.12}}>What makes<br style={{display:square?'block':'none'}}/> Bondrail <Marker p={move(f,12)}>different?</Marker></div>
    {entries.map((line,i)=><div key={line} style={{display:'flex',gap:square?28:52,alignItems:'center',borderTop:'1px solid #71877A',padding:square?'30px 0':'28px 0',opacity:enter(f,18+i*54),transform:`translateY(${14*(1-enter(f,18+i*54))}px)`}}><span style={{fontFamily:'ConceptMono',fontSize:25,color:C.mint}}>0{i+1}</span><span style={{fontSize:square?43:52,letterSpacing:'-.03em'}}>{line}</span></div>)}
  </div>;
}
function Rhythm({frame,square}:{frame:number;square:boolean}) {
  const f=frame-64*FPS,opacity=visible(frame,64,70);if(!opacity)return null;
  const lines=['Businesses set the terms.','Investors fund them.','Revenue repays them.'];
  return <div style={{position:'absolute',left:square?70:320,right:square?70:240,top:315,opacity,color:C.paper,fontSize:square?61:79,letterSpacing:'-.045em',lineHeight:1.63}}>
    {lines.map((line,i)=><div key={line} style={{opacity:enter(f,i*54)}}>{i===2?<Line text={line} accent="Revenue" p={move(f,i*54+5)}/>:line}</div>)}
  </div>;
}
