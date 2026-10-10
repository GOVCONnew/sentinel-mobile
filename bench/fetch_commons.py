# Fetch candidate eval images from Wikimedia Commons with license metadata. Output: eval/raw/*.jpg + eval/raw/meta.json
import json, urllib.request, urllib.parse, os, re, sys, time
UA = {'User-Agent': 'NewtonSentinelBench/2.0 (research eval; contact GOVCONnew@users.noreply.github.com)'}
def api(params):
    params.update(format='json'); u = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(params)
    return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30))
Q = sys.argv[1:] or []
meta = json.load(open('eval/raw/meta.json')) if os.path.exists('eval/raw/meta.json') else {}
for q in Q:
    tag, query, n = q.split('|'); n = int(n)
    r = api(dict(action='query', generator='search', gsrsearch=query + ' filetype:bitmap', gsrnamespace=6, gsrlimit=n, prop='imageinfo', iiprop='url|extmetadata|size', iiurlwidth=1024))
    for p in (r.get('query', {}).get('pages', {}) or {}).values():
        ii = p['imageinfo'][0]; em = ii.get('extmetadata', {}); lic = em.get('LicenseShortName', {}).get('value', '?')
        if not re.search(r'CC0|Public domain|PD|CC BY', lic, re.I): continue
        name = re.sub(r'[^A-Za-z0-9]+', '_', p['title'][5:])[:60] + '.jpg'
        if name in meta: continue
        try:
            d = urllib.request.urlopen(urllib.request.Request(ii.get('thumburl', ii['url']), headers=UA), timeout=60).read()
        except Exception as e: print('fail', name, e); continue
        open('eval/raw/' + name, 'wb').write(d)
        meta[name] = dict(tag=tag, title=p['title'], page=ii.get('descriptionurl'), license=lic, artist=re.sub('<[^>]+>', '', em.get('Artist', {}).get('value', '?'))[:120])
        time.sleep(0.3)
json.dump(meta, open('eval/raw/meta.json', 'w'), indent=1); print(len(meta))
