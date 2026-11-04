"""Stable JSON protocol. stdin append; query never initializes or repairs storage."""
import argparse
import json
from pathlib import Path
import sys

from src.platform.paths import STATE
from src.platform.observability.events import event
from src.platform.observability.store import Store


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, default=STATE)
    commands = parser.add_subparsers(dest='operation', required=True)
    query = commands.add_parser('query')
    for name in ('since', 'until', 'kind', 'source', 'correlation-id'):
        query.add_argument('--' + name)
    query.add_argument('--limit', type=int, default=100)
    commands.add_parser('append')
    # argparse's errors are replaced with a stable, sanitized JSON response.
    parser.error = lambda message: (_ for _ in ()).throw(ValueError('invalid_arguments'))
    query.error = parser.error
    try:
        args = parser.parse_args(argv)
        store = Store(args.runtime)
        if args.operation == 'query':
            result = store.query(args.since, args.until, args.kind, args.source, args.correlation_id, args.limit)
        else:
            incoming = sys.stdin.read(65537)
            if len(incoming) > 65536:
                raise ValueError('oversized_input')
            value = json.loads(incoming)
            record = value if 'event_id' in value else event(**value)
            result = {'schema_version': 1, **store.append(record)}
        print(json.dumps(result, ensure_ascii=True, separators=(',', ':')))
        return 0 if result.get('ok') else 1
    except (ValueError, TypeError, KeyError, OSError, OverflowError):
        print(json.dumps({'schema_version': 1, 'ok': False, 'error_category': 'invalid_arguments'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
