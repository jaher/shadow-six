#!/usr/bin/env python3
"""Fire-ramp look-dev (src/render/vfx/glsl.js fireEmit): simulates three r186's AgX tone mapping + the per-theatre
grade LUT (src/engine/grade.js) on a linear emission value and prints the on-screen sRGB colour, then fits the
ramp nodes (log intensity + green ratio at a fixed negative-blue ratio) to target screen colours.
Usage: python3 tools/render/fire-ramp.py          (needs numpy)
"""
import numpy as np, sys
def M(*cols): return np.array(cols).T  # glsl mat3 column-major
S2R=M((0.6274,0.0691,0.0164),(0.3293,0.9195,0.0880),(0.0433,0.0113,0.8956))
R2S=M((1.6605,-0.1246,-0.0182),(-0.5876,1.1329,-0.1006),(-0.0728,-0.0083,1.1187))
IN=M((0.856627153315983,0.137318972929847,0.11189821299995),(0.0951212405381588,0.761241990602591,0.0767994186031903),(0.0482516061458583,0.101439036467562,0.811302368396859))
OUT=M((1.1271005818144368,-0.1413297634984383,-0.14132976349843826),(-0.11060664309660323,1.157823702216272,-0.11060664309660294),(-0.016493938717834573,-0.016493938717834257,1.2519364065950405))
def con(x):
  x2=x*x;x4=x2*x2
  return 15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232
def agx(c):
  c=IN@(S2R@np.array(c,float)); c=np.maximum(c,1e-10); c=np.log2(c); c=(c+12.47393)/(16.5)
  c=np.clip(c,0,1); c=con(c); c=OUT@c; c=np.maximum(c,0)**2.2; c=R2S@c; return np.clip(c,0,1)
def srgb(c): return np.where(c<=0.0031308,12.92*c,1.055*c**(1/2.4)-0.055)
def disp(c): return (srgb(agx(c))*255).round().astype(int)
def bb(T):
  T=min(max(T,600),8000); t=T/100
  r=1 if t<=66 else 1.2929*(t-60)**-0.1332
  g=np.clip(0.3900816*np.log(t)-0.6318414,0,1)
  b=0 if t<=19 else np.clip(0.5432068*np.log(t-10)-1.1962541,0,1)
  return np.array([r,g,b])**2.2
def rad(T): return (max(T-800,0)/1000)**2.5
G={'norway':dict(wb=[0.99,1.0,1.02],lift=[0.012,0.014,0.022],gamma=1.02,gain=[1,1,1],contrast=1.06,sat=0.86,st=[-0.01,0,0.018],ht=[0.008,0.004,-0.004],vib=-0.15,exp=1.2),
   'desert':dict(wb=[1.02,1.0,0.96],lift=[0.014,0.01,0.006],gamma=0.98,gain=[1.0,0.98,0.94],contrast=1.1,sat=0.84,st=[0,-0.002,0.008],ht=[0.016,0.008,-0.012],vib=-0.2,exp=0.95)}
def grade(c,g):
  c=np.array(c)*g['wb']; L=np.array(g['lift']); c=np.array(g['gain'])*(c+L*(1-c))
  c=np.maximum(c,0)**(1/g['gamma']); c=(c-0.46)*g['contrast']+0.46
  l=0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; ch=c.max()-c.min(); s=max(0,g['sat']*(1+g['vib']*min(max(ch*2,0),1)))
  c=l+(c-l)*s; lc=min(max(l,0),1); c=c+np.array(g['st'])*(1-lc)**2+np.array(g['ht'])*lc*lc
  return np.clip(c,0,1)
def gdisp(e,g): return (grade(srgb(agx(np.array(e)*g['exp'])),g)*255).round().astype(int)
if __name__ == '__main__':
  targets = {'white': (255, 235, 170), 'core': (255, 200, 70), 'hot': (250, 150, 30), 'orange': (230, 95, 15), 'red': (160, 36, 8), 'ember': (72, 14, 6)}
  for th in ['norway', 'desert']:
    kb = 0.14
    print(th, 'blue ratio', -kb)
    for k, t in targets.items():
      best = None
      for lI in np.linspace(-3.5, 3.5, 141):
        for a in np.linspace(0, 0.5, 26):
          I = np.exp(lI); e = [I, a * I, -kb * I]; d = np.sum((gdisp(e, G[th]).astype(float) - np.array(t)) ** 2)
          if best is None or d < best[0]: best = (d, I, a, gdisp(e, G[th]))
      print('  %-6s target %s  lnI=%.2f a=%.2f -> %s' % (k, t, np.log(best[1]), best[2], best[3]))
