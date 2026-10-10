"""Email adapter: console (dev), SMTP, or AWS SES. Vendor SDKs live only here."""

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

log = logging.getLogger(__name__)

# Captured in tests / console mode so flows can be exercised without a mail server.
outbox: list[dict] = []


def send_email(to: str, subject: str, text: str) -> None:
    backend = settings.email_backend
    if backend == "console":
        outbox.append({"to": to, "subject": subject, "text": text})
        log.info("EMAIL to=%s subject=%s\n%s", to, subject, text)
    elif backend == "smtp":
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = settings.email_from, to, subject
        msg.set_content(text)
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as s:
            if settings.smtp_username:
                s.starttls()
                s.login(settings.smtp_username, settings.smtp_password or "")
            s.send_message(msg)
    elif backend == "ses":
        import boto3

        boto3.client("ses", region_name=settings.s3_region).send_email(
            Source=settings.email_from,
            Destination={"ToAddresses": [to]},
            Message={"Subject": {"Data": subject}, "Body": {"Text": {"Data": text}}},
        )
    else:
        raise ValueError(f"Unknown EMAIL_BACKEND: {backend}")
