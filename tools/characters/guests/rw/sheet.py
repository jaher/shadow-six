import sys,glob,re
from PIL import Image, ImageDraw
pre, out, labels = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
fs = sorted(glob.glob(pre+'_r*_f*.png'))
rows = {}
for f in fs:
    m = re.search(r'_r(\d+)_f(\d+)\.png$', f); rows.setdefault(int(m.group(1)), {})[int(m.group(2))] = f
tw, th = Image.open(fs[0]).size; s = 0.5; tw2, th2 = int(tw*s), int(th*s)
nr = len(rows); nf = max(len(v) for v in rows.values())
sheet = Image.new('RGB', (nf*tw2, nr*(th2+16)), (40,40,40)); d = ImageDraw.Draw(sheet)
for i,(r,fr) in enumerate(sorted(rows.items())):
    d.text((4, i*(th2+16)+2), labels[i] if i < len(labels) else str(r), fill=(230,230,230))
    for j,(k,f) in enumerate(sorted(fr.items())):
        sheet.paste(Image.open(f).convert('RGB').resize((tw2,th2), Image.LANCZOS), (j*tw2, i*(th2+16)+16))
sheet.save(out, quality=88); print(out, sheet.size)
