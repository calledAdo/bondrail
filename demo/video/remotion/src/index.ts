import React from 'react';
import {registerRoot,Composition} from 'remotion';
import {Update,durationInFrames} from './Update';
import {Concepts,conceptsDurationInFrames} from './concepts/Concepts';
const Root=()=>React.createElement(React.Fragment,null,
  React.createElement(Composition,{id:'BondrailUpdate',component:Update,width:1920,height:1080,fps:30,durationInFrames}),
  React.createElement(Composition,{id:'Concepts',component:Concepts,width:1920,height:1080,fps:30,durationInFrames:conceptsDurationInFrames}),
  React.createElement(Composition,{id:'ConceptsSquare',component:Concepts,width:1080,height:1080,fps:30,durationInFrames:conceptsDurationInFrames}),
);
registerRoot(Root);
