#!/usr/bin/env python3
"""The still camera of a theatre (tools/ui/ground/bake_ground.mjs: camera.json, depth.png at 2x the 1920x1080 still):
project world points onto the still and back. Still pixels are the shipped 1920x1080 frame (the bake renders 2x)."""
import json
import numpy as np
from PIL import Image


class Still:
    def __init__(self, d):
        c = json.load(open(d + '/camera.json'))
        self.W, self.H = c['W'], c['H']                       # the render (2x the still)
        self.P = np.array(c['projection']).reshape(4, 4).T     # three.js elements are column-major
        self.Mw = np.array(c['matrixWorld']).reshape(4, 4).T
        self.V = np.linalg.inv(self.Mw)
        self.Pinv = np.linalg.inv(self.P)
        self.pos = np.array(c['position'])
        self.k = 1920.0 / self.W                               # render px -> still px
        dp = d + '/depth.png'
        try:
            a = np.asarray(Image.open(dp).convert('RGB')).astype(np.float32)
            self.depth = (a[..., 0] * 256 + a[..., 1]) / 32.0    # metres along the view axis, render px
            self.sky = a[..., 2] > 128
            self.depth[self.sky] = 1e5
        except FileNotFoundError:
            self.depth = None

    def project(self, X):
        """world [..., 3] -> still px (u, v) and the view depth (m)."""
        X = np.asarray(X, float)
        h = np.concatenate([X, np.ones(X.shape[:-1] + (1,))], -1) @ self.V.T
        z = -h[..., 2]
        c = h @ self.P.T
        ndc = c[..., :3] / c[..., 3:4]
        u = (ndc[..., 0] + 1) / 2 * self.W * self.k
        v = (1 - ndc[..., 1]) / 2 * self.H * self.k
        return u, v, z

    def ray(self, u, v):
        """still px -> the camera ray (origin, unit direction) in world space."""
        x = (u / self.k) / self.W * 2 - 1
        y = 1 - (v / self.k) / self.H * 2
        p = self.Pinv @ np.array([x, y, 1.0, 1.0])
        d = p[:3] / p[3]
        d = d / np.linalg.norm(d)
        dw = self.Mw[:3, :3] @ d
        return self.pos, dw, -d[2]                              # -d[2]: view z per unit along the ray

    def unproject(self, u, v):
        """still px -> the visible surface point (world) from the depth map, and its view depth."""
        z = self.depth_at(u, v)
        o, dw, cz = self.ray(u, v)
        return o + dw * (z / cz), z

    def depth_at(self, u, v):
        x = int(np.clip(round(u / self.k), 0, self.W - 1)); y = int(np.clip(round(v / self.k), 0, self.H - 1))
        return float(self.depth[y, x])

    def pxm(self, X):
        """still px per metre at world point X (a 1 m step across the view at that depth)."""
        u0, v0, z = self.project(X)
        return 1080.0 / (2 * z * np.tan(np.radians(15)))   # the 30 deg vertical fov over the 1080 px still


def ground(st, u, v, y=0.0):
    """still px -> where its camera ray meets the plane at height y (for spots off the frame or behind things)."""
    o, d, _ = st.ray(u, v)
    t = (y - o[1]) / d[1]
    return o + d * t
