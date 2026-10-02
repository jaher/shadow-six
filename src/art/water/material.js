/**
 * Water surface material (GLSL3 ShaderMaterial, linear HDR output — tone mapping happens in OutputPass).
 * One material per body; shared textures/uniform objects are passed in by WaterSystem.
 * All animated terms are periodic in the shader clock `time` (wrapped on the CPU to TIME_LOOP s), so long
 * sessions never shear or lose precision.
 */
import * as THREE from 'three';
import { WIND_GLSL, WIND_UNIFORMS } from '../../world/wind.js';

/** Shader clock period (s); equals the FFT loop period. Every speed/period below divides it. */
export const TIME_LOOP = 256;

const COMMON = /* glsl */`
uniform float time, level, bodyType, dispScaleA, dispScaleB, patchA, patchB, surfAmp, surfLen, surfPeriod;
uniform vec4 bodyBounds, rippleArea;
uniform sampler2D bodyTex, dispA, dispB, rippleTex;
const float PI = 3.14159265, TL = ${TIME_LOOP.toFixed(1)};
vec4 bodyAt(vec2 xz){ return texture(bodyTex, (xz - bodyBounds.xy)/bodyBounds.zw); }
// shoaling surf: crests follow depth contours and run toward the shore; returns (height, breaking foam)
vec2 surf(float depth, float t){
  if (surfAmp <= 0.0 || depth < -0.6) return vec2(0.0);
  float d = max(depth, 0.0);
  float ph = 2.0*PI*(t/surfPeriod + d/surfLen);
  float shoal = pow(clamp(3.0/(d+0.35), 0.0, 3.0), 0.25);          // Green's law-ish amplitude growth
  float a = surfAmp*shoal*smoothstep(-0.6, 0.15, depth)*(1.0 - smoothstep(3.0, 7.0, d));
  float breakAt = 1.6*a;                                             // H/d ~ 0.78
  float crest = pow(0.5 + 0.5*sin(ph), 3.0);
  float broken = 1.0 - smoothstep(breakAt*0.6, breakAt*1.6, d);
  a *= mix(1.0, 0.55, broken);                                       // energy lost after breaking
  float foam = crest*broken*smoothstep(-0.3, 0.1, depth);
  return vec2(a*crest, foam);
}`;

export const WATER_VS = /* glsl */`
${COMMON}
out vec3 vWorld; out vec2 vXZ; out vec4 vBody; out float vSurfFoam; out vec3 vViewPos;
void main(){
  vec4 wp = modelMatrix*vec4(position, 1.0);
  vec2 xz = wp.xz;
  vec4 body = bodyAt(xz);
  vec3 d = vec3(0.0);
  if (bodyType > 1.5) {
    float att = clamp(body.a/5.0, 0.0, 1.0);
    d = texture(dispA, xz/patchA).xyz*dispScaleA*att + texture(dispB, xz/patchB).xyz*dispScaleB*(0.3+0.7*att);
  } else if (dispScaleB > 0.0) {
    d = texture(dispB, xz/patchB).xyz*dispScaleB;
  }
  vec2 s = surf(body.a, time);
  d.y += s.x;
  // interactive ripples feed the normals only (fragment shader): no vertex aliasing on the 0.75 m grid
  wp.xyz += d;
  vWorld = wp.xyz; vXZ = xz; vBody = body; vSurfFoam = s.y;
  vec4 mv = viewMatrix*wp; vViewPos = mv.xyz;
  gl_Position = projectionMatrix*mv;
}`;

export const WATER_FS = /* glsl */`
${COMMON}
#include <packing>
${WIND_GLSL}
in vec3 vWorld; in vec2 vXZ; in vec4 vBody; in float vSurfFoam; in vec3 vViewPos;
uniform sampler2D bodyTex2, nrmA, nrmB, detailTex, foamTex, causticsTex, sceneColor, sceneDepth, reflTex, envTex;
uniform sampler2DShadow sunShadow; uniform mat4 sunShadowMat; uniform float shadowOn, shadowBias; uniform vec2 shadowTexel;
uniform vec2 resolution; uniform mat4 projInv, camWorld, reflMatrix, viewMat;
uniform float uOrtho, camNear, camFar, slopeA, slopeB, detailScale, causticsPatch, causticsStrength, reflEnabled, envIntensity;
uniform float refrStrength, roughness, sssStrength, foamScale, shoreFoamDepth, iceWidth, flowPeriod, fogOn, fogNear, fogFar;
uniform float rippleTexel, reflDistort, fadeDepth, envRot, night, shoreFoam, foamAmount, sheen, directFrac, maskCut;
uniform vec2 flowDir; uniform int dbg;
uniform vec3 plPos[4], plCol[4]; uniform int plCount;
uniform vec3 sunDir, sunColor, skyIrr, absorb, scatterColor, foamColor, fogColor, iceColor;
uniform vec3 iceFree[4]; // (x, z, radius m): open water kept free of the shore ice (M3: where the dam's water lands)
vec3 worldAt(vec2 uv, float d){ vec4 v = projInv*vec4(uv*2.0-1.0, d*2.0-1.0, 1.0); v /= v.w; return (camWorld*v).xyz; }
vec3 envLookup(vec3 r){
  float a = atan(r.z, r.x) + envRot;
  vec2 uv = vec2(a/(2.0*PI) + 0.5, asin(clamp(r.y, -1.0, 1.0))/PI + 0.5);
  return texture(envTex, uv).rgb*envIntensity;
}
// sun visibility from the engine's PCF shadow map (3x3 taps); 1 outside the shadow frustum
float sunVis(vec3 wp, float soft){
  if (shadowOn < 0.5) return 1.0;
  vec4 sc = sunShadowMat*vec4(wp, 1.0); vec3 c = sc.xyz/sc.w;
  if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
    s += texture(sunShadow, vec3(c.xy + vec2(i, j)*shadowTexel*soft, c.z - shadowBias));
  return s/9.0;
}
// two-phase flow-mapped sampling (Vlachos 2010), phase offset o; periodic in time (flowPeriod divides TL)
vec4 flowTex(sampler2D t, vec2 xz, vec2 flow, float scale, float per, float o){
  float p0 = fract(time/per + o), p1 = fract(time/per + o + 0.5);
  float w = abs(1.0 - 2.0*p0);
  vec4 a = texture(t, (xz - flow*p0*per)/scale);
  vec4 b = texture(t, (xz - flow*p1*per)/scale + 0.37);
  return mix(b, a, w);
}
float ggx(float NH, float a){ float a2 = a*a; float d = NH*NH*(a2 - 1.0) + 1.0; return a2/(PI*d*d); }
void main(){
  // grid-mask bodies: the mesh is the component's bounding box; drop texels well outside the water cells
  if (texture(bodyTex, (vXZ - bodyBounds.xy)/bodyBounds.zw).a < maskCut) discard;
  vec2 suv = gl_FragCoord.xy/resolution;
  vec3 V = uOrtho > 0.5 ? normalize(camWorld[2].xyz) : normalize(cameraPosition - vWorld);
  vec2 flow = vBody.rg;
  float speed = length(flow);
  bool river = bodyType > 0.5 && bodyType < 1.5;
  float shoreD = texture(bodyTex2, (vXZ - bodyBounds.xy)/bodyBounds.zw).r;   // metres to bank/obstacle
  float footprint = length(fwidth(vXZ));                                       // metres per pixel
  vec4 nz = texture(foamTex, vXZ/13.0);                                        // b: tileable fbm noise
  // ---------------------------------------------------------------- normal
  vec2 slope = vec2(0.0); float whitecap = 0.0;
  if (bodyType > 1.5) {
    vec4 a = texture(nrmA, vXZ/patchA), b = texture(nrmB, vXZ/patchB);
    slope = a.rg*slopeA + b.rg*slopeB; whitecap = max(a.b, b.b*0.7);
  } else if (river) {
    vec3 s = flowTex(nrmB, vXZ, flow, patchB, flowPeriod, 0.0).rgb;
    slope = s.rg*slopeB*(0.6 + 0.5*min(speed, 2.0));
  } else {
    slope = texture(nrmB, vXZ/patchB).rg*slopeB;
  }
  vec3 dn = river ? flowTex(detailTex, vXZ, flow, 3.0, flowPeriod, 0.25).rgb*2.0 - 1.0
          : (texture(detailTex, vXZ/5.0 - floor(uWindA.xy*5.8 + 0.5)/TL*time).rgb + texture(detailTex, vXZ/2.3 - floor(uWindA.xy*4.5 + vec2(-uWindA.y, uWindA.x)*1.5 + 0.5)/TL*time).rgb - 1.0);
  // step 4w: gusts darken/roughen the surface in travelling patches (cat's paws); stronger wind, rougher chop
  vec4 wS = windSample(vXZ);
  float windK = windStr(wS), gustW = min(wS.z, 1.2);
  slope += dn.rg*detailScale*(river ? (0.5 + 0.6*min(speed, 2.0)) : 1.0)*(0.75 + 0.6*windK + 1.3*gustW);
  // interactive ripples (normals only)
  vec2 ruv = (vXZ - rippleArea.xy)*rippleArea.w;
  float rFoam = 0.0;
  if (all(greaterThan(ruv, vec2(0.0))) && all(lessThan(ruv, vec2(1.0)))) {
    float e = rippleTexel, cell = rippleArea.z*e;
    float hx = texture(rippleTex, ruv + vec2(e, 0.)).r - texture(rippleTex, ruv - vec2(e, 0.)).r;
    float hz = texture(rippleTex, ruv + vec2(0., e)).r - texture(rippleTex, ruv - vec2(0., e)).r;
    vec2 edge = min(ruv, 1.0 - ruv);
    float win = smoothstep(0.0, 0.05, min(edge.x, edge.y));
    slope += clamp(vec2(hx, hz)/(2.0*cell), -1.5, 1.5)*win;
    vec4 rp = texture(rippleTex, ruv);
    rFoam = (rp.b + rp.a*1.2)*win; // wash / splash foam + boat wake-crest lines (the Kelvin V arms)
  }
  // surf slope from the analytic shoaling wave (finite difference across the depth field)
  if (surfAmp > 0.0) {
    float st = 0.35;
    float h0 = surf(vBody.a, time).x;
    float hxs = surf(bodyAt(vXZ + vec2(st, 0.)).a, time).x, hzs = surf(bodyAt(vXZ + vec2(0., st)).a, time).x;
    slope += vec2(hxs - h0, hzs - h0)/st;
  }
  // large-scale surface variation: calm slicks vs. wind-ruffled patches (cat's paws), advected with the current
  // (two-phase flow map: bounded offsets, no shear over long sessions)
  float patchN = flowTex(foamTex, vXZ + vec2(3.0, 2.0)/TL*time*41.0, flow*0.8, 41.0, 8.0, 0.1).g;
  float ruffle = smoothstep(0.25, 0.8, patchN);
  float rough = mix(river ? 0.35 : 0.45, river ? 1.5 : 1.35, ruffle) + vBody.b*0.8;
  slope *= rough;
  // slope variance the pixel cannot resolve (mip-averaged normals) → widened lobe + reflection spread (Toksvig-like)
  float sig = clamp(0.03 + 0.05*log2(1.0 + footprint*10.0), 0.0, 0.25)*(0.4 + 0.8*ruffle)*sheen;
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 nV = mat3(viewMat)*N;
  // ---------------------------------------------------------------- depth, refraction, absorption
  float fragZ = gl_FragCoord.z;
  float d0 = texture(sceneDepth, suv).r;
  vec3 bed0 = worldAt(suv, d0);
  float col0 = d0 >= 0.99999 ? 50.0 : max(level - bed0.y, 0.0);          // vertical water column here
  float path0 = d0 >= 0.99999 ? 50.0 : length(bed0 - vWorld);
  vec2 ruvR = dbg == 5 ? suv : suv + nV.xy*refrStrength*clamp(path0, 0.0, 3.0)/3.0*vec2(resolution.y/resolution.x, 1.0);
  float dR = texture(sceneDepth, ruvR).r;
  if (dR < fragZ) { ruvR = suv; dR = d0; }                                   // foreground leak guard
  vec3 bedR = worldAt(ruvR, dR);
  float colR = dR >= 0.99999 ? 50.0 : max(level - bedR.y, 0.0);
  float pathR = dR >= 0.99999 ? 50.0 : length(bedR - vWorld);
  vec3 bed = texture(sceneColor, ruvR).rgb;
  vec3 bedRaw = bed;
  float sunUp = max(sunDir.y, 0.05);
  float visS = sunVis(vWorld, 1.5);                                           // surface in the shadow of piers, hulls, cliffs
  // caustics projected along the refracted sun ray onto the bed, blocked by the shadow map (W-B graft),
  // advected with the current in rivers (two-phase), blurred with depth
  if (causticsStrength > 0.0 && colR < 30.0 && dbg != 4) {
    vec3 Lr = refract(-sunDir, vec3(0.0, 1.0, 0.0), 0.75);
    vec2 cxz = bedR.xz - Lr.xz/max(-Lr.y, 0.2)*colR;
    float lod = clamp(log2(1.0 + colR*0.5), 0.0, 4.0);
    float c;
    if (river) {
      float p0 = fract(time/flowPeriod), w = abs(1.0 - 2.0*p0), p1 = fract(p0 + 0.5);
      c = mix(textureLod(causticsTex, (cxz - flow*p1*flowPeriod)/causticsPatch + 0.37, lod).r,
              textureLod(causticsTex, (cxz - flow*p0*flowPeriod)/causticsPatch, lod).r, w);
      c = 0.5*(c + textureLod(causticsTex, (cxz - flow*p0*flowPeriod)*0.61/causticsPatch + 0.3, lod).r*w
                 + textureLod(causticsTex, (cxz - flow*p1*flowPeriod)*0.61/causticsPatch + 0.7, lod).r*(1.0 - w));
    } else {
      c = 0.5*(textureLod(causticsTex, cxz/causticsPatch, lod).r + textureLod(causticsTex, cxz/causticsPatch*0.61 + 0.3, lod).r);
    }
    float visB = sunVis(bedR + sunDir*0.15, 2.5);
    float amt = causticsStrength*smoothstep(0.03, 0.35, colR)*exp(-colR*0.25)*smoothstep(0.02, 0.2, sunDir.y)*visB
      *directFrac*(1.0 - 0.85*night);   // caustics modulate only the direct (sun/moon) share of the bed light
    bed *= 1.0 + amt*(c - 1.0);
  }
  // Beer-Lambert: light goes down the column (sun path) and back up the view path
  // night murk (art direction): the bed fades faster at night so harbours read as dark mirrors with lamp glints
  vec3 sig_a = absorb*mix(1.0, 2.2, night);
  vec3 T = exp(-sig_a*(pathR + colR/sunUp*0.5));
  vec3 Tv = exp(-sig_a*pathR*1.3);
  vec3 lightIn = (skyIrr + sunColor*sunUp*mix(0.4, 1.0, visS))/PI;
  vec3 inscatter = scatterColor*lightIn*(1.0 - Tv);
  vec3 refr = bed*T + inscatter;
  // ---------------------------------------------------------------- reflection
  // three sub-pixel facets (N and N tilted by ±sig toward/away from the viewer and sideways): unresolved ripples
  // reflect brighter sky from lower elevations — rivers at game distance read as water, not flat paint
  vec2 vh = normalize(V.xz + 1e-4);
  vec3 tA = normalize(vec3(vh.x, 0.0, vh.y)), tB = vec3(-tA.z, 0.0, tA.x);
  vec3 Ns[3]; Ns[0] = N; Ns[1] = normalize(N + (tA*0.8 + tB*0.6)*sig*2.0); Ns[2] = normalize(N + (-tA*0.8 + tB*0.6)*sig*2.0);
  vec3 planar = vec3(0.0); float planarA = 0.0;
  if (reflEnabled > 0.5) {
    vec4 rp = reflMatrix*vec4(vWorld.x, level, vWorld.z, 1.0);
    vec4 pl = texture(reflTex, rp.xy/rp.w + nV.xy*reflDistort);
    planar = pl.rgb; planarA = pl.a;
  }
  vec3 col = vec3(0.0), refl = vec3(0.0); float Favg = 0.0;
  for (int i = 0; i < 3; i++) {
    float NVi = max(dot(Ns[i], V), 0.0);
    float Fi = 0.02 + 0.98*pow(1.0 - NVi, 5.0);
    vec3 Ri = reflect(-V, Ns[i]); Ri.y = abs(Ri.y);
    vec3 ri = mix(envLookup(Ri), planar, planarA);
    col += mix(refr, ri, Fi)/3.0; refl += ri/3.0; Favg += Fi/3.0;
  }
  float NV = max(dot(N, V), 0.0);
  // ---------------------------------------------------------------- sun glitter (GGX, lobe widened by sig), crest SSS
  vec3 L = normalize(sunDir);
  vec3 H = normalize(L + V);
  float NH = max(dot(N, H), 0.0), NL = max(dot(N, L), 0.0);
  float a = sqrt(roughness*roughness + sig*sig*0.5);
  float FH = 0.02 + 0.98*pow(1.0 - max(dot(L, H), 0.0), 5.0);
  // night: the moon's glitter is capped lower (an orthographic camera spreads it over the whole screen)
  vec3 spec = sunColor*visS*min(ggx(NH, a)*FH*0.25/max(NV, 0.05)*NL, mix(400.0, 25.0, night));
  // point lights (lamps, fires, flares): GGX glints stretched by the waves → long night reflections
  float ap = max(a, 0.12);
  for (int i = 0; i < 4; i++) {
    if (i >= plCount) break;
    vec3 Lp = plPos[i] - vWorld; float dd = max(dot(Lp, Lp), 0.25); Lp *= inversesqrt(dd);
    vec3 Hp = normalize(Lp + V); float nh = max(dot(N, Hp), 0.0), nl = max(dot(N, Lp), 0.0);
    spec += plCol[i]/dd*min(ggx(nh, ap)*0.02*0.25/max(NV, 0.1), 200.0)*nl;
  }
  float crest = bodyType > 1.5 ? clamp((vWorld.y - level)*0.9, 0.0, 1.0) : 0.0;
  vec2 lh = normalize(L.xz + 1e-4);
  vec3 sss = scatterColor*sunColor*visS*sssStrength*crest*(0.35 + 0.65*pow(max(dot(vh, -lh), 0.0), 2.0))*sunUp;
  col += spec + sss*(1.0 - Favg);
  // ---------------------------------------------------------------- foam (W-B lace + coverage threshold)
  // lace density (uniformly distributed 0..1) at two scales; rivers: advected, stretched along the current into thin
  // streaks; sea/lake: carried by the wave slopes and a slow drift
  float n1 = nz.b;
  float surfF = surfAmp > 0.0 ? surf(bodyAt(vXZ).a, time).y : 0.0;
  float fdens;
  if (river) {
    vec2 fd = speed > 0.02 ? flow/speed : flowDir, fp = vec2(-fd.y, fd.x);
    vec2 q = vec2(dot(vXZ, fd)*0.45, dot(vXZ, fp));                       // along-flow stretch ~2.2x
    vec2 qv = vec2(dot(flow, fd)*0.45, dot(flow, fp));
    fdens = mix(flowTex(foamTex, q, qv, foamScale*0.6, flowPeriod, 0.6).r, flowTex(foamTex, q*2.7 + 0.5, qv*2.7, foamScale*0.6, flowPeriod, 0.85).r, 0.45);
  } else {
    vec2 fuv = vXZ + clamp(slope, -0.3, 0.3)*0.25 + vec2(2.0, 1.0)/TL*time*foamScale;
    fdens = mix(texture(foamTex, fuv/(foamScale*0.63)).r, texture(foamTex, fuv/(foamScale*0.23) + 0.5).r, 0.45);
  }
  float cover = 0.0;
  // contact line hugging banks, piers and rocks (distance field), wider and broken on beaches
  float cw = 0.10 + n1*(bodyType > 1.5 ? 0.5 : 0.3) + (bodyType > 1.5 ? 0.5 : 0.15)*(1.0 - smoothstep(0.3, 1.2, vBody.a));
  cover += (1.0 - smoothstep(0.0, cw, shoreD))*0.6*shoreFoam;
  // sea: surge lines running up the beach (periodic: 65 cycles per TL)
  if (bodyType > 1.5) {
    float surge = pow(0.5 + 0.5*sin(shoreD*1.3 - time*(65.0*2.0*PI/TL) + n1*4.0), 6.0)*(1.0 - smoothstep(1.0, 9.0, shoreD))*(1.0 - smoothstep(0.4, 1.8, vBody.a));
    cover += surge*0.5*shoreFoam + surfF*0.25*smoothstep(0.2, 0.8, n1 + 0.3);
  }
  // obstacle wakes / bank turbulence from the bake (rivers), modulated so streaks break up
  cover += vBody.b*(river ? smoothstep(0.1, 0.9, speed)*smoothstep(0.15, 0.75, n1)*0.6 : 0.6);
  cover += smoothstep(0.45, 0.95, whitecap)*0.55 + smoothstep(0.0, 0.5, rFoam)*0.9; // wakes, splashes: readable at game zoom
  // wind whitecaps (Beaufort 4-5 up), flaring as gust fronts sweep across open water
  cover += smoothstep(0.5, 1.0, windK + gustW*0.5)*smoothstep(0.45, 0.85, nz.b)*(river ? 0.15 : bodyType > 1.5 ? 0.7 : 0.4);
  cover *= foamAmount;
  // soft lace edge (wider when the pixel covers more lace cells) and never fully opaque: foam is aerated water
  float foam = smoothstep(1.0 - cover, 1.0 - cover + 0.16 + footprint*0.3, fdens)*mix(0.35, river ? 0.65 : 0.82, smoothstep(0.25, 0.9, cover));
  foam *= smoothstep(0.0, 0.04, col0 + vSurfFoam*0.05);
  // night: foam is lit only by moon/sky/lamps and reads as dull grey, never glowing (art-directed ×0.55 albedo)
  vec3 Nd = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.75));
  vec3 fLight = sunColor*max(dot(Nd, L), 0.0)*visS + skyIrr*0.9;
  for (int i = 0; i < 4; i++) { if (i >= plCount) break; vec3 Lp = plPos[i] - vWorld; float dd = max(dot(Lp, Lp), 0.25);
    fLight += plCol[i]/dd*max(dot(Nd, Lp*inversesqrt(dd)), 0.0)*0.25; }
  vec3 foamLit = foamColor*mix(1.0, 0.55, night)*fLight/PI;
  col = mix(col, foamLit, foam*mix(1.0, 0.7, night));
  // ---------------------------------------------------------------- ice: shore shelf (iceWidth m) or fully frozen (iceWidth >= 1000)
  float iceA = 0.0;
  if (iceWidth > 0.0) {
    bool frozen = iceWidth >= 1000.0;
    float big = texture(foamTex, vXZ/23.0).g, small = texture(foamTex, vXZ/4.3).g;
    float iw = frozen ? 4.0 : iceWidth;
    float e = frozen ? 0.0 : shoreD + (big - 0.5)*iceWidth*1.1 + (small - 0.5)*0.6;
    for (int k = 0; k < 4; k++) { vec3 f = iceFree[k]; if (f.z > 0.0) e += 12.0*(1.0 - smoothstep(f.z*0.55, f.z, distance(vXZ, f.xy) + (small - 0.5)*1.5)); }
    // floes: the outer third breaks into plates (cell pattern of the mask texture) before open water
    float floe = smoothstep(0.35, 0.55, texture(foamTex, vXZ/7.7).g + 0.35 - 0.7*smoothstep(iw*0.65, iw*1.25, e));
    float ice = frozen ? 1.0 : max(1.0 - smoothstep(iw*0.62 - 0.06, iw*0.62 + 0.06, e), floe*(1.0 - smoothstep(iw*1.2, iw*1.3, e)));
    float snowCover = frozen ? smoothstep(0.42, 0.62, big + (small - 0.5)*0.5 + (1.0 - smoothstep(0.0, 3.0, shoreD))*0.4)
                             : 1.0 - smoothstep(iw*0.25, iw*0.6, e + (small - 0.5)*1.2);   // snow on the older shore ice
    float slush = frozen ? 0.0 : (1.0 - smoothstep(iw*0.6, iw*1.6, e))*(1.0 - ice);
    col = mix(col, col*0.75 + foamColor*skyIrr/PI*0.18, slush*0.5);
    // crack network: cell walls of the lace texture at a large scale, only where a noise mask allows (not a grid)
    float cracks = smoothstep(0.93, 0.985, texture(foamTex, vXZ/11.0 + 0.2).r)*smoothstep(0.45, 0.7, texture(foamTex, vXZ/37.0).b)*0.55;
    vec3 iceN = normalize(vec3(-(small - 0.5)*0.12, 1.0, -(big - 0.5)*0.12));
    // clear (black) ice shows the dark water below; snow-covered ice is bright and matte
    vec3 clearIce = refr*0.45 + iceColor*0.05*skyIrr;
    vec3 snowIce = iceColor*(1.0 - cracks)*(0.88 + 0.2*small)*(sunColor*max(dot(iceN, L), 0.0)*visS + skyIrr)/PI;
    vec3 iceLit = mix(clearIce, snowIce, max(snowCover, 0.35*(1.0 - cracks)));
    float Fi = 0.04 + 0.96*pow(1.0 - max(dot(iceN, V), 0.0), 5.0);
    iceLit += envLookup(reflect(-V, iceN))*Fi*(1.0 - snowCover);
    iceLit += sunColor*visS*ggx(max(dot(iceN, H), 0.0), 0.08)*Fi*0.25*(1.0 - snowCover)*max(dot(iceN, L), 0.0);
    // the shelf ends where the bank rises out of the water (the per-pixel bed depth: the terrain's smooth contour),
    // not at the body's cell mask, whose 0.5 m steps would show as a sawtooth rim where the bank is low and flat
    ice *= smoothstep(0.0, 0.03, col0 + vSurfFoam*0.02);
    col = mix(col, iceLit, ice); iceA = ice;
  }
  // ---------------------------------------------------------------- soft shoreline + fog
  vec3 under = texture(sceneColor, suv).rgb;
  float fade = smoothstep(0.0, fadeDepth, col0 + vSurfFoam*0.02);
  col = mix(under, col, max(fade, iceA));
  if (dbg == 1) col = under; else if (dbg == 2) col = bed; else if (dbg == 3) col = refl; else if (dbg == 6) col = bedRaw*T + inscatter;
  else if (dbg == 7) col = vec3(foam); else if (dbg == 12) col = vec3(rFoam, cover, fdens); else if (dbg == 8) col = vec3(visS);
  else if (dbg == 9) col = spec; else if (dbg == 10) col = refr; else if (dbg == 11) col = foamLit*foam;
  if (fogOn > 0.5) col = mix(col, fogColor, smoothstep(fogNear, fogFar, -vViewPos.z));
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeWaterMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VS, fragmentShader: WATER_FS, uniforms: Object.assign(uniforms, WIND_UNIFORMS),
    depthTest: true, depthWrite: true, transparent: false, side: THREE.FrontSide,
  });
}
