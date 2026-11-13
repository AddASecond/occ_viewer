import hashlib
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from deploy_shared_static import validate_index, versioned_entry


class DeploymentTest(unittest.TestCase):
    old = b'<script src="./app.shared-static-v1.js"></script>'
    new = b'<script src="./app.render-fix-v2.js"></script>'

    def test_snapshot_and_retry(self):
        digest = hashlib.sha256(self.old).hexdigest()
        validate_index(self.old, self.new, digest, 'app.render-fix-v2.js')
        validate_index(self.new, self.new, digest, 'app.render-fix-v2.js')

    def test_concurrent_update_rejected(self):
        with self.assertRaises(ValueError):
            validate_index(b'someone else deployed', self.new,
                           hashlib.sha256(self.old).hexdigest(), 'app.render-fix-v2.js')

    def test_wrong_bundle_rejected(self):
        for bundle in ['app.shared-static-v1.js', '../app.js', 'app.js']:
            with self.assertRaises(ValueError):
                validate_index(self.old, self.new, hashlib.sha256(self.old).hexdigest(), bundle)

    def test_versioned_html_entry(self):
        self.assertEqual(versioned_entry('app.point-sources-v5.js'), 'index.point-sources-v5.html')
        self.assertEqual(versioned_entry('app.color-nine-v6.js'), 'index.color-nine-v6.html')
        for value in ['../app.js', 'app.js', 'app.x.js/../index.html']:
            with self.assertRaises(ValueError):
                versioned_entry(value)


if __name__ == '__main__':
    unittest.main()
