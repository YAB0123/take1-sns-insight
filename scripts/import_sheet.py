"""
「岡山乗馬倶楽部2026インサイト」スプレッドシート（xlsx）を、管理ページの
「過去データを取り込む」で読める JSON に変換する。

  python import_sheet.py insight-sheet.xlsx sheet-reports.json

シート名 "2026.8" → 集計期間 2026-08-16〜2026-09-15（16日〜翌月15日）として扱う。
シートごとに列の並び・日付の書き方が違うので、見出し名で列を探し、日付は複数の書式を試す。
"""

import datetime as dt
import hashlib
import json
import re
import sys

import openpyxl

COLS = {
    'ビュー': 'views',
    'リーチ': 'reach',
    'いいね！の数': 'likes',
    'シェア数': 'shares',
    'コメント': 'comments',
    '保存数': 'saves',
    'フォロー': 'follows',
    'フォロー数': 'follows',
    '動画平均再生時間(秒)': 'avgWatchSec',
}


def period_of(sheet_name: str):
    y, m = map(int, sheet_name.split('.'))
    start = dt.date(y, m, 16)
    end = dt.date(y + (m == 12), m % 12 + 1, 15)
    return start, end


def parse_date(v, start: dt.date):
    """様々な書式の公開日時 → ISO(JST)"""
    if isinstance(v, dt.datetime):
        d = v
    else:
        s = str(v or '').strip()
        d = None
        m = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日(?:\([^)]*\))?\s*(?:(\d{1,2}):(\d{2}))?', s)
        if m:
            d = dt.datetime(int(m[1]), int(m[2]), int(m[3]), int(m[4] or 0), int(m[5] or 0))
        if not d:
            m = re.search(r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?', s)
            if m:
                d = dt.datetime(int(m[1]), int(m[2]), int(m[3]), int(m[4] or 0), int(m[5] or 0))
        if not d:
            # 05/17/2025 09:16 / 2/17/2026 20:06（月/日/年）
            m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?', s)
            if m:
                d = dt.datetime(int(m[3]), int(m[1]), int(m[2]), int(m[4] or 0), int(m[5] or 0))
        if not d:
            # 8/17(月) 20:11（年なし → 期間から補う）
            m = re.search(r'(\d{1,2})/(\d{1,2})(?:\([^)]*\))?\s*(?:(\d{1,2}):(\d{2}))?', s)
            if m:
                mo = int(m[1])
                year = start.year + (1 if mo < start.month else 0)
                d = dt.datetime(year, mo, int(m[2]), int(m[3] or 0), int(m[4] or 0))
        if not d:
            return None
    return d.strftime('%Y-%m-%dT%H:%M:00+09:00')


def num(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2) if not float(v).is_integer() else int(v)
    s = re.sub(r'[,人\s]', '', str(v))
    try:
        f = float(s)
        return int(f) if f.is_integer() else f
    except ValueError:
        return None


def header_value(cell, label):
    m = re.search(label + r'[：:]\s*([\d,]+)', str(cell or ''))
    return num(m[1]) if m else None


def convert(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    reports = []
    for ws in wb.worksheets:
        if not re.fullmatch(r'\d{4}\.\d{1,2}', ws.title):
            continue
        rows = list(ws.iter_rows(values_only=True))
        start, end = period_of(ws.title)
        top = rows[0]
        followers = next((header_value(c, 'フォロワー数') for c in top if header_value(c, 'フォロワー数') is not None), None)
        new_f = next((header_value(c, '新規フォロワー') for c in top if header_value(c, '新規フォロワー') is not None), None)
        hdr = [str(h).strip() if h else '' for h in rows[1]]
        idx = {h: i for i, h in enumerate(hdr) if h}
        posts = []
        for r in rows[2:]:
            title = r[0]
            if not title or not str(title).strip():
                continue
            published = parse_date(r[idx['公開日時']], start) if '公開日時' in idx else None
            if not published:
                continue
            metrics = {}
            for h, k in COLS.items():
                if h in idx:
                    v = num(r[idx[h]])
                    if v is not None:
                        metrics[k] = v
            if not metrics.get('views'):
                continue
            t = str(title).strip().split('\n')[0][:200]
            ptype = r[idx['投稿タイプ']] if '投稿タイプ' in idx else 'リール'
            posts.append({
                'id': 'sheet-' + hashlib.md5(f'{published}|{t}'.encode()).hexdigest()[:10],
                'platform': 'instagram',
                'title': t,
                'publishedAt': published,
                'type': 'リール' if ptype and 'リール' in str(ptype) else (ptype or 'リール'),
                'metrics': metrics,
            })
        reports.append({
            'periodStart': start.isoformat(),
            'periodEnd': end.isoformat(),
            'label': f'{start.year}年{start.month}月度',
            'platforms': {
                'instagram': {
                    'account': {k: v for k, v in {'followers': followers, 'netFollowers': new_f}.items() if v is not None},
                    'posts': sorted(posts, key=lambda p: p['publishedAt']),
                }
            },
        })
    return sorted(reports, key=lambda r: r['periodStart'])


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    reports = convert(src)
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(reports, f, ensure_ascii=False, indent=1)
    for r in reports:
        ig = r['platforms']['instagram']
        print(r['label'], r['periodStart'], '〜', r['periodEnd'], '投稿', len(ig['posts']), ig['account'])
