#!/usr/bin/env python3
"""rebind.py raw.glb out.glb [--ual UAL1_Standard.glb] [--extras extras.json]
Offline port of rig.js rebindToUAL(): skins a Blender/MPFB (game_engine rig) character onto the Quaternius UAL
skeleton FRAMES (swing-only fit joint-to-joint, joints moved to the MH joint positions), recomputes the inverse bind
matrices and remaps JOINTS_0 by bone name. Every UAL clip (quaternion tracks = absolute local rotations in UAL frames)
then plays natively on the output. The output GLB contains only the UAL joint hierarchy + the character meshes."""
import sys, os, json, argparse
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb import GLB, trs, decompose, rot_between

HERE = os.path.dirname(os.path.abspath(__file__))
SCR = '<claude-tmp>'
UAL1 = os.path.join(SCR, 'realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb')
NAME_MAP = {'Root': 'root', 'head': 'Head'}
SEG = {}
for s in 'lr':
    SEG.update({f'clavicle_{s}': f'upperarm_{s}', f'upperarm_{s}': f'lowerarm_{s}', f'lowerarm_{s}': f'hand_{s}',
                f'hand_{s}': f'middle_01_{s}', f'thigh_{s}': f'calf_{s}', f'calf_{s}': f'foot_{s}', f'foot_{s}': f'ball_{s}'})
    for f in ('index', 'middle', 'ring', 'pinky', 'thumb'):
        SEG[f'{f}_01_{s}'] = f'{f}_02_{s}'
        SEG[f'{f}_02_{s}'] = f'{f}_03_{s}'


def node_worlds(j):
    parent = {}
    for i, n in enumerate(j['nodes']):
        for c in n.get('children', []):
            parent[c] = i
    W = {}
    def w(i):
        if i not in W:
            W[i] = (w(parent[i]) @ trs(j['nodes'][i])) if i in parent else trs(j['nodes'][i])
        return W[i]
    for i in range(len(j['nodes'])):
        w(i)
    return W, parent


def quantized(out, k, arr, jmap):
    """KHR_mesh_quantization: normals int8 (stride 4), uv uint16, weights uint8, joints uint8 (all normalized except joints)"""
    oj = out.j
    if k == 'NORMAL':
        n = arr / np.maximum(np.linalg.norm(arr, axis=1, keepdims=True), 1e-9)
        q = np.zeros((len(n), 4), np.int8); q[:, :3] = np.round(n * 127).astype(np.int8)
        vi = out.add_view(q.tobytes(), 34962); oj['bufferViews'][vi]['byteStride'] = 4
        oj['accessors'].append({'bufferView': vi, 'componentType': 5120, 'count': len(n), 'type': 'VEC3', 'normalized': True})
        return len(oj['accessors']) - 1
    if k == 'TEXCOORD_0':
        uv = np.clip(arr, 0, 1)
        if np.abs(arr - uv).max() > 1e-3:
            print('  WARNING: uv outside [0,1] clamped', float(np.abs(arr - uv).max()))
        return out.add_acc(np.round(uv * 65535).astype(np.uint16), 34962, normalized=True)
    if k == 'WEIGHTS_0':
        w = arr / np.maximum(arr.sum(1, keepdims=True), 1e-9)
        q = np.floor(w * 255).astype(np.int32)
        rem = 255 - q.sum(1)
        idx = np.argmax(w * 255 - q, axis=1)
        q[np.arange(len(q)), idx] += rem
        return out.add_acc(q.astype(np.uint8), 34962, normalized=True)
    if k == '_MASK':
        q = np.zeros((len(arr), 4), np.uint8); q[:, :arr.shape[1]] = np.round(np.clip(arr, 0, 1) * 255).astype(np.uint8)
        return out.add_acc(q, 34962, normalized=True)
    if k == 'JOINTS_0':
        return out.add_acc(jmap[arr.astype(np.int64)].astype(np.uint8), 34962)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('raw'); ap.add_argument('out')
    ap.add_argument('--ual', default=UAL1)
    ap.add_argument('--extras', default=None)
    ap.add_argument('--no-quantize', dest='quantize', action='store_false')
    a = ap.parse_args()
    raw = GLB(a.raw); ual = GLB(a.ual)
    rj, uj = raw.j, ual.j
    # ---- MH bind joints
    rs = rj['skins'][0]
    ibm = raw.acc(rs['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    Wr, _ = node_worlds(rj)
    J = {}
    rnames = []
    for k, ni in enumerate(rs['joints']):
        nm = rj['nodes'][ni]['name']; u = NAME_MAP.get(nm, nm); rnames.append(u)
        J[u] = np.linalg.inv(ibm[k])[:3, 3]
    # ---- UAL skeleton
    us = uj['skins'][0]
    ujoints = us['joints']
    uname = {ni: uj['nodes'][ni]['name'] for ni in ujoints}
    Wu, uparent = node_worlds(uj)
    root_ni = [ni for ni in ujoints if uname[ni] == 'root'][0]
    L = {i: trs(uj['nodes'][i]) for i in range(len(uj['nodes']))}
    W = dict(Wu)
    order = []
    def dfs(i):
        order.append(i)
        for c in uj['nodes'][i].get('children', []):
            if c in uname:
                dfs(c)
    dfs(root_ni)
    by_name = {uname[i]: i for i in ujoints}
    pelvis_y0 = W[by_name['pelvis']][1, 3]
    for i in order:
        nm = uname[i]; p = uparent[i]
        if nm != 'root' and nm in J:
            L[i][:3, 3] = (np.linalg.inv(W[p]) @ np.append(J[nm], 1))[:3]
        W[i] = W[p] @ L[i]
        c = SEG.get(nm)
        if c and nm in J and c in J and c in by_name:
            ci = by_name[c]
            cur = (W[i] @ np.append(L[ci][:3, 3], 1))[:3] - W[i][:3, 3]
            R = rot_between(cur, J[c] - J[nm])
            Wn = W[i].copy(); Wn[:3, :3] = R @ W[i][:3, :3]
            L[i] = np.linalg.inv(W[p]) @ Wn
            W[i] = Wn
    # errors
    err = max(np.linalg.norm(W[by_name[n]][:3, 3] - J[n]) for n in J if n in by_name and n != 'root')
    missing = [n for n in J if n not in by_name]
    print(f'rebind: {len(J)} MH joints, max joint err {err:.2e} m, unmapped {missing}')
    # ---- build output
    out = GLB()
    oj = out.j
    oj['nodes'] = []
    # copy UAL ancestor chain of root + all joints (hierarchy preserved)
    keep = set(ujoints)
    x = root_ni
    while x in uparent:
        x = uparent[x]; keep.add(x)
    remap = {}
    for i in sorted(keep):
        remap[i] = len(oj['nodes'])
        n = uj['nodes'][i]
        t, q, s = decompose(L[i])
        nn = {'name': n.get('name', f'n{i}'), 'translation': t.tolist(), 'rotation': q.tolist()}
        if np.abs(s - 1).max() > 1e-5:
            nn['scale'] = s.tolist()
        oj['nodes'].append(nn)
    for i in sorted(keep):
        ch = [remap[c] for c in uj['nodes'][i].get('children', []) if c in keep]
        if ch:
            oj['nodes'][remap[i]]['children'] = ch
    top = [remap[i] for i in keep if i not in uparent or uparent[i] not in keep]
    # materials / textures / images
    for key in ('samplers', 'textures', 'materials'):
        if key in rj:
            oj[key] = json.loads(json.dumps(rj[key]))
    if 'images' in rj:
        oj['images'] = []
        for im in rj['images']:
            vi = out.add_view(raw.view_bytes(im['bufferView']))
            oj['images'].append({'name': im.get('name', 'img'), 'mimeType': im['mimeType'], 'bufferView': vi})
    # skin
    uidx = {uname[ni]: k for k, ni in enumerate(ujoints)}
    ibm_new = np.stack([np.linalg.inv(W[ni]).T for ni in ujoints]).astype(np.float32).reshape(-1, 16)
    ibm_acc = out.add_acc(ibm_new)
    oj['skins'] = [{'name': 'UAL', 'joints': [remap[ni] for ni in ujoints], 'inverseBindMatrices': ibm_acc, 'skeleton': remap[root_ni]}]
    jmap = np.array([uidx.get(n, uidx['pelvis']) for n in rnames], dtype=np.uint16)
    # meshes (skinned mesh nodes of raw)
    oj['meshes'] = []
    mesh_nodes = []
    for ni, n in enumerate(rj['nodes']):
        if 'mesh' not in n:
            continue
        Mw = Wr[ni]
        skinned = 'skin' in n
        m = rj['meshes'][n['mesh']]
        prims = []
        for pr in m['primitives']:
            at = {}
            for k, ai in pr['attributes'].items():
                arr = raw.acc(ai)
                if k.upper() == '_MASK':
                    k = '_MASK'
                if a.quantize and k in ('NORMAL', 'TEXCOORD_0', 'WEIGHTS_0', 'JOINTS_0', '_MASK'):
                    at[k] = quantized(out, k, arr, jmap)
                    continue
                if k == 'JOINTS_0':
                    arr = jmap[arr.astype(np.int64)].astype(np.uint16)
                elif k == 'POSITION' and not skinned:
                    arr = (arr @ Mw[:3, :3].T + Mw[:3, 3]).astype(np.float32)
                elif k == 'NORMAL' and not skinned:
                    arr = arr @ Mw[:3, :3].T; arr = (arr / np.linalg.norm(arr, axis=1, keepdims=True)).astype(np.float32)
                elif k.startswith('WEIGHTS'):
                    arr = arr.astype(np.float32)
                at[k] = out.add_acc(arr, 34962, minmax=(k == 'POSITION'))
            p2 = {'attributes': at}
            if 'indices' in pr:
                idx = raw.acc(pr['indices'])
                idx = idx.astype(np.uint16 if idx.max() < 65535 else np.uint32)
                p2['indices'] = out.add_acc(idx, 34963)
            if 'material' in pr:
                p2['material'] = pr['material']
            prims.append(p2)
        oj['meshes'].append({'name': m.get('name', n.get('name')), 'primitives': prims})
        nd = {'name': n.get('name', 'mesh'), 'mesh': len(oj['meshes']) - 1}
        if skinned:
            nd['skin'] = 0
        else:
            print('  WARNING: unskinned mesh node', n.get('name'), '(baked to world; not attached)')
        if 'extras' in n:
            nd['extras'] = n['extras']
        oj['nodes'].append(nd)
        mesh_nodes.append(len(oj['nodes']) - 1)
    if a.quantize:
        oj['extensionsUsed'] = ['KHR_mesh_quantization']; oj['extensionsRequired'] = ['KHR_mesh_quantization']
    oj['scenes'] = [{'name': 'Scene', 'nodes': top + mesh_nodes}]
    oj['scene'] = 0
    pel = by_name['pelvis']
    info = {'pelvisRest': L[pel][:3, 3].tolist(), 'ualPelvisRest': trs(uj['nodes'][pel])[:3, 3].tolist(),
            'pelvisRatio': float(W[pel][1, 3] / pelvis_y0), 'headY': float(J['Head'][1]),
            'skeleton': 'UAL', 'rebind_err_m': float(err)}
    if a.extras and os.path.exists(a.extras):
        info.update(json.load(open(a.extras)))
    oj['scenes'][0]['extras'] = {'shadowSix': info}
    n = out.save(a.out)
    print(f'wrote {a.out} {n/1e6:.2f} MB; pelvis ratio {info["pelvisRatio"]:.3f}')


if __name__ == '__main__':
    main()
