#!/usr/bin/env python3
"""Publish a validated plugin release. Uses the existing Git credential helper in memory."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPO = 'BertQLi/GitObsidian'
API = 'https://api.github.com/repos/' + REPO

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()

def main():
    manifest = json.loads((ROOT / 'simple-git-sync/manifest.json').read_text())
    version = manifest['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise SystemExit('Invalid stable version')
    if git('status', '--porcelain'):
        raise SystemExit('Commit the release files before publishing')
    subprocess.run(['node', '--check', 'simple-git-sync/main.js'], cwd=ROOT, check=True)
    if git('rev-parse', 'HEAD') != git('rev-parse', 'origin/main'):
        raise SystemExit('Push main before publishing')
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'}
    cred = subprocess.run(['git', 'credential', 'fill'], cwd=ROOT, env=env,
        input='protocol=https\nhost=github.com\npath='+REPO+'.git\n\n', text=True,
        capture_output=True, timeout=30, check=True)
    fields = dict(line.split('=', 1) for line in cred.stdout.splitlines() if '=' in line)
    token = fields.get('password')
    if not token:
        raise SystemExit('No GitHub credential available in the Git credential helper')

    def api(url, data=None, method=None, content_type='application/json'):
        if not url.startswith(('https://api.github.com/repos/'+REPO+'/', 'https://uploads.github.com/repos/'+REPO+'/')):
            raise RuntimeError('Unexpected GitHub endpoint')
        if isinstance(data, dict): data = json.dumps(data).encode()
        req = urllib.request.Request(url, data=data, method=method,
            headers={'Authorization': 'Bearer '+token, 'Accept':'application/vnd.github+json',
                     'Content-Type':content_type, 'User-Agent':'GitObsidian-release'})
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)

    tag = 'v'+version
    try:
        release = api(API+'/releases/tags/'+tag)
    except urllib.error.HTTPError as e:
        if e.code != 404: raise SystemExit('GitHub API returned HTTP '+str(e.code))
        release = api(API+'/releases', {'tag_name':tag,'target_commitish':git('rev-parse','HEAD'),
            'name':'Simple Git Sync '+tag, 'body':(ROOT/'RELEASE_NOTES.md').read_text(), 'draft':True})
    tag_commit = git('rev-parse', tag+'^{commit}') if subprocess.run(['git','rev-parse','--verify','--quiet',tag],cwd=ROOT,stdout=subprocess.DEVNULL).returncode==0 else None
    if tag_commit and tag_commit != git('rev-parse','HEAD'):
        raise SystemExit('Release tag points at a different commit')
    upload = release['upload_url'].split('{')[0]
    existing = {a['name']:a for a in release.get('assets',[])}
    payloads = {name:(ROOT/'simple-git-sync'/name).read_bytes() for name in ['main.js','manifest.json']}
    metadata = {'tag_name':tag, 'assets':[
        {'name':name,'size':len(content),'digest':'sha256:'+hashlib.sha256(content).hexdigest(),
         'browser_download_url':'https://github.com/'+REPO+'/releases/download/'+tag+'/'+name}
        for name,content in payloads.items()]}
    payloads['update.json'] = json.dumps(metadata,ensure_ascii=False,indent=2).encode()
    for name,content in payloads.items():
        digest = 'sha256:'+hashlib.sha256(content).hexdigest()
        if name in existing:
            if existing[name].get('digest') != digest:
                raise SystemExit('An existing release asset differs: '+name)
        else:
            result=api(upload+'?name='+name,content,'POST','application/octet-stream')
            if result.get('digest') != digest: raise SystemExit('GitHub asset checksum mismatch')
        print('Verified release asset:',name)
    if release['draft']:
        release=api(API+'/releases/'+str(release['id']),{'draft':False,'make_latest':'true'},'PATCH')
    print('Published:',release['html_url'])

if __name__=='__main__':
    try: main()
    except urllib.error.HTTPError as e: raise SystemExit('GitHub API returned HTTP '+str(e.code))
