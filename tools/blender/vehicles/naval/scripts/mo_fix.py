"""mo_fix.py src.glb packed.glb : restore the external texture uris (by image name) that mo_keepuri.mjs had to embed
as placeholders, dropping the placeholder bufferViews' references."""
import sys, os
sys.path.insert(0, '<claude-tmp>')
import glb_post
src, dst = sys.argv[1:3]
js0, _ = glb_post.read_glb(src)
uris = {im.get('name'): im['uri'] for im in js0.get('images', []) if 'uri' in im}
js, bin_ = glb_post.read_glb(dst)
n = 0
for im in js.get('images', []):
    if im.get('name') in uris:
        im.pop('bufferView', None)
        im.pop('mimeType', None)
        im['uri'] = uris[im['name']]
        n += 1
glb_post.write_glb(dst, js, bin_)
print('mo_fix restored', n, 'uris;', os.path.getsize(src) // 1024, 'KB ->', os.path.getsize(dst) // 1024, 'KB')
