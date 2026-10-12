"""Render helpers: GPU (OptiX, then CUDA) when it has room, else CPU; OIDN denoise (needs an official Blender build:
the Ubuntu 4.0.2 package has no OpenImageDenoise and cannot drive RTX 50 GPUs)."""
import bpy, os, time


def setup(samples=128, denoise=True, device=None):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = denoise
    if denoise:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
        sc.cycles.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
        try: sc.cycles.denoising_prefilter = 'ACCURATE'
        except Exception: pass
    _device(device or os.environ.get('HERO_DEVICE', 'OPTIX'))


def _device(kind):
    sc = bpy.context.scene
    p = bpy.context.preferences.addons['cycles'].preferences
    if kind == 'CPU':
        to_cpu(); return
    try:
        p.compute_device_type = kind; p.get_devices()
        ok = False
        for d in p.devices:
            d.use = d.type == kind; ok |= d.use
        sc.cycles.device = 'GPU' if ok else 'CPU'
    except Exception as e:
        print('RUTIL no', kind, e); sc.cycles.device = 'CPU'


def to_cpu():
    sc = bpy.context.scene
    sc.cycles.device = 'CPU'
    try: sc.cycles.denoising_use_gpu = False
    except Exception: pass
    p = bpy.context.preferences.addons['cycles'].preferences
    try:
        p.compute_device_type = 'NONE'
    except Exception: pass


def render(path, write=True):
    sc = bpy.context.scene
    sc.render.filepath = path
    t = time.time()
    try:
        bpy.ops.render.render(write_still=write)
    except RuntimeError as e:
        if sc.cycles.device == 'GPU':
            print('RUTIL GPU failed (%s) -> CPU' % str(e).splitlines()[0])
            to_cpu()
            bpy.ops.render.render(write_still=write)
        else:
            raise
    print('RUTIL rendered', path, sc.cycles.device, round(time.time() - t, 1), 's')
