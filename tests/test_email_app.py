import contextlib
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class FakeResponse:
    def __init__(self, body, status=200):
        self.body = body
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def getcode(self):
        return self.status

    def read(self):
        return self.body


class EmailAppTests(unittest.TestCase):
    def test_dry_run_does_not_load_credentials_or_send(self):
        output = io.StringIO()
        with (
            mock.patch.object(app, "load_project_environment") as load_environment,
            mock.patch.object(app, "send_authenticated_payload") as send_payload,
            contextlib.redirect_stdout(output),
        ):
            result = app.main(["--to", "Student@Students.ISATU.edu.ph"])

        self.assertEqual(result, 0)
        self.assertIn("Dry run only. No email was sent", output.getvalue())
        load_environment.assert_not_called()
        send_payload.assert_not_called()

    def test_recipient_must_be_an_isatu_email(self):
        error_output = io.StringIO()
        with contextlib.redirect_stderr(error_output), self.assertRaises(SystemExit) as error:
            app.main(["--to", "person@example.com", "--send"])

        self.assertEqual(error.exception.code, 2)
        self.assertIn("must be an ISAT U email address", error_output.getvalue())

    def test_test_email_uses_authenticated_gas_envelope(self):
        response = FakeResponse(b'{"ok":true,"sent":1}')
        with (
            mock.patch.dict(os.environ, {
                "GAS_API_URL": "https://script.google.com/macros/s/test-deployment/exec",
                "GAS_API_SECRET": "test-secret-with-at-least-thirty-two-characters",
            }),
            mock.patch.object(app.time, "time", return_value=1_800_000_000),
            mock.patch.object(app.secrets, "token_hex", return_value="a" * 32),
            mock.patch.object(app.urllib.request, "urlopen", return_value=response) as urlopen,
        ):
            app.send_authenticated_payload({
                "event": "test_email",
                "email": "student@students.isatu.edu.ph",
            }, 1)

        request = urlopen.call_args.args[0]
        envelope = json.loads(request.data)
        self.assertEqual(request.full_url, "https://script.google.com/macros/s/test-deployment/exec")
        self.assertEqual(envelope["secret"], "test-secret-with-at-least-thirty-two-characters")
        self.assertEqual(envelope["timestamp"], "1800000000")
        self.assertEqual(envelope["nonce"], "a" * 32)
        self.assertEqual(json.loads(envelope["payload"]), {
            "event": "test_email",
            "email": "student@students.isatu.edu.ph",
        })

    def test_auth_check_requires_mailapp_readiness_without_sending(self):
        response = FakeResponse(
            b'{"ok":true,"authorized":true,"emailReady":true,"remainingQuota":7}'
        )
        with (
            mock.patch.dict(os.environ, {
                "GAS_API_URL": "https://script.google.com/macros/s/test-deployment/exec",
                "GAS_API_SECRET": "test-secret-with-at-least-thirty-two-characters",
            }),
            mock.patch.object(app.urllib.request, "urlopen", return_value=response),
        ):
            result = app.send_authenticated_payload({"event": "auth_check"}, 0)

        self.assertEqual(result["remainingQuota"], 7)

    def test_auth_check_accepts_working_api_response_without_quota_metadata(self):
        response = FakeResponse(b'{"ok":true,"authorized":true}')
        with (
            mock.patch.dict(os.environ, {
                "GAS_API_URL": "https://script.google.com/macros/s/test-deployment/exec",
                "GAS_API_SECRET": "test-secret-with-at-least-thirty-two-characters",
            }),
            mock.patch.object(app.urllib.request, "urlopen", return_value=response),
        ):
            result = app.send_authenticated_payload({"event": "auth_check"}, 0)

        self.assertTrue(result["authorized"])

    def test_auth_check_fails_when_mailapp_quota_is_exhausted(self):
        response = FakeResponse(
            b'{"ok":true,"authorized":true,"emailReady":false,"remainingQuota":0}'
        )
        with (
            mock.patch.dict(os.environ, {
                "GAS_API_URL": "https://script.google.com/macros/s/test-deployment/exec",
                "GAS_API_SECRET": "test-secret-with-at-least-thirty-two-characters",
            }),
            mock.patch.object(app.urllib.request, "urlopen", return_value=response),
            self.assertRaisesRegex(app.GasApiError, "daily recipient quota is exhausted"),
        ):
            app.send_authenticated_payload({"event": "auth_check"}, 0)

    def test_auth_check_reports_mailapp_authorization_errors(self):
        response = FakeResponse(
            b'{"ok":false,"error":"Email could not be sent: permission is required."}'
        )
        with (
            mock.patch.dict(os.environ, {
                "GAS_API_URL": "https://script.google.com/macros/s/test-deployment/exec",
                "GAS_API_SECRET": "test-secret-with-at-least-thirty-two-characters",
            }),
            mock.patch.object(app.urllib.request, "urlopen", return_value=response),
            self.assertRaisesRegex(app.GasApiError, "authorizeEmailService"),
        ):
            app.send_authenticated_payload({"event": "auth_check"}, 0)


if __name__ == "__main__":
    unittest.main()
