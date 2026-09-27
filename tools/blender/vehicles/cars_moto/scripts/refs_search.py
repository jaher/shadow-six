import json, sys, time, urllib.request, urllib.parse
UA = {'User-Agent': 'ShadowSixRefBot/0.1 (internal reference research; jaherrero project)'}
def api(params):
    url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(dict(params, format='json'))
    for i in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20))
        except Exception as e:
            print('retry', e, file=sys.stderr); time.sleep(3 + i * 3)
for q in sys.argv[1:]:
    r = api({'action': 'query', 'list': 'search', 'srsearch': q, 'srnamespace': 6, 'srlimit': 12})
    print('==', q)
    for x in (r or {}).get('query', {}).get('search', []):
        print('  ', x['title'])
    time.sleep(1.5)
