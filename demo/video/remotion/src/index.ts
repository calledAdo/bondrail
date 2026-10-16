import React from 'react';
import {registerRoot,Composition} from 'remotion';
import {Update,durationInFrames} from './Update';
const Root=()=>React.createElement(Composition,{id:'BondrailUpdate',component:Update,width:1920,height:1080,fps:30,durationInFrames});
registerRoot(Root);
