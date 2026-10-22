"""Build consistent current deliverables in staging, then publish atomically."""
import argparse, csv, hashlib, json, os, shutil, subprocess, tempfile, zipfile
from collections import Counter
from pathlib import Path
from current_model import ROOT, load_current, validate_current, quotation_readiness, require

def h(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def account_text(a):
    r=a['review']
    fields=[('国家与渠道',a['country']+'；'+a['role']),('官网',a['website']),('公开邮箱',a['email']),
            ('电话及已核即时渠道',a['phone']),('地址',a['address']),('联系人及应转岗位',a['person']),
            ('备用渠道',a['alt']),('公开事实',a['fact']),('历史项目或应用场景',a['scenario']),
            ('项目证据边界',a['project_status']),('本次排序',r['queue']+'；'+r['fit']),
            ('讨论位置',r['entry_product']),('研究判断',r['reason']),('合作障碍',a['risk']),
            ('首封目标',r['next_commitment']),('进入下一步',r['unlock']),('停止条件',r['stop']),
            ('采购权限和需求','均未确认；'+r['stage']+'；'+r['outreach_status']),
            ('原来源核验日期',a['checked_on']),('本次判断复审日期',r['reviewed_on'])]
    text=f"## {a['id']} {a['name']}\n\n"+'\n\n'.join(f'**{k}：**{v}' for k,v in fields)+'\n\n'
    text+='**产品及联系来源：**'+a['product_url']+'\n\n'+a['contact_url']+'\n\n'
    if a['project_url']:text+='**项目/补充来源：**'+a['project_url']+'\n\n'
    text+='### 首选语言草稿\n\nSubject: '+a['local_subject']+'\n\n'+a['local']+'\n\n### 中文译文\n\n'+a['chinese']+'\n\n'
    if a['language']=='越南语':text+='### 英文母稿\n\nSubject: '+a['subject']+'\n\n'+a['english']+'\n\n'
    return text

def write_texts(dest, accounts, model):
    validate_current(accounts,model)
    (dest/'canonical_accounts.json').write_text(json.dumps(accounts,ensure_ascii=False,indent=2)+'\n')
    (dest/'operating_model.json').write_text(json.dumps(model,ensure_ascii=False,indent=2)+'\n')
    (dest/'action_decisions.json').write_text(json.dumps({a['id']:quotation_readiness(a['review'],model['quote_fields']) for a in accounts},ensure_ascii=False,indent=2)+'\n')
    for field,target in [('audit_report','01_项目审核与优化.md'),('playbook','02_业务员推进手册.md'),('market_report','03_原市场研究_保留原日期.md'),('product_passport','08_产品资料卡.md')]:
        shutil.copy2(ROOT/model[field],dest/target)
    # Keep the report's local evidence references usable in a standalone pack.
    evidence=dest/'evidence';evidence.mkdir()
    for name in ['audit-primary-sources.json','source-audit-2026-10-23.json']:
        shutil.copy2(ROOT/'evidence'/name,evidence/name)
    shutil.copytree(ROOT/'evidence/trade',evidence/'trade')
    (dest/'04_20家客户与开发信.md').write_text('# 20家候选账户与逐家开发信\n\nP1为小批研究验证队列，P2先补条件，P3暂缓；均未确认购买意愿。\n\n'+''.join(account_text(a) for a in accounts))
    letters=dest/'开发信_逐家';letters.mkdir()
    for a in accounts:
        (letters/f'{a["id"]}.md').write_text(account_text(a))
        (letters/f'{a["id"]}.txt').write_text(f"To: {a['email']}\n状态: 草稿 未发送；{a['review']['queue']}\nSubject: {a['local_subject']}\n\n{a['local']}\n")
    with (dest/'05_客户来源与行动.csv').open('w',encoding='utf-8-sig',newline='') as f:
        keys=['id','name','country','email','phone','queue','unlock','stop','checked_on','reviewed_on','product_url','contact_url']
        w=csv.DictWriter(f,fieldnames=keys);w.writeheader()
        for a in accounts:w.writerow({k:(a['review'][k] if k in a['review'] else a[k]) for k in keys})
    (dest/'00_先读这里.txt').write_text('先读01审核报告，再看02推进手册和07客户工作簿。06打印表始终一页横版，记录格留空。\n20家是候选账户，当前队列见07；没有发送或确认需求。\n03为原市场研究，旧A/B分数和排序仅供追溯；当前行动以01及07的P队列为准。\n填写操作、买方回复和成本前，请将电子工作副本移到private目录或公司受控位置；不上传公开仓库。\n')

def validate_texts(dest, accounts):
    dossier=(dest/'04_20家客户与开发信.md').read_text()
    with (dest/'05_客户来源与行动.csv').open(encoding='utf-8-sig') as f: rows=list(csv.DictReader(f))
    require([r['id'] for r in rows]==[a['id'] for a in accounts],'CSV account order mismatch')
    for a,row in zip(accounts,rows):
        for key in ['email','phone','english','chinese','local']:
            require(a[key] in dossier,f'{a["id"]}: dossier {key} mismatch')
        require(a['local'] in (dest/'开发信_逐家'/f'{a["id"]}.txt').read_text(),f'{a["id"]}: TXT mismatch')
        require(row['email']==a['email'],f'{a["id"]}: CSV email mismatch')

def publish_staging(staging, destination):
    backup=destination.with_name(destination.name+'.previous')
    require(not backup.exists(),'Previous backup exists; inspect before replacing')
    if destination.exists(): destination.rename(backup)
    try: staging.rename(destination)
    except BaseException:
        if backup.exists(): backup.rename(destination)
        raise
    if backup.exists(): shutil.rmtree(backup)

def build_current(destination=None, text_only=False, accounts=None, model=None):
    if accounts is None or model is None:accounts,model=load_current()
    validate_current(accounts,model)
    destination=Path(destination or ROOT/'outputs/current').resolve()
    require(ROOT/'outputs' in destination.parents,'Output must be below outputs/')
    require(not destination.exists() or destination.is_dir(),'Output is not a directory')
    destination.parent.mkdir(parents=True,exist_ok=True)
    staging=Path(tempfile.mkdtemp(prefix='.friesgo-',dir=destination.parent))
    try:
        write_texts(staging,accounts,model)
        validate_texts(staging,accounts)
        if not text_only:
            from reproduce import dependency_paths
            py,node,modules,soffice=dependency_paths()
            require(node and (modules/'@oai/artifact-tool').exists(),'Current XLSX build needs the documented artifact-tool runtime')
            require(bool(soffice),'Current full pack needs LibreOffice for the one-page PDF')
            env=dict(os.environ,FRIESGO_OUTPUT_DIR=str(staging))
            if not env.get('FONTCONFIG_FILE'):
                from prepare_fonts import configure
                env['FONTCONFIG_FILE']=configure(ROOT,Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies')
            target=ROOT/'node_modules'
            if not target.exists(): target.symlink_to(modules,target_is_directory=True)
            subprocess.run([py,str(ROOT/'scripts/build_current_word.py')],check=True,env=env)
            subprocess.run([node,str(ROOT/'scripts/build_current_workbook.mjs')],check=True,env=env)
            subprocess.run([node,str(ROOT/'scripts/build_print_tracker.mjs')],check=True,env=env)
            subprocess.run([py,str(ROOT/'scripts/set_tracker_print.py')],check=True,env=env)
            subprocess.run([soffice,'--headless','--convert-to','pdf','--outdir',str(staging),str(staging/'06_业务员操作记录_一页横版.xlsx')],check=True,env=env,timeout=120)
            from validate_current_outputs import validate_outputs
            validate_outputs(staging,accounts)
        validation={'schema':validate_current(accounts,model),'text_only':text_only,
                    'visual_review':'pending; structural validation cannot approve layout',
                    'input_hashes':{'canonical_accounts.json':h(staging/'canonical_accounts.json'),'operating_model.json':h(staging/'operating_model.json')},
                    'queues':dict(Counter(a['review']['queue'] for a in accounts)),
                    'source_dates':sorted(set(a['checked_on'] for a in accounts)),
                    'report_date':model['report_date'],'version':model['version']}
        (staging/'build-validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n')
        publish_staging(staging,destination)
    except BaseException:
        if staging.exists():shutil.rmtree(staging)
        raise
    print(destination)
    return destination

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path);p.add_argument('--text-only',action='store_true')
    args=p.parse_args();build_current(args.output,args.text_only)
