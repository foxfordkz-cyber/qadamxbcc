import socket

import pytest
from pydantic import ValidationError

from app.integrations.scam_check import MAX_TEXT, ScamCheckRequest, analyze, mask, normalize


@pytest.mark.parametrize(
    ("value", "code"),
    [
        ("Переведите деньги на безопасный счёт", "safe_account"),
        ("Ақшаны қауіпсіз шотқа аударыңыз", "safe_account"),
        ("Назовите код подтверждения из SMS", "credentials"),
        ("Растау кодын маған жіберіңіз", "credentials"),
        ("Установите AnyDesk для удаленного доступа", "remote_access"),
        ("Экранды көрсету үшін AnyDesk орнатыңыз", "remote_access"),
        ("Никому не говорите про этот перевод", "secrecy"),
        ("Ақша туралы ешкімге айтпаңыз", "secrecy"),
        ("Я сотрудник банка, отправьте деньги", "impersonation"),
        ("Банк қызметкері ақша аударуды сұрады", "impersonation"),
        ("Для получения приза внесите комиссию", "advance_fee"),
        ("Жүлде үшін алдын ала төлем жасаңыз", "advance_fee"),
        ("Переведите деньги на бeзопа\u200bсный счёт", "safe_account"),
        ("Не переводите деньги другим, а переведите на безопасный счет", "safe_account"),
        ("Ақша аудармаңыз, бірақ қауіпсіз шотқа аударыңыз", "safe_account"),
    ],
)
def test_explicit_bilingual_signals(value: str, code: str) -> None:
    result = analyze(ScamCheckRequest(text=value))
    assert code in {s.code for s in result.signals}
    assert result.advisory_only


@pytest.mark.parametrize(
    "text",
    [
        "Не переводите деньги на безопасный счет",
        "Никогда не сообщайте код подтверждения",
        "Ақшаны қауіпсіз шотқа аудармаңыз",
        "Құпиясөзді жібермеңіз",
        "Позвоню сотруднику банка завтра. Переведу книгу с казахского.",
        "Срочно принесите книгу в библиотеку",
        "Кездесу ертең сағат он екіде",
    ],
)
def test_warnings_or_unrelated_context_do_not_accuse(text: str) -> None:
    result = analyze(ScamCheckRequest(text=text))
    assert result.status != "signals_detected"
    assert "не доказывает безопасность" in result.limitation


def test_masking_and_response_never_contain_user_material(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("offline analyzer attempted a network connection")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    text = (
        "Сотрудник банка просит перевести деньги на безопасный счет. "
        "SYNTHETIC_PERSON email=demo@example.invalid token=SYNTHETIC_SECRET "
        "+7 (700) 000-00-00 KZ000000000000000000 0000 0000 0000 0000 "
        "https://example.invalid/private?password=synthetic"
    )
    masked, privacy = mask(text)
    assert set(privacy.masked_categories) == {"url", "email", "secret", "number", "iban"}
    for sentinel in ("synthetic_secret", "example.invalid", "700", "kz0000"):
        assert sentinel not in masked
    output = analyze(ScamCheckRequest(text=text)).model_dump_json()
    for sentinel in ("SYNTHETIC_PERSON", "SYNTHETIC_SECRET", "example.invalid", "KZ000"):
        assert sentinel not in output
    assert not privacy.external_ai_used
    assert not privacy.stored


@pytest.mark.parametrize("value", ["", "   ", "\u200b", "x" * (MAX_TEXT + 1)])
def test_bounded_input_and_redacted_python_errors(value: str) -> None:
    with pytest.raises(ValidationError) as exc:
        ScamCheckRequest(text=value)
    assert "input_value" not in str(exc.value)


def test_normalization_does_not_transliterate_latin_app_names() -> None:
    assert normalize("AnyDesk, бeзопасный, қaуіпсіз") == "anydesk, безопасный, қауіпсіз"


def test_deterministic_result_deduplicates_rules_and_does_not_echo() -> None:
    body = ScamCheckRequest(text="Назовите OTP. Назовите OTP. SYNTHETIC_MARKER", language="kk")
    first = analyze(body)
    assert first == analyze(body)
    assert len(first.signals) == 1
    assert "SYNTHETIC_MARKER" not in first.model_dump_json()
    assert "text" not in repr(body)
    assert first.language == "kk"


def test_masking_preserves_credential_context() -> None:
    result = analyze(ScamCheckRequest(text="Сообщите пароль: SYNTHETIC_SECRET"))
    assert [s.code for s in result.signals] == ["credentials"]
