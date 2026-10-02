# Newsreel narrator, stage 3: the 1940s period chain (booth, mic band, presence EQ, tube, compressor, optical band-limit,
# film hiss + crackle, wow/flutter, -18 LUFS, soft limit at -1 dBFS sample peak; package.mjs
# limits the true peak before encoding). usage: period.py in.wav out.wav [preset.json]  (44.1 kHz mono)
# preset keys override P below; pad_in / pad_out = film run-in / run-out silence (s) around the voice.
import sys,json,numpy as np,soundfile as sf,librosa,pyloudnorm as pyln
from scipy import signal as sg
SR=44100
P=dict(tempo=1.0,hp=250,lp=5000,presence_f=2500,presence_db=6.0,low_mid_f=330,low_mid_db=-4.0,
       booth_rt60=0.32,booth_wet=0.10,drive=2.2,tube_asym=0.12,comp_thr=-22,comp_ratio=4.0,comp_att=0.004,comp_rel=0.09,
       wow_hz=0.55,wow_depth=0.0012,flutter_hz=7.8,flutter_depth=0.0004,hiss_db=-53,frame_hum=0.25,
       crackle_rate=2.5,crackle_db=-38,lufs=-18.0,tp=-1.0,seed=1941,pad_in=0.6,pad_out=0.8)
def peq(f,g,q,sr=SR):  # RBJ peaking biquad
    A=10**(g/40); w=2*np.pi*f/sr; a=np.sin(w)/(2*q)
    b=[1+a*A,-2*np.cos(w),1-a*A]; aa=[1+a/A,-2*np.cos(w),1-a/A]; return sg.tf2sos(b,aa)
def band(x,hp,lp,order=4): return sg.sosfilt(sg.butter(order,[hp,lp],'bandpass',fs=SR,output='sos'),x)
def booth(x,rt60,wet,rng):
    n=int(SR*rt60*1.2); t=np.arange(n)/SR
    ir=rng.standard_normal(n)*np.exp(-6.91*t/rt60); ir=sg.sosfilt(sg.butter(2,[300,4000],'bandpass',fs=SR,output='sos'),ir)
    for d,g in [(0.0047,0.5),(0.0089,0.35),(0.0131,0.25)]: ir[int(d*SR)]+=g   # close wooden-booth early reflections
    ir/=np.sqrt((ir**2).sum()); y=sg.fftconvolve(x,ir)[:len(x)]
    return (1-wet)*x+wet*y*np.sqrt((x**2).mean()/max(1e-12,(y**2).mean()))
def tube(x,drive,asym):  # asymmetric tanh -> even+odd harmonics, output RMS-matched
    y=np.tanh(drive*(x+asym))-np.tanh(drive*asym); y-=sg.sosfilt(sg.butter(1,20,'hp',fs=SR,output='sos'),y)*0  # dc removed below
    y=sg.sosfilt(sg.butter(1,30,'hp',fs=SR,output='sos'),y); return y*np.sqrt((x**2).mean()/max(1e-12,(y**2).mean()))
def comp(x,thr,ratio,att,rel):
    env=np.abs(x); a=np.exp(-1/(att*SR)); r=np.exp(-1/(rel*SR))
    e=sg.lfilter([1-r],[1,-r],env)  # smooth release-ish follower
    e=np.maximum(e,sg.lfilter([1-a],[1,-a],env))
    db=20*np.log10(e+1e-9); gr=np.minimum(0,(thr-db)*(1-1/ratio))
    y=x*10**(gr/20); return y*np.sqrt((x**2).mean()/max(1e-12,(y**2).mean()))
def wowflutter(x,p,rng):
    t=np.arange(len(x))/SR; ph=rng.uniform(0,6.28,3)
    d=p['wow_depth']*np.sin(2*np.pi*p['wow_hz']*t+ph[0])+p['flutter_depth']*np.sin(2*np.pi*p['flutter_hz']*t+ph[1]) \
      +0.3*p['flutter_depth']*np.sin(2*np.pi*p['flutter_hz']*1.63*t+ph[2])
    idx=np.arange(len(x))+np.cumsum(d)   # speed deviation -> read position
    return np.interp(np.clip(idx,0,len(x)-1),np.arange(len(x)),x)
def film_noise(n,p,rng):
    w=rng.standard_normal(n); pink=sg.lfilter([0.049922035,-0.095993537,0.050612699,-0.004408786],[1,-2.494956002,2.017265875,-0.522189400],w)
    hiss=band(pink,400,6500,2); hiss/=np.sqrt((hiss**2).mean())
    t=np.arange(n)/SR; hiss*=1+p['frame_hum']*0.5*(1+np.sin(2*np.pi*24*t))   # 24 fps gate modulation of the optical track
    hiss*=10**(p['hiss_db']/20)
    cr=np.zeros(n); k=rng.poisson(p['crackle_rate']*n/SR)
    for pos in rng.integers(0,n-400,k):
        L=rng.integers(40,260); amp=10**((p['crackle_db']+rng.uniform(-8,4))/20)*rng.choice([-1,1])
        cr[pos:pos+L]+=amp*np.exp(-np.arange(L)/(L/4))*rng.uniform(0.4,1,L)
    cr=band(cr,500,7000,2)
    return hiss+cr
def run(x,p):
    rng=np.random.default_rng(p['seed'])
    if p['tempo']!=1.0: x=librosa.effects.time_stretch(x,rate=p['tempo'])
    x=x/np.max(np.abs(x))*0.5
    x=booth(x,p['booth_rt60'],p['booth_wet'],rng)
    x=band(x,p['hp']*0.8,min(p['lp']*1.15,SR/2-100),2)            # microphone + amp roll-off
    x=sg.sosfilt(peq(p["presence_f"],p["presence_db"],0.7),x); x=sg.sosfilt(peq(p['low_mid_f'],p['low_mid_db'],1.0),x)
    x=x/np.max(np.abs(x))*0.7; x=tube(x,p['drive'],p['tube_asym'])
    x=comp(x,p['comp_thr'],p['comp_ratio'],p['comp_att'],p['comp_rel'])
    x=band(x,p['hp'],p['lp'],4)                                     # optical soundtrack response
    x=x/np.sqrt((x[np.abs(x)>0.01*np.abs(x).max()]**2).mean())*10**(-20/20)  # speech at ~-20 dBFS rms before noise
    x=x+film_noise(len(x),p,rng); x=wowflutter(x,p,rng)
    x=sg.sosfilt(sg.butter(2,p['lp']*1.3,'lp',fs=SR,output='sos'),x)
    meter=pyln.Meter(SR); x=pyln.normalize.loudness(x,meter.integrated_loudness(x),p['lufs'])
    pk=10**(p['tp']/20); return np.where(np.abs(x)>pk*0.8,np.sign(x)*(pk*0.8+(pk*0.2)*np.tanh((np.abs(x)-pk*0.8)/(pk*0.2))),x)
if __name__=='__main__':
    x,_=librosa.load(sys.argv[1],sr=SR,mono=True)
    p=dict(P); p.update(json.load(open(sys.argv[3])) if len(sys.argv)>3 else {})
    y=run(np.pad(x,(int(p['pad_in']*SR),int(p['pad_out']*SR))),p); sf.write(sys.argv[2],y.astype(np.float32),SR,subtype='PCM_16')
    print(sys.argv[2],'LUFS',round(pyln.Meter(SR).integrated_loudness(y),2),'peak',round(20*np.log10(np.abs(y).max()),2))
