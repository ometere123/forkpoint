"""Integer accounting properties and the actual Direct Mode participant cap."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
from types import SimpleNamespace

from gltest.direct import VMContext, deploy_contract
from hypothesis import given, settings, strategies as st
import pytest

from scripts.build_contract import build


BASE = 1_800_000_000


@pytest.fixture(scope="module")
def contract_source(tmp_path_factory):
    override = os.environ.get("FORKPOINT_TEST_CONTRACT")
    if override:
        return Path(override)
    return build(tmp_path_factory.mktemp("accounting") / "forkpoint.py")


def _clock(offset):
    return datetime.fromtimestamp(BASE + offset, timezone.utc).isoformat()


def _wallet(index):
    return f"0x{index:040x}"


def _set_sender(vm, address, value=0):
    vm.sender = vm.origin = address
    vm.value = value


@pytest.fixture(scope="module")
def accounting(contract_source):
    vm = VMContext(_chain_id=61999)
    with vm.activate():
        _set_sender(vm, _wallet(1))
        vm.warp(_clock(0))
        deployed = deploy_contract(contract_source, vm, sdk_version="v0.2.16")
    return SimpleNamespace(**deployed._get.__globals__)


@given(
    total=st.integers(min_value=0, max_value=64),
    yes_weight=st.integers(min_value=0, max_value=64),
    stake=st.integers(min_value=1, max_value=10**24),
    phase=st.sampled_from([
        "CREATED", "ACTIVE", "VOID", "INCONCLUSIVE", "RESOLVED_YES", "RESOLVED_NO",
    ]),
)
@settings(max_examples=180, derandomize=True)
def test_entitlement_conservation(accounting, total, yes_weight, stake, phase):
    yes_count = min(total, yes_weight)
    no_count = total - yes_count
    _prove_payouts(accounting, yes_count, no_count, stake, phase)


@pytest.mark.parametrize(("yes_count", "no_count", "stake", "phase"), [
    (3, 2, 1, "RESOLVED_YES"),
    (2, 3, 1, "RESOLVED_NO"),
    (0, 64, 10**24, "RESOLVED_YES"),
    (64, 0, 10**24, "RESOLVED_NO"),
    (0, 0, 1, "RESOLVED_NO"),
    (32, 32, 1, "INCONCLUSIVE"),
])
def test_rounding_and_zero_winner_boundaries(accounting, yes_count, no_count, stake, phase):
    _prove_payouts(accounting, yes_count, no_count, stake, phase)


def _prove_payouts(module, yes_count, no_count, stake, phase):
    market = module._Market(
        "", 0, phase, yes_count, no_count, 0, 0, 0, "", "", "", "", "", 0,
    )
    payouts = {
        side: [
            module._entitlement(market, module._Position(side, rank, 0, 0), stake)
            for rank in range(count)
        ]
        for side, count in ((True, yes_count), (False, no_count))
    }
    accepted = (yes_count + no_count) * stake
    released = sum(payouts[True]) + sum(payouts[False])
    assert all(isinstance(amount, int) and amount >= 0 for side in payouts.values() for amount in side)
    if phase in ("CREATED", "ACTIVE"):
        assert released == 0
        return
    assert released == accepted
    if phase in ("VOID", "INCONCLUSIVE"):
        assert payouts == {True: [stake] * yes_count, False: [stake] * no_count}
        return
    winning_side = phase == "RESOLVED_YES"
    winners = payouts[winning_side]
    losers = payouts[not winning_side]
    if not winners:
        assert all(amount == stake for amount in losers)
        return
    assert all(amount == 0 for amount in losers)
    quotient = accepted // len(winners)
    assert winners[1:] == [quotient] * (len(winners) - 1)
    assert winners[0] == accepted - sum(winners[1:])


def test_real_storage_at_64_wallets(contract_source):
    vm = VMContext(_chain_id=61999)
    with vm.activate():
        _set_sender(vm, _wallet(1))
        vm.warp(_clock(0))
        market = deploy_contract(contract_source, vm, sdk_version="v0.2.16")
        from genlayer import Address

        spec = {
            "trigger_repo_id": 54, "pr_number": 3, "target_repo_id": 61,
            "release_tag": "v2.0.0", "feature": "Add feature flag support",
            "criteria": [
                {"path": "src/flag.py", "needle": "def use_flag(config):\n    return config.enabled"},
                {"path": "src/client.py", "needle": "config = load_settings()\nclient = Client(config)"},
            ],
            "cutoff": BASE + 10, "trigger_deadline": BASE + 20,
            "outcome_deadline": BASE + 40, "limit": 64, "stake": str(17),
        }
        assert market.create_market(json.dumps(spec)) == 0
        for account in range(1, 65):
            _set_sender(vm, Address(_wallet(account)), 17)
            market.predict(0, account % 2 == 0)
        _set_sender(vm, Address(_wallet(65)), 17)
        with vm.expect_revert("MARKET_FULL"):
            market.predict(0, True)
        _set_sender(vm, Address(_wallet(65)))
        assert json.loads(market.get_position(0, Address(_wallet(65)))) is None
        state = json.loads(market.get_market(0))
        assert state["yes_count"] == state["no_count"] == 32
        assert state["pool_wei"] == str(17 * 64)
        treasury = json.loads(market.get_treasury())
        assert treasury["deposited_wei"] == treasury["undispatched_pool_wei"] == str(17 * 64)
        assert treasury["dispatched_wei"] == "0"

