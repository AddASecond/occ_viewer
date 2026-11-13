"""Publish a versioned compatible reader, then conditionally switch the index."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[1]
BUCKET = 'robotruck-perception-data'
PREFIX = 'occ-viewer/web/'


def validate_index(old, new, expected_hash, bundle):
    if not re.fullmatch(r'app\.[a-z0-9-]+\.js', bundle):
        raise ValueError('Use an immutable versioned app bundle filename')
    if f'src="./{bundle}"'.encode() not in new:
        raise ValueError('Local index does not reference the requested bundle')
    if old != new and hashlib.sha256(old).hexdigest() != expected_hash:
        raise ValueError('Deployed index changed since snapshot; refusing to overwrite')


def versioned_entry(bundle):
    if not re.fullmatch(r'app\.[a-z0-9-]+\.js', bundle):
        raise ValueError('Use an immutable versioned app bundle filename')
    return 'index.' + bundle[4:-3] + '.html'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--endpoint', default='http://127.0.0.1:19000')
    ap.add_argument('--output', type=Path, required=True)
    ap.add_argument('--bundle-name', required=True)
    ap.add_argument('--expected-index-sha256', required=True)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    s3 = boto3.client('s3', endpoint_url=args.endpoint, config=Config(connect_timeout=10, read_timeout=60))
    index_data = (ROOT / 'web/index.html').read_bytes()
    current = s3.get_object(Bucket=BUCKET, Key=PREFIX + 'index.html')
    old = current['Body'].read()
    validate_index(old, index_data, args.expected_index_sha256, args.bundle_name)
    if args.dry_run:
        print(json.dumps({'validated': True, 'current_index_sha256': hashlib.sha256(old).hexdigest(),
                          'bundle': args.bundle_name, 'writes': 0}), flush=True)
        return

    def immutable(key, data, content_type):
        try:
            found = s3.get_object(Bucket=BUCKET, Key=key)['Body'].read()
        except ClientError as error:
            if error.response['Error']['Code'] not in ('404', 'NoSuchKey', 'NotFound'):
                raise
        else:
            if found != data:
                raise ValueError(f'Existing versioned object differs: {key}')
            return
        try:
            s3.put_object(Bucket=BUCKET, Key=key, Body=data, ContentType=content_type, IfNoneMatch='*',
                          ContentMD5=base64.b64encode(hashlib.md5(data).digest()).decode())
        except ClientError as error:
            # This gateway can replay a successful conditional PUT as 304
            # (or 412). Only accept it after exact GET byte verification below.
            if error.response['ResponseMetadata']['HTTPStatusCode'] not in (304, 412):
                raise
        assert s3.get_object(Bucket=BUCKET, Key=key)['Body'].read() == data

    backup = 'occ-viewer/deployment-backups/' + args.expected_index_sha256 + '/index.html'
    if old != index_data:
        immutable(backup, old, 'text/html')
    else:
        # A retry must still have the actual previous index available to roll back.
        saved = s3.get_object(Bucket=BUCKET, Key=backup)['Body'].read()
        assert hashlib.sha256(saved).hexdigest() == args.expected_index_sha256
    manifest = {}
    for local, remote in [('shared-points.mjs', 'shared-points.mjs'),
                          ('semantic-nine.v6.mjs', 'semantic-nine.v6.mjs'),
                          ('asset-loader.v3.mjs', 'asset-loader.v3.mjs'), ('app.js', args.bundle_name)]:
        data = (ROOT / 'web' / local).read_bytes()
        immutable(PREFIX + remote, data, 'text/javascript')
        manifest[remote] = hashlib.sha256(data).hexdigest()
    # A new HTML path bypasses stale index.html caches in browsers and mounted
    # object filesystems, without overwriting any previous versioned bundle.
    entry = versioned_entry(args.bundle_name)
    immutable(PREFIX + entry, index_data, 'text/html')
    manifest[entry] = hashlib.sha256(index_data).hexdigest()
    if old != index_data:
        # Backup and versioned JS already exist. Conditional PUT prevents
        # clobbering a concurrently deployed index on compliant S3 gateways.
        try:
            s3.put_object(Bucket=BUCKET, Key=PREFIX + 'index.html', Body=index_data,
                          ContentType='text/html', CacheControl='no-cache', IfMatch=current['ETag'],
                          ContentMD5=base64.b64encode(hashlib.md5(index_data).digest()).decode())
        except ClientError as error:
            # A gateway/SDK retry after a successful PUT can get 412 against
            # the now-new ETag. Accept ONLY byte-identical intended content.
            if error.response['ResponseMetadata']['HTTPStatusCode'] != 412 or s3.get_object(
                    Bucket=BUCKET, Key=PREFIX + 'index.html')['Body'].read() != index_data:
                raise
    assert s3.get_object(Bucket=BUCKET, Key=PREFIX + 'index.html')['Body'].read() == index_data
    manifest['index.html'] = hashlib.sha256(index_data).hexdigest()
    result = {'deployed': True, 'bucket': BUCKET, 'prefix': PREFIX, 'sha256': manifest,
              'versioned_entry': entry, 'index_backup_key': backup}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
