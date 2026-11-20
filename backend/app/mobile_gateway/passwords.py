import hashlib
import hmac
import re
import secrets

from pydantic import BaseModel, ConfigDict, Field, SecretStr


class PasswordLogin(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    login: str = Field(min_length=1, max_length=64)
    password: SecretStr = Field(min_length=1, max_length=128)


def derive(password: str, salt: str) -> str:
    return hashlib.scrypt(
        password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32
    ).hex()


def encode(password: str) -> str:
    salt = secrets.token_hex(16)
    return f"s1:{salt}:{derive(password, salt)}"


def valid_encoded(encoded: str) -> bool:
    return re.fullmatch(r"s1:[a-f0-9]{32}:[a-f0-9]{64}", encoded) is not None


def verify(password: str, encoded: str) -> bool:
    _, salt, expected = encoded.split(":")
    return hmac.compare_digest(derive(password, salt), expected)
