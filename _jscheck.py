import re, sys

with open("graphify-out/graph.html", encoding="utf-8") as f:
    html = f.read()

m = re.search(r'<script>\s*(.*?)\s*</script>\s*</body>', html, re.DOTALL)
if not m:
    print("Could not find script block")
    sys.exit(1)

js = m.group(1)
lines = js.split('\n')
for i, line in enumerate(lines, 1):
    # Look for lines that might have issues
    stripped = line.strip()
    if stripped.startswith('//') or stripped.startswith('/*') or stripped.startswith('*'):
        continue
    # Check for obvious JS syntax issues
    if ';' in stripped and ('{' in stripped or '}' in stripped):
        # Try to validate object/array literals
        pass

# Try to find exact location by looking for common issues
issues = []

# Check CO line
for i, line in enumerate(lines, 1):
    if 'const CO=' in line:
        # Check if valid JS
        if '{{' in line or '}}' in line:
            issues.append(f"Line {i}: Unescaped braces in CO line: {line[:80]}")

# Check for unclosed strings
in_str = False
str_char = None
for i, line in enumerate(lines, 1):
    if i >= 59 and i <= 100:  # Around the JSON lines
        for c in line:
            if c in "'\"\"" and not (in_str and c == str_char):
                in_str = not in_str
                str_char = c
            elif in_str and c == '\\':
                continue  # Skip escaped chars

# Check for lines that might have JSON parsing issues
for i, line in enumerate(lines, 1):
    if i >= 59 and i <= 99:
        # Check if line contains {{ which means f-string braces weren't escaped
        if '{{' in line or '}}' in line:
            issues.append(f"Line {i}: Possible unescaped braces: {line.strip()[:100]}")

# Check NM/LK/CM/CO lines
for i, line in enumerate(lines, 1):
    if any(x in line for x in ['const ND=', 'const LK=', 'const CM=', 'const CO=']):
        print(f"Line {i}: {line.strip()[:120]}")

# Find JSON lines and check for issues
for i, line in enumerate(lines, 1):
    if (i >= 60 and i <= 65) or (i >= 71 and i <= 75):
        # These should be JSON array/object literals
        stripped = line.strip()
        if stripped.startswith('const ND=') or stripped.startswith('const LK=') or stripped.startswith('const CM=') or stripped.startswith('const CO='):
            print(f"\nLine {i} (JSON): {stripped[:200]}...")
            # Check for trailing commas in object literals within the line
            # Find the first { or [ and check if last } or ] makes sense
            if '{' in stripped:
                # Count braces - this is simplistic
                opens = stripped.count('{')
                closes = stripped.count('}')
                if opens != closes:
                    issues.append(f"Line {i}: Mismatched braces ({opens} open, {closes} close)")

# Show lines 60-65
print("\n=== Lines 60-65 ===")
for i in range(59, 66):
    if i < len(lines):
        print(f"Line {i+1}: {lines[i][:150]}")

# Show lines 379-385 (the nm/lm/adj init)
print("\n=== Lines 379-385 ===")
for i in range(378, 386):
    if i < len(lines):
        print(f"Line {i+1}: {lines[i][:150]}")

# Show lines 60-65 from the script (the JSON lines)
print("\n=== JSON Lines ===")
for i in range(59, 70):
    if i < len(lines):
        ln = lines[i].strip()
        print(f"Line {i+1}: {ln[:200]}")

if issues:
    print("\n=== Issues ===")
    for issue in issues:
        print(issue)
else:
    print("\nNo obvious issues found in inspection")