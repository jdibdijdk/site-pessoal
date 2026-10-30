#!/usr/bin/env python3
"""Divide os .wasm acima de 24 MiB em partes (a Cloudflare aceita até 25 MiB por arquivo) e acrescenta ao
index.html um pequeno script que junta as partes no navegador quando o app pede o .wasm."""
import glob, json, os, re, sys

LIMIT = 24 * 1024 * 1024
d = sys.argv[1]
parts = {}
for f in glob.glob(os.path.join(d, '*.wasm')):
    data = open(f, 'rb').read()
    if len(data) <= LIMIT:
        continue
    n = -(-len(data) // LIMIT)
    size = -(-len(data) // n)
    for i in range(n):
        open('%s.part%d' % (f, i), 'wb').write(data[i * size:(i + 1) * size])
    os.remove(f)
    parts[os.path.basename(f)] = n
if parts:
    js = ('<script>(function(){var f=window.fetch,P=%s;window.fetch=function(u){var s=typeof u==="string"?u:(u&&u.url)||"",n=s.split("?")[0].split("/").pop();'
          'if(P[n]){return Promise.all(Array.from({length:P[n]},function(_,i){return f(s.replace(n,n+".part"+i)).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.arrayBuffer();});}))'
          '.then(function(b){return new Response(new Blob(b),{headers:{"content-type":"application/wasm"}});});}return f.apply(this,arguments);};})();</script>') % json.dumps(parts)
    p = os.path.join(d, 'index.html')
    h = open(p).read()
    h = re.sub(r'<link[^>]*rel="preload"[^>]*\.wasm[^>]*>', '', h)
    h = h.replace('<head>', '<head>' + js, 1)
    open(p, 'w').write(h)
print(parts)
