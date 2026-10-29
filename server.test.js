import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer as createProbeServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import vm from "node:vm";
import loginHandler from "./api/login.js";
import sessionHandler from "./api/session.js";

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

class FakeElement {
    constructor() {
        this.hidden = false;
        this.disabled = false;
        this.value = "";
        this.children = [];
        this.listeners = {};
        this._textContent = "";
    }

    get textContent() {
        return this._textContent;
    }

    set textContent(value) {
        this._textContent = String(value);
    }

    addEventListener(type, callback) {
        this.listeners[type] = callback;
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    replaceChildren(...children) {
        this.children = children;
    }
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
        const stylesheet = await fetch(`${baseUrl}/style.css`);
        assert.equal(stylesheet.status, 200);
        assert.match(await stylesheet.text(), /\.login-panel/);
        const frontendScript = await fetch(`${baseUrl}/script.js`);
        assert.equal(frontendScript.status, 200);
        const scriptText = await frontendScript.text();
        assert.match(scriptText, /api\/login/);
        assert.match(scriptText, /assistRequests/);
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
        assert.equal(oversizedResponse.status, 413);
    } finally {
        child.kill();
        await once(child, "exit");
    }
});

test("Vercel function handlers accept credentials and verify the issued session", async () => {
    const previousEnvironment = {
        LOGIN_USERNAME: process.env.LOGIN_USERNAME,
        LOGIN_PASSWORD: process.env.LOGIN_PASSWORD,
        JWT_SECRET: process.env.JWT_SECRET
    };
    const originalConsoleError = console.error;
    process.env.LOGIN_USERNAME = username;
    process.env.LOGIN_PASSWORD = password;
    process.env.JWT_SECRET = secret;

    try {
        const loginResponse = await loginHandler.fetch(new Request("http://localhost/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        }));
        assert.equal(loginResponse.status, 200);
        const { token } = await loginResponse.json();

        const sessionResponse = await sessionHandler.fetch(new Request("http://localhost/api/session", {
            headers: { authorization: `Bearer ${token}` }
        }));
        assert.equal(sessionResponse.status, 200);
        assert.equal((await sessionResponse.json()).username, username);

        const wrongMethodResponse = await loginHandler.fetch(
            new Request("http://localhost/api/login")
        );
        assert.equal(wrongMethodResponse.status, 405);
        assert.equal(wrongMethodResponse.headers.get("allow"), "POST");

        delete process.env.JWT_SECRET;
        let configurationErrorWasLogged = false;
        console.error = (message, error) => {
            configurationErrorWasLogged = message === "Authentication API request failed." &&
                error.message.includes("JWT_SECRET");
        };
        const missingConfigurationResponse = await loginHandler.fetch(
            new Request("http://localhost/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            })
        );
        assert.equal(missingConfigurationResponse.status, 500);
        assert.equal(configurationErrorWasLogged, true);
    } finally {
        console.error = originalConsoleError;
        for (const [key, value] of Object.entries(previousEnvironment)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});

test("dashboard creates, persists, completes, reopens, and logs out requests", async () => {
    const script = await readFile(new URL("./public/script.js", import.meta.url), "utf8");
    const savedRequests = new Map();
    const storedSession = new Map();
    const token = "test-session-token";

    function createBrowser() {
        const elements = new Map();
        const ids = [
            "loginView", "appShell", "loginForm", "loginError", "loginButton",
            "userTag", "logoutButton", "requestForm", "requestList", "totalCount",
            "pendingCount", "completedCount", "username", "password", "requester",
            "requestTitle", "priority"
        ];
        ids.forEach(id => elements.set(id, new FakeElement()));

        const document = {
            getElementById(id) {
                return elements.get(id);
            },
            createElement() {
                return new FakeElement();
            }
        };
        const requestForm = elements.get("requestForm");
        requestForm.reset = () => {
            elements.get("requester").value = "";
            elements.get("requestTitle").value = "";
            elements.get("priority").value = "Medium";
        };
        elements.get("priority").value = "Medium";

        const sessionStorage = {
            getItem(key) {
                return storedSession.get(key) ?? null;
            },
            setItem(key, value) {
                storedSession.set(key, String(value));
            },
            removeItem(key) {
                storedSession.delete(key);
            }
        };
        const localStorage = {
            getItem(key) {
                return savedRequests.get(key) ?? null;
            },
            setItem(key, value) {
                savedRequests.set(key, String(value));
            }
        };
        const fetch = async (url, options = {}) => {
            if (url === "/api/login") {
                return {
                    ok: true,
                    json: async () => ({ token, tokenType: "Bearer", expiresIn: 3600 })
                };
            }
            assert.equal(url, "/api/session");
            assert.equal(options.headers.Authorization, `Bearer ${token}`);
            return {
                ok: true,
                json: async () => ({ username })
            };
        };

        vm.runInNewContext(script, { document, sessionStorage, localStorage, fetch });
        return { elements, sessionStorage };
    }

    const browser = createBrowser();
    const { elements } = browser;
    elements.get("username").value = username;
    elements.get("password").value = password;
    await elements.get("loginForm").listeners.submit({ preventDefault() {} });
    assert.equal(elements.get("appShell").hidden, false);
    assert.equal(elements.get("userTag").textContent, username);
    assert.equal(browser.sessionStorage.getItem("assistToken"), token);

    elements.get("requester").value = "Alex";
    elements.get("requestTitle").value = "Project assistance";
    elements.get("priority").value = "High";
    elements.get("requestForm").onsubmit({ preventDefault() {} });
    assert.equal(elements.get("totalCount").textContent, "1");
    assert.equal(elements.get("pendingCount").textContent, "1");
    assert.equal(elements.get("completedCount").textContent, "0");

    const actionButton = elements.get("requestList").children[0].children[4].children[0];
    actionButton.listeners.click();
    assert.equal(elements.get("completedCount").textContent, "1");
    assert.equal(JSON.parse(savedRequests.get("assistRequests"))[0].status, "Completed");

    const refreshedBrowser = createBrowser();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(refreshedBrowser.elements.get("totalCount").textContent, "1");
    assert.equal(refreshedBrowser.elements.get("completedCount").textContent, "1");
    const reopenedButton = refreshedBrowser.elements.get("requestList").children[0]
        .children[4].children[0];
    reopenedButton.listeners.click();
    assert.equal(refreshedBrowser.elements.get("pendingCount").textContent, "1");

    refreshedBrowser.elements.get("logoutButton").listeners.click();
    assert.equal(refreshedBrowser.sessionStorage.getItem("assistToken"), null);
    assert.equal(refreshedBrowser.elements.get("appShell").hidden, true);
    assert.equal(refreshedBrowser.elements.get("loginView").hidden, false);
});
