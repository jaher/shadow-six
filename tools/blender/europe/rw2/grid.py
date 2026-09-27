import sys,os
from PIL import Image,ImageDraw
O='<claude-tmp>'
# grid.py out.jpg cols W name:view[:crop] ...
out=sys.argv[1]; cols=int(sys.argv[2]); W=int(sys.argv[3]); items=sys.argv[4:]
cw=W//cols; ch=int(cw*0.667); rows=(len(items)+cols-1)//cols
sh=Image.new('RGB',(W,rows*ch))
for i,it in enumerate(items):
    p=it.split(':'); n,v=p[0],p[1]; fr=float(p[2]) if len(p)>2 else 1.0
    f=f'{O}/{n}/review/{n}_{v}.png'
    im=Image.open(f).convert('RGB') if os.path.exists(f) else Image.new('RGB',(960,640),(255,0,255))
    w,h=im.size; a,b=int(w*fr),int(h*fr); im=im.crop(((w-a)//2,(h-b)//2,(w-a)//2+a,(h-b)//2+b)).resize((cw,ch),Image.LANCZOS)
    sh.paste(im,((i%cols)*cw,(i//cols)*ch)); d=ImageDraw.Draw(sh); d.rectangle(((i%cols)*cw,(i//cols)*ch,(i%cols)*cw+len(n+v)*7+12,(i//cols)*ch+12),fill=(0,0,0)); d.text(((i%cols)*cw+2,(i//cols)*ch),n+' '+v,fill=(255,255,0))
sh.save(out,quality=82); print(sh.size,os.path.getsize(out))
