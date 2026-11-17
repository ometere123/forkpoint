"""GitHub evidence policy. The build inserts this module into the contract."""
import ast
import base64
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import json

from genlayer import gl

GH = "https://api.github.com"
MAX_GITHUB_RESPONSE = 262144
MAX_SOURCE_BYTES = 16384
MAX_EVIDENCE_RESULT = 4096


class EvidenceUnavailable(Exception):
    pass


def _require_evidence(condition, reason="invalid_github_response"):
    if not condition:
        raise EvidenceUnavailable(reason)


def _json_object(pairs):
    result = {}
    for key, value in pairs:
        _require_evidence(key not in result)
        result[key] = value
    return result


def _invalid_json_constant(_):
    raise ValueError("JSON value is not finite")


def _github(path, min_date=None, timestamp_field=None):
    # Paths are assembled from fixed segments, validated tag names and IDs.
    try:
        response = gl.nondet.web.get(GH + path, headers={
            "accept": "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "cache-control": "no-cache, max-age=0",
            "user-agent": "Forkpoint-evidence-v1",
        })
        status = response.status
        body = response.body
        headers = {name.lower(): value for name, value in response.headers.items()}
    except Exception as exc:
        raise EvidenceUnavailable("github_transport_error") from exc

    _require_evidence(not (300 <= status < 400) and "location" not in headers, "github_redirect")
    _require_evidence(status not in (403, 429), "github_rate_limited_or_forbidden")
    _require_evidence(status != 404, "github_not_found")
    _require_evidence(status == 200, "github_http_error")
    _require_evidence(isinstance(body, bytes) and 0 < len(body) <= MAX_GITHUB_RESPONSE,
                      "github_response_size")
    _require_evidence(headers.get("content-type", b"").split(b";", 1)[0].strip().lower() == b"application/json",
                      "github_content_type")
    _require_evidence(b'rel="next"' not in headers.get("link", b"").lower(),
                      "github_unexpected_pagination")
    if min_date is not None:
        try:
            date = parsedate_to_datetime(headers["date"].decode("ascii"))
            response_time = int(date.timestamp()) if date.tzinfo is not None else -1
            fresh = response_time >= min_date
        except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
            fresh = False
        _require_evidence(fresh, "github_stale_response")
    try:
        result = json.loads(body.decode("utf-8"), object_pairs_hook=_json_object,
                            parse_constant=_invalid_json_constant)
    except (ValueError, RecursionError) as exc:
        raise EvidenceUnavailable("github_invalid_json") from exc
    _require_evidence(isinstance(result, dict))
    if timestamp_field is not None and result[timestamp_field] is not None:
        _require_evidence(_event_time(result[timestamp_field]) <= response_time,
                          "github_timestamp_after_response")
    return result


def _event_time(value):
    _require_evidence(isinstance(value, str) and len(value) == 20)
    timestamp = datetime.fromisoformat(value)
    _require_evidence(timestamp.strftime("%Y-%m-%dT%H:%M:%SZ") == value and
                      timestamp.utcoffset() == timezone.utc.utcoffset(None))
    return int(timestamp.timestamp())


def _github_id(value):
    _require_evidence(type(value) is int and 0 < value < 2**53)
    return value


def _git_sha(value):
    _require_evidence(isinstance(value, str) and len(value) == 40 and
                      all(ch in "0123456789abcdef" for ch in value))
    return value


def _repo_path(repo_id):
    return "/repositories/" + str(repo_id)


def _repo_name(repo_id):
    repo = _github(_repo_path(repo_id))
    _require_evidence(_github_id(repo["id"]) == repo_id and repo["private"] is False,
                      "github_repository_identity")
    name = repo["full_name"]
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-"
    _require_evidence(isinstance(name, str) and len(name) <= 160 and name.count("/") == 1)
    _require_evidence(all(segment and segment not in (".", "..") and
                          all(ch in alphabet for ch in segment) for segment in name.split("/")))
    return name


def _trigger_findings(spec, created_at):
    repo_id = spec["trigger_repo_id"]
    pr_ref = _repo_path(repo_id) + "/pulls/" + str(spec["pr_number"])
    pr = _github(pr_ref, spec["trigger_deadline"] + 1, "merged_at")
    _require_evidence(_github_id(pr["base"]["repo"]["id"]) == repo_id and
                      pr["base"]["repo"]["private"] is False and
                      _github_id(pr["number"]) == spec["pr_number"],
                      "github_pull_identity")
    result = {"repo_id": repo_id, "pr_id": _github_id(pr["id"]),
              "pr_number": spec["pr_number"], "sources": [GH + pr_ref]}
    merged = pr["merged"]
    state = pr["state"]
    _require_evidence(type(merged) is bool and state in ("open", "closed"))
    if not merged:
        _require_evidence(pr["merged_at"] is None)
        return {**result, "verdict": "VOID", "reason": "pull_unmerged_at_deadline"}
    _require_evidence(state == "closed")
    merged_at = _event_time(pr["merged_at"])
    result.update(merged_at=merged_at, merge_sha=_git_sha(pr["merge_commit_sha"]))
    if merged_at <= created_at or merged_at < spec["cutoff"]:
        return {**result, "verdict": "VOID", "reason": "pull_merged_before_eligible_window"}
    if merged_at > spec["trigger_deadline"]:
        return {**result, "verdict": "VOID", "reason": "pull_merged_after_deadline"}
    return {**result, "verdict": "ACTIVE", "reason": "pull_merged_in_window"}


def _release_commit(repo_path, tag):
    ref_path = repo_path + "/git/ref/tags/" + tag
    ref = _github(ref_path)
    _require_evidence(ref["ref"] == "refs/tags/" + tag)
    target = ref["object"]
    sha = _git_sha(target["sha"])
    tag_sha = sha
    sources = [GH + ref_path]
    if target["type"] == "tag":
        tag_path = repo_path + "/git/tags/" + sha
        tag_object = _github(tag_path)
        _require_evidence(_git_sha(tag_object["sha"]) == sha and tag_object["tag"] == tag)
        target = tag_object["object"]
        sha = _git_sha(target["sha"])
        sources.append(GH + tag_path)
    _require_evidence(target["type"] == "commit", "github_release_tag_target")
    commit_path = repo_path + "/git/commits/" + sha
    commit = _github(commit_path)
    _require_evidence(_git_sha(commit["sha"]) == sha)
    sources.append(GH + commit_path)
    return tag_sha, sha, _git_sha(commit["tree"]["sha"]), sources


def _release_blob(repo_path, sha, expected_size):
    _require_evidence(type(expected_size) is int and 0 <= expected_size <= MAX_SOURCE_BYTES,
                      "github_blob_size")
    path = repo_path + "/git/blobs/" + sha
    blob = _github(path)
    _require_evidence(_git_sha(blob["sha"]) == sha and blob["encoding"] == "base64" and
                      type(blob["size"]) is int and blob["size"] == expected_size)
    encoded = blob["content"]
    _require_evidence(isinstance(encoded, str) and len(encoded) <= 24000)
    raw = base64.b64decode(encoded.replace("\n", ""), validate=True)
    _require_evidence(len(raw) == expected_size)
    git_bytes = ("blob " + str(len(raw)) + "\0").encode("ascii") + raw
    _require_evidence(hashlib.sha1(git_bytes).hexdigest() == sha, "github_blob_digest")
    text = raw.decode("utf-8")
    _require_evidence("\0" not in text, "github_blob_binary")
    return text.replace("\r\n", "\n"), hashlib.sha256(raw).hexdigest(), GH + path


def _python_block(statements):
    if statements:
        yield statements
    for statement in statements:
        yield from _python_blocks(statement)


def _python_blocks(node):
    if isinstance(node, (ast.If, ast.While)) and isinstance(node.test, ast.Constant):
        yield from _python_block(node.body if node.test.value else node.orelse)
        return
    if isinstance(node, ast.If):
        condition = node.test
        if ((isinstance(condition, ast.Name) and condition.id == "TYPE_CHECKING") or
            (isinstance(condition, ast.Attribute) and condition.attr == "TYPE_CHECKING")):
            yield from _python_block(node.orelse)
            return
    for _, value in ast.iter_fields(node):
        if isinstance(value, list):
            if value and isinstance(value[0], ast.stmt):
                yield from _python_block(value)
            else:
                for child in value:
                    if isinstance(child, ast.AST):
                        yield from _python_blocks(child)
        elif isinstance(value, ast.AST):
            yield from _python_blocks(value)


def _substantive_python_node(node):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return any(_substantive_python_node(statement)
                   for block in _python_blocks(node) for statement in block)
    if isinstance(node, ast.Expr):
        return isinstance(node.value, ast.Call)
    if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.Return)):
        return node.value is not None and not isinstance(node.value, ast.Constant)
    return False


def _line_marker_match(path, text, needle):
    if not path.lower().endswith(".py"):
        match = ("\n" + needle + "\n") in ("\n" + text + "\n")
        return match, "lines_match" if match else "lines_missing"

    try:
        module = ast.parse(text, filename=path)
        blocks = list(_python_blocks(module))
    except (SyntaxError, RecursionError) as exc:
        raise EvidenceUnavailable("github_python_source_unparseable") from exc
    lines = text.split("\n")
    marker = needle.split("\n")
    for block in blocks:
        for start, statement in enumerate(block):
            first = statement.lineno - 1
            last = first + len(marker)
            if lines[first:last] != marker:
                continue
            meaningful = False
            for candidate in block[start:]:
                if candidate.end_lineno > last:
                    break
                meaningful = meaningful or _substantive_python_node(candidate)
                if candidate.end_lineno == last and meaningful:
                    return True, "python_statement_match"
    return False, "python_statement_missing"

def _criteria_findings(spec, repo_path, tree_sha):
    tree_path = repo_path + "/git/trees/" + tree_sha + "?recursive=1"
    tree = _github(tree_path)
    _require_evidence(_git_sha(tree["sha"]) == tree_sha and tree["truncated"] is False,
                      "github_tree_incomplete")
    _require_evidence(isinstance(tree["tree"], list))
    wanted = {criterion["path"] for criterion in spec["criteria"]}
    found = {}
    for entry in tree["tree"]:
        path = entry["path"]
        _require_evidence(isinstance(path, str))
        if path in wanted:
            _require_evidence(path not in found, "github_tree_duplicate")
            found[path] = entry
    sources = [GH + tree_path]
    blobs = {}
    checks = []
    for criterion in spec["criteria"]:
        path = criterion["path"]
        needle = criterion["needle"]
        finding = {"path": path, "criterion_sha256": hashlib.sha256(needle.encode("utf-8")).hexdigest(),
                   "matched": False}
        entry = found.get(path)
        if entry is None:
            finding["reason"] = "path_missing_in_complete_tree"
        elif entry["type"] != "blob" or entry["mode"] not in ("100644", "100755"):
            non_regular_modes = {"040000": "tree", "120000": "blob", "160000": "commit"}
            _require_evidence(entry["mode"] in non_regular_modes and
                              non_regular_modes[entry["mode"]] == entry["type"])
            finding.update(reason="path_not_regular_file", mode=entry["mode"], sha=_git_sha(entry["sha"]))
        else:
            sha = _git_sha(entry["sha"])
            if sha not in blobs:
                text, digest, source = _release_blob(repo_path, sha, entry["size"])
                blobs[sha] = (text, digest, source, entry["size"])
                sources.append(source)
            text, digest, source, size = blobs[sha]
            _require_evidence(type(entry["size"]) is int and entry["size"] == size)
            match, reason = _line_marker_match(path, text, needle)
            finding.update(matched=match, reason=reason,
                           sha=sha, content_sha256=digest, source=source)
        checks.append(finding)
    return checks, sources


def _outcome_findings(spec, merged_at):
    repo_id = spec["target_repo_id"]
    repo_path = _repo_path(repo_id)
    name = _repo_name(repo_id)
    tag = spec["release_tag"]
    release_path = repo_path + "/releases/tags/" + tag
    release = _github(release_path, spec["outcome_deadline"] + 1, "published_at")
    release_id = _github_id(release["id"])
    canonical_release_url = GH + "/repos/" + name + "/releases/" + str(release_id)
    _require_evidence(release["tag_name"] == tag and release["url"] == canonical_release_url,
                      "github_release_identity")
    _require_evidence(release["draft"] is False and release["immutable"] is True,
                      "github_release_not_immutable")
    published_at = _event_time(release["published_at"])
    result = {"repo_id": repo_id, "release_id": release_id, "release_tag": tag,
              "published_at": published_at, "sources": [GH + release_path]}
    if not merged_at < published_at <= spec["outcome_deadline"]:
        return {**result, "verdict": "RESOLVED_NO", "reason": "release_outside_window"}
    tag_sha, commit_sha, tree_sha, sources = _release_commit(repo_path, tag)
    checks, source_refs = _criteria_findings(spec, repo_path, tree_sha)
    corroboration = _github(release_path, spec["outcome_deadline"] + 1, "published_at")
    release_facts = ("id", "tag_name", "url", "draft", "immutable", "published_at")
    _require_evidence(all(type(corroboration[key]) is type(release[key]) and
                          corroboration[key] == release[key] for key in release_facts),
                      "github_release_changed_during_assessment")
    matched = all(criterion["matched"] for criterion in checks)
    return {**result, "verdict": "RESOLVED_YES" if matched else "RESOLVED_NO",
            "reason": "all_frozen_lines_found" if matched else "frozen_lines_missing",
            "tag_sha": tag_sha, "commit_sha": commit_sha, "tree_sha": tree_sha,
            "checks": checks, "sources": result["sources"] + sources + source_refs}


def _evidence_consensus(spec, timestamp, trigger):
    def propose():
        try:
            result = _trigger_findings(spec, timestamp) if trigger else _outcome_findings(spec, timestamp)
        except EvidenceUnavailable as exc:
            result = {"verdict": "INCONCLUSIVE", "reason": str(exc)}
        except (KeyError, ValueError, TypeError, OverflowError, RecursionError):
            result = {"verdict": "INCONCLUSIVE", "reason": "invalid_github_response"}
        canonical = json.dumps(result, sort_keys=True, separators=(",", ":"))
        if len(canonical) > MAX_EVIDENCE_RESULT:
            return '{"reason":"github_result_size","verdict":"INCONCLUSIVE"}'
        return canonical

    def independently_verify(leader):
        if not isinstance(leader, gl.vm.Return) or not isinstance(leader.calldata, str):
            return False
        return len(leader.calldata) <= MAX_EVIDENCE_RESULT and leader.calldata == propose()

    return json.loads(gl.vm.run_nondet_unsafe(propose, independently_verify))


def assess_trigger(spec, created_at):
    return _evidence_consensus(spec, created_at, True)


def assess_outcome(spec, merged_at):
    return _evidence_consensus(spec, merged_at, False)
