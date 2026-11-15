import os
import uuid

import pytest
from aiogram.fsm.storage.base import DefaultKeyBuilder, StorageKey
from aiogram.fsm.storage.redis import RedisStorage
from redis.asyncio import Redis


@pytest.mark.skipif(not os.getenv("BCC_TEST_REDIS_URL"), reason="Real Redis restart persistence")
async def test_guardian_draft_survives_storage_restart_with_ttl() -> None:
    url = os.environ["BCC_TEST_REDIS_URL"]
    prefix = "guardian-test-" + uuid.uuid4().hex
    builder = DefaultKeyBuilder(prefix=prefix, with_bot_id=True)
    key = StorageKey(bot_id=987, chat_id=123, user_id=123)
    redis: Redis = Redis.from_url(url)
    storage = RedisStorage(redis, key_builder=builder, state_ttl=900, data_ttl=900)
    draft = {"language": "kk", "report_key": str(uuid.uuid4()), "report_waiting": True}
    await storage.set_data(key, draft)
    assert 0 < await redis.ttl(builder.build(key, "data")) <= 900
    await storage.close()
    restored = RedisStorage(Redis.from_url(url), key_builder=builder, data_ttl=900)
    try:
        assert await restored.get_data(key) == draft
        foreign_bot = StorageKey(bot_id=988, chat_id=123, user_id=123)
        assert await restored.get_data(foreign_bot) == {}
        await restored.set_data(key, {})
        assert await restored.get_data(key) == {}
    finally:
        await restored.redis.delete(builder.build(key, "data"))
        await restored.close()
