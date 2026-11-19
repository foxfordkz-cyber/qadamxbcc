"""Lightweight demo capability issuance, without loading scoring/DB resources."""

import hashlib
import hmac
import time
import uuid
from typing import Literal

from pydantic import BaseModel

Role = Literal["owner", "soc", "simulator"]


class Principal(BaseModel):
    subject: uuid.UUID
    role: Role


def issue_token(principal: Principal, key: str, *, ttl: int = 900) -> str:
    if len(key) < 32 or not 1 <= ttl <= 3600:
        raise ValueError("invalid capability configuration")
    payload = f"{principal.role}:{principal.subject}:{int(time.time()) + ttl}"
    signature = hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{signature}"
