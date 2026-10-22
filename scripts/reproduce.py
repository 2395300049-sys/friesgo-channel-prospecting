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

def reproduce(destination, rebuild=False, rebuild_word=False):
    validate_snapshot()
    destination=Path(destination).resolve()
    # Do not allow the immutable snapshot or repository source to be overwritten.
    assert destination==ROOT/'outputs/latest' or ROOT/'outputs' in destination.parents, 'Output must be under outputs/'
    destination.mkdir(parents=True,exist_ok=True)
    for src in SNAPSHOT.iterdir():
        if src.name=='manifest.json':continue
        dst=destination/src.name
        if src.is_dir():shutil.copytree(src,dst,dirs_exist_ok=True)
        else:shutil.copy2(src,dst)
    if rebuild or rebuild_word:
        py,node,modules,soffice=dependency_paths()
        env=dict(os.environ,FRIESGO_OUTPUT_DIR=str(destination))
        shutil.copy2(ROOT/'data/canonical_accounts.json',destination/'canonical_accounts.json')
        shutil.copy2(ROOT/'data/market_model.json',destination/'market_model.json')
        shutil.copy2(ROOT/'docs/market-research-2026-10-23.md',destination/'01_市场调研与渠道选择依据.md')
        subprocess.run([py,str(ROOT/'scripts/build_word.py')],check=True,env=env)
        if rebuild:
            if not node or not (modules/'@oai/artifact-tool').exists():
                raise RuntimeError('Rebuild requires the documented Codex @oai/artifact-tool runtime. Snapshot mode needs no such dependency.')
            target=ROOT/'node_modules'
            if not target.exists():target.symlink_to(modules,target_is_directory=True)
            for name in ['build_workbook.mjs','build_print_tracker.mjs']:
                subprocess.run([node,str(ROOT/'scripts'/name)],check=True,env=env)
            subprocess.run([py,str(ROOT/'scripts/set_tracker_print.py')],check=True,env=env)
            pdf=destination/'06_业务员操作记录_一页横版.pdf'
            pdf.unlink(missing_ok=True)
            if soffice:
                if not env.get('FONTCONFIG_FILE'):
                    from prepare_fonts import configure
                    dep=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies'
                    env['FONTCONFIG_FILE']=configure(ROOT,dep)
                subprocess.run([soffice,'--headless','--convert-to','pdf','--outdir',str(destination),
                                str(destination/'06_业务员操作记录_一页横版.xlsx')],check=True,env=env,timeout=120)
                if not pdf.exists():raise RuntimeError('LibreOffice did not create the new print PDF')
            else:print('No LibreOffice: new print PDF not created. Print the new XLSX or install LibreOffice.',file=sys.stderr)
        (destination/'重建说明.txt').write_text('本目录按已有数据重新排版，不代表重新联网核验。重排后的Word须逐页检查，打印PDF须重新确认一页横版。\n')
    package=destination/'FriesGo_完整复用包.zip'
    with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED) as z:
        for src in sorted(destination.rglob('*')):
            if src.is_file() and src!=package and not any(s in str(src) for s in ['.inspect.ndjson','previews/','print_tracking_qa/']):
                z.write(src,str(src.relative_to(destination)))
    print(destination)
    print('Reproduced historical files; source verification date remains 2026-10-23.')
    return destination

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'outputs/latest')
    parser.add_argument('--rebuild',action='store_true')
    parser.add_argument('--rebuild-word',action='store_true')
    args=parser.parse_args()
    reproduce(args.output,args.rebuild,args.rebuild_word)
