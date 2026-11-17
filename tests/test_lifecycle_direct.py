from datetime import datetime, timezone
from email.utils import formatdate
import json
from pathlib import Path
import os

import pytest

from scripts.build_contract import build


BASE = 1_800_000_000
STAKE = 7
TRIGGER_URL = r"^https://api\.github\.com/repositories/54/pulls/3$"


def spec(**overrides):
    return {
        "trigger_repo_id": 54, "pr_number": 3, "target_repo_id": 61,
        "release_tag": "v2.0.0", "feature": "Add feature flag support",
        "criteria": [
            {"path": "src/flag.py", "needle": "def use_flag(config):\n    return config.enabled"},
            {"path": "src/client.py", "needle": "config = load_settings()\nclient = Client(config)"},
        ],
        "cutoff": BASE + 10, "trigger_deadline": BASE + 20,
        "outcome_deadline": BASE + 40, "limit": 2, "stake": str(STAKE),
        **overrides,
    }


def at(vm, offset):
    vm.warp(datetime.fromtimestamp(BASE + offset, timezone.utc).isoformat())


def sender(vm, wallet, value=0):
    vm.sender = wallet
    vm.origin = wallet
    vm.value = value


@pytest.fixture(scope="session")
def contract_path():
    override = os.environ.get("FORKPOINT_TEST_CONTRACT")
    return Path(override) if override else build()


@pytest.fixture
def market(direct_vm, direct_deploy, direct_alice, contract_path):
    direct_vm._chain_id = 61999
    at(direct_vm, 0)
    sender(direct_vm, direct_alice)
    contract = direct_deploy(str(contract_path), sdk_version="v0.2.16")
    assert contract.create_market(json.dumps(spec())) == 0
    return contract


def details(market):
    return json.loads(market.get_market(0))


def position(market, wallet):
    from genlayer import Address

    return json.loads(market.get_position(0, wallet if isinstance(wallet, Address) else Address(wallet)))


def mock_pr(vm, merged_offset=None, *, status=200, repo_id=54):
    vm.mock_web(TRIGGER_URL, {"response": {
        "status": status,
        "headers": {"content-type": b"application/json", "date": formatdate(BASE + 21, usegmt=True).encode()},
        "body": json.dumps({
            "base": {"repo": {"id": repo_id, "private": False}},
            "number": 3, "id": 200, "merged": merged_offset is not None,
            "state": "closed" if merged_offset is not None else "open",
            "merged_at": None if merged_offset is None else datetime.fromtimestamp(
                BASE + merged_offset, timezone.utc
            ).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "merge_commit_sha": "a" * 40,
        }).encode(),
    }})


@pytest.mark.parametrize(("change", "error"), [
    ({"trigger_repo_id": True}, "INVALID_GITHUB_ID"),
    ({"release_tag": "../release"}, "INVALID_RELEASE_TAG"),
    ({"feature": " "}, "INVALID_FEATURE"),
    ({"criteria": []}, "TWO_TO_FOUR"),
    ({"criteria": [{"path": "../x", "needle": "short"}] * 2}, "INVALID_EVIDENCE_PATH"),
    ({"criteria": [{"path": "a", "needle": "short"}] * 2}, "INVALID_SOURCE_MARKER"),
    ({"criteria": [spec()["criteria"][0]] * 2}, "DUPLICATE_CRITERION"),
    ({"limit": 65}, "INVALID_PARTICIPANT_LIMIT"),
    ({"stake": "07"}, "INVALID_STAKE"),
    ({"stake": str(10**24 + 1)}, "INVALID_STAKE"),
    ({"cutoff": BASE}, "INVALID_DEADLINE"),
    ({"cutoff": BASE + 21}, "INVALID_DEADLINE_ORDER"),
    ({"unexpected": True}, "INVALID_SPEC_FIELDS"),
])
def test_spec_rejection(market, direct_vm, change, error):
    with direct_vm.expect_revert(error):
        market.create_market(json.dumps(spec(**change)))
    assert market.market_count() == 1


def test_replay_and_boundary(market, direct_vm, direct_alice, direct_bob):
    sender(direct_vm, direct_alice, STAKE - 1)
    with direct_vm.expect_revert("INCORRECT_STAKE"):
        market.predict(0, True)
    sender(direct_vm, direct_alice, STAKE + 1)
    with direct_vm.expect_revert("INCORRECT_STAKE"):
        market.predict(0, True)
    at(direct_vm, 9)
    sender(direct_vm, direct_alice, STAKE)
    market.predict(0, True)
    with direct_vm.expect_revert("POSITION_EXISTS"):
        market.predict(0, False)
    with direct_vm.expect_revert("MARKET_NOT_FOUND"):
        market.predict(1, True)
    sender(direct_vm, direct_bob, STAKE)
    at(direct_vm, 10)
    with direct_vm.expect_revert("PREDICTIONS_CLOSED"):
        market.predict(0, False)
    assert position(market, direct_bob) is None
    assert details(market)["state"] == "PREDICTIONS_CLOSED"
    assert details(market)["pool_wei"] == str(STAKE)


@pytest.mark.parametrize(("merged_at", "expected"), [
    (None, "VOID"), (9, "VOID"), (10, "ACTIVE"),
    (20, "ACTIVE"), (21, "VOID"),
])
def test_trigger_github_deadline(market, direct_vm, merged_at, expected):
    at(direct_vm, 20)
    with direct_vm.expect_revert("OUTSIDE_ASSESSMENT_WINDOW"):
        market.check_trigger(0)
    mock_pr(direct_vm, merged_at)
    at(direct_vm, 21)
    assert market.check_trigger(0) == expected
    assert details(market)["stored_state"] == expected
    with direct_vm.expect_revert("TRIGGER_ALREADY_DECIDED"):
        market.check_trigger(0)


def test_trigger_retry_and_refund(market, direct_vm, direct_alice):
    sender(direct_vm, direct_alice, STAKE)
    market.predict(0, True)
    sender(direct_vm, direct_alice)
    mock_pr(direct_vm, status=429)
    at(direct_vm, 21)
    assert market.check_trigger(0) == "INCONCLUSIVE"
    assert position(market, direct_alice)["claimable"] == "0"
    with direct_vm.expect_revert("ASSESSMENT_SLOT_USED"):
        market.check_trigger(0)
    at(direct_vm, 1821)
    assert market.check_trigger(0) == "INCONCLUSIVE"
    assert details(market)["stored_state"] == "INCONCLUSIVE"
    assert position(market, direct_alice)["claimable"] == str(STAKE)


def test_expire_and_native_dispatch(market, direct_vm, direct_alice, direct_bob):
    sender(direct_vm, direct_alice, STAKE)
    market.predict(0, True)
    sender(direct_vm, direct_alice)
    with direct_vm.expect_revert("NOTHING_CLAIMABLE"):
        market.claim(0)
    at(direct_vm, 3620)
    with direct_vm.expect_revert("ASSESSMENT_WINDOW_OPEN"):
        market.expire(0)
    at(direct_vm, 3621)
    market.expire(0)
    with direct_vm.expect_revert("MARKET_ALREADY_TERMINAL"):
        market.expire(0)
    sender(direct_vm, direct_bob)
    with direct_vm.expect_revert("NO_POSITION"):
        market.claim(0)
    sender(direct_vm, direct_alice)
    assert market.claim(0) == "EMITTED_UNCONFIRMED"
    assert position(market, direct_alice)["dispatched_amount"] == str(STAKE)
    assert position(market, direct_alice)["claimable"] == "0"
    assert details(market)["undispatched_pool_wei"] == "0"
    assert json.loads(market.get_treasury())["dispatched_wei"] == str(STAKE)
    with direct_vm.expect_revert("CLAIM_ALREADY_DISPATCHED"):
        market.claim(0)


def test_wrong_network_and_indirect_prediction(market, direct_vm, direct_alice, direct_bob):
    direct_vm._chain_id = 1
    sender(direct_vm, direct_alice, STAKE)
    with direct_vm.expect_revert("WRONG_NETWORK"):
        market.predict(0, True)
    direct_vm._chain_id = 61999
    direct_vm.origin = direct_bob
    with direct_vm.expect_revert("DIRECT_WALLET_REQUIRED"):
        market.predict(0, True)

def test_wrong_repository_never_activates_market(market, direct_vm):
    mock_pr(direct_vm, 12, repo_id=55)
    at(direct_vm, 21)
    assert market.check_trigger(0) == "INCONCLUSIVE"
    assert details(market)["stored_state"] == "CREATED"


def test_wallet_limit_and_void_pool_conservation(
    market, direct_vm, direct_alice, direct_bob, direct_charlie
):
    for wallet, yes in [(direct_alice, True), (direct_bob, False)]:
        sender(direct_vm, wallet, STAKE)
        market.predict(0, yes)
    sender(direct_vm, direct_charlie, STAKE)
    with direct_vm.expect_revert("MARKET_FULL"):
        market.predict(0, True)
    sender(direct_vm, direct_charlie)
    mock_pr(direct_vm)
    at(direct_vm, 21)
    assert market.check_trigger(0) == "VOID"
    assert position(market, direct_alice)["claimable"] == str(STAKE)
    assert position(market, direct_bob)["claimable"] == str(STAKE)
    for wallet in (direct_bob, direct_alice):
        sender(direct_vm, wallet)
        market.claim(0)
    summary = details(market)
    assert summary["pool_wei"] == summary["dispatched_wei"] == str(2 * STAKE)
    assert summary["undispatched_pool_wei"] == "0"





@pytest.mark.parametrize(("raw", "reason"), [
    (" " * 8193, "SPEC_TOO_LARGE"),
    ("{", "INVALID_SPEC_JSON"),
    ('{"pr_number":1,"pr_number":2}', "INVALID_SPEC_JSON"),
    ("[]", "INVALID_SPEC_FIELDS"),
    (json.dumps(spec(feature="Invalid\nlinebreak")), "INVALID_FEATURE"),
    (json.dumps(spec(outcome_deadline=BASE + 367 * 86400)), "INVALID_DEADLINE"),
])
def test_malformed_specs_do_not_create_markets(market, direct_vm, raw, reason):
    with direct_vm.expect_revert(reason):
        market.create_market(raw)
    assert market.market_count() == 1


def test_pinned_early_transaction_cannot_fund_newer_market(market, direct_vm, direct_alice):
    at(direct_vm, -1)
    sender(direct_vm, direct_alice, STAKE)
    with direct_vm.expect_revert("PREDICTIONS_CLOSED"):
        market.predict(0, True)
    assert details(market)["pool_wei"] == "0"


def test_outcome_slot_expiry_and_claim(market, direct_vm, direct_alice):
    sender(direct_vm, direct_alice, STAKE)
    market.predict(0, False)
    sender(direct_vm, direct_alice)
    with direct_vm.expect_revert("MARKET_NOT_ACTIVE"):
        market.check_outcome(0)
    mock_pr(direct_vm, 11)
    at(direct_vm, 21)
    assert market.check_trigger(0) == "ACTIVE"
    at(direct_vm, 3620)
    assert details(market)["state"] == "ACTIVE"
    with direct_vm.expect_revert("OUTSIDE_ASSESSMENT_WINDOW"):
        market.check_outcome(0)
    at(direct_vm, 3621)
    assert details(market)["state"] == "OUTCOME_CHECK"
    assert market.check_outcome(0) == "INCONCLUSIVE"
    at(direct_vm, 7221)
    market.expire(0)
    assert details(market)["evidence"]["expiration"]["phase"] == "OUTCOME"
    assert position(market, direct_alice)["claimable"] == str(STAKE)
