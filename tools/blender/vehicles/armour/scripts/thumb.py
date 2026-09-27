import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); im.thumbnail((int(sys.argv[3]) if len(sys.argv) > 3 else 900,) * 2)
im.save(sys.argv[2], quality=82)
