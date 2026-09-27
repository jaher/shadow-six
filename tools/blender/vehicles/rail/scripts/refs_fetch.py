# python3 refs_fetch.py <prefix> "File:..." ... -> refs/rail/<prefix>_<n>.jpg (<=800 px) + refs.json (URLs, internal only)
import json, sys, time, os, io, urllib.request, urllib.parse
from PIL import Image
UA = {'User-Agent': 'ShadowSixRefBot/0.1 (internal reference research)'}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'refs', 'rail')
os.makedirs(OUT, exist_ok=True)
J = os.path.join(OUT, 'refs.json')
db = json.load(open(J)) if os.path.exists(J) else {}
def get(url, js=True):
    for i in range(5):
        try:
            d = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()
            return json.loads(d) if js else d
        except Exception as e:
            print('retry', e, file=sys.stderr); time.sleep(4 + 4 * i)
pre = sys.argv[1]
for n, t in enumerate(sys.argv[2:]):
    q = urllib.parse.urlencode({'action': 'query', 'titles': t, 'prop': 'imageinfo', 'iiprop': 'url', 'iiurlwidth': 900, 'format': 'json'})
    r = get('https://commons.wikimedia.org/w/api.php?' + q)
    pg = list(r['query']['pages'].values())[0]
    ii = pg['imageinfo'][0]
    time.sleep(1.5)
    data = get(ii['thumburl'], js=False)
    im = Image.open(io.BytesIO(data)).convert('RGB'); im.thumbnail((800, 800))
    fn = '%s_%d.jpg' % (pre, n + 1)
    im.save(os.path.join(OUT, fn), quality=80)
    db[fn] = {'title': t, 'page': ii['descriptionurl'], 'url': ii['url']}
    print(fn, im.size, ii['descriptionurl'])
    time.sleep(2)
json.dump(db, open(J, 'w'), indent=1)
