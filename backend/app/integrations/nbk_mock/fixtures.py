from app.integrations.nbk_mock.schemas import GatewayStatus

# Not IIN, PAN, IBAN, phone numbers, or an official NBK list.
SANDBOX: dict[str, GatewayStatus] = {
    "SYN-CLEAR-001": GatewayStatus.CLEAR,
    "SYN-REVIEW-001": GatewayStatus.INDICATORS,
}
