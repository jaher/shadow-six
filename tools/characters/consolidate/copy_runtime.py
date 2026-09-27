# copy the verified browser runtimes into src/art/characters/<group>/, rewriting '/chars/...' imports and asset URLs
import os, re
S = '<claude-tmp>'
R = '<repo>/src/art/characters'
A = '<repo>/assets/characters'   # asset root the runtime URLs point at
DIRS = {f'{S}/pipeline/web': 'pipeline', f'{S}/commandos_a/web': 'commandos_a', f'{S}/commandos_b/pipeline/web': 'commandos_b',
        f'{S}/enemies/web': 'enemies', f'{S}/guests/pipeline/web': 'guests'}
ENTRIES = ['commandos_a/web/ca_runtime.js', 'commandos_b/pipeline/web/charkit.js', 'commandos_b/pipeline/web/weapons.js',
           'commandos_b/pipeline/web/squadkit.js', 'enemies/web/enemykit.js', 'guests/pipeline/web/guestkit.js', 'guests/pipeline/web/dogkit.js',
           'pipeline/web/variety.js']
URLS = {'/chars/out/anims.glb': 'anims/base_anims.glb', '/chars/out/weapons.glb': 'weapons/weapons.glb',
        '/chars/commandos_a/out/ca_anims.glb': 'anims/ca_anims.glb', '/chars/enemies/out/enemy_anims.glb': 'anims/enemy_anims.glb',
        '/chars/guests/out/guest_anims.glb': 'anims/guest_anims.glb', '/chars/commandos_b/out/anims.glb': 'anims/commando_anims.glb',
        '/chars/enemies/out/': 'enemies/'}
PATCHES = {'enemies/enemykit.js': [
    ("{ anims = '/chars/out/anims.glb', weapons = '/chars/out/weapons.glb' } = {}", "{ anims = '/chars/out/anims.glb', weapons = '/chars/out/weapons.glb', enemyAnims = null } = {}"),
    ("loadAnimLibrary(base + 'enemy_anims.glb')", "loadAnimLibrary(enemyAnims || base + 'enemy_anims.glb')")]}
def dst_of(src):
    d, b = os.path.split(src); return os.path.join(R, DIRS[d], b)
def resolve(spec, src):
    if spec.startswith('/chars/'): return os.path.normpath(S + spec[6:])
    if spec.startswith('.'): return os.path.normpath(os.path.join(os.path.dirname(src), spec))
    return None
todo = [f'{S}/{e}' for e in ENTRIES]; done = set(); files = []
while todo:
    src = todo.pop()
    if src in done: continue
    done.add(src); txt = open(src).read(); out = dst_of(src)
    key = os.path.relpath(out, R)
    for a, b in PATCHES.get(key, []):
        assert a in txt, (key, a); txt = txt.replace(a, b)
    def rep_imp(m):
        spec = m.group(2); dep = resolve(spec, src)
        if not dep: return m.group(0)
        todo.append(dep); rel = os.path.relpath(dst_of(dep), os.path.dirname(out))
        if not rel.startswith('.'): rel = './' + rel
        return m.group(1) + rel + m.group(3)
    txt = re.sub(r"""(\bfrom\s+['"])([^'"]+)(['"])""", rep_imp, txt)
    def rep_url(m):
        u = m.group(2)
        if u not in URLS: return m.group(0)
        rel = os.path.relpath(os.path.join(A, URLS[u]), os.path.dirname(out)) + ('/' if URLS[u].endswith('/') else '')
        return f"new URL('{rel}', import.meta.url).href"
    lines = []
    for ln in txt.split('\n'):
        code = ln.split('//')[0] if not ln.lstrip().startswith('//') else ''
        if code and '/chars/' in code:
            ln = re.sub(r"""(['"])(/chars/[^'"]+)\1""", rep_url, ln)
        lines.append(ln)
    txt = '\n'.join(lines)
    left = [l for l in txt.split('\n') if '/chars/' in l.split('//')[0] and not l.lstrip().startswith('//')]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    hdr = f"// Copied from scratchpad chars/{os.path.relpath(src, S)} by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten). CC0 project code.\n"
    open(out, 'w').write(hdr + txt); files.append((key, len(txt), left))
for k, n, left in sorted(files): print(k, n, ('LEFT: ' + ' | '.join(l.strip()[:120] for l in left)) if left else '')
