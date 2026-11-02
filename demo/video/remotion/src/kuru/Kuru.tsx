import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Audio, Img, continueRender, delayRender, interpolate, interpolateColors, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {BondCard} from '../concepts/Artwork';
import {enter, move, mix, palette as C, visible} from '../concepts/motion';
import timeline from './timeline.json';
import {ClaimsArt, ExitArt, HonestArt, HookArt, MarketArt, PriceArt} from './KuruArtwork';

export const kuruDurationInFrames=timeline.seconds*timeline.fps;
const FPS=timeline.fps;

type Pose=[number,number,number,number];
const landscapePoses:Pose[]=[[5,0,0,.80],[11,0,18,.58],[18,-8,22,.46],[25,0,300,.32],[33,0,300,.30],[37,0,300,.30]];
const squarePoses:Pose[]=[[5,0,0,.60],[11,0,0,.42],[18,-8,10,.38],[25,0,300,.28],[33,0,300,.26],[37,0,300,.26]];

function poseFor(frame:number,poses:Pose[]) {
  let pose=poses[0].slice(1) as number[];
  for(let i=1;i<poses.length;i++) {
    const [time,...next]=poses[i];
    if(frame<time*FPS) break;
    const p=move(frame,time*FPS);
    pose=pose.map((value,index)=>mix(value,next[index],p));
  }
  return {x:pose[0],y:pose[1],scale:pose[2]};
}

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
  return <style>{`@font-face{font-family:ConceptGeist;src:url('${staticFile('kuru/Geist.woff2')}');font-weight:100 900;font-display:block;}@font-face{font-family:ConceptMono;src:url('${staticFile('kuru/GeistMono.woff2')}');font-weight:400;font-display:block;}`}</style>;
}

const artwork:Record<string,(props:{f:number})=>React.ReactElement>={hook:HookArt,claims:ClaimsArt,market:MarketArt,exit:ExitArt,price:PriceArt,honest:HonestArt};

export function Kuru() {
  const frame=useCurrentFrame(), {width}=useVideoConfig(), square=width===1080;
  let darkness=0;
  for (const beat of timeline.beats) {if(frame>=beat.start*FPS) darkness=interpolate(move(frame,beat.start*FPS),[0,1],[darkness,beat.dark?1:0]);}
  const color=interpolateColors(darkness,[0,1],[C.ink,C.paper]);
  const muted=interpolateColors(darkness,[0,1],[C.muted,'#B4C9BD']);
  const pose=poseFor(frame,square?squarePoses:landscapePoses);
  const diagramScale=square?.92:.95, diagramX=square?70:140, diagramY=square?430:270;
  const cardOpacity=enter(frame,5*FPS+9,12);
  const closingMove=move(frame,37*FPS);
  const cardX=interpolate(closingMove,[0,1],[diagramX+pose.x*diagramScale,width-(square?210:300)]);
  const cardY=interpolate(closingMove,[0,1],[diagramY+pose.y*diagramScale,65]);
  const cardScale=interpolate(closingMove,[0,1],[pose.scale*diagramScale,.17]);
  const headerOpacity=1-move(frame,37*FPS);
  const illustrationOpacity=1-move(frame,37*FPS);
  return <AbsoluteFill style={{fontFamily:'ConceptGeist',background:C.paper,color,overflow:'hidden'}}>
    <Fonts/><Audio src={staticFile('kuru/music.wav')}/>
    <AbsoluteFill style={{background:'radial-gradient(ellipse at 1% 0%, #9FE8CA88, transparent 53%), radial-gradient(ellipse at 98% 100%, #9FE8CA77, transparent 53%), linear-gradient(120deg,#F6F5EF,#ECECE6 53%,#F6F5EF)'}}/>
    <AbsoluteFill style={{opacity:darkness,background:'radial-gradient(ellipse at 10% 10%, #334A3F, transparent 65%), linear-gradient(120deg,#202A27,#17221E)'}}/>
    <div style={{position:'absolute',left:square?65:132,top:68,width:230,height:58,opacity:headerOpacity}}>
      <Img src={staticFile('kuru/logo-light.svg')} style={{position:'absolute',width:'100%',opacity:1-darkness}}/>
      <Img src={staticFile('kuru/logo-dark.svg')} style={{position:'absolute',width:'100%',opacity:darkness}}/>
    </div>
    {timeline.beats.slice(0,6).map(beat=>{
      const opacity=visible(frame,beat.start,beat.end);if(!opacity)return null;
      const f=frame-beat.start*FPS;
      const small=beat.id==='honest';
      const size=square?(small?42:62):(small?48:68);
      return <div key={beat.id} style={{position:'absolute',left:square?70:1130,top:square?165:340,width:square?940:700,opacity,transform:`translateY(${18*(1-enter(f,0))}px)`}}>
        <div style={{fontFamily:'ConceptMono',fontSize:square?22:23,color:muted,marginBottom:square?20:30}}>{beat.label}</div>
        <div style={{fontSize:size,fontWeight:550,letterSpacing:'-.045em',lineHeight:small?1.3:1.19}}>
          {beat.lines.map((line,i)=><div key={line} style={{opacity:enter(f,i*4),transform:`translateY(${12*(1-enter(f,i*4))}px)`}}><Line text={line} accent={beat.accent} p={move(f,8+i*4)} underline={beat.id==='hook'}/></div>)}
        </div>
      </div>;
    })}
    <svg width={width} height={1080} style={{position:'absolute',inset:0,overflow:'visible'}}>
      <g transform={`translate(${diagramX} ${diagramY}) scale(${diagramScale})`}>
        {timeline.beats.slice(0,6).map(beat=>{
          const opacity=visible(frame,beat.start,beat.end);if(!opacity)return null;
          const f=frame-beat.start*FPS;
          const Art=artwork[beat.id];if(!Art)return null;
          return <g key={beat.id} opacity={opacity}><Art f={f}/></g>;
        })}
      </g>
      <g opacity={cardOpacity} transform={`translate(${cardX} ${cardY}) scale(${cardScale})`}><BondCard/></g>
    </svg>
    <div style={{position:'absolute',left:square?70:140,bottom:square?39:92,fontFamily:'ConceptMono',fontSize:20,color:muted,opacity:illustrationOpacity}}>How it works · illustration</div>
    <div style={{position:'absolute',inset:0,opacity:enter(frame,37*FPS+8,9),transform:`translateY(${18*(1-enter(frame,37*FPS))}px)`,color:C.paper,textAlign:'center'}}>
      <Img src={staticFile('kuru/logo-dark.svg')} style={{position:'absolute',width:square?720:780,left:(width-(square?720:780))/2,top:square?275:270}}/>
      <div style={{position:'absolute',top:square?520:520,left:50,right:50,fontSize:square?43:48,lineHeight:1.28,letterSpacing:'-.025em'}}>
        <div>Revenue bonds,</div>
        <div><Line text="tradeable on Kuru." accent="Kuru" p={move(frame,37*FPS+14)}/></div>
      </div>
      <div style={{position:'absolute',top:square?660:660,left:0,right:0,fontSize:27,color:C.mint,opacity:enter(frame,37*FPS+12)}}>Built on Monad</div>
      <div style={{position:'absolute',top:square?716:716,left:0,right:0,fontSize:30,color:C.paper,opacity:enter(frame,37*FPS+16)}}>bondrail.vercel.app · @useBondrail</div>
      <div style={{position:'absolute',top:square?778:778,left:0,right:0,fontSize:21,color:'#B4C9BD',opacity:enter(frame,37*FPS+22)}}>Live on Monad testnet</div>
    </div>
  </AbsoluteFill>;
}
