"""
Email Service (SendGrid)
------------------------
Sends transactional emails to clients (buyers) and logs activity.
Falls back to logging when SendGrid is not configured.
"""
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.services.lead_service import log_activity
import httpx
import logging

logger = logging.getLogger(__name__)

EMAIL_TEMPLATES = {
    "welcome": {
        "subject": "Welcome to Propello — We'll find your dream home 🏠",
        "body": """<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
<h2 style="color: #1d1d1f; font-weight: 600;">Hi {name},</h2>
<p style="color: #424245; line-height: 1.6;">Thank you for connecting with Propello! We're excited to help you find the perfect property.</p>
<p style="color: #424245; line-height: 1.6;">Your dedicated agent <strong>{agent_name}</strong> will be reaching out to you shortly to understand your requirements better.</p>
<p style="color: #424245; line-height: 1.6;">In the meantime, feel free to browse our latest listings or chat with our AI assistant Priya for instant answers.</p>
<br>
<p style="color: #86868b; font-size: 14px;">Warm regards,<br>Team Propello</p>
</div>""",
    },
    "visit_confirmation": {
        "subject": "Your site visit is confirmed ✅",
        "body": """<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
<h2 style="color: #1d1d1f; font-weight: 600;">Hi {name},</h2>
<p style="color: #424245; line-height: 1.6;">Your site visit has been confirmed! Here are the details:</p>
<div style="background: #f5f5f7; border-radius: 16px; padding: 20px; margin: 20px 0;">
<p style="margin: 4px 0;"><strong>Date & Time:</strong> {visit_date}</p>
<p style="margin: 4px 0;"><strong>Property:</strong> {property_name}</p>
<p style="margin: 4px 0;"><strong>Your Agent:</strong> {agent_name}</p>
</div>
<p style="color: #424245; line-height: 1.6;">Please arrive 5 minutes early. If you need to reschedule, reply to this email or contact your agent directly.</p>
<br>
<p style="color: #86868b; font-size: 14px;">See you there!<br>Team Propello</p>
</div>""",
    },
    "visit_reminder": {
        "subject": "Reminder: Your site visit is tomorrow 🏗️",
        "body": """<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
<h2 style="color: #1d1d1f; font-weight: 600;">Hi {name},</h2>
<p style="color: #424245; line-height: 1.6;">Just a friendly reminder — your site visit is scheduled for tomorrow.</p>
<p style="color: #424245; line-height: 1.6;">Your agent {agent_name} will be there to show you around and answer all your questions.</p>
<p style="color: #424245; line-height: 1.6;">Looking forward to seeing you!</p>
<br>
<p style="color: #86868b; font-size: 14px;">Team Propello</p>
</div>""",
    },
    "post_visit": {
        "subject": "How was your visit? We'd love your feedback 💬",
        "body": """<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
<h2 style="color: #1d1d1f; font-weight: 600;">Hi {name},</h2>
<p style="color: #424245; line-height: 1.6;">Thank you for visiting! We hope you liked what you saw.</p>
<p style="color: #424245; line-height: 1.6;">We'd love to hear your thoughts. Was the property what you expected? Any questions or concerns?</p>
<p style="color: #424245; line-height: 1.6;">Your agent {agent_name} is available to discuss next steps whenever you're ready.</p>
<br>
<p style="color: #86868b; font-size: 14px;">Best,<br>Team Propello</p>
</div>""",
    },
    "reengagement": {
        "subject": "We miss you! New properties matching your criteria 🏡",
        "body": """<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
<h2 style="color: #1d1d1f; font-weight: 600;">Hi {name},</h2>
<p style="color: #424245; line-height: 1.6;">It's been a while since we last connected. We wanted to let you know we have some exciting new listings that match your preferences.</p>
<p style="color: #424245; line-height: 1.6;">Would you like to schedule a quick call to explore what's new? No pressure — just wanted to keep you in the loop.</p>
<br>
<p style="color: #86868b; font-size: 14px;">Cheers,<br>Team Propello</p>
</div>""",
    },
    "custom": {
        "subject": "{subject}",
        "body": """<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
{body}
</div>""",
    },
}


async def send_email(
    to_email: str,
    template: str,
    variables: dict,
    db: AsyncSession,
    lead_id: str,
    contact_id: str,
    agent_id: Optional[str] = None,
) -> dict:
    """Send an email via SendGrid and log the activity."""
    tmpl = EMAIL_TEMPLATES.get(template, EMAIL_TEMPLATES["custom"])
    subject = tmpl["subject"]
    body = tmpl["body"]

    for key, value in variables.items():
        subject = subject.replace(f"{{{key}}}", str(value))
        body = body.replace(f"{{{key}}}", str(value))

    sent = False
    error = None

    if settings.SENDGRID_API_KEY and to_email:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    "https://api.sendgrid.com/v3/mail/send",
                    headers={
                        "Authorization": f"Bearer {settings.SENDGRID_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "personalizations": [{"to": [{"email": to_email}]}],
                        "from": {"email": "noreply@propello.ai", "name": "Propello Real Estate"},
                        "subject": subject,
                        "content": [{"type": "text/html", "value": body}],
                    },
                )
                sent = response.status_code in (200, 201, 202)
                if not sent:
                    error = f"SendGrid {response.status_code}: {response.text[:200]}"
        except Exception as e:
            error = str(e)
    else:
        error = "SendGrid not configured or no email address"
        logger.info(f"[Email Mock] To: {to_email} | Subject: {subject}")

    # Always log
    await log_activity(
        db=db,
        lead_id=lead_id,
        contact_id=contact_id,
        activity_type="email",
        title=f"Email sent: {template}",
        description=subject,
        outcome="sent" if sent else f"failed: {error}",
        performed_by=agent_id,
        meta={"template": template, "sent": sent, "to_email": to_email},
    )

    return {"sent": sent, "subject": subject, "error": error}
