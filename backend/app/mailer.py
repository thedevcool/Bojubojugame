"""Minimal transactional email (password resets). Uses stdlib smtplib in a thread."""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.settings import get_settings

log = logging.getLogger("boju.mail")


def _send(to: str, subject: str, body: str) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["From"] = s.mail_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
        smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password)
        smtp.send_message(msg)


async def send_email(to: str, subject: str, body: str) -> bool:
    """Returns True if handed to SMTP. Without SMTP configured, logs instead (dev)."""
    if not get_settings().smtp_host:
        log.warning("SMTP not configured; email to %s not sent. Subject=%r Body=%r", to, subject, body)
        return False
    try:
        await asyncio.to_thread(_send, to, subject, body)
        return True
    except Exception:  # noqa: BLE001 - mail problems must never break the request
        log.exception("email send failed")
        return False
