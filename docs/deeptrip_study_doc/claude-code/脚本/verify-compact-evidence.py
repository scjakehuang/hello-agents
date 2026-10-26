"""Verify shipped excerpt bytes and document links without executing Claude Code."""
from pathlib import Path
import hashlib
import json
import re
from urllib.parse import unquote

base = Path(__file__).resolve().parent.parent
manifest = json.loads((base / '证据/交付源码映射.json').read_text())
source_root = Path(manifest['source_root'])
binary_path = Path(manifest['binary_path'])


def sha(data):
    return hashlib.sha256(data).hexdigest()


assert sha(binary_path.read_bytes()) == manifest['binary_sha256'], 'binary changed'
sources = {}
with binary_path.open('rb') as binary:
    for row in manifest['records']:
        raw = (base / row['delivered_raw_path']).read_bytes()
        assert len(raw) == row['source_byte_length']
        assert sha(raw) == row['sha256'], row['raw_path']
        if row['source'] not in sources:
            source = (source_root / row['source']).read_bytes()
            assert sha(source) == row['source_sha256']
            sources[row['source']] = source
        start = row['source_byte_start']
        assert sources[row['source']][start:start + len(raw)] == raw
        binary.seek(row['binary_file_offset'])
        assert binary.read(len(raw)) == raw
        assert sha((base / row['delivered_readable_path']).read_bytes()) == row['readable_sha256']

checked = 0
for markdown in base.rglob('*.md'):
    for target in re.findall(r'(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)', markdown.read_text()):
        target = target.strip('<>')
        if re.match(r'^[a-zA-Z]+://', target) or target.startswith('#'):
            continue
        target = re.sub(r':\d+$', '', unquote(target.split('#', 1)[0]))
        path = Path(target) if target.startswith('/') else markdown.parent / target
        assert path.exists(), f'{markdown.name}: missing {target}'
        checked += 1

# Validate numeric examples in the documentation; these are not model measurements.
groups = [4000, 9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000]
assert sum(groups[:9]) == 48000
assert sum(groups[:6]) == 39000 and sum(groups[6:]) == 10000
assert sum(groups[6:9]) == 9000 and sum(groups[:3]) == 21000
assert 180000 - 13000 == 167000
assert min(180000 - round(180000 * .2), 167000) == 144000
assert 200000 - 20000 - 3000 == 177000

result = {
    'scope': 'static artifact and documentation checks only; target not executed',
    'binary_sha256': manifest['binary_sha256'],
    'excerpt_binary_source_hash_matches': len(manifest['records']),
    'source_modules_verified': len(sources),
    'local_markdown_links_checked': checked,
    'numeric_examples': 'passed',
}
(base / '证据/校验结果.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False))
