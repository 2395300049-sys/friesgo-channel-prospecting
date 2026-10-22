from pathlib import Path
import hashlib, json, sys, tempfile, unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from reproduce import reproduce
from validate import validate_snapshot, SNAPSHOT

class ReproductionTests(unittest.TestCase):
    def test_contact_and_letter_consistency_and_blank_print_table(self):
        result=validate_snapshot()
        self.assertEqual(result['accounts'],20)
        self.assertEqual(result['record_cells_empty'],160)
        self.assertEqual(result['print_pages'],1)

    def test_reproduction_preserves_reviewed_bytes_and_source(self):
        before=hashlib.sha256((ROOT/'data/canonical_accounts.json').read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory(dir=self._output_root()) as d:
            output=reproduce(Path(d),version='v1')
            manifest=json.loads((SNAPSHOT/'manifest.json').read_text())
            for rec in manifest['files']:
                self.assertEqual(hashlib.sha256((output/rec['path']).read_bytes()).hexdigest(),rec['sha256'])
            self.assertTrue((output/'FriesGo_完整复用包.zip').is_file())
        after=hashlib.sha256((ROOT/'data/canonical_accounts.json').read_bytes()).hexdigest()
        self.assertEqual(before,after)

    def test_source_destination_rejected(self):
        with self.assertRaises(AssertionError):reproduce(SNAPSHOT,version='v1')

    def _output_root(self):
        out=ROOT/'outputs';out.mkdir(exist_ok=True);return out

if __name__=='__main__':unittest.main()
