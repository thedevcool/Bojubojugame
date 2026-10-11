from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    database_url: str = "sqlite+aiosqlite:///./boju.db"
    jwt_secret: str = Field(default="dev-only-change-me-dev-only-change-me", min_length=32)
    jwt_ttl_minutes: int = 360
    frontend_origin: str = "http://localhost:3000"
    public_frontend_url: str = "http://localhost:3000"
    log_level: str = "INFO"
    # Password-reset email (optional). Any SMTP works, e.g. Brevo free (300/day) or a Gmail app password.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    mail_from: str = "Boju Boju <no-reply@example.com>"
    # Ads (the only real money in the game: advertisers pay with Paystack; game naira is separate)
    paystack_secret_key: str = ""
    admin_token: str = ""  # protects /admin (approve / reject ads)
    ads_fake_payments: bool = False  # dev/tests only: skip Paystack and treat payments as successful

    @property
    def async_database_url(self) -> str:
        url = self.database_url
        # Neon/Supabase hand out postgres:// URLs; SQLAlchemy needs the driver.
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                url = "postgresql+asyncpg://" + url[len(prefix) :]
        # asyncpg does not understand libpq's sslmode/channel_binding params.
        if url.startswith("postgresql+asyncpg://") and "?" in url:
            base, query = url.split("?", 1)
            params = [p for p in query.split("&") if not p.startswith(("sslmode", "channel_binding"))]
            if "sslmode=require" in query and not any(p.startswith("ssl=") for p in params):
                params.append("ssl=require")
            url = base + ("?" + "&".join(params) if params else "")
        return url


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.env == "prod" and s.jwt_secret.startswith("dev-only"):
        raise RuntimeError("JWT_SECRET must be set in production")
    if s.env == "prod" and s.ads_fake_payments:
        raise RuntimeError("ADS_FAKE_PAYMENTS must never be on in production")
    return s
