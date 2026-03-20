from fastapi import FastAPI, HTTPException, status, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy import create_engine, Column, String, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from fastapi.middleware.cors import CORSMiddleware
import uuid
import jwt
import time

# --- 1. 初期設定 ---
app = FastAPI(title="Sefirot Backend API", version="0.1.0", docs_url="/api/v1/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # フロントエンドのURLを許可
    allow_credentials=True,
    allow_methods=["*"], # 全てのリクエストメソッド（GET, POSTなど）を許可
    allow_headers=["*"], # 全てのヘッダーを許可
)

SQLALCHEMY_DATABASE_URL = "sqlite:///./sefirot.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__ident="2b")
SECRET_KEY = "sefirot_hackathon_super_secret_key"
ALGORITHM = "HS256"

# --- 2. モデル ---
class DBUser(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    display_name = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- 3. スキーマ ---
class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str

class SigninRequest(BaseModel):
    email: EmailStr
    password: str

class UserSchema(BaseModel):
    id: str
    email: EmailStr
    display_name: str
    created_at: datetime

    class Config:
        from_attributes = True

class AuthResponse(BaseModel):
    user: UserSchema
    access_token: str
    refresh_token: str

# --- 4. ヘルパー関数 (トークン生成) ---
def create_tokens(user_id: str):
    # JWTの有効期限を数値(int)で計算する（500エラー対策の肝）
    access_token_expires = int(time.time() + 3600) # 1時間後
    refresh_token_expires = int(time.time() + 3600 * 24 * 7) # 7日後

    access_token = jwt.encode(
        {"sub": user_id, "exp": access_token_expires},
        SECRET_KEY,
        algorithm=ALGORITHM
    )
    refresh_token = jwt.encode(
        {"sub": user_id, "type": "refresh", "exp": refresh_token_expires},
        SECRET_KEY,
        algorithm=ALGORITHM
    )
    return access_token, refresh_token

# --- 5. API ---

@app.post("/api/v1/auth/signup", response_model=AuthResponse, tags=["Auth"])
def signup(request: SignupRequest, db: Session = Depends(get_db)):
    db_user = db.query(DBUser).filter(DBUser.email == request.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="このメールアドレスは既に登録されています")

    hashed_pw = pwd_context.hash(request.password)
    new_user = DBUser(
        email=request.email,
        hashed_password=hashed_pw,
        display_name=request.display_name
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # トークン生成
    access_token, refresh_token = create_tokens(new_user.id)

    return AuthResponse(user=new_user, access_token=access_token, refresh_token=refresh_token)

@app.post("/api/v1/auth/signin", response_model=AuthResponse, tags=["Auth"])
def signin(request: SigninRequest, db: Session = Depends(get_db)):
    user = db.query(DBUser).filter(DBUser.email == request.email).first()
    if not user or not pwd_context.verify(request.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="メールアドレスまたはパスワードが間違っています")

    access_token, refresh_token = create_tokens(user.id)

    return AuthResponse(user=user, access_token=access_token, refresh_token=refresh_token)
