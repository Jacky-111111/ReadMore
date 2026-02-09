"""
ReadMore: FastAPI backend serving search, work details, and content-based recommendations.
"""
from collections import defaultdict
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from services.openlibrary import (
    get_subject_works,
    get_work,
    search as ol_search,
)

app = FastAPI(title="ReadMore", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files first so /static/* is served
app.mount("/static", StaticFiles(directory="static"), name="static")


# ---------- Request/Response models ----------


class RecommendProfile(BaseModel):
    likedWorks: list[str] = []
    dislikedWorks: list[str] = []
    savedWorks: list[str] = []
    profile: dict = {}  # subjects, authors, length, era


# ---------- Routes ----------


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the main SPA."""
    path = Path(__file__).resolve().parent / "templates" / "index.html"
    return FileResponse(path)


@app.get("/api/search")
async def api_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=50),
):
    """Search Open Library; returns normalized book list."""
    try:
        books = await ol_search(q, limit=limit)
        return {"results": books}
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/work/{work_id}")
async def api_work(work_id: str):
    """Get work details by ID."""
    try:
        work = await get_work(work_id)
        return work
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))


def _score_candidate(
    item: dict,
    profile: dict,
    seen: set[str],
) -> tuple[float, list[str]]:
    """Score one candidate; return (score, reasons). Excludes seen works."""
    work_id = (item.get("work_id") or "").strip()
    if work_id in seen:
        return -1.0, []

    subjects_weights = profile.get("subjects") or {}
    authors_weights = profile.get("authors") or {}
    era_weights = profile.get("era") or {}

    score = 0.0
    reasons = []

    # Subject match
    item_subjects = [s.strip().lower() for s in (item.get("subjects") or [])]
    for sub in item_subjects:
        w = subjects_weights.get(sub) or subjects_weights.get(sub.replace(" ", "_"))
        if w and w > 0:
            score += 2 * w
            if sub not in [r.split(":")[1].strip().split(" ")[0] for r in reasons if "interest" in r]:
                reasons.append(f"matches your interest: {sub} (+{w})")
    reasons = reasons[:2]  # top 2 subject reasons

    # Author match
    for a in item.get("authors") or []:
        key = (a.get("key") or "").strip()
        if key and key in authors_weights:
            w = authors_weights[key]
            if w > 0:
                score += 3 * w
                reasons.append(f"author you like: {a.get('name', 'Unknown')} (+{w})")

    # Era
    year = item.get("first_publish_year")
    if year is not None:
        era = "classic" if year < 1980 else "modern"
        w = era_weights.get(era, 0) or 0
        if w > 0:
            score += 0.5 * w

    return score, reasons


@app.post("/api/recommend")
async def api_recommend(body: RecommendProfile):
    """Content-based recommendations from user profile."""
    profile = body.profile or {}
    liked = set((body.likedWorks or [])[:500])
    disliked = set((body.dislikedWorks or [])[:500])
    saved = set((body.savedWorks or [])[:500])
    seen = liked | disliked | saved

    subjects_weights = profile.get("subjects") or {}
    authors_weights = profile.get("authors") or {}
    # Top subjects (positive weight only), cap at 5
    top_subjects = sorted(
        [s for s, w in subjects_weights.items() if w and w > 0],
        key=lambda s: -(subjects_weights.get(s, 0) or 0),
    )[:5]
    if not top_subjects:
        return {"recommendations": [], "message": "Like or save some books to get recommendations."}

    # Candidate pool from subjects
    all_candidates: list[dict] = []
    subject_to_items: dict[str, list[dict]] = defaultdict(list)
    try:
        for sub in top_subjects:
            sub_slug = sub.strip().lower().replace(" ", "_")
            works = await get_subject_works(sub_slug, limit=50)
            for w in works:
                wid = (w.get("work_id") or "").strip()
                if wid and wid not in seen:
                    w["_first_subject"] = sub
                    subject_to_items[sub].append(w)
                    all_candidates.append(w)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    # Deduplicate by work_id (keep first occurrence to preserve subject ordering)
    by_id: dict[str, dict] = {}
    for c in all_candidates:
        wid = (c.get("work_id") or "").strip()
        if wid and wid not in by_id:
            by_id[wid] = c
    candidates = list(by_id.values())

    # Score and sort
    scored: list[tuple[float, list[str], dict]] = []
    for item in candidates:
        s, reasons = _score_candidate(item, profile, seen)
        if s >= 0:
            scored.append((s, reasons, item))

    scored.sort(key=lambda x: -x[0])

    # Diversity: at most 12 per top subject in final list (for frontend pagination)
    MAX_PER_SUBJECT = 12
    MAX_RECOMMENDATIONS = 60
    subject_count: dict[str, int] = defaultdict(int)
    final: list[dict] = []
    for score, reasons, item in scored:
        if len(final) >= MAX_RECOMMENDATIONS:
            break
        first_sub = item.get("_first_subject") or (item.get("subjects") or [""])[0]
        if subject_count[first_sub] >= MAX_PER_SUBJECT:
            continue
        subject_count[first_sub] += 1
        item_copy = {k: v for k, v in item.items() if k != "_first_subject"}
        item_copy["score"] = round(score, 1)
        item_copy["reasons"] = reasons[:3]
        final.append(item_copy)

    return {"recommendations": final}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
