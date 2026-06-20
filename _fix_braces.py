import re

with open("_graphify_full.py", encoding="utf-8") as f:
    src = f.read()

# Fix: 4 braces -> 2 braces for JSON placeholders (ND, LK, CM, CO)
src = src.replace("const ND={{{{ND_JSON}}}};", "const ND={{ND_JSON}};")
src = src.replace("const LK={{{{LK_JSON}}}};", "const LK={{LK_JSON}};")
src = src.replace("const CM={{{{CM_JSON}}}};", "const CM={{CM_JSON}};")
src = src.replace("const CO={{{{CO_JSON}}}};", "const CO={{CO_JSON}};")

# Verify no 4-brace JSON placeholders remain
four_brace_json = re.findall(r'\{\{\{\{[A-Z_]+\}\}\}\}', src)
if four_brace_json:
    print(f"WARNING: Still have 4-brace placeholders: {four_brace_json}")
else:
    print("All 4-brace JSON placeholders fixed")

# Verify 2-brace JSON placeholders exist
two_brace_json = re.findall(r'\{\{[A-Z_]+\}\}', src)
print(f"2-brace placeholders found: {two_brace_json}")

with open("_graphify_full.py", "w", encoding="utf-8") as f:
    f.write(src)

print("Template fixed and saved")