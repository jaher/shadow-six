"""Minimal GLB read/write (single BIN buffer, uncompressed bufferViews) for AO/URI rewrites."""
import json, struct, io

def read(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF'
    off = 12; j = None; bin_ = b''
    while off < len(b):
        ln, typ = struct.unpack('<II', b[off:off+8]); data = b[off+8:off+8+ln]
        if typ == 0x4E4F534A: j = json.loads(data)
        elif typ == 0x004E4942: bin_ = data
        off += 8 + ln
    return j, bin_

def write(path, j, bin_):
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    bin_ = bytes(bin_) + b'\0' * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(js) + (8 + len(bin_) if bin_ else 0)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        if bin_: f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)

def replace_views(j, bin_, repl):
    """repl: {bufferView index: new bytes}. Rebuilds BIN (only valid when no meshopt ext)."""
    out = io.BytesIO()
    for i, bv in enumerate(j['bufferViews']):
        assert bv.get('buffer', 0) == 0 and 'extensions' not in bv
        data = repl.get(i, bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])
        pad = (4 - out.tell() % 4) % 4; out.write(b'\0' * pad)
        bv['byteOffset'] = out.tell(); bv['byteLength'] = len(data); out.write(data)
    nb = out.getvalue(); j['buffers'][0]['byteLength'] = len(nb)
    return nb

def rewrite_uris(j, fn):
    for im in j.get('images', []):
        if 'uri' in im: im['uri'] = fn(im['uri'])
