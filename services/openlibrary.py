"""
Open Library API client with in-memory caching and response normalization.
"""
import re
import time
from typing import Any

import httpx

BASE = "https://openlibrary.org"
CACHE_TTL_SEC = 60
_cache: dict[str, tuple[Any, float]] = {}


def _cache_get(key: str) -> Any | None:
    if key not in _cache:
        return None
    val, expires = _cache[key]
    if time.monotonic() > expires:
        del _cache[key]
        return None
    return val


def _cache_set(key: str, value: Any) -> None:
    _cache[key] = (value, time.monotonic() + CACHE_TTL_SEC)


def _normalize_subjects(raw: list[str] | None) -> list[str]:
    if not raw:
        return []
    out = []
    for s in raw:
        if isinstance(s, str):
            t = s.strip().lower()
            if t:
                out.append(t)
    return out[:20]


def _cover_url(cover_i: int | None) -> str | None:
    if cover_i is None:
        return None
    return f"https://covers.openlibrary.org/b/id/{cover_i}-M.jpg"


def normalize_search_item(doc: dict[str, Any], source: str = "search") -> dict[str, Any]:
    """Turn a search hit into our book shape."""
    key = doc.get("key", "")
    if isinstance(key, str) and key.startswith("/works/"):
        work_id = key.replace("/works/", "").strip()
    else:
        work_id = doc.get("key", "")

    authors_raw = doc.get("author_name") or doc.get("author_key") or []
    author_keys = doc.get("author_key") or []
    if isinstance(authors_raw, str):
        authors_raw = [authors_raw]
    if isinstance(author_keys, str):
        author_keys = [author_keys]
    authors = []
    for i, name in enumerate(authors_raw):
        key = author_keys[i] if i < len(author_keys) else None
        if isinstance(key, str) and key.startswith("/authors/"):
            key = key.replace("/authors/", "").strip()
        authors.append({"name": str(name), "key": key})

    first_publish_year = None
    for k in ("first_publish_year", "first_publish_year_i"):
        if doc.get(k) is not None:
            try:
                first_publish_year = int(doc[k])
                break
            except (TypeError, ValueError):
                pass

    subjects = _normalize_subjects(doc.get("subject") or doc.get("subjects"))

    cover_i = doc.get("cover_i")
    cover_url = _cover_url(cover_i)

    isbn_raw = doc.get("isbn")
    if isinstance(isbn_raw, str):
        isbn_list = [isbn_raw] if isbn_raw.strip() else []
    elif isinstance(isbn_raw, list):
        isbn_list = [str(x).strip() for x in isbn_raw[:15] if x and str(x).strip()]
    else:
        isbn_list = []

    return {
        "work_id": work_id,
        "title": (doc.get("title") or "Unknown").strip(),
        "authors": authors,
        "first_publish_year": first_publish_year,
        "subjects": subjects,
        "cover_url": cover_url,
        "source": source,
        "isbn": isbn_list,
    }


def normalize_work(work_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Turn work JSON into our book shape."""
    title = data.get("title") or "Unknown"
    if isinstance(title, dict):
        title = title.get("value", "Unknown")

    authors = []
    for a in data.get("authors", [])[:10]:
        key = a.get("author", {}).get("key", "") if isinstance(a.get("author"), dict) else a.get("key", "")
        if isinstance(key, str) and "/" in key:
            key = key.split("/")[-1]
        name = "Unknown"
        authors.append({"name": name, "key": key})

    desc = data.get("description")
    if isinstance(desc, dict):
        desc = desc.get("value") or desc.get("description")
    if isinstance(desc, str):
        pass
    else:
        desc = None

    subjects = _normalize_subjects(data.get("subjects"))

    cover_i = None
    for c in ("covers", "cover"):
        v = data.get(c)
        if isinstance(v, list) and v:
            cover_i = v[0]
            break
        if isinstance(v, int):
            cover_i = v
            break

    first_publish_year = None
    for k in ("first_publish_date", "first_publish_year"):
        v = data.get(k)
        if v is not None:
            if isinstance(v, (int, float)):
                first_publish_year = int(v)
                break
            if isinstance(v, str):
                m = re.search(r"\d{4}", v)
                if m:
                    first_publish_year = int(m.group(0))
                    break

    isbn_list = []
    for id_type in ("isbn_10", "isbn_13", "isbn"):
        ids = data.get(id_type)
        if isinstance(ids, list):
            isbn_list.extend([str(x).strip() for x in ids[:10] if x and str(x).strip()])
        elif ids:
            isbn_list.append(str(ids).strip())
    identifiers = data.get("identifiers") or {}
    for id_type in ("isbn_10", "isbn_13", "isbn"):
        ids = identifiers.get(id_type)
        if isinstance(ids, list):
            isbn_list.extend([str(x).strip() for x in ids[:10] if x and str(x).strip()])
        elif ids:
            isbn_list.append(str(ids).strip())
    isbn_list = list(dict.fromkeys(isbn_list))[:15]

    return {
        "work_id": work_id,
        "title": str(title).strip(),
        "authors": authors,
        "first_publish_year": first_publish_year,
        "subjects": subjects,
        "cover_url": _cover_url(cover_i),
        "source": "work",
        "description": desc,
        "isbn": isbn_list,
    }


async def search(q: str, limit: int = 20) -> list[dict[str, Any]]:
    """Search Open Library; returns normalized book list."""
    cache_key = f"search:{q}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    fields = "key,title,author_name,author_key,first_publish_year,subject,cover_i,isbn"
    params = {"q": q, "limit": limit, "fields": fields}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(f"{BASE}/search.json", params=params)
            r.raise_for_status()
            data = r.json()
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        raise RuntimeError(f"Open Library search failed: {e}") from e

    docs = data.get("docs", [])
    out = []
    for doc in docs:
        key = doc.get("key", "")
        if isinstance(key, str) and key.startswith("/works/"):
            work_id = key.replace("/works/", "").strip()
        else:
            work_id = key
        out.append(normalize_search_item(doc, "search"))

    _cache_set(cache_key, out)
    return out


async def get_work(work_id: str) -> dict[str, Any]:
    """Fetch work by ID; returns normalized work."""
    # strip /works/ prefix if present
    wid = work_id.replace("/works/", "").strip()
    cache_key = f"work:{wid}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(f"{BASE}/works/{wid}.json")
            r.raise_for_status()
            data = r.json()
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        raise RuntimeError(f"Open Library work fetch failed: {e}") from e

    out = normalize_work(wid, data)
    _cache_set(cache_key, out)
    return out


async def get_subject_works(subject: str, limit: int = 50) -> list[dict[str, Any]]:
    """Fetch works for a subject; returns normalized list."""
    subject_clean = subject.strip().lower().replace(" ", "_")
    cache_key = f"subject:{subject_clean}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{BASE}/subjects/{subject_clean}.json",
                params={"limit": limit},
            )
            r.raise_for_status()
            data = r.json()
    except (httpx.HTTPError, httpx.TimeoutException) as e:
        raise RuntimeError(f"Open Library subject fetch failed: {e}") from e

    works = data.get("works", [])
    out = []
    for w in works:
        key = w.get("key", "")
        if isinstance(key, str) and key.startswith("/works/"):
            wid = key.replace("/works/", "").strip()
        else:
            wid = key
        # subject API returns minimal work info; build minimal normalized item
        authors = []
        for a in w.get("authors", [])[:5]:
            auth = a if isinstance(a, dict) else {}
            k = auth.get("key", "")
            if isinstance(k, str) and "/" in k:
                k = k.split("/")[-1]
            authors.append({"name": auth.get("name", "Unknown"), "key": k})
        cover_i = None
        if "cover_id" in w:
            cover_i = w["cover_id"]
        first_publish_year = w.get("first_publish_year")
        subjects = _normalize_subjects([subject_clean.replace("_", " ")])
        out.append({
            "work_id": wid,
            "title": (w.get("title") or "Unknown").strip(),
            "authors": authors,
            "first_publish_year": first_publish_year,
            "subjects": subjects,
            "cover_url": _cover_url(cover_i),
            "source": "subject",
            "isbn": [],
        })
    _cache_set(cache_key, out)
    return out
