// Bondrail adapter for snapcn's host design system; no remote fonts or editor runtime.
import type {ReactNode} from 'react';
export interface SnapCnTheme {background:string;foreground:string;card:string;border:string;primary:string;primaryForeground:string;mutedForeground:string;fontFamily:string;}
export const defaultLightTheme:SnapCnTheme={background:'#F6F5EF',foreground:'#202A27',card:'#ffffff',border:'#d2d8d3',primary:'#202A27',primaryForeground:'#F6F5EF',mutedForeground:'#737373',fontFamily:'Geist'};
const dark:SnapCnTheme={background:'#202A27',foreground:'#F6F5EF',card:'#202A27',border:'#52645c',primary:'#9FE8CA',primaryForeground:'#202A27',mutedForeground:'#b5c3ba',fontFamily:'Geist'};
export const useSnapCnTheme=(theme?:Partial<SnapCnTheme>,mode?:'light'|'dark'):SnapCnTheme=>({...mode==='light'?defaultLightTheme:dark,...theme});
export const resolveFont=(name?:string)=>name??'Geist';
export const withAlpha=(color:string,alpha:number)=>`color-mix(in srgb, ${color} ${alpha*100}%, transparent)`;
export const mixOklch=(a:string,b:string,t:number)=>`color-mix(in oklch, ${a} ${(1-t)*100}%, ${b})`;
export const parseColor=(color:string)=>({alpha:color==='transparent'?0:1});
export const Item=({children}:{children:ReactNode;index:number;primary?:boolean})=><>{children}</>;
