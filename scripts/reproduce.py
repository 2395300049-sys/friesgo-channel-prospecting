"""Reproduce the reviewed snapshot; optionally rebuild inside a supported runtime."""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, sys, zipfile
from validate import ROOT, SNAPSHOT, validate_snapshot

def dependency_paths():
    # Probe documented bundle locations without publishing a machine-specific path.
    dep=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies'
    py=os.environ.get('FRIESGO_PYTHON') or str(dep/'python/bin/python3')
    if not Path(py).exists():py=sys.executable
    node=os.environ.get('FRIESGO_NODE') or str(dep/'node/bin/node')
    if not Path(node).exists():node=shutil.which('node')
    modules=Path(os.environ.get('FRIESGO_NODE_MODULES') or dep/'node/node_modules')
    soffice=os.environ.get('FRIESGO_SOFFICE') or str(dep/'bin/override/soffice')
    if not Path(soffice).exists():soffice=shutil.which('soffice')
    return py,node,modules,soffice

def reproduce(destination, rebuild=False, rebuild_word=False, version='v2'):
    if rebuild or rebuild_word:
        # Never copy old reports/letters into a current rebuild. One data batch
        # owns all formats, including TXT/MD/CSV, before atomic publication.
        from build_current import build_current
        if rebuild_word:
            print('--rebuild-word now rebuilds the complete current pack to preserve consistency.',file=sys.stderr)
        return build_current(destination)
    if version=='v1':
        validate_snapshot();snapshot=SNAPSHOT
    else:
        from validate_release import V2, validate_release
        validate_release();snapshot=V2
    destination=Path(destination).resolve()
    # Do not allow the immutable snapshot or repository source to be overwritten.
    assert destination==ROOT/'outputs/latest' or ROOT/'outputs' in destination.parents, 'Output must be under outputs/'
    import tempfile
    from build_current import publish_staging
    destination.parent.mkdir(parents=True,exist_ok=True)
    staging=Path(tempfile.mkdtemp(prefix='.reproduce-',dir=destination.parent))
    try:
        shutil.copytree(snapshot,staging,dirs_exist_ok=True)
        publish_staging(staging,destination)
    except BaseException:
        if staging.exists():shutil.rmtree(staging)
        raise
    package=destination/'FriesGo_完整复用包.zip'
    with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED) as z:
        for src in sorted(destination.rglob('*')):
            if src.is_file() and src!=package and not any(s in str(src) for s in ['.inspect.ndjson','previews/','print_tracking_qa/']):
                z.write(src,str(src.relative_to(destination)))
    print(destination)
    print(f'Reproduced {version} reviewed snapshot; original source dates preserved.')
    return destination

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'outputs/latest')
    parser.add_argument('--rebuild',action='store_true')
    parser.add_argument('--rebuild-word',action='store_true')
    parser.add_argument('--version',choices=['v1','v2'],default='v2')
    args=parser.parse_args()
    reproduce(args.output,args.rebuild,args.rebuild_word,args.version)
