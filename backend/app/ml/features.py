"""Shared training/serving feature contract; missing measurements use -1."""

from dataclasses import dataclass
from typing import Final

FEATURE_NAMES: Final = (
    "amount_ratio",
    "night_hour",
    "new_recipient",
    "active_call",
    "deposit_withdrawal",
    "fan_in_velocity",
    "transit_ratio",
    "paste_detected",
    "typing_speed_cps",
    "hesitation_ms",
    "hesitation_count",
    "new_device",
)
FEATURE_LABELS: Final = (
    ("Соманың әдеттегі сомаға қатынасы", "Отношение суммы к обычной"),
    ("Түнгі уақыт", "Ночное время"),
    ("Жаңа алушы", "Новый получатель"),
    ("Белсенді қоңырау", "Активный звонок"),
    ("Депозиттен алу", "Снятие с депозита"),
    ("30 минуттағы жіберушілер саны", "Число отправителей за 30 минут"),
    ("Транзиттік қатынас", "Транзитное отношение"),
    ("Алмасу буферінен қою", "Вставка из буфера обмена"),
    ("Теру жылдамдығы", "Скорость ввода"),
    ("Кідіріс ұзақтығы", "Длительность пауз"),
    ("Кідірістер саны", "Число пауз"),
    ("Жаңа құрылғы", "Новое устройство"),
)


@dataclass(frozen=True, slots=True)
class Features:
    amount_ratio: float = 1.0
    night_hour: bool = False
    new_recipient: bool = False
    active_call: bool = False
    deposit_withdrawal: bool = False
    fan_in_velocity: int = 1
    transit_ratio: float = 0.0
    paste_detected: bool = False
    typing_speed_cps: float = -1.0
    hesitation_ms: int = -1
    hesitation_count: int = 0
    new_device: bool = False

    def vector(self) -> tuple[float, ...]:
        return (
            min(100.0, max(0.0, self.amount_ratio)),
            float(self.night_hour),
            float(self.new_recipient),
            float(self.active_call),
            float(self.deposit_withdrawal),
            float(min(100, max(0, self.fan_in_velocity))),
            min(3.0, max(0.0, self.transit_ratio)),
            float(self.paste_detected),
            min(100.0, max(-1.0, self.typing_speed_cps)),
            float(min(300_000, max(-1, self.hesitation_ms))),
            float(min(100, max(0, self.hesitation_count))),
            float(self.new_device),
        )
