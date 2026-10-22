"""Provision checksum-verified Noto CJK fonts for headless LibreOffice only."""
from pathlib import Path
import hashlib, urllib.request
from xml.sax.saxutils import escape

REV='f8d157532fbfaeda587e826d4cd5b21a49186f7c'
FONTS={
 'NotoSansCJKsc-Regular.otf':'2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b',
 'NotoSansCJKsc-Bold.otf':'b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a',
}

def configure(root,dependencies):
    directory=Path(root)/'outputs/.fontcache';directory.mkdir(parents=True,exist_ok=True)
    for name,digest in FONTS.items():
        target=directory/name
        if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()!=digest:
            url=f'https://raw.githubusercontent.com/notofonts/noto-cjk/{REV}/Sans/OTF/SimplifiedChinese/{name}'
            with urllib.request.urlopen(url,timeout=90) as r:payload=r.read()
            if hashlib.sha256(payload).hexdigest()!=digest:raise ValueError('Noto font checksum mismatch: '+name)
            target.write_bytes(payload)
    search=[directory,Path('/System/Library/Fonts'),Path('/usr/share/fonts'),
            Path(dependencies)/'native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype']
    conf=directory/'fonts.conf'
    conf.write_text('<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'+''.join('<dir>'+escape(str(p))+'</dir>' for p in search if p.exists())+'<cachedir>'+escape(str(directory/'cache'))+'</cachedir><alias><family>sans-serif</family><prefer><family>Noto Sans CJK SC</family></prefer></alias></fontconfig>')
    return str(conf)
