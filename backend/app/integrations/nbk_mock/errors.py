class GatewayError(Exception):
    code = "INTERNAL_SERVICE_ERROR"


class GatewayUnavailableError(GatewayError):
    code = "GATEWAY_UNAVAILABLE"


class GatewayTimeoutError(GatewayError):
    code = "TIMEOUT"


class MalformedResponseError(GatewayError):
    code = "MALFORMED_RESPONSE"


class ExpiredResultError(GatewayError):
    code = "EXPIRED_RESULT"


class UnverifiedResponseError(GatewayError):
    code = "UNVERIFIED_RESPONSE"
