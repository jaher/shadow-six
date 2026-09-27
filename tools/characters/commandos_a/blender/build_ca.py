# build_ca.py - commandos_a wrapper around pipeline/blender/build_char.py: installs ca_skin + ca_kit extensions, then runs it.
# usage: pipeline/tools/bl.sh commandos_a/blender/build_ca.py specs/<id>.json <out_dir>
import sys, os, json, runpy
HERE = os.path.dirname(os.path.abspath(__file__))
PB = os.path.join(HERE, '..', '..', 'pipeline', 'blender')
PB = os.path.abspath(PB)
sys.path.insert(0, PB); sys.path.insert(1, HERE)
from common import args
spec = json.load(open(args()[0]))
import ca_skin, ca_kit, ca_outfit, ca_headgear
ca_skin.install(spec)
ca_kit.install()
ca_outfit.install()
ca_headgear.install()
runpy.run_path(os.path.join(PB, 'build_char.py'), run_name='__main__')
