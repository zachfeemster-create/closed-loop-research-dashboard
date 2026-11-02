#!/usr/bin/env python3
"""Publish a narrowly redacted INDEX of the private Closed Loop run log.

This script runs in the PUBLIC dashboard repo Actions runner, using a read-only PAT
from an Actions secret. It does NOT publish plans, keystones, raw input, user data,
free-form notes, or the token. The private original files remain in closed-loop-log.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

PRIVATE_REPO = 'zachfeemster-create/closed-loop-log'
API = f'https://api.github.com/repos/{PRIVATE_REPO}'
OUT = Path(__file__).resolve().parent.parent / 'data' / 'run_index.json'
FOLDERS = {'runs', 'rotation_runs', 'test_runs', 'fingerprint_runs', 'game_runs'}


def api_json(url: str, token: str) -> dict:
    if not url.startswith('https://api.github.com/repos/zachfeemster-create/closed-loop-log/'):
        raise ValueError('Unexpected API endpoint')
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ClosedLoopResearchDashboard/1.0',
    }
    with urlopen(Request(url, headers=headers), timeout=30) as response:
        return json.load(response)


def safe_stat_row(row):
    if not isinstance(row, dict):
        return None
    permitted = {'step', 'stat', 'real', 'bar', 'percentile', 'passed', 'fake_arm_passed',
                 'fakes_mid', 'z', 'sided', 'eq', 'lens'}
    out = {}
    for key, value in row.items():
        if key not in permitted:
            continue
        if isinstance(value, (bool, int, float)) or value is None:
            out[key] = value
        elif isinstance(value, str):
            # Descriptive labels, not arbitrary test data or user plans.
            out[key] = value[:96]
        elif key == 'bar' and isinstance(value, list):
            out[key] = [x for x in value[:3] if isinstance(x, (int, float)) and not isinstance(x, bool)]
    return out or None


def summarize(path: str, sha: str, raw: dict) -> dict:
    folder = path.split('/', 1)[0]
    result = raw.get('result') if isinstance(raw.get('result'), dict) else {}
    identifier = raw.get('run_id') or path.rsplit('/', 1)[-1].removesuffix('.json')
    passed = result.get('passed', raw.get('passed'))
    # Interpret `verdict` only to classify; never publish its free-form text.
    verdict = str(result.get('verdict') or raw.get('verdict') or '')
    status = ('pass' if passed else 'fail') if isinstance(passed, bool) else ('fail' if 'FAIL' in verdict.upper() else ('pass' if 'PASS' in verdict.upper() else 'recorded'))
    rows = result.get('rows', raw.get('rows', raw.get('log', [])))
    if not isinstance(rows, list):
        rows = []
    checks = [x for row in rows[:1200] if (x := safe_stat_row(row))]
    survivors = raw.get('survivors') if isinstance(raw.get('survivors'), list) else []
    luck_pile = raw.get('luck_pile') if isinstance(raw.get('luck_pile'), list) else []
    when = raw.get('logged_at') or raw.get('ran_at') or ''
    # Do not publish user-supplied questions, datasets, plans, keystones, free-form notes or private raw content.
    return {
        'id': str(identifier)[:80],
        'kind': folder.replace('_runs', ''),
        'status': status,
        'logged_at': str(when)[:40],
        'question': {'rotation_runs': 'Lens rotation', 'test_runs': 'Run a Test', 'fingerprint_runs': 'Modeling fingerprint',
                     'game_runs': 'Game theory', 'runs': 'Locked test'}.get(folder, 'Recorded test'),
        'summary': f'{len(rows)} recorded check(s); {len(survivors)} survivor(s); {len(luck_pile)} luck-pile item(s).',
        'n_checks': len(rows),
        'n_survivors': len(survivors),
        'n_luck': len(luck_pile),
        'checks': checks,
        'sourcePath': path,
        'blobSha': sha,
        'publicMirror': True,
    }


def build_index(tree, previous, fetch_blob):
    if not isinstance(tree.get('tree'), list) or tree.get('truncated'):
        raise ValueError('Private Git tree incomplete; refusing to replace existing snapshot')
    old = {x.get('sourcePath'): x for x in previous.get('runs', []) if isinstance(x, dict)}
    entries = [x for x in tree['tree'] if x.get('type') == 'blob' and
               x.get('path', '').split('/', 1)[0] in FOLDERS and
               x.get('path', '').endswith('.json') and x.get('path', '').count('/') == 1]
    runs = []
    for i, entry in enumerate(entries, 1):
        path, sha = entry['path'], entry['sha']
        if path in old and old[path].get('blobSha') == sha:
            runs.append(old[path])
            continue
        # Never persist the unredacted document in the public repo.
        raw = fetch_blob(sha)
        runs.append(summarize(path, sha, raw))
        print(f'Updated {i}/{len(entries)}: {path}', flush=True)
    runs.sort(key=lambda x: (x.get('logged_at', ''), x['id']), reverse=True)
    return {'schemaVersion': 1, 'source': PRIVATE_REPO, 'redaction': 'metadata-and-statistics-only',
            'count': len(runs), 'runs': runs}


def main():
    token = os.environ.get('CLOSED_LOOP_LOG_TOKEN', '').strip()
    if not token:
        raise SystemExit('Missing Actions secret CLOSED_LOOP_LOG_TOKEN. No data published.')
    previous = json.loads(OUT.read_text('utf-8')) if OUT.exists() else {'runs': []}
    tree = api_json(f'{API}/git/trees/main?recursive=1', token)
    import base64
    def fetch_blob(sha):
        blob = api_json(f'{API}/git/blobs/{sha}', token)
        if blob.get('encoding') != 'base64':
            raise ValueError(f'Unexpected blob encoding for {sha}')
        return json.loads(base64.b64decode(blob['content']))
    updated = build_index(tree, previous, fetch_blob)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    new = json.dumps(updated, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
    if not OUT.exists() or OUT.read_text('utf-8') != new:
        OUT.write_text(new, encoding='utf-8')
        print(f'Wrote public redacted index of {len(updated["runs"])} private log records')
    else:
        print(f'No private log changes; {len(updated["runs"])} records indexed')


if __name__ == '__main__':
    main()