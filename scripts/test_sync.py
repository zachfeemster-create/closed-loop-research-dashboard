"""Offline tests for private-log redaction and incremental updates."""
import unittest
from sync_private_log import summarize, build_index

class SyncTest(unittest.TestCase):
    def test_omits_private_content(self):
        record = {'run_id':'RT-FOO','logged_at':'2026-11-02T18:30:00Z',
                  'plan':{'secret':'PRIVATE_INPUT','intake':{'keystone':'PRIVATE_IDEA'}},
                  'keystone':'PRIVATE_QUESTION',
                  'result':{'passed':False,'verdict':'FAIL PRIVATE_COMMENT',
                            'rows':[{'stat':'accuracy', 'real':0.75,'percentile':85,
                                     'notes':'SECRET_NOTE','data':'PRIVATE_DATA'}]}}
        s = summarize('test_runs/RT-FOO.json','abc', record)
        self.assertEqual(s['status'], 'fail')
        self.assertEqual(s['checks'][0]['real'], 0.75)
        self.assertNotIn('PRIVATE_',str(s))
        self.assertNotIn('SECRET_',str(s))

    def test_incremental(self):
        tree={'tree':[{'type':'blob','path':'test_runs/RT-FOO.json','sha':'abc'}]}
        old={'runs':[{'id':'RT-FOO','sourcePath':'test_runs/RT-FOO.json','blobSha':'abc', 'logged_at':'t'}]}
        got=build_index(tree,old,lambda sha: self.fail('Unchanged blob should not be fetched'))
        self.assertEqual(got['count'],1)

    def test_rejects_truncated_tree(self):
        with self.assertRaises(ValueError):build_index({'truncated':True,'tree':[]},{},lambda sha:{})

if __name__ == '__main__':unittest.main()