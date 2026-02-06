import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from .db import Base, engine, get_db
from .models import Reply, Thread, User
from .schemas import (
    AuthResponse,
    ReplyCreate,
    ReplyCreateResponse,
    ReplyRead,
    ThreadCreate,
    ThreadCreateResponse,
    ThreadRead,
    UserCreate,
    UserRead,
    UserSignin,
)

app = FastAPI(title="Anonymous Threads API")

cors_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
jwt_secret = os.getenv("JWT_SECRET", "dev-secret")
jwt_algorithm = "HS256"
jwt_expiry_hours = 24 * 7


def create_access_token(user: User) -> str:
    expires = datetime.now(timezone.utc) + timedelta(hours=jwt_expiry_hours)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "email": user.email,
        "exp": expires,
    }
    return jwt.encode(payload, jwt_secret, algorithm=jwt_algorithm)


def ensure_password_length(password: str) -> str:
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password too long (max 72 bytes).")
    return password


def get_current_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authentication token.")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, jwt_secret, algorithms=[jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token.") from exc
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")
    user = db.get(User, int(user_id))
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")
    return user


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


@app.post("/auth/signup", response_model=AuthResponse, status_code=201)
def signup(payload: UserCreate, db: Session = Depends(get_db)):
    username = payload.username.strip()
    email = payload.email.strip().lower()
    password = ensure_password_length(payload.password)
    if db.execute(select(User).where(User.username == username)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already exists.")
    if db.execute(select(User).where(User.email == email)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already exists.")

    user = User(username=username, email=email, password_hash=pwd_context.hash(password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return AuthResponse(access_token=create_access_token(user), user=UserRead.model_validate(user))


@app.post("/auth/signin", response_model=AuthResponse)
def signin(payload: UserSignin, db: Session = Depends(get_db)):
    email = payload.email.strip().lower() if payload.email else None
    username = payload.username.strip() if payload.username else None
    password = ensure_password_length(payload.password)
    user = None
    if email:
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user and username:
        user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if not user or not pwd_context.verify(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    return AuthResponse(access_token=create_access_token(user), user=UserRead.model_validate(user))


@app.get("/auth/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)):
    return UserRead.model_validate(current_user)


@app.get("/threads", response_model=list[ThreadRead])
def list_threads(db: Session = Depends(get_db)):
    threads = (
        db.execute(select(Thread).options(selectinload(Thread.replies)).order_by(Thread.created_at.desc()))
        .scalars()
        .all()
    )
    return threads


@app.post("/threads", response_model=ThreadCreateResponse, status_code=201)
def create_thread(
    payload: ThreadCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    author_name = None if payload.is_anonymous else (payload.author_name or current_user.username)
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
def create_reply(
    thread_id: int,
    payload: ReplyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    thread = db.get(Thread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")

    if payload.parent_id is not None:
        parent_reply = db.get(Reply, payload.parent_id)
        if not parent_reply or parent_reply.thread_id != thread_id:
            raise HTTPException(status_code=400, detail="Invalid parent reply.")

    author_name = None if payload.is_anonymous else (payload.author_name or current_user.username)
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
