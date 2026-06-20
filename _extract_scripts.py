import re, os
with open('graphify-out/graph.html', 'r', encoding='utf-8') as f:
    html = f.read()
scripts = re.findall(r'<script>(.*?)</script>', html, re.DOTALL)
print(f'Found {len(scripts)} script blocks')
for i, s in enumerate(scripts):
    path = os.environ['TEMP'] + f'/_graph_script_{i}.js'
    with open(path, 'w', encoding='utf-8') as f:
        f.write(s)
    print(f'Script {i}: {len(s)} bytes | first: {s[:80].strip()}')
