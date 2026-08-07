"""Alert rule CRUD, manual test fires, and notification history."""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import access, alerting
from ..database import get_db
from ..models import AlertNotification, AlertRule, DataSource, User
from ..permissions import require_alert_edit, require_alert_view
from ..secrets_store import MASK, encrypt

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

def _editable_rule(rule_id: int, user: User, db: Session) -> AlertRule:
    """A rule you may change: yours, or one on a source you can already use.

    Without the source check, anyone could repoint someone else's rule at a
    private source and read it through the alert history.
    """
    rule = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Not found")
    if access.is_admin(user) or rule.owner_id == user.id:
        return rule
    if rule.datasource and access.can_use_datasource(db, user, rule.datasource):
        return rule
    raise HTTPException(status_code=404, detail="Not found")


VALID_AGGREGATES = {"first", "sum", "avg", "min", "max", "count"}
VALID_FORMATS = {"generic", "slack", "teams"}
MIN_INTERVAL = 30


class Webhook(BaseModel):
    url: str = ""
    format: str = "generic"


class AlertIn(BaseModel):
    name: str
    datasource_id: int
    options: dict = {}
    value_field: str | None = None
    aggregate: str = "first"
    thresholds: dict = {}
    interval_seconds: int = 300
    for_evaluations: int = 1
    repeat_minutes: int = 0
    notify_on_recovery: bool = True
    webhook: Webhook = Webhook()
    enabled: bool = True


def _validate(body: AlertIn, db: Session, user: User):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Give the rule a name")
    ds = db.query(DataSource).filter(DataSource.id == body.datasource_id).first()
    # A rule runs a query of your choosing on a schedule, so creating one needs
    # the same access as an ad-hoc query — otherwise it would be a way to read
    # a private source by proxy.
    if not ds or not access.can_use_datasource(db, user, ds):
        raise HTTPException(status_code=400, detail="That data source does not exist")
    if body.aggregate not in VALID_AGGREGATES:
        raise HTTPException(status_code=400,
                            detail=f"Aggregate must be one of {sorted(VALID_AGGREGATES)}")
    if body.webhook.format not in VALID_FORMATS:
        raise HTTPException(status_code=400,
                            detail=f"Webhook format must be one of {sorted(VALID_FORMATS)}")
    if alerting.number_or_none(body.thresholds.get("warn")) is None and \
            alerting.number_or_none(body.thresholds.get("critical")) is None:
        raise HTTPException(
            status_code=400,
            detail="Set a warning or critical threshold — a rule with neither can never fire.",
        )
    if body.interval_seconds < MIN_INTERVAL:
        raise HTTPException(
            status_code=400,
            detail=f"Check interval must be at least {MIN_INTERVAL} seconds, so a rule "
                   f"cannot hammer a data source.",
        )


def _apply(rule: AlertRule, body: AlertIn, existing_url: str = ""):
    rule.name = body.name.strip()
    rule.datasource_id = body.datasource_id
    rule.options = json.dumps(body.options or {})
    rule.value_field = body.value_field or None
    rule.aggregate = body.aggregate
    rule.thresholds = json.dumps(body.thresholds or {})
    rule.interval_seconds = body.interval_seconds
    rule.for_evaluations = max(1, body.for_evaluations)
    rule.repeat_minutes = max(0, body.repeat_minutes)
    rule.notify_on_recovery = body.notify_on_recovery
    rule.enabled = body.enabled

    # the URL is masked in responses, so a form round-trip sends the mask back
    url = body.webhook.url
    keep = url in (MASK, "") and existing_url
    rule.webhook = json.dumps({
        "url": existing_url if keep else encrypt(url),
        "format": body.webhook.format,
    })


@router.get("")
def list_rules(user: User = Depends(require_alert_view), db: Session = Depends(get_db)):
    """Every rule, with the source name only.

    Alarm state is deliberately visible to everyone — "is anything on fire?" is
    exactly what a viewer needs — but a rule on a private source reveals only
    its name, never the query or the connection behind it.
    """
    rules = db.query(AlertRule).order_by(AlertRule.id).all()
    out = []
    for r in rules:
        d = alerting.rule_to_dict(r)
        if r.datasource and not access.can_use_datasource(db, user, r.datasource):
            d["options"] = {}          # the query can name internal tables
            d["datasource_name"] = None
        out.append(d)
    return out


@router.post("")
def create_rule(body: AlertIn, user: User = Depends(require_alert_edit),
                db: Session = Depends(get_db)):
    _validate(body, db, user)
    rule = AlertRule(owner_id=user.id)
    _apply(rule, body)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return alerting.rule_to_dict(rule)


@router.put("/{rule_id}")
def update_rule(rule_id: int, body: AlertIn, user: User = Depends(require_alert_edit),
                db: Session = Depends(get_db)):
    rule = _editable_rule(rule_id, user, db)
    _validate(body, db, user)
    existing = json.loads(rule.webhook or "{}").get("url") or ""
    _apply(rule, body, existing)
    db.commit()
    db.refresh(rule)
    return alerting.rule_to_dict(rule)


@router.delete("/{rule_id}")
def delete_rule(rule_id: int, user: User = Depends(require_alert_edit),
                db: Session = Depends(get_db)):
    rule = _editable_rule(rule_id, user, db)
    db.delete(rule)
    db.commit()
    return {"ok": True}


@router.post("/{rule_id}/test")
async def test_rule(rule_id: int, user: User = Depends(require_alert_edit),
                    db: Session = Depends(get_db)):
    """Send a message now, whatever the current value.

    Proves the webhook works without waiting for something to break — the
    thing people actually want to check when they set an alert up.
    """
    rule = _editable_rule(rule_id, user, db)

    payload = alerting.build_payload(
        rule.name, "ok", rule.last_value,
        "This is a test from Hub-Bro. If you can read this, the webhook works.",
        "test", rule.webhook_dict.get("format") or "generic",
    )
    ok, error = await alerting.send_webhook(rule.webhook_dict, payload)
    alerting.record(db, rule, "ok", rule.last_value, "Test message", "test", ok, error)
    alerting.prune_notifications(db, rule.id)
    db.commit()
    if not ok:
        raise HTTPException(status_code=400, detail=error or "Delivery failed")
    return {"ok": True}


@router.post("/{rule_id}/run")
async def run_rule(rule_id: int, user: User = Depends(require_alert_edit),
                   db: Session = Depends(get_db)):
    """Evaluate a rule immediately — useful while tuning thresholds."""
    rule = _editable_rule(rule_id, user, db)
    result = await alerting.evaluate(db, rule)
    alerting.prune_notifications(db, rule.id)
    db.commit()
    return {**result, "rule": alerting.rule_to_dict(rule)}


@router.get("/{rule_id}/history")
def history(rule_id: int, limit: int = 25, _: User = Depends(require_alert_view),
            db: Session = Depends(get_db)):
    rows = (db.query(AlertNotification)
            .filter(AlertNotification.rule_id == rule_id)
            .order_by(AlertNotification.id.desc())
            .limit(max(1, min(limit, 100))).all())
    return [{
        "id": n.id, "level": n.level, "value": n.value, "message": n.message,
        "reason": n.reason, "delivered": n.delivered, "error": n.error,
        "created_at": n.created_at,
    } for n in rows]
