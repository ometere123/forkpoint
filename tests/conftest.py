"""Windows cleanup compatibility for genlayer-test 0.29.2 Direct Mode."""

import os
from pathlib import Path

from gltest.direct import loader


if os.name == "nt":
    _inject = loader._inject_message_to_fd0
    _pending_cleanup: set[Path] = set()

    def _inject_on_windows(vm):
        try:
            _inject(vm)
        except PermissionError as error:
            # By this point stdin already points at the encoded SDK message.
            # Windows blocks unlink until VMContext.activate restores stdin.
            if error.winerror != 32 or not error.filename or vm._original_stdin_fd is None:
                raise
            _pending_cleanup.add(Path(error.filename))

    loader._inject_message_to_fd0 = _inject_on_windows

    def pytest_runtest_logfinish(nodeid, location):
        for path in tuple(_pending_cleanup):
            path.unlink(missing_ok=True)
            _pending_cleanup.remove(path)
