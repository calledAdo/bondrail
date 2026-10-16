import {Easing, interpolate} from 'remotion';
import timeline from './timeline.json';
export {timeline};
export const FPS = timeline.fps;
export const FRAMES = timeline.seconds * FPS;
export const palette = {ink:'#202A27', mint:'#9FE8CA', paper:'#F6F5EF', muted:'#65786F', line:'#DCE4DC', green:'#52AF89'};
export const move = (frame:number, at:number, duration=18) => interpolate(frame,[at,at+duration],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.inOut(Easing.cubic)});
export const enter = (frame:number, at:number, duration=15) => interpolate(frame,[at,at+duration],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.out(Easing.cubic)});
// Sequential 300 ms fades keep adjacent headlines from double-exposing.
// The persistent card moves for the same full 600 ms transition.
export const visible = (frame:number, start:number, end:number) => enter(frame,start*FPS+(start===0?0:9),start===0?15:9)*(1-move(frame,end*FPS,9));
export const mix = (a:number,b:number,t:number) => interpolate(t,[0,1],[a,b]);
// This one card remains mounted throughout. Pose changes take 600 ms, even across scene boundaries.
const poses = [
  [0,0,0,.88], [2.4,0,15,.82], [6,0,65,.62], [16,0,40,.72],
  [24,190,130,.36], [32,0,15,.58], [41,0,100,.53], [49,560,60,.65], [56,780,-100,.22], [64,780,-100,.22],
];
export function cardPose(frame:number) {
  let pose=poses[0].slice(1);
  for(let i=1;i<poses.length;i++) {
    const [time,...next]=poses[i];
    if(frame<time*FPS) break;
    const p=move(frame,time*FPS);
    pose=pose.map((value,index)=>mix(value,next[index],p));
  }
  return {x:pose[0],y:pose[1],scale:pose[2]};
}
