"""Fetch bounded Gaia subsets, verifying result completeness against COUNT(*)."""
import argparse,csv,gzip,io,json,urllib.parse,urllib.request
from compile_gaia import ROOT,FIELDS,LMC_WHERE,NEAR_WHERE
ENDPOINT='https://gaia.ari.uni-heidelberg.de/tap/sync'
def query_csv(query):
    body=urllib.parse.urlencode(dict(REQUEST='doQuery',LANG='ADQL',FORMAT='csv',MAXREC=1000000,QUERY=query)).encode()
    with urllib.request.urlopen(ENDPOINT,data=body,timeout=300) as response:return response.read()
def run(kind):
    path=ROOT/f'data/gaia-dr3-{kind}.csv.gz'
    if path.exists():print('Cached',path,flush=True);return
    where=LMC_WHERE if kind=='lmc' else NEAR_WHERE
    query=f'SELECT {FIELDS} FROM gaiadr3.gaia_source WHERE '+where
    raw=query_csv(query)
    if not raw.startswith(b'source_id,'):raise ValueError('Expected Gaia CSV schema')
    rows=sum(1 for _ in csv.reader(io.StringIO(raw.decode())))-1
    expected=int(list(csv.reader(io.StringIO(query_csv('SELECT COUNT(*) AS n FROM gaiadr3.gaia_source WHERE '+where).decode())))[1][0])
    if rows!=expected or rows>=1000000:raise ValueError(f'Incomplete TAP response: {rows} of {expected}')
    path.parent.mkdir(exist_ok=True)
    temporary=path.with_suffix('.part');temporary.write_bytes(gzip.compress(raw,mtime=0));temporary.replace(path)
    path.with_suffix('.query.json').write_text(json.dumps({'endpoint':ENDPOINT,'query':query,'maxrec':1000000,'bytes':len(raw),'verifiedCount':expected},indent=2)+'\n')
    print('Saved',rows,'sources to',path,flush=True)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('kind',choices=['lmc','500pc']);run(parser.parse_args().kind)
