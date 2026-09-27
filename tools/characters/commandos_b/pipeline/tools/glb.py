# Minimal GLB reader/writer (numpy) for the character pipeline.
import json, struct
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


class GLB:
    def __init__(self, path=None):
        self.j = {'asset': {'version': '2.0', 'generator': 'shadow-six pipeline'}, 'buffers': [], 'bufferViews': [], 'accessors': []}
        self.bin = bytearray()
        if path:
            d = open(path, 'rb').read()
            n = struct.unpack('<I', d[12:16])[0]
            self.j = json.loads(d[20:20 + n])
            o = 20 + n
            if o < len(d):
                bl = struct.unpack('<I', d[o:o + 4])[0]
                self.bin = bytearray(d[o + 8:o + 8 + bl])

    # ---- read
    def view_bytes(self, vi):
        v = self.j['bufferViews'][vi]
        o = v.get('byteOffset', 0)
        return bytes(self.bin[o:o + v['byteLength']])

    def acc(self, ai):
        a = self.j['accessors'][ai]
        dt = CT[a['componentType']]
        nc = NC[a['type']]
        v = self.j['bufferViews'][a['bufferView']]
        o = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = v.get('byteStride', 0)
        isz = np.dtype(dt).itemsize * nc
        if stride and stride != isz:
            raw = np.frombuffer(bytes(self.bin[o:o + stride * a['count']]), dtype=np.uint8).reshape(a['count'], stride)[:, :isz]
            arr = np.frombuffer(raw.tobytes(), dtype=dt)
        else:
            arr = np.frombuffer(bytes(self.bin[o:o + isz * a['count']]), dtype=dt)
        arr = arr.reshape(a['count'], nc) if nc > 1 else arr.copy()
        if a.get('normalized') and dt != np.float32:
            arr = arr.astype(np.float32) / np.iinfo(dt).max
        return arr.copy()

    # ---- write
    def add_view(self, data: bytes, target=None):
        while len(self.bin) % 4:
            self.bin += b'\0'
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.bin += data
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def add_acc(self, arr, target=None, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        ct = {np.dtype(np.float32): 5126, np.dtype(np.uint16): 5123, np.dtype(np.uint32): 5125, np.dtype(np.uint8): 5121, np.dtype(np.int16): 5122, np.dtype(np.int8): 5120}[arr.dtype]
        nc = 1 if arr.ndim == 1 else arr.shape[1]
        t = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4'}[nc]
        vi = self.add_view(arr.tobytes(), target)
        a = {'bufferView': vi, 'componentType': ct, 'count': int(arr.shape[0]), 'type': t}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = np.atleast_1d(arr.min(0)).astype(float).tolist()
            a['max'] = np.atleast_1d(arr.max(0)).astype(float).tolist()
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def save(self, path):
        while len(self.bin) % 4:
            self.bin += b'\0'
        self.j['buffers'] = [{'byteLength': len(self.bin)}]
        js = json.dumps(self.j, separators=(',', ':')).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<4sII', b'glTF', 2, total))
            f.write(struct.pack('<I4s', len(js), b'JSON'))
            f.write(js)
            f.write(struct.pack('<I4s', len(self.bin), b'BIN\0'))
            f.write(self.bin)
        return total


# ---- transforms
def quat_to_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def mat_to_quat(m):
    t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    q = np.array(q)
    return q / np.linalg.norm(q)


def trs(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=float).reshape(4, 4).T
    M = np.eye(4)
    s = np.array(n.get('scale', [1, 1, 1]), dtype=float)
    M[:3, :3] = quat_to_mat(n.get('rotation', [0, 0, 0, 1])) * s[None, :]
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M


def decompose(M):
    t = M[:3, 3].copy()
    R = M[:3, :3].copy()
    s = np.linalg.norm(R, axis=0)
    R = R / s[None, :]
    if np.linalg.det(R) < 0:
        s[0] *= -1; R[:, 0] *= -1
    return t, mat_to_quat(R), s


def rot_between(a, b):
    """3x3 rotation taking unit vector a to unit vector b (shortest arc)."""
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = float(np.dot(a, b))
    if c < -0.999999:
        ax = np.cross(a, [1, 0, 0])
        if np.linalg.norm(ax) < 1e-6:
            ax = np.cross(a, [0, 1, 0])
        ax /= np.linalg.norm(ax)
        return 2 * np.outer(ax, ax) - np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * (1 / (1 + c))
