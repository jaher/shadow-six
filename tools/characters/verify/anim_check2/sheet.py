import sys,glob,os
from PIL import Image,ImageDraw
out=sys.argv[1]; files=sorted(glob.glob(sys.argv[2])); cols=int(sys.argv[3]) if len(sys.argv)>3 else 4; tw=int(sys.argv[4]) if len(sys.argv)>4 else 240
ims=[Image.open(f).convert('RGB') for f in files]; th=int(tw*ims[0].height/ims[0].width)
rows=(len(ims)+cols-1)//cols; S=Image.new('RGB',(cols*tw,rows*(th+14)),(30,30,30)); d=ImageDraw.Draw(S)
for i,(f,im) in enumerate(zip(files,ims)):
  x,y=(i%cols)*tw,(i//cols)*(th+14); S.paste(im.resize((tw,th)),(x,y+14)); d.text((x+3,y+1),os.path.basename(f)[2:-4][:40],fill=(255,255,120))
S.save(out,quality=85); print(out,S.size,os.path.getsize(out))
