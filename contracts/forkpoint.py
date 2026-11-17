# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from datetime import datetime, timezone
from dataclasses import dataclass
import json
import re


_SLOT_SECONDS = 1800
_WINDOW_SECONDS = 2 * _SLOT_SECONDS
_MAX_SAFE_INTEGER = 9007199254740991
_MAX_STAKE = 10**24
_MAX_HORIZON = 366 * 86400
_POLICY = "github-immutable-release-markers-v1"
_SPEC_FIELDS = {
    "trigger_repo_id", "pr_number", "target_repo_id", "release_tag", "feature",
    "criteria", "cutoff", "trigger_deadline", "outcome_deadline", "stake", "limit",
}


@gl.evm.contract_interface
class _PayoutRecipient:
    class View:
        pass

    class Write:
        pass


@allow_storage
@dataclass
class _Market:
    spec: str
    created_at: u64
    phase: str
    yes_count: u64
    no_count: u64
    trigger_slot: u64
    outcome_slot: u64
    merged_at: u64
    trigger_first: str
    trigger_second: str
    outcome_first: str
    outcome_second: str
    expiration: str
    dispatched_wei: u256


@allow_storage
@dataclass
class _Position:
    yes: bool
    side_rank: u64
    dispatched_at: u64
    dispatched_amount: u256


def _fail(reason: str) -> None:
    raise gl.vm.UserError(reason)


def _refund_rejected(reason: str) -> str:
    """Refund an application-level rejection after the payable value has arrived.

    Studionet credits ``gl.message.value`` before GenVM execution and does not roll that
    credit back when a contract raises ``gl.vm.UserError``. Payable validation therefore
    returns a tagged refusal and emits the exact incoming value to the direct sender instead
    of raising. The parent receipt only proves that the refund message was dispatched; the
    child transfer and recipient credit still require independent readback.
    """
    amount = int(gl.message.value)
    if amount > 0:
        _PayoutRecipient(gl.message.sender_address).emit_transfer(value=u256(amount))
        return "REJECTED_" + reason + "_REFUND_EMITTED_UNCONFIRMED"
    return "REJECTED_" + reason + "_NO_VALUE"


def _json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _unique_fields(pairs: list) -> dict:
    fields = {}
    for key, value in pairs:
        if key in fields:
            raise ValueError("Duplicate JSON field")
        fields[key] = value
    return fields


def _now() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def _validate_chain() -> None:
    if int(gl.message.chain_id) != 61999:
        _fail("WRONG_NETWORK")


def _wallet() -> Address:
    _validate_chain()
    sender = gl.message.sender_address
    if sender != gl.message.origin_address:
        _fail("DIRECT_WALLET_REQUIRED")
    return sender


def _valid_integer(value, lower: int, upper: int) -> bool:
    return type(value) is int and lower <= value <= upper


def _text_is_safe(value: str, allow_linebreaks: bool) -> bool:
    for char in value:
        if char in "\n\t" and allow_linebreaks:
            continue
        if not char.isprintable():
            return False
    return True


def _is_implementation_path(path: str) -> bool:
    if not path.endswith(".py"):
        return False
    parts = path.lower().split("/")
    filename = parts[-1]
    fixture_directories = {"test", "tests", "fixture", "fixtures", "__tests__", "__fixtures__"}
    fixture_files = {"conftest.py", "test.py", "tests.py", "fixture.py", "fixtures.py"}
    return (
        not any(directory in fixture_directories for directory in parts[:-1])
        and filename not in fixture_files
        and not filename.startswith(("test_", "fixture_"))
        and not filename.endswith(("_test.py", "_fixture.py"))
    )


def _validate_criteria(criteria) -> None:
    if not isinstance(criteria, list) or not 2 <= len(criteria) <= 4:
        _fail("TWO_TO_FOUR_CRITERIA_REQUIRED")
    seen = set()
    for criterion in criteria:
        if not isinstance(criterion, dict) or set(criterion) != {"path", "needle"}:
            _fail("INVALID_CRITERION")
        path = criterion["path"]
        needle = criterion["needle"]
        if (
            not isinstance(path, str)
            or not re.fullmatch(r"[A-Za-z0-9._/-]{1,160}", path)
            or any(part in ("", ".", "..") for part in path.split("/"))
        ):
            _fail("INVALID_EVIDENCE_PATH")
        if (
            not isinstance(needle, str)
            or len(needle) < 20
            or not _text_is_safe(needle, True)
            or len(needle.encode("utf-8")) > 240
            or len(set(line.strip() for line in needle.splitlines() if line.strip())) < 2
            or needle != needle.strip("\n")
        ):
            _fail("INVALID_SOURCE_MARKER")
        if (path, needle) in seen:
            _fail("DUPLICATE_CRITERION")
        seen.add((path, needle))
    if not any(_is_implementation_path(criterion["path"]) for criterion in criteria):
        _fail("IMPLEMENTATION_MARKER_REQUIRED")


def _validate_spec(raw: str, now: int) -> dict:
    if len(raw) > 8192:
        _fail("SPEC_TOO_LARGE")
    try:
        spec = json.loads(raw, object_pairs_hook=_unique_fields)
    except (ValueError, RecursionError):
        raise gl.vm.UserError("INVALID_SPEC_JSON")
    if not isinstance(spec, dict) or set(spec) != _SPEC_FIELDS:
        _fail("INVALID_SPEC_FIELDS")
    for field in ("trigger_repo_id", "pr_number", "target_repo_id"):
        if not _valid_integer(spec[field], 1, _MAX_SAFE_INTEGER):
            _fail("INVALID_GITHUB_ID")
    release_tag = spec["release_tag"]
    if (
        not isinstance(release_tag, str)
        or not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", release_tag)
        or release_tag.startswith(".")
        or release_tag.endswith((".", ".lock"))
        or ".." in release_tag
    ):
        _fail("INVALID_RELEASE_TAG")
    feature = spec["feature"]
    if (
        not isinstance(feature, str)
        or not 8 <= len(feature) <= 400
        or feature != feature.strip()
        or not _text_is_safe(feature, False)
        or len(feature.encode("utf-8")) > 640
    ):
        _fail("INVALID_FEATURE")
    _validate_criteria(spec["criteria"])
    if not _valid_integer(spec["limit"], 2, 64):
        _fail("INVALID_PARTICIPANT_LIMIT")
    stake = spec["stake"]
    if (
        not isinstance(stake, str)
        or not re.fullmatch(r"[1-9][0-9]{0,24}", stake)
        or int(stake) > _MAX_STAKE
    ):
        _fail("INVALID_STAKE")
    for field in ("cutoff", "trigger_deadline", "outcome_deadline"):
        if not _valid_integer(spec[field], now + 1, now + _MAX_HORIZON):
            _fail("INVALID_DEADLINE")
    if not spec["cutoff"] <= spec["trigger_deadline"] < spec["outcome_deadline"]:
        _fail("INVALID_DEADLINE_ORDER")
    return spec


def _window_start(spec: dict, trigger: bool) -> int:
    trigger_start = spec["trigger_deadline"] + 1
    if trigger:
        return trigger_start
    return max(spec["outcome_deadline"] + 1, trigger_start + _WINDOW_SECONDS)


def _assessment_slot(spec: dict, trigger: bool, now: int, last_slot: int) -> int:
    start = _window_start(spec, trigger)
    if not start <= now < start + _WINDOW_SECONDS:
        _fail("OUTSIDE_ASSESSMENT_WINDOW")
    slot = (now - start) // _SLOT_SECONDS + 1
    if slot <= last_slot:
        _fail("ASSESSMENT_SLOT_USED")
    return slot


def _position_key(market_id: u64, wallet: Address) -> str:
    return str(int(market_id)) + "/" + wallet.as_hex.lower()


def _market_key(market_id: u64) -> str:
    return str(int(market_id))


def _scheduled_phase(market: _Market, spec: dict, now: int) -> str:
    if market.phase == "CREATED":
        if now >= _window_start(spec, True):
            return "TRIGGER_CHECK"
        if now >= spec["cutoff"]:
            return "PREDICTIONS_CLOSED"
    if market.phase == "ACTIVE" and now >= _window_start(spec, False):
        return "OUTCOME_CHECK"
    return market.phase


def _pool(market: _Market, stake: int) -> int:
    return (int(market.yes_count) + int(market.no_count)) * stake


def _entitlement(market: _Market, pos: _Position, stake: int) -> int:
    if market.phase in ("VOID", "INCONCLUSIVE"):
        return stake
    if market.phase not in ("RESOLVED_YES", "RESOLVED_NO"):
        return 0
    yes_wins = market.phase == "RESOLVED_YES"
    winners = int(market.yes_count if yes_wins else market.no_count)
    if winners == 0:
        return stake
    if pos.yes != yes_wins:
        return 0
    amount, remainder = divmod(_pool(market, stake), winners)
    return amount + (remainder if int(pos.side_rank) == 0 else 0)


def _record_evidence(facts: dict, slot: int, now: int) -> str:
    serialized = _json({"slot": slot, "checked_at": now, "facts": facts})
    if len(serialized) > 8192:
        _fail("EVIDENCE_RECORD_TOO_LARGE")
    return serialized


class Forkpoint(gl.Contract):
    markets: TreeMap[str, _Market]
    positions: TreeMap[str, _Position]
    count: u64
    deposited_wei: u256
    total_dispatched_wei: u256

    def __init__(self) -> None:
        _validate_chain()
        self.count = u64(0)
        self.deposited_wei = u256(0)
        self.total_dispatched_wei = u256(0)

    def _get(self, market_id: u64) -> _Market:
        key = _market_key(market_id)
        if key not in self.markets:
            raise gl.vm.UserError("MARKET_NOT_FOUND")
        return self.markets[key]

    @gl.public.write
    def create_market(self, spec_json: str) -> u64:
        _wallet()
        now = _now()
        spec = _validate_spec(spec_json, now)
        market_id = self.count
        if int(market_id) == (1 << 64) - 1:
            _fail("MARKET_CAPACITY_REACHED")
        self.markets[_market_key(market_id)] = _Market(
            _json(spec), u64(now), "CREATED", u64(0), u64(0), u64(0),
            u64(0), u64(0), "", "", "", "", "", u256(0),
        )
        self.count = u64(int(market_id) + 1)
        return market_id

    @gl.public.write.payable
    def predict(self, market_id: u64, yes: bool) -> str:
        try:
            self._predict(market_id, yes)
            return "ACCEPTED"
        except gl.vm.UserError as exc:
            return _refund_rejected(str(exc.message))

    def _predict(self, market_id: u64, yes: bool) -> None:
        sender = _wallet()
        if type(yes) is not bool:
            _fail("INVALID_POSITION_SIDE")
        market = self._get(market_id)
        spec = json.loads(market.spec)
        now = _now()
        if (
            market.phase != "CREATED"
            or int(market.trigger_slot) != 0
            or not int(market.created_at) <= now < spec["cutoff"]
        ):
            _fail("PREDICTIONS_CLOSED")
        stake = int(spec["stake"])
        if int(gl.message.value) != stake:
            _fail("INCORRECT_STAKE")
        key = _position_key(market_id, sender)
        if key in self.positions:
            _fail("POSITION_EXISTS")
        if int(market.yes_count) + int(market.no_count) >= spec["limit"]:
            _fail("MARKET_FULL")
        rank = market.yes_count if yes else market.no_count
        self.positions[key] = _Position(yes, rank, u64(0), u256(0))
        if yes:
            market.yes_count = u64(int(rank) + 1)
        else:
            market.no_count = u64(int(rank) + 1)
        self.deposited_wei = u256(int(self.deposited_wei) + stake)

    @gl.public.write
    def check_trigger(self, market_id: u64) -> str:
        _validate_chain()
        market = self._get(market_id)
        if market.phase != "CREATED":
            _fail("TRIGGER_ALREADY_DECIDED")
        spec = json.loads(market.spec)
        now = _now()
        slot = _assessment_slot(spec, True, now, int(market.trigger_slot))
        facts = assess_trigger(spec, int(market.created_at))
        verdict = facts.get("verdict")
        if verdict not in ("ACTIVE", "VOID", "INCONCLUSIVE"):
            _fail("INVALID_TRIGGER_VERDICT")
        if verdict == "ACTIVE":
            merged_at = facts.get("merged_at")
            if not _valid_integer(
                merged_at, max(spec["cutoff"], int(market.created_at) + 1), spec["trigger_deadline"],
            ):
                _fail("INVALID_MERGE_TIME")
            market.merged_at = u64(merged_at)
        record = _record_evidence(facts, slot, now)
        market.trigger_slot = u64(slot)
        if slot == 1:
            market.trigger_first = record
        else:
            market.trigger_second = record
        if verdict != "INCONCLUSIVE" or slot == 2:
            market.phase = verdict
        return verdict

    @gl.public.write
    def check_outcome(self, market_id: u64) -> str:
        _validate_chain()
        market = self._get(market_id)
        if market.phase != "ACTIVE":
            _fail("MARKET_NOT_ACTIVE")
        spec = json.loads(market.spec)
        now = _now()
        slot = _assessment_slot(spec, False, now, int(market.outcome_slot))
        facts = assess_outcome(spec, int(market.merged_at))
        verdict = facts.get("verdict")
        if verdict not in ("RESOLVED_YES", "RESOLVED_NO", "INCONCLUSIVE"):
            _fail("INVALID_OUTCOME_VERDICT")
        record = _record_evidence(facts, slot, now)
        market.outcome_slot = u64(slot)
        if slot == 1:
            market.outcome_first = record
        else:
            market.outcome_second = record
        if verdict != "INCONCLUSIVE" or slot == 2:
            market.phase = verdict
        return verdict

    @gl.public.write
    def expire(self, market_id: u64) -> None:
        _validate_chain()
        market = self._get(market_id)
        if market.phase not in ("CREATED", "ACTIVE"):
            _fail("MARKET_ALREADY_TERMINAL")
        spec = json.loads(market.spec)
        trigger = market.phase == "CREATED"
        now = _now()
        if now < _window_start(spec, trigger) + _WINDOW_SECONDS:
            _fail("ASSESSMENT_WINDOW_OPEN")
        market.expiration = _json({
            "checked_at": now,
            "phase": "TRIGGER" if trigger else "OUTCOME",
            "reason": "ASSESSMENT_WINDOW_ENDED_WITHOUT_A_DECISION",
        })
        market.phase = "INCONCLUSIVE"

    @gl.public.write
    def claim(self, market_id: u64) -> str:
        sender = _wallet()
        market = self._get(market_id)
        key = _position_key(market_id, sender)
        if key not in self.positions:
            raise gl.vm.UserError("NO_POSITION")
        pos = self.positions[key]
        if int(pos.dispatched_amount) != 0:
            _fail("CLAIM_ALREADY_DISPATCHED")
        amount = _entitlement(market, pos, int(json.loads(market.spec)["stake"]))
        if amount <= 0:
            _fail("NOTHING_CLAIMABLE")
        pos.dispatched_amount = u256(amount)
        pos.dispatched_at = u64(_now())
        market.dispatched_wei = u256(int(market.dispatched_wei) + amount)
        self.total_dispatched_wei = u256(int(self.total_dispatched_wei) + amount)
        _PayoutRecipient(sender).emit_transfer(value=u256(amount))
        return "EMITTED_UNCONFIRMED"

    @gl.public.view
    def market_count(self) -> u64:
        return self.count

    @gl.public.view
    def get_market(self, market_id: u64) -> str:
        market = self._get(market_id)
        spec = json.loads(market.spec)
        trigger_start = _window_start(spec, True)
        outcome_start = _window_start(spec, False)
        total = _pool(market, int(spec["stake"]))
        dispatched = int(market.dispatched_wei)
        evidence = {
            "trigger": [json.loads(record) for record in (market.trigger_first, market.trigger_second) if record],
            "outcome": [json.loads(record) for record in (market.outcome_first, market.outcome_second) if record],
            "expiration": json.loads(market.expiration) if market.expiration else None,
        }
        return _json({
            **spec,
            "id": int(market_id),
            "created_at": int(market.created_at),
            "state": _scheduled_phase(market, spec, _now()),
            "stored_state": market.phase,
            "merged_at": int(market.merged_at) or None,
            "policy": _POLICY,
            "yes_count": int(market.yes_count),
            "no_count": int(market.no_count),
            "trigger_window_start": trigger_start,
            "trigger_window_end": trigger_start + _WINDOW_SECONDS,
            "outcome_window_start": outcome_start,
            "outcome_window_end": outcome_start + _WINDOW_SECONDS,
            "slot_seconds": _SLOT_SECONDS,
            "trigger_slot": int(market.trigger_slot),
            "outcome_slot": int(market.outcome_slot),
            "refund_all": (
                market.phase in ("VOID", "INCONCLUSIVE")
                or (market.phase == "RESOLVED_YES" and int(market.yes_count) == 0)
                or (market.phase == "RESOLVED_NO" and int(market.no_count) == 0)
            ),
            "pool_wei": str(total),
            "dispatched_wei": str(dispatched),
            "undispatched_pool_wei": str(total - dispatched),
            "evidence": evidence,
        })

    @gl.public.view
    def get_position(self, market_id: u64, wallet: Address) -> str:
        market = self._get(market_id)
        key = _position_key(market_id, wallet)
        if key not in self.positions:
            return "null"
        pos = self.positions[key]
        stake = int(json.loads(market.spec)["stake"])
        dispatched = int(pos.dispatched_amount)
        claimable = 0 if dispatched else _entitlement(market, pos, stake)
        return _json({
            "yes": pos.yes,
            "stake": str(stake),
            "claimable": str(claimable),
            "dispatched": dispatched != 0,
            "dispatched_amount": str(dispatched),
            "dispatched_at": int(pos.dispatched_at) or None,
            "payout_status": "EMITTED_UNCONFIRMED" if dispatched else None,
        })

    @gl.public.view
    def get_treasury(self) -> str:
        deposited = int(self.deposited_wei)
        dispatched = int(self.total_dispatched_wei)
        return _json({
            "deposited_wei": str(deposited),
            "dispatched_wei": str(dispatched),
            "undispatched_pool_wei": str(deposited - dispatched),
            "runtime_balance_wei": str(self.balance),
        })

