import json, os
from collections import defaultdict

with open("graphify-out/graph.json", encoding="utf-8") as f:
    g = json.load(f)

# Try local path first, then parent dir
rubric_path = "rubric-additions.md" if os.path.exists("rubric-additions.md") else "../rubric-additions.md"
with open(rubric_path, encoding="utf-8") as f:
    rubric = f.read()

# Compute degree from edges
node_degree = defaultdict(int)
for e in g["edges"]:
    node_degree[e["source"]] += 1
    node_degree[e["target"]] += 1

# Attach degree to nodes
for n in g["nodes"]:
    n["degree"] = node_degree.get(n["id"], 0)

with open("graphify-out/graph.json", "w", encoding="utf-8") as f:
    json.dump(g, f, indent=2)
print("Degree recomputed and saved.")

feature_status = {}
for line in rubric.split("\n"):
    if "## Feature" in line:
        fid = line.split("Feature ")[1].split(":")[0].strip()
        feature_status[fid] = "implemented"

nm = {n["id"]: n for n in g["nodes"]}
file_funcs = defaultdict(list)
for n in g["nodes"]:
    if n.get("type") == "function" and n.get("source"):
        file_funcs[n["source"]].append(n)

gods = sorted([n for n in g["nodes"] if n.get("degree", 0) >= 54], key=lambda x: -x["degree"])[:12]

def file_node(fname):
    funcs = sorted([n["label"] for n in file_funcs.get(fname, [])], key=str.lower)
    nfuncs = len(funcs)
    label = f"{fname}  <span class=meta>{nfuncs} fns</span>"
    if not funcs:
        return f'<li class="leaf"><span class="label">{fname}</span></li>'
    fn_nodes = "".join(f'<li class="leaf"><span class="fn">{fn}</span></li>' for fn in funcs[:8])
    if len(funcs) > 8:
        fn_nodes += f'<li class="leaf"><span class=meta>+{len(funcs)-8} more</span></li>'
    safe = fname.replace(".","_").replace("-","_")
    return f'<li><input type="checkbox" id="tn{safe}" checked /><label for="tn{safe}">{label}</label><ul>{fn_nodes}</ul></li>'

def section(id, label, children):
    sid = id.replace(".","_").replace("-","_")
    return f'<li><input type="checkbox" id="tns{sid}" checked /><label for="tns{sid}">{label}</label><ul>{children}</ul></li>'

feature_sections = [
    ("A", "Platform Badge on Departures"),
    ("B", "Accessibility Badge on Stop Markers"),
    ("C", "Planned Works / Engineering Works"),
    ("D", "Line Route Map"),
    ("E", "Connection Alerts During Trip"),
    ("F", '"My Lines" Dashboard'),
    ("H", "Connection Window Warnings"),
]
fs_children = "".join(
    f'<li class="leaf"><span class="label feature-A">Feature {fid}: {fname}</span>  <span class="{feature_status.get(fid,"unknown")}">[{feature_status.get(fid,"?")}]</span></li>'
    for fid, fname in feature_sections
)

arch_children = (
    section("core", "Core", "".join(file_node(f) for f in ["app.js","config.js","sw.js"] if f in file_funcs)) +
    section("mapmod", "Map Module", "".join(file_node(f) for f in ["map.js","icons.js","ui-bikes.js"] if f in file_funcs)) +
    section("dataapi", "Data / API", "".join(file_node(f) for f in ["api.js","geocoder.js","stops.js"] if f in file_funcs)) +
    section("routing", "Routing", "".join(file_node(f) for f in ["router.js","ui-route.js"] if f in file_funcs)) +
    section("status", "Status / Disruptions", "".join(file_node(f) for f in ["status.js"] if f in file_funcs)) +
    section("storage", "Storage", "".join(file_node(f) for f in ["storage.js"] if f in file_funcs)) +
    section("uipanels", "UI Panels", "".join(file_node(f) for f in sorted(file_funcs.keys()) if f.startswith("ui-"))) +
    section("docs", "Documentation", '<li class="leaf"><span class="label">ARCHITECTURE.md</span></li><li class="leaf"><span class="label">rubric-additions.md</span></li><li class="leaf"><span class="label">manifest.json</span></li>')
)

god_children = "".join(
    f'<li class="leaf"><span class="fn">{n["label"]}</span>  <span class=meta>{n.get("source","?")} · {n.get("degree",0)} edges</span></li>'
    for n in gods
)

call_edges = [e for e in g["edges"] if e.get("type") == "CALLS"]
sh_edges = [e for e in g["edges"] if e.get("type") == "SHARED_NAME"]
seen = set()
cf_children_parts = []
for e in call_edges + sh_edges[:80]:
    sid = f'{e["source"]}->{e["target"]}'
    if sid in seen:
        continue
    seen.add(sid)
    sf = e["source"].rsplit(":", 1)[0] if ":" in e["source"] else e["source"]
    tf = e["target"].rsplit(":", 1)[0] if ":" in e["target"] else e["target"]
    if sf == tf:
        continue
    etype = e.get("type", "CALLS")
    cf_children_parts.append(f'<li class="leaf"><span class="fn">{sf}</span> <span class=meta>--{etype}-></span> <span class="fn">{tf}</span></li>')
cf_children = "".join(cf_children_parts[:30])
if len(cf_children_parts) > 30:
    cf_children += f'<li class="leaf"><span class=meta>+{len(cf_children_parts)-30} more cross-file edges</span></li>'

html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>London Transport App — Knowledge Tree</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;padding:20px 40px}}
h1{{font-size:18px;color:#58a6ff;margin-bottom:20px;padding-bottom:10px;border-bottom:1px solid #30363d}}
ul{{list-style:none;padding-left:20px}}
li{{margin:3px 0}}
input[type=checkbox]{{display:none}}
label{{cursor:pointer;padding:2px 8px;border-radius:4px;display:inline-block;font-weight:600}}
label:hover{{background:#21262d}}
input:checked ~ ul{{display:block}}
input:not(:checked) ~ ul{{display:none}}
input:checked ~ label{{background:#1c2128;color:#58a6ff}}
.label{{color:#e6edf3;font-weight:500}}
.meta{{color:#8b949e;font-size:11px}}
.fn{{color:#79c0ff;font-family:monospace;font-size:12px}}
.pending{{color:#d29922;font-size:11px}}
.implemented{{color:#3fb950;font-size:11px}}
.feature-A{{color:#a5d6ff}}
.section-hd{{color:#58a6ff;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-top:14px;display:block}}
.status-bar{{font-size:11px;color:#8b949e;margin-top:24px;padding-top:10px;border-top:1px solid #30363d}}
.sect{{margin-top:4px}}
</style></head><body>
<h1>London Transport App — Knowledge Tree</h1>
<span class="section-hd">Feature Spec (rubric-additions.md)</span>
<ul>{fs_children}</ul>
<span class="section-hd">Architecture (js/)</span>
<ul>{arch_children}</ul>
<span class="section-hd">Most-Connected Functions (god nodes)</span>
<ul>{god_children}</ul>
<span class="section-hd">Cross-File Connections</span>
<ul>{cf_children}</ul>
<div class="status-bar">
  {len(g["nodes"])} nodes · {len(g["edges"])} edges · {len(file_funcs)} JS modules
  &nbsp;|&nbsp; graph.html = force-directed &nbsp;|&nbsp; KNOWLEDGE_TREE.html = this tree
</div>
</body></html>"""

with open("graphify-out/KNOWLEDGE_TREE.html", "w", encoding="utf-8") as f:
    f.write(html)

print(f"KNOWLEDGE_TREE.html: {len(html)//1024} KB")
print(f"Files: {sorted(file_funcs.keys())}")
for fid in sorted(feature_status):
    print(f"  Feature {fid}: {feature_status[fid]}")
print(f"God nodes: {len(gods)}")
print(f"Cross-file edges shown: {min(30, len(cf_children_parts))} of {len(cf_children_parts)}")