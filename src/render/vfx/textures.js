// Procedural textures baked on the GPU at startup (0 bytes of shipped assets).
import * as THREE from 'three';
import { NOISE } from './glsl.js';

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`;

function bake(renderer, frag, size, uniforms = {}) {
  uniforms = { uSeed: { value: 0 }, ...uniforms };
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
  });
  rt.texture.anisotropy = 4;
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.Camera();
  const prevRT = renderer.getRenderTarget(); const prevAuto = renderer.autoClear;
  renderer.setRenderTarget(rt); renderer.autoClear = true; renderer.render(scene, cam);
  renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto;
  mat.dispose(); quad.geometry.dispose();
  return rt;
}

// 4x4 atlas of billowing "cauliflower" puffs. RG = fake normal xy, B = thickness, A = density.
const PUFF_FRAG = /* glsl */ `
varying vec2 vUv;
${NOISE}
float hash(float n){ return fract(sin(n)*43758.5453); }
float puffHeight(vec2 p, float seed){
  float h=0.0;
  // cluster of 9 soft spheres -> cumulus-like silhouette
  for(int i=0;i<7;i++){
    float fi=float(i)+seed*17.0;
    float a=hash(fi*1.7)*6.2832; float r=(i==0)?0.0:0.18+0.2*hash(fi*3.1);
    vec2 c=vec2(cos(a),sin(a))*r;
    float rad=(i==0)?0.36:0.16+0.14*hash(fi*5.3);
    float d=length(p-c);
    float s=max(rad*rad-d*d,0.0);
    h=max(h, sqrt(s)/rad*(0.75+0.25*rad/0.36));
  }
  // erosion + fine billows
  float n=fbm3(vec3(p*3.2, seed*3.7));
  float n2=snoise(vec3(p*9.0, seed*5.1+2.0));
  h = h + 0.34*n + 0.1*n2 - 0.14;
  h *= smoothstep(0.5,0.3,length(p));
  return max(h,0.0);
}
float wispHeight(vec2 p, float seed){
  // torn, stretched smoke wisp: domain-warped fbm under a soft elliptical falloff (no round silhouette)
  vec2 q=p*vec2(1.0,1.6);
  vec2 w=vec2(fbm3(vec3(q*2.2,seed*1.3)), fbm3(vec3(q*2.2+4.1,seed*2.1)));
  float n=fbm3(vec3(q*2.8+w*1.4, seed*3.3));
  float fall=(1.0-smoothstep(0.12,0.5,length(p*vec2(1.0,0.8)+w*0.08)));
  return max((0.8+1.1*n)*fall-0.08,0.0);
}
float shapeH(vec2 p, float seed, float wisp){ return wisp>0.5 ? wispHeight(p,seed) : puffHeight(p,seed); }
void main(){
  vec2 cell=floor(vUv*4.0); vec2 lp=fract(vUv*4.0)-0.5;
  float seed=cell.x+cell.y*4.0+1.0; float wisp=step(1.5,cell.y);
  float e=1.0/256.0;
  float h=shapeH(lp,seed,wisp);
  float hx=shapeH(lp+vec2(e,0.0),seed,wisp)-shapeH(lp-vec2(e,0.0),seed,wisp);
  float hy=shapeH(lp+vec2(0.0,e),seed,wisp)-shapeH(lp-vec2(0.0,e),seed,wisp);
  vec3 n=normalize(vec3(-hx/(2.0*e)*0.22,-hy/(2.0*e)*0.22,1.0));
  float dens=smoothstep(0.0,0.75,h)*(0.55+0.45*smoothstep(-0.35,0.35,fbm3(vec3(lp*6.0,seed*9.0))));
  dens*=(1.0-smoothstep(0.42,0.5,max(abs(lp.x),abs(lp.y))));
  gl_FragColor=vec4(n.xy*0.5+0.5, clamp(h,0.0,1.0), dens);
}`;

// Tileable 3-channel detail noise for animated erosion (period 1 in UV).
const DETAIL_FRAG = /* glsl */ `
varying vec2 vUv;
${NOISE}
// tileable 2D noise via 4D torus mapping emulated with 3D sums
float tnoise(vec2 uv, float f, float z){
  vec2 a=uv*6.2831853;
  vec3 p1=vec3(cos(a.x),sin(a.x),0.0)*f/6.2831853; vec3 p2=vec3(cos(a.y),sin(a.y),0.0)*f/6.2831853;
  return snoise(vec3(p1.xy+p2.yx*1.3, z+p2.x*0.7+p1.y*0.3))*0.5+snoise(vec3(p2.xy*1.1-p1.yx, z*1.7+p1.x))*0.5;
}
void main(){
  float r=0.0,g=0.0,b=0.0,a=0.5;
  for(int i=0;i<4;i++){ float f=pow(2.0,float(i))*3.0; r+=a*tnoise(vUv,f,0.0); g+=a*tnoise(vUv,f*1.5,5.0); b+=a*abs(tnoise(vUv,f*2.0,11.0)); a*=0.5; }
  gl_FragColor=vec4(r*0.5+0.5,g*0.5+0.5,b,1.0);
}`;

// Scorch decal: RGB = char colour (sRGB-ish values used as linear albedo), A = coverage.
const SCORCH_FRAG = /* glsl */ `
varying vec2 vUv; uniform float uSeed;
${NOISE}
void main(){
  vec2 p=vUv-0.5; float r=length(p)*2.0; float ang=atan(p.y,p.x);
  float streak=0.5+0.5*snoise(vec3(cos(ang)*3.0,sin(ang)*3.0,0.0)*1.6);
  float n=fbm3(vec3(p*6.0,1.3+uSeed));
  float edge=0.62+0.25*streak+0.12*n;
  float cov=(1.0-smoothstep(edge-0.35, edge, r));
  float spikes=smoothstep(0.35,0.9,snoise(vec3(cos(ang)*9.0,sin(ang)*9.0,2.0)))*(1.0-smoothstep(0.4,1.0,r));
  cov=max(cov, spikes*0.7);
  float core=(1.0-smoothstep(0.0,0.55,r));
  vec3 col=mix(vec3(0.05,0.045,0.04), vec3(0.012,0.011,0.01), core);
  col*=0.8+0.4*(fbm3(vec3(p*20.0,4.0))*0.5+0.5);
  float speck=step(0.72,snoise(vec3(p*55.0,7.0)))*(1.0-smoothstep(0.5,1.0,r));
  cov=clamp(cov+speck*0.5,0.0,1.0);
  gl_FragColor=vec4(col, cov*0.92);
}`;

export function bakeVfxTextures(renderer) {
  const puff = bake(renderer, PUFF_FRAG, 1024);
  const detail = bake(renderer, DETAIL_FRAG, 256);
  detail.texture.wrapS = detail.texture.wrapT = THREE.RepeatWrapping;
  const scorch = bake(renderer, SCORCH_FRAG, 512);
  return { puff, detail, scorch, dispose() { puff.dispose(); detail.dispose(); scorch.dispose(); } };
}
