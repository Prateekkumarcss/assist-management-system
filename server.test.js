import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer as createProbeServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

const username = "test-admin";
const password = "test-password";
const secret = "temporary-test-secret-0123456789abcdef";

function signTestToken(payload, header = { alg: "HS256", typ: "JWT" }) {
    const headerPart = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signingInput = `${headerPart}.${payloadPart}`;
    const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
    return `${signingInput}.${signature}`;
}

async function getAvailablePort() {
    const probe = createProbeServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const { port } = probe.address();
    await new Promise(resolve => probe.close(resolve));
    return port;
}

test("login API, session verification, and frontend delivery", async () => {
    const port = await getAvailablePort();
    const child = spawn(process.execPath, ["server.js"], {
        env: {
            ...process.env,
            PORT: String(port),
            LOGIN_USERNAME: username,
            LOGIN_PASSWORD: password,
            JWT_SECRET: secret
        },
        stdio: "ignore"
    });
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        let ready = false;
        for (let attempt = 0; attempt < 40; attempt++) {
            try {
                await fetch(baseUrl);
                ready = true;
                break;
            } catch {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        assert.equal(ready, true, "server starts and serves the frontend");

        const page = await fetch(baseUrl);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /id="loginForm"/);
        assert.equal((await fetch(`${baseUrl}/style.css`)).status, 200);
        assert.equal((await fetch(`${baseUrl}/script.js`)).status, 200);
        assert.equal((await fetch(`${baseUrl}/unknown`)).status, 404);

        const login = async credentials => fetch(`${baseUrl}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials)
        });

        const validResponse = await login({ username, password });
        assert.equal(validResponse.status, 200);
        const validResult = await validResponse.json();
        assert.equal(validResult.tokenType, "Bearer");
        assert.equal(validResult.expiresIn, 3600);
        assert.equal(validResult.token.split(".").length, 3);

        const sessionResponse = await fetch(`${baseUrl}/api/session`, {
            headers: { Authorization: `Bearer ${validResult.token}` }
        });
        assert.equal(sessionResponse.status, 200);
        assert.equal((await sessionResponse.json()).username, username);

        const invalidTokenResponse = await fetch(`${baseUrl}/api/session`, {
            headers: { Authorization: "Bearer invalid.token.value" }
        });
        assert.equal(invalidTokenResponse.status, 401);

        const tamperedTokenResponse = await fetch(`${baseUrl}/api/session`, {
            headers: { Authorization: `Bearer ${validResult.token.slice(0, -1)}x` }
        });
        assert.equal(tamperedTokenResponse.status, 401);

        const expiredToken = signTestToken({ sub: username, exp: Math.floor(Date.now() / 1000) - 1 });
        const expiredTokenResponse = await fetch(`${baseUrl}/api/session`, {
            headers: { Authorization: `Bearer ${expiredToken}` }
        });
        assert.equal(expiredTokenResponse.status, 401);

        const wrongAlgorithmToken = signTestToken(
            { sub: username, exp: Math.floor(Date.now() / 1000) + 60 },
            { alg: "none", typ: "JWT" }
        );
        const wrongAlgorithmResponse = await fetch(`${baseUrl}/api/session`, {
            headers: { Authorization: `Bearer ${wrongAlgorithmToken}` }
        });
        assert.equal(wrongAlgorithmResponse.status, 401);

        const missingTokenResponse = await fetch(`${baseUrl}/api/session`);
        assert.equal(missingTokenResponse.status, 401);

        assert.equal((await login({ username, password: "wrong" })).status, 401);
        assert.equal((await login({ username: "wrong", password })).status, 401);
        assert.equal((await login({})).status, 401);

        const malformedResponse = await fetch(`${baseUrl}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{invalid json"
        });
        assert.equal(malformedResponse.status, 400);

        const oversizedResponse = await fetch(`${baseUrl}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ padding: "x".repeat(10_240) })
        });
        assert.equal(oversizedResponse.status, 400);
    } finally {
        child.kill();
        await once(child, "exit");
    }
});
