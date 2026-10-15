"""
Real-Time Leaderboard System - FastAPI Backend
Features:
- SQLAlchemy ORM with SQLite (WAL mode enabled for concurrent performance)
- RESTful API for participants, dynamic scoring, filtering, search, and statistics
- WebSocket broadcasting for instant multi-client live leaderboard synchronization
- Built-in static file serving and CORS for standalone / hybrid deployments
- Automatic database seeding with realistic data on startup
"""

import os
import json
import asyncio
from datetime import datetime
from typing import List, Optional, Literal
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from sqlalchemy import create_engine, Column, Integer, String, DateTime, event
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# ---------------------------------------------------------
# Path configurations
# ---------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = BASE_DIR / "index.html"

DATA_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "leaderboard.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

# ---------------------------------------------------------
# Database Engine & SQLAlchemy Models
# ---------------------------------------------------------
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

# Enable SQLite WAL mode and synchronous settings for speed & safety
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Participant(Base):
    __tablename__ = "participants"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False, index=True)
    category = Column(String(50), nullable=False, default="General", index=True)
    score = Column(Integer, nullable=False, default=0, index=True)
    avatar = Column(String(500), nullable=True)
    badge = Column(String(50), nullable=True)
    streak = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, rank: Optional[int] = None) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "score": self.score,
            "avatar": self.avatar or f"https://api.dicebear.com/7.x/bottts/svg?seed={self.name}",
            "badge": self.badge or "",
            "streak": self.streak,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if rank is not None:
            data["rank"] = rank
        return data


Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------
class ParticipantCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    category: str = Field(default="General", max_length=50)
    initial_score: int = Field(default=0)
    avatar: Optional[str] = None
    badge: Optional[str] = None


class ParticipantUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    category: Optional[str] = Field(None, max_length=50)
    avatar: Optional[str] = None
    badge: Optional[str] = None


class ScoreAction(BaseModel):
    mode: Literal["increment", "decrement", "set"] = "increment"
    delta: Optional[int] = 1
    value: Optional[int] = None


# ---------------------------------------------------------
# WebSocket Connection Manager
# ---------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            self.active_connections.append(websocket)
        await self.broadcast_user_count()

    async def disconnect(self, websocket: WebSocket):
        async with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)
        await self.broadcast_user_count()

    async def broadcast(self, message: dict):
        dead_connections = []
        # JSON encode once for efficiency
        data_text = json.dumps(message)
        async with self._lock:
            for connection in self.active_connections:
                try:
                    await connection.send_text(data_text)
                except Exception:
                    dead_connections.append(connection)

            for dead in dead_connections:
                if dead in self.active_connections:
                    self.active_connections.remove(dead)

    async def broadcast_user_count(self):
        async with self._lock:
            count = len(self.active_connections)
        await self.broadcast({"event": "viewer_count", "count": count})


manager = ConnectionManager()

# ---------------------------------------------------------
# FastAPI App Initialization
# ---------------------------------------------------------
app = FastAPI(
    title="Real-Time Leaderboard API",
    description="Full-stack real-time Python leaderboard engine with SQLite/SQLAlchemy and WebSockets",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def query_leaderboard(db: Session, category: Optional[str] = None, search: Optional[str] = None) -> List[dict]:
    query = db.query(Participant)
    if category and category.lower() != "all":
        query = query.filter(Participant.category.ilike(category))
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(
            (Participant.name.ilike(term)) | (Participant.category.ilike(term))
        )
    # Order by score descending, then updated_at ascending as tiebreaker
    participants = query.order_by(Participant.score.desc(), Participant.updated_at.asc()).all()
    return [p.to_dict(rank=idx + 1) for idx, p in enumerate(participants)]


def get_all_ranked(db: Session) -> List[dict]:
    participants = db.query(Participant).order_by(
        Participant.score.desc(), Participant.updated_at.asc()
    ).all()
    return [p.to_dict(rank=idx + 1) for idx, p in enumerate(participants)]


# ---------------------------------------------------------
# Seed Data Handler
# ---------------------------------------------------------
SAMPLE_PARTICIPANTS = [
    {"name": "Elena Rostova", "category": "Engineering", "score": 940, "badge": "🔥 Grandmaster", "streak": 7, "avatar": "https://api.dicebear.com/7.x/bottts/svg?seed=Elena"},
    {"name": "Kai Thorne", "category": "Data Science", "score": 885, "badge": "⚡ Speedster", "streak": 5, "avatar": "https://api.dicebear.com/7.x/bottts/svg?seed=Kai"},
    {"name": "Aria Chen", "category": "Design", "score": 820, "badge": "✨ Visionary", "streak": 4, "avatar": "https://api.dicebear.com/7.x/bottts/svg?seed=Aria"},
    {"name": "Mateo Silva", "category": "Product", "score": 760, "badge": "🎯 Strategist", "streak": 3, "avatar": "https://api.dicebear.com/7.x/bottts/svg?seed=Mateo"},
    {"name": "Zoe Vance", "category": "Security", "score": 710, "badge": "🛡️ Guardian", "streak": 6, "avatar": "https://api.dicebear.com/7.x/bottts/svg?seed=Zoe"},
    {"name": "Darius Knox", "category": "Engineering", "score": 680, "badge": "🚀 Climber", "streak": 2, "avatar": "https://api.dicebear.com/7.x/bottts/svg?seed=Darius"},
    {"name": "Nova Miller", "category": "Marketing", "score": 630, "badge": "🌟 Rising Star", "streak": 4, "avatar": "https://api.dicebear.com/7.x/bottts/svg?seed=Nova"},
    {"name": "Liam Gallagher", "category": "Gaming", "score": 590, "badge": "🎮 Contender", "streak": 1, "avatar": "https://api.dicebear.com/7.x/bottts/svg?seed=Liam"},
]


def seed_database_if_empty():
    db = SessionLocal()
    try:
        count = db.query(Participant).count()
        if count == 0:
            for item in SAMPLE_PARTICIPANTS:
                p = Participant(
                    name=item["name"],
                    category=item["category"],
                    score=item["score"],
                    badge=item.get("badge"),
                    streak=item.get("streak", 0),
                    avatar=item.get("avatar"),
                )
                db.add(p)
            db.commit()
    finally:
        db.close()


@app.on_event("startup")
def on_startup():
    seed_database_if_empty()


# ---------------------------------------------------------
# REST API Endpoints
# ---------------------------------------------------------
@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "Real-Time Leaderboard API",
        "timestamp": datetime.utcnow().isoformat()
    }


@app.get("/api/participants")
def list_participants(
    category: Optional[str] = Query(None, description="Filter by category"),
    search: Optional[str] = Query(None, description="Search by name or category")
):
    db = SessionLocal()
    try:
        return query_leaderboard(db, category=category, search=search)
    finally:
        db.close()


@app.post("/api/participants", status_code=status.HTTP_201_CREATED)
async def create_participant(payload: ParticipantCreate):
    db = SessionLocal()
    try:
        avatar = payload.avatar or f"https://api.dicebear.com/7.x/bottts/svg?seed={payload.name}"
        p = Participant(
            name=payload.name.strip(),
            category=payload.category.strip() or "General",
            score=payload.initial_score,
            avatar=avatar,
            badge=payload.badge,
            streak=1 if payload.initial_score > 0 else 0
        )
        db.add(p)
        db.commit()
        db.refresh(p)
        created_data = p.to_dict()
        leaderboard = get_all_ranked(db)
    finally:
        db.close()

    # Broadcast event
    await manager.broadcast({
        "event": "participant_added",
        "participant": created_data,
        "leaderboard": leaderboard,
        "timestamp": datetime.utcnow().isoformat()
    })

    return created_data


@app.patch("/api/participants/{participant_id}/score")
async def update_score(participant_id: int, action: ScoreAction):
    db = SessionLocal()
    try:
        p = db.query(Participant).filter(Participant.id == participant_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Participant not found")

        old_score = p.score
        if action.mode == "increment":
            delta = action.delta if action.delta is not None else 1
            p.score += delta
            p.streak = (p.streak or 0) + 1
        elif action.mode == "decrement":
            delta = action.delta if action.delta is not None else 1
            p.score = max(0, p.score - delta)
            p.streak = 0
        elif action.mode == "set":
            if action.value is None:
                raise HTTPException(status_code=400, detail="Value must be provided for 'set' mode")
            p.score = max(0, action.value)
            if p.score > old_score:
                p.streak = (p.streak or 0) + 1

        p.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(p)

        updated_data = p.to_dict()
        leaderboard = get_all_ranked(db)
    finally:
        db.close()

    # Broadcast real-time score update
    await manager.broadcast({
        "event": "score_updated",
        "participant": updated_data,
        "old_score": old_score,
        "new_score": p.score,
        "leaderboard": leaderboard,
        "timestamp": datetime.utcnow().isoformat()
    })

    return updated_data


@app.put("/api/participants/{participant_id}")
async def update_participant_details(participant_id: int, payload: ParticipantUpdate):
    db = SessionLocal()
    try:
        p = db.query(Participant).filter(Participant.id == participant_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Participant not found")

        if payload.name is not None:
            p.name = payload.name.strip()
        if payload.category is not None:
            p.category = payload.category.strip()
        if payload.avatar is not None:
            p.avatar = payload.avatar.strip()
        if payload.badge is not None:
            p.badge = payload.badge.strip()

        p.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(p)
        updated_data = p.to_dict()
        leaderboard = get_all_ranked(db)
    finally:
        db.close()

    await manager.broadcast({
        "event": "participant_updated",
        "participant": updated_data,
        "leaderboard": leaderboard,
        "timestamp": datetime.utcnow().isoformat()
    })

    return updated_data


@app.delete("/api/participants/{participant_id}")
async def delete_participant(participant_id: int):
    db = SessionLocal()
    try:
        p = db.query(Participant).filter(Participant.id == participant_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="Participant not found")
        deleted_name = p.name
        db.delete(p)
        db.commit()
        leaderboard = get_all_ranked(db)
    finally:
        db.close()

    await manager.broadcast({
        "event": "participant_deleted",
        "id": participant_id,
        "name": deleted_name,
        "leaderboard": leaderboard,
        "timestamp": datetime.utcnow().isoformat()
    })

    return {"message": f"Participant {deleted_name} deleted successfully"}


@app.post("/api/reset")
async def reset_leaderboard():
    db = SessionLocal()
    try:
        db.query(Participant).delete()
        for item in SAMPLE_PARTICIPANTS:
            p = Participant(
                name=item["name"],
                category=item["category"],
                score=item["score"],
                badge=item.get("badge"),
                streak=item.get("streak", 0),
                avatar=item.get("avatar"),
            )
            db.add(p)
        db.commit()
        leaderboard = get_all_ranked(db)
    finally:
        db.close()

    await manager.broadcast({
        "event": "leaderboard_reset",
        "leaderboard": leaderboard,
        "timestamp": datetime.utcnow().isoformat()
    })

    return {"message": "Leaderboard reset to sample state", "leaderboard": leaderboard}


@app.get("/api/stats")
def get_stats():
    db = SessionLocal()
    try:
        participants = db.query(Participant).all()
        total_count = len(participants)
        if total_count == 0:
            return {
                "total_participants": 0,
                "top_score": 0,
                "average_score": 0,
                "categories": {},
                "top_category": "None"
            }

        scores = [p.score for p in participants]
        top_score = max(scores)
        avg_score = round(sum(scores) / total_count, 1)

        category_counts = {}
        for p in participants:
            cat = p.category or "General"
            category_counts[cat] = category_counts.get(cat, 0) + 1

        top_category = max(category_counts, key=category_counts.get) if category_counts else "General"

        return {
            "total_participants": total_count,
            "top_score": top_score,
            "average_score": avg_score,
            "categories": category_counts,
            "top_category": top_category
        }
    finally:
        db.close()


@app.get("/api/export")
def export_leaderboard(format: str = Query("json", pattern="^(json|csv)$")):
    db = SessionLocal()
    try:
        participants = get_all_ranked(db)
    finally:
        db.close()

    if format == "csv":
        import io
        import csv
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Rank", "ID", "Name", "Category", "Score", "Badge", "Streak", "Updated At"])
        for p in participants:
            writer.writerow([
                p.get("rank"),
                p.get("id"),
                p.get("name"),
                p.get("category"),
                p.get("score"),
                p.get("badge"),
                p.get("streak"),
                p.get("updated_at")
            ])
        csv_data = output.getvalue()
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=leaderboard.csv"}
        )

    return Response(
        content=json.dumps(participants, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=leaderboard.json"}
    )


# ---------------------------------------------------------
# Real-Time WebSocket Connection
# ---------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    # Send initial snapshot upon connection
    db = SessionLocal()
    try:
        initial_leaderboard = get_all_ranked(db)
    finally:
        db.close()

    await websocket.send_text(json.dumps({
        "event": "snapshot",
        "leaderboard": initial_leaderboard,
        "timestamp": datetime.utcnow().isoformat()
    }))

    try:
        while True:
            # Keep connection alive & handle incoming pings
            data = await websocket.receive_text()
            try:
                parsed = json.loads(data)
                if parsed.get("action") == "ping":
                    await websocket.send_text(json.dumps({"event": "pong"}))
            except Exception:
                pass
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception:
        await manager.disconnect(websocket)


# ---------------------------------------------------------
# Static File Mounting & Single Page Dashboard
# ---------------------------------------------------------
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def serve_index():
    if INDEX_FILE.exists():
        return FileResponse(str(INDEX_FILE))
    return {"message": "Real-Time Leaderboard API is active. index.html is being prepared."}


# ---------------------------------------------------------
# Direct Execution Runner
# ---------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)
