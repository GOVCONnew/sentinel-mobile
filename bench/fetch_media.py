import json, urllib.request, urllib.parse, re, sys, time
UA = {'User-Agent': 'NewtonSentinelBench/2.0 (research eval; GOVCONnew@users.noreply.github.com)'}
def api(p):
    p.update(format='json'); return json.load(urllib.request.urlopen(urllib.request.Request('https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(p), headers=UA), timeout=30))
for q in sys.argv[1:]:
    kind, query = q.split('|')
    r = api(dict(action='query', generator='search', gsrsearch=query + ' filetype:' + kind, gsrnamespace=6, gsrlimit=8, prop='imageinfo', iiprop='url|extmetadata|size|mediatype'))
    for p in (r.get('query', {}).get('pages', {}) or {}).values():
        ii = p['imageinfo'][0]; em = ii.get('extmetadata', {})
        print(query, '|', p['title'], '|', em.get('LicenseShortName', {}).get('value'), '|', ii.get('size'), '|', ii.get('duration', ''), '|', ii['url'])
