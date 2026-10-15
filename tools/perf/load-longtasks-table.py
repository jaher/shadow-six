#!/usr/bin/env python3
"""Long-task table of tools/perf/load-longtasks.mjs reports: every main-thread task over the bound, grouped by what
blocked (rules on the sampled game-code chain + self functions), with count / total / max per group.

  python3 tools/perf/load-longtasks-table.py report.json [more.json ...] [--min=50] [--rows]
"""
import json, sys, re

RULES = [
    ('shader compile (first use of a program)', lambda c, s: re.search(r'onFirstUse|getProgramParameter|getShaderParameter|getProgramInfoLog', s)),
    ('gpu-compress encoder program link', lambda c, s: re.search(r'_program engine/gpu-compress|\bu engine/gpu-compress', s)),
    ('texture upload: gpu-compress temp (texSubImage2D/3D)', lambda c, s: '_issue' in c and re.search(r'texSubImage|texImage|generateMipmap|texStorage', s)),
    ('texture upload: three (texImage/compressedTexImage)', lambda c, s: re.search(r'texSubImage|texImage2D|texImage3D|compressedTex|generateMipmap|texStorage', s)),
    ('gpu-compress readback (getBufferSubData)', lambda c, s: re.search(r'collect engine/gpu-compress|getBufferSubData', s)),
    ('warm-up probe parts (compileAhead)', lambda c, s: 'compileAhead' in c and 'probe' in c),
    ('warm-up frame drawn in parts (framesInParts)', lambda c, s: 'framesInParts' in c),
    ('fx scan (chimneys / drums)', lambda c, s: re.search(r'prescan|_scanG|_maybeChimney|_seatOnStack', c)),
    ('ladder / stair-side fitting', lambda c, s: re.search(r'fitLadders|fitStairSides|measureFrame', c)),
    ('mission scenery (script visuals)', lambda c, s: re.search(r'buildCastleVisuals|buildM20Art|buildVisuals|buildShelfVisuals|buildPlateauVisuals|buildSummitVisuals', c)),
    ('terrain layer decode (loadLayerArray)', lambda c, s: 'loadLayerArray' in c or 'loadLayerArray' in s),
    ('map build (placement / structures / decks)', lambda c, s: re.search(r'buildMap|placeStructures|stampOverhead|libraryDecks|memoVisual|resolvePlacement', c)),
    ('terrain build (splat / noise / trails)', lambda c, s: re.search(r'createTerrain|buildSplat|preTrample|fbm|blur8', c + ' ' + s)),
    ('vegetation / impostors', lambda c, s: re.search(r'createVegetation|bakeImpostors|scatter', c)),
    ('water bake', lambda c, s: re.search(r'buildWater|bakeBody|captureHeights|distanceField', c + ' ' + s)),
    ('chunking', lambda c, s: 'chunkLargeMeshes' in c or 'chunkMesh' in s),
    ('spawn units / characters', lambda c, s: re.search(r'_spawnUnits|spawnSquadMember|createUnitModel|initCommandos|bodyClips|buildClip|prepareCharacters', c)),
    ('audio (context / decode / synth)', lambda c, s: re.search(r'audio/|decodeAudioData|defaultContext', c + ' ' + s)),
    ('renderer / boot setup', lambda c, s: re.search(r'> Game > |Renderer engine|resize engine|getExtension', c + ' ' + s)),
    ('GLB parse / glTF', lambda c, s: re.search(r'GLTFLoader|parse vendor|_invokeAll|loadMesh|loadNode|meshopt', c + ' ' + s)),
    ('frame render after load (draw)', lambda c, s: re.search(r'game\.frame|_frame', c)),
    ('garbage collection', lambda c, s: re.search(r'garbage collector', s)),
]

def label(row):
    c = ' | '.join(row.get('chain', [])[:2])
    s = ' | '.join(row.get('self', [])[:2])
    for name, f in RULES:
        if f(c, s):
            return name
    return 'other: ' + (row.get('chain') or [''])[0][:70]

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    mn = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--min=')), 50))
    for path in args:
        r = json.load(open(path))
        rows = [x for x in r['longTasks'] if x['ms'] > mn]
        groups = {}
        for x in rows:
            g = groups.setdefault(label(x), {'n': 0, 'sum': 0, 'max': 0, 'cpu': 0, 'stages': set()})
            g['n'] += 1; g['sum'] += x['ms']; g['max'] = max(g['max'], x['ms']); g['cpu'] = max(g['cpu'], x.get('cpu') or 0); g['stages'].add(x['stage'])
        mt = r['mainThread']; fr = r['frames']
        print(f"\n### {r['mission']} {r['mode']} ({r['preset']}, {r['size']}) load avg {r['loadavg'][0]}: {r['wallMs']/1000:.1f} s to {r['endName']}"
              f"{'' if not r.get('lastLoad') else f', loadMission {r['lastLoad']['ms']/1000:.1f} s'}")
        cpu = f", CPU time > 50 ms in {mt['cpuOver50']}, max {mt['cpuMax']} ms" if 'cpuMax' in mt else ''
        print(f"main thread: {mt['over50']} tasks > 50 ms ({mt['sumOver50']/1000:.1f} s), {mt['over100']} > 100 ms, max {mt['maxMs']} ms{cpu}; "
              f"frames > 50 ms: {fr['over50']} (frozen {fr['frozenMs']/1000:.1f} s), longest frame {fr['max']} ms\n")
        print('| what blocked | tasks > %d ms | total s | max ms | max CPU ms | stages |' % mn)
        print('|---|---:|---:|---:|---:|---|')
        for k, g in sorted(groups.items(), key=lambda kv: -kv[1]['sum']):
            print(f"| {k} | {g['n']} | {g['sum']/1000:.1f} | {g['max']} | {g['cpu'] or '-'} | {', '.join(sorted(g['stages']))} |")
        if '--rows' in sys.argv:
            print('\n| at s | ms | CPU ms | stage | what | chain | self |')
            print('|---:|---:|---:|---|---|---|---|')
            for x in rows:
                print(f"| {x['at']} | {x['ms']} | {x.get('cpu') if x.get('cpu') is not None else '-'} | {x['stage']} | {label(x)} | {(x['chain'] or [''])[0][:90]} | {', '.join(x['self'][:2])[:90]} |")

main()
