import { expect, it } from 'vitest';
import { graphLaneViewport } from './graph-layout.js';
it('keeps empty and collapsed canvases usable', () => {
 expect(graphLaneViewport({nodes:[]},800).height).toBe(300);
 expect(graphLaneViewport({nodes:[{path:'a',x:0,y:0}]},800).height).toBe(300);
});
it('includes expanded height and spread independently of pan', () => {
 const nodes=[{path:'a',x:0,y:0,expanded:true,width:360,height:500},{path:'b',x:0,y:800,expanded:true,width:360,height:300}];
 expect(graphLaneViewport({nodes},800).height).toBe(1320);
 expect(graphLaneViewport({nodes:nodes.map(n=>({...n,x:n.x+400,y:n.y-600}))},800).height).toBe(1320);
});
it('fits width and resized card dimensions', () => {
 const nodes=[{path:'a',x:0,y:0,expanded:true,width:1000,height:800}];
 expect(graphLaneViewport({nodes},1120)).toMatchObject({height:920,zoom:1,x:0});
 expect(graphLaneViewport({nodes},1000)).toMatchObject({height:824,zoom:.88,x:0});
 expect(graphLaneViewport({nodes},1200).height).toBe(920);
});
it('keeps a readable minimum scale and opens overflowing lanes at their left edge', () => {
 const nodes=[{path:'a',x:0,y:0,expanded:true,width:1000,height:800}];
 expect(graphLaneViewport({nodes},412)).toMatchObject({height:720,zoom:.75});
 expect(graphLaneViewport({nodes},412).x).toBeCloseTo(-500+146/.75);
});
