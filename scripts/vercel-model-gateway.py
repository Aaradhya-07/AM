#!/usr/bin/env python3
"""Proxy the model API on loopback for one Vercel production project."""

import argparse
import http.client
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import jwt


MAX_REQUEST_BYTES = 8 * 1024 * 1024
MAX_CONNECTIONS = 16
UPSTREAM_TIMEOUT_SECONDS = 240


class Gateway(ThreadingHTTPServer):
    def __init__(self, port, upstream_port, owner, project):
        self.upstream_port = upstream_port
        self.audience = f"https://vercel.com/{owner}"
        self.subject = f"owner:{owner}:project:{project}:environment:production"
        self.issuers = {
            issuer: jwt.PyJWKClient(f"{issuer}/.well-known/jwks", timeout=4)
            for issuer in ("https://oidc.vercel.com", f"https://oidc.vercel.com/{owner}")
        }
        self.connections = threading.BoundedSemaphore(MAX_CONNECTIONS)
        self.inference = threading.BoundedSemaphore(1)
        super().__init__(("127.0.0.1", port), ModelRequest)

    def process_request(self, request, client_address):
        if not self.connections.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.connections.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connections.release()

    def authorized(self, authorization):
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not 0 < len(token) <= 4096:
            return False
        try:
            # Select a trusted key source from a fixed list before verifying claims.
            issuer = jwt.decode(token, options={"verify_signature": False}).get("iss")
            if not isinstance(issuer, str) or issuer not in self.issuers:
                return False
            if jwt.get_unverified_header(token).get("alg") != "RS256":
                return False
            key = self.issuers[issuer].get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                audience=self.audience,
                issuer=issuer,
                options={"require": ["exp", "iat", "nbf", "sub"]},
            )
            return claims["sub"] == self.subject
        except (jwt.PyJWTError, OSError, ValueError, TypeError):
            return False


class ModelRequest(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(15)
        super().setup()

    def log_message(self, _format, *_args):
        # Keep paths, request bodies, and credentials out of logs.
        pass

    def do_GET(self):
        if self.allowed("/v1/models"):
            self.forward()

    def do_POST(self):
        if not self.allowed("/v1/chat/completions"):
            return
        lengths = self.headers.get_all("Content-Length", [])
        if (
            len(lengths) != 1
            or not re.fullmatch(r"[0-9]{1,8}", lengths[0])
            or self.headers.get("Transfer-Encoding")
        ):
            self.send_error(411)
            return
        length = int(lengths[0])
        if not 0 < length <= MAX_REQUEST_BYTES:
            self.send_error(413)
            return
        if self.headers.get_content_type() != "application/json":
            self.send_error(415)
            return
        if not self.server.inference.acquire(blocking=False):
            self.send_error(429)
            return
        try:
            try:
                body = self.rfile.read(length)
            except OSError:
                self.send_error(408)
                return
            if len(body) != length:
                self.send_error(400)
                return
            self.forward(body)
        finally:
            self.server.inference.release()

    def allowed(self, path):
        if self.path != path:
            self.send_error(404)
            return False
        if not self.server.authorized(self.headers.get("Authorization", "")):
            self.send_error(401)
            return False
        return True

    def forward(self, body=None):
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.server.upstream_port, timeout=UPSTREAM_TIMEOUT_SECONDS
        )
        try:
            try:
                connection.request(
                    self.command,
                    self.path,
                    body=body,
                    headers={"Content-Type": "application/json"} if body else {},
                )
                response = connection.getresponse()
            except (OSError, http.client.HTTPException):
                self.send_error(502)
                return

            self.send_response(response.status)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            for name in ("Content-Type", "Content-Length"):
                if value := response.getheader(name):
                    self.send_header(name, value)
            self.end_headers()
            while chunk := response.read1(16 * 1024):
                self.wfile.write(chunk)
        except (OSError, http.client.HTTPException):
            self.close_connection = True
        finally:
            connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--upstream-port", type=int, default=8080)
    args = parser.parse_args()
    for name in (args.owner, args.project):
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", name):
            parser.error("Expected a Vercel owner and project slug.")
    with Gateway(args.port, args.upstream_port, args.owner, args.project) as gateway:
        gateway.serve_forever()
