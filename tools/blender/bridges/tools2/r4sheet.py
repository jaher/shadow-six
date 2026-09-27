import sys
from PIL import Image, ImageDraw
O = '<claude-tmp>'
out, names = sys.argv[1], sys.argv[2:]
tw, th = 400, 240
c = Image.new('RGB', (tw * 3, th * len(names)), (20, 20, 20))
d = ImageDraw.Draw(c)
for i, n in enumerate(names):
    g = Image.open(O + n + '/review/' + n + '_game1.png').convert('RGB')
    cl = Image.open(O + n + '/review/' + n + '_close.png').convert('RGB')
    l2 = Image.open(O + n + '/review/' + n + '_lod2@05x.png').convert('RGB')
    c.paste(g.crop((160, 120, 800, 504)).resize((tw, th)), (0, i * th))
    c.paste(cl.resize((tw, int(tw * cl.size[1] / cl.size[0]))).crop((0, 20, tw, 20 + th)), (tw, i * th))
    c.paste(l2.resize((tw, int(tw * l2.size[1] / l2.size[0]))).crop((0, 20, tw, 20 + th)), (2 * tw, i * th))
    d.text((4, i * th + 3), n, fill=(255, 230, 60))
c.save(out, quality=84)
