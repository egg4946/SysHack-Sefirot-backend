from fastapi import FastAPI, HTTPException, status, Depends # type: ignore
from pydantic import BaseModel, EmailStr # type: ignore
from sqlalchemy import create_engine, Column, String, DateTime # type: ignore
from sqlalchemy.orm import declarative_base, sessionmaker, Session # type: ignore
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from fastapi.middleware.cors import CORSMiddleware # type: ignore
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials # type: ignore
security = HTTPBearer()
import uuid
import jwt # type: ignore
import time
import secrets # 招待コード生成用
import string

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

class DBCommunity(Base):
    __tablename__ = "communities"
    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    invite_code = Column(String, unique=True, index=True) # 参加用コード
    created_by = Column(String, nullable=False) # 作成者のユーザーID
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class DBCommunityMember(Base):
    __tablename__ = "community_members"
    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, index=True, nullable=False)
    community_id = Column(String, index=True, nullable=False)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user_id(auth: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(auth.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except:
        raise HTTPException(status_code=401, detail="無効なトークンです")

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

class CommunityCreateRequest(BaseModel):
    name: str

class CommunityResponse(BaseModel):
    id: str
    name: str
    invite_code: str
    created_by: str
    created_at: datetime

    class Config:
        from_attributes = True # SQLAlchemyのモデルをJSONに変換できるようにする魔法

class CommunityJoinRequest(BaseModel):
    invite_code: str

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

# コミュニティ作成
@app.post("/api/v1/community/create", response_model=CommunityResponse, tags=["Community"]) # ここに追記！
def create_community(
    request: CommunityCreateRequest,
    db: Session = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    # ...中身の処理はそのまま...
    code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))

    new_comm = DBCommunity(
        name=request.name,
        invite_code=code,
        created_by=current_user_id
    )
    db.add(new_comm)
    db.commit()
    db.refresh(new_comm)

    # メンバー登録
    member = DBCommunityMember(user_id=current_user_id, community_id=new_comm.id)
    db.add(member)
    db.commit()

    return new_comm

# コミュニティ参加
@app.post("/api/v1/community/join", tags=["Community"])
def join_community(
    request: CommunityJoinRequest,
    db: Session = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    # コードでコミュニティを探す
    comm = db.query(DBCommunity).filter(DBCommunity.invite_code == request.invite_code).first()
    if not comm:
        raise HTTPException(status_code=404, detail="招待コードが無効です")

    # 既に参加していないかチェック
    exists = db.query(DBCommunityMember).filter(
        DBCommunityMember.user_id == current_user_id,
        DBCommunityMember.community_id == comm.id
    ).first()

    if exists:
        return {"message": "既に参加しています", "community": CommunityResponse.from_orm(comm)}

    # メンバー登録
    member = DBCommunityMember(user_id=current_user_id, community_id=comm.id)
    db.add(member)
    db.commit()

    return {"message": "参加に成功しました", "community": CommunityResponse.from_orm(comm)}
