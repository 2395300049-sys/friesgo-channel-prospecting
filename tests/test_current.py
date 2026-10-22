from copy import deepcopy
import csv,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from current_model import load_current,validate_current,quotation_readiness
from build_current import build_current

class CurrentPackTests(unittest.TestCase):
    def setUp(self):
        self.accounts,self.model=deepcopy(load_current())
        (ROOT/'outputs').mkdir(exist_ok=True)

    def test_updated_contact_letter_country_and_source_date_propagate(self):
        a=self.accounts[0]
        a.update(email='updated@example.org',country='测试市场',english='A changed factual draft for review.',local='A changed factual draft for review.',chinese='更新后的中文草稿。')
        self.model['report_date']='2026-11-01'
        with tempfile.TemporaryDirectory(dir=ROOT/'outputs') as temp:
            out=build_current(Path(temp)/'pack',text_only=True,accounts=self.accounts,model=self.model)
            dossier=(out/'04_20家客户与开发信.md').read_text()
            draft=(out/'开发信_逐家/V01.txt').read_text()
            self.assertIn(a['email'],dossier);self.assertIn(a['local'],draft)
            with (out/'05_客户来源与行动.csv').open(encoding='utf-8-sig') as f:rows=list(csv.DictReader(f))
            self.assertEqual(rows[0]['country'],'测试市场')
            self.assertEqual(rows[0]['checked_on'],'2026-10-23')
            self.assertIn(a['chinese'],dossier)

    def test_failed_build_keeps_previous_complete_output(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'outputs') as temp:
            dest=Path(temp)/'pack';dest.mkdir();(dest/'last-good.txt').write_text('reviewed previous pack')
            with patch('build_current.write_texts',side_effect=RuntimeError('simulated generator failure')):
                with self.assertRaises(RuntimeError):build_current(dest,text_only=True)
            self.assertEqual((dest/'last-good.txt').read_text(),'reviewed previous pack')
            self.assertEqual(list(Path(temp).iterdir()),[dest])

    def test_rebuild_removes_obsolete_accounts_and_leftovers(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'outputs') as temp:
            dest=Path(temp)/'pack';dest.mkdir();(dest/'stale-letter.txt').write_text('old')
            build_current(dest,text_only=True)
            self.assertFalse((dest/'stale-letter.txt').exists())
            self.assertEqual(len(list((dest/'开发信_逐家').glob('*.txt'))),20)

    def test_research_score_cannot_verify_authority_or_issue_quote(self):
        a=self.accounts[0];a['score']=100;a['review']['stage']='S3 采购职权已核'
        with self.assertRaisesRegex(ValueError,'authority evidence'):validate_current(self.accounts,self.model)
        a['review'].update(authority_verified=True,authority_evidence='a recorded referral',demand_confirmed=True,demand_evidence='a dated buyer reply',rfq_evidence='a saved RFQ',stage='S6 已正式报价')
        with self.assertRaisesRegex(ValueError,'actual quote'):validate_current(self.accounts,self.model)

    def test_quote_gate_requires_content_and_evidence(self):
        r=self.accounts[0]['review']
        self.assertFalse(quotation_readiness(r,self.model['quote_fields'])['ready'])
        r['quote_gates']['compliance_path']={'status':'not_applicable','reason':'verified applicability assessment','evidence':'dated assessment'}
        r['quote_gates']['authorized_cost']={'status':'not_applicable','reason':'no cost yet','evidence':'note'}
        self.assertFalse(quotation_readiness(r,self.model['quote_fields'])['ready'])
        r['quote_gates']={key:{'status':'confirmed'} for key in self.model['quote_fields']}
        self.assertFalse(quotation_readiness(r,self.model['quote_fields'])['ready'])
        r['quote_gates']={key:{'status':'confirmed','value':'agreed value','evidence':'dated record'} for key in self.model['quote_fields']}
        self.assertTrue(quotation_readiness(r,self.model['quote_fields'])['ready'])
        r['quote_gates']['compliance_path']={'status':'not_applicable'}
        self.assertFalse(quotation_readiness(r,self.model['quote_fields'])['ready'])

    def test_current_dates_and_pilot_consistency_are_enforced(self):
        self.accounts[0]['checked_on']='2027-01-01'
        with self.assertRaisesRegex(ValueError,'future source date'):validate_current(self.accounts,self.model)
        self.accounts[0]['checked_on']='2026-10-23';self.model['pilot_ids'].pop()
        with self.assertRaisesRegex(ValueError,'Pilot/queue mismatch'):validate_current(self.accounts,self.model)

    def test_public_source_tree_cannot_be_output(self):
        with self.assertRaisesRegex(ValueError,'below outputs'):build_current(ROOT/'deliverables/new',text_only=True)

    def test_v2_snapshot_rejects_modified_letter(self):
        import shutil
        from validate_release import V2,validate_release
        with tempfile.TemporaryDirectory(dir=ROOT/'outputs') as temp:
            copy=Path(temp)/'release';shutil.copytree(V2,copy)
            validate_release(copy)
            (copy/'开发信_逐家/V01.txt').write_text('changed after review')
            with self.assertRaisesRegex(ValueError,'Changed release file'):validate_release(copy)

    def test_missing_gate_configuration_cannot_approve_a_quote(self):
        with self.assertRaisesRegex(ValueError,'ten quotation fields'):
            quotation_readiness(self.accounts[0]['review'],[])
        self.model['quote_fields'].remove('authorized_cost')
        with self.assertRaisesRegex(ValueError,'ten quotation fields'):
            validate_current(self.accounts,self.model)

if __name__=='__main__':unittest.main()
