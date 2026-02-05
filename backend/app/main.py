import os
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from .db import Base, engine, get_db
from .models import Reply, Thread
from .schemas import ReplyCreate, ReplyCreateResponse, ReplyRead, ThreadCreate, ThreadCreateResponse, ThreadRead

app = FastAPI(title="Anonymous Threads API")

cors_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    # Lightweight migration for existing SQLite DBs created before ownership tokens were added.
    with engine.begin() as conn:
        thread_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(threads)"))}
        if "owner_token" not in thread_columns:
            conn.execute(text("ALTER TABLE threads ADD COLUMN owner_token VARCHAR(64) NOT NULL DEFAULT ''"))

        reply_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(replies)"))}
        if "owner_token" not in reply_columns:
            conn.execute(text("ALTER TABLE replies ADD COLUMN owner_token VARCHAR(64) NOT NULL DEFAULT ''"))


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/threads", response_model=list[ThreadRead])
def list_threads(db: Session = Depends(get_db)):
    threads = (
        db.execute(select(Thread).options(selectinload(Thread.replies)).order_by(Thread.created_at.desc()))
        .scalars()
        .all()
    )
    return threads


@app.post("/threads", response_model=ThreadCreateResponse, status_code=201)
def create_thread(payload: ThreadCreate, db: Session = Depends(get_db)):
    author_name = None if payload.is_anonymous else payload.author_name
    owner_token = payload.owner_token or secrets.token_hex(16)
    thread = Thread(
        title=payload.title.strip(),
        body=payload.body.strip(),
        author_name=author_name.strip() if author_name else None,
        is_anonymous=payload.is_anonymous,
        owner_token=owner_token,
    )
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return thread


@app.post("/threads/{thread_id}/replies", response_model=ReplyCreateResponse, status_code=201)
def create_reply(thread_id: int, payload: ReplyCreate, db: Session = Depends(get_db)):
    thread = db.get(Thread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")

    if payload.parent_id is not None:
        parent_reply = db.get(Reply, payload.parent_id)
        if not parent_reply or parent_reply.thread_id != thread_id:
            raise HTTPException(status_code=400, detail="Invalid parent reply.")

    author_name = None if payload.is_anonymous else payload.author_name
    owner_token = payload.owner_token or secrets.token_hex(16)
    reply = Reply(
        thread_id=thread_id,
        parent_id=payload.parent_id,
        body=payload.body.strip(),
        author_name=author_name.strip() if author_name else None,
        is_anonymous=payload.is_anonymous,
        owner_token=owner_token,
    )
    db.add(reply)
    db.commit()
    db.refresh(reply)
    return reply


@app.delete("/threads/{thread_id}", status_code=204)
def delete_thread(
    thread_id: int,
    owner_token: str | None = Header(default=None, alias="X-Owner-Token"),
    db: Session = Depends(get_db),
):
    thread = db.get(Thread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    if not owner_token or owner_token != thread.owner_token:
        raise HTTPException(status_code=403, detail="You can only delete your own thread.")

    db.delete(thread)
    db.commit()


@app.delete("/threads/{thread_id}/replies/{reply_id}", status_code=204)
def delete_reply(
    thread_id: int,
    reply_id: int,
    owner_token: str | None = Header(default=None, alias="X-Owner-Token"),
    db: Session = Depends(get_db),
):
    reply = db.get(Reply, reply_id)
    if not reply or reply.thread_id != thread_id:
        raise HTTPException(status_code=404, detail="Reply not found.")
    if not owner_token or owner_token != reply.owner_token:
        raise HTTPException(status_code=403, detail="You can only delete your own reply.")

    all_replies = db.execute(select(Reply).where(Reply.thread_id == thread_id)).scalars().all()
    children_by_parent: dict[int, list[Reply]] = {}
    for item in all_replies:
        if item.parent_id is not None:
            children_by_parent.setdefault(item.parent_id, []).append(item)

    to_delete_ids: set[int] = set()
    stack = [reply.id]
    while stack:
        current = stack.pop()
        if current in to_delete_ids:
            continue
        to_delete_ids.add(current)
        stack.extend(child.id for child in children_by_parent.get(current, []))

    for item in all_replies:
        if item.id in to_delete_ids:
            db.delete(item)
    db.commit()
