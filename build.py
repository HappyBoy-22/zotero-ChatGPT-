"""Package a Zotero plugin using the Python standard library."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import json
from urllib.parse import urlparse

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
settings = manifest['applications']['zotero']
for required in ('id', 'update_url', 'strict_max_version'):
    if not settings.get(required):
        raise ValueError(f'Missing Zotero-required manifest field: {required}')
if urlparse(settings['update_url']).scheme != 'https':
    raise ValueError('Zotero requires an HTTPS update_url; local files disable the plugin')
output = root / 'dist' / f"chatgpt-reader-{manifest['version']}.xpi"
output.parent.mkdir(exist_ok=True)
files = (
    'manifest.json', 'bootstrap.js', 'sidebar.js', 'bindings.js',
    'analysis.js', 'autochat.js', 'gestures.js', 'ReaderChild.sys.mjs',
    'preferences.xhtml', 'preferences.js', 'margins.js', 'rectangles.js', 'LICENSE',
    'vendor/pdf-lib.min.js', 'vendor/pdf-lib.LICENSE.md',
)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for name in files:
        info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.compress_type = ZIP_DEFLATED
        # Normalize text so Windows and Unix checkouts produce identical input.
        data = (root / name).read_text(encoding='utf-8').replace('\r\n', '\n')
        archive.writestr(info, data.encode('utf-8'))
digest = hashlib.sha256(output.read_bytes()).hexdigest()
(output.parent / 'SHA256SUMS').write_text(
    f'{digest}  {output.name}\n', encoding='utf-8', newline='\n'
)
print(output)
