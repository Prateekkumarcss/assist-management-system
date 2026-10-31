import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer as createProbeServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import vm from "node:vm";
import loginHandler from "./api/login.js";
import registerHandler from "./api/register.js";
import requestsHandler from "./api/requests.js";
import sessionHandler from "./api/session.js";
import { hashPassword, verifyPassword } from "./lib/supabase.js";

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
        this.type = "text";
        this.className = "";
        this.dataset = {};
        this.style = {};
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

    setAttribute(name, value) {
        this[name] = String(value);
    }

    focus() {}

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
            JWT_SECRET: secret,
            SUPABASE_URL: "",
            SUPABASE_SERVICE_ROLE_KEY: ""
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
        assert.match(await stylesheet.text(), /\.auth-panel/);
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

        const administratorRequestAccess = await fetch(`${baseUrl}/api/requests`, {
            headers: { Authorization: `Bearer ${validResult.token}` }
        });
        assert.equal(administratorRequestAccess.status, 403);
        const registrationStatus = await fetch(`${baseUrl}/api/register`);
        assert.equal(registrationStatus.status, 200);
        assert.equal((await registrationStatus.json()).available, false);
        const registrationWithoutDatabase = await fetch(`${baseUrl}/api/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                fullName: "Test User", username: "new-user", email: "new@example.com", password: "valid-password"
            })
        });
        assert.equal(registrationWithoutDatabase.status, 503);

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

test("registered accounts and requests use the Supabase-backed APIs", async () => {
    const previousEnvironment = {
        LOGIN_USERNAME: process.env.LOGIN_USERNAME,
        LOGIN_PASSWORD: process.env.LOGIN_PASSWORD,
        JWT_SECRET: process.env.JWT_SECRET,
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
    };
    const originalFetch = globalThis.fetch;
    const adminSecret = "temporary-account-test-secret-0123456789abcdef";
    const accountId = "123e4567-e89b-42d3-a456-426614174000";
    const requestId = "123e4567-e89b-42d3-a456-426614174001";
    const users = [];
    const requests = [];
    process.env.LOGIN_USERNAME = "legacy-admin";
    process.env.LOGIN_PASSWORD = "legacy-password";
    process.env.JWT_SECRET = adminSecret;
    process.env.SUPABASE_URL = "https://assist-test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

    globalThis.fetch = async (input, options = {}) => {
        const url = new URL(input);
        const table = url.pathname.endsWith("/assist_users") ? "users" : "requests";
        const body = options.body ? JSON.parse(options.body) : null;
        const filters = Object.fromEntries(url.searchParams);

        if (table === "users" && options.method === "POST") {
            if (users.some(user => user.username === body.username || user.email === body.email)) {
                return Response.json({ code: "23505" }, { status: 409 });
            }
            const user = { id: accountId, created_at: new Date().toISOString(), ...body };
            users.push(user);
            return Response.json([user]);
        }
        if (table === "users") {
            const [field, expected] = Object.entries(filters).find(([key]) => ["username", "email"].includes(key)) || [];
            return Response.json(users.filter(user => field && user[field] === expected?.slice(3)));
        }

        const belongsToAccount = row => row.user_id === filters.user_id?.slice(3);
        const selected = requests.filter(row => belongsToAccount(row) &&
            (!filters.id || row.id === filters.id.slice(3)));
        if (options.method === "POST") {
            const row = { id: requestId, created_at: new Date().toISOString(), ...body };
            requests.push(row);
            return Response.json([row]);
        }
        if (options.method === "PATCH") {
            selected.forEach(row => Object.assign(row, body));
            return Response.json(selected);
        }
        if (options.method === "DELETE") {
            selected.forEach(row => requests.splice(requests.indexOf(row), 1));
            return Response.json(selected.map(row => ({ id: row.id })));
        }
        return Response.json(selected);
    };

    try {
        const hashed = await hashPassword("correct-horse-battery");
        assert.notEqual(hashed.hash, "correct-horse-battery");
        assert.equal(await verifyPassword("correct-horse-battery", hashed.salt, hashed.hash), true);
        assert.equal(await verifyPassword("incorrect-password", hashed.salt, hashed.hash), false);

        const invalidRegistration = await registerHandler.fetch(new Request("http://localhost/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fullName: "Test User", username: "bad", email: "invalid", password: "short" })
        }));
        assert.equal(invalidRegistration.status, 400);

        const registrationBody = {
            fullName: "Test User",
            username: "test.user",
            email: "test@example.com",
            password: "correct-horse-battery"
        };
        const registration = await registerHandler.fetch(new Request("http://localhost/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(registrationBody)
        }));
        assert.equal(registration.status, 201);
        const registered = await registration.json();
        assert.equal(registered.account.fullName, registrationBody.fullName);
        assert.equal(await verifyPassword(registrationBody.password, users[0].password_salt, users[0].password_hash), true);
        assert.notEqual(users[0].password_hash, registrationBody.password);

        const duplicate = await registerHandler.fetch(new Request("http://localhost/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(registrationBody)
        }));
        assert.equal(duplicate.status, 409);

        const login = await loginHandler.fetch(new Request("http://localhost/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: registrationBody.email, password: registrationBody.password })
        }));
        assert.equal(login.status, 200);
        const { token } = await login.json();
        const authorization = { authorization: `Bearer ${token}` };
        const session = await sessionHandler.fetch(new Request("http://localhost/api/session", { headers: authorization }));
        const sessionBody = await session.json();
        assert.equal(sessionBody.id, accountId);
        assert.equal(sessionBody.fullName, registrationBody.fullName);
        assert.equal(sessionBody.email, registrationBody.email);

        const list = await requestsHandler.fetch(new Request("http://localhost/api/requests", { headers: authorization }));
        assert.deepEqual((await list.json()).requests, []);
        const create = await requestsHandler.fetch(new Request("http://localhost/api/requests", {
            method: "POST",
            headers: { ...authorization, "Content-Type": "application/json" },
            body: JSON.stringify({ requester: "Test User", title: "Account request", priority: "High" })
        }));
        assert.equal(create.status, 201);
        assert.equal((await create.json()).request.id, requestId);

        const otherAccountId = "123e4567-e89b-42d3-a456-426614174099";
        const headerPart = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
        const payloadPart = Buffer.from(JSON.stringify({
            sub: "another.user",
            uid: otherAccountId,
            exp: Math.floor(Date.now() / 1000) + 3600
        })).toString("base64url");
        const signingInput = `${headerPart}.${payloadPart}`;
        const otherToken = `${signingInput}.${createHmac("sha256", adminSecret).update(signingInput).digest("base64url")}`;
        const otherAuthorization = { authorization: `Bearer ${otherToken}` };
        const isolatedList = await requestsHandler.fetch(new Request("http://localhost/api/requests", {
            headers: otherAuthorization
        }));
        assert.deepEqual((await isolatedList.json()).requests, []);
        const crossAccountDelete = await requestsHandler.fetch(new Request("http://localhost/api/requests", {
            method: "DELETE",
            headers: { ...otherAuthorization, "Content-Type": "application/json" },
            body: JSON.stringify({ id: requestId })
        }));
        assert.equal(crossAccountDelete.status, 404);
        assert.equal(requests.length, 1);

        const update = await requestsHandler.fetch(new Request("http://localhost/api/requests", {
            method: "PATCH",
            headers: { ...authorization, "Content-Type": "application/json" },
            body: JSON.stringify({ id: requestId, requester: "Test User", title: "Account request", priority: "High", status: "Completed" })
        }));
        assert.equal((await update.json()).request.status, "Completed");

        const remove = await requestsHandler.fetch(new Request("http://localhost/api/requests", {
            method: "DELETE",
            headers: { ...authorization, "Content-Type": "application/json" },
            body: JSON.stringify({ id: requestId })
        }));
        assert.equal(remove.status, 200);
        assert.equal(requests.length, 0);
    } finally {
        globalThis.fetch = originalFetch;
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
            "loginButtonText", "signInTab", "createAccountTab", "signInFields", "createAccountPanel",
            "authEyebrow", "authTitle", "authCopy", "authFootnote",
            "togglePassword", "registrationError", "loginSuccess", "registrationNotice", "createAccountForm", "createAccountButton",
            "newFullName", "newUsername", "newEmail", "newPassword", "confirmPassword", "sidebarUsername",
            "sidebarRole", "topUsername", "profileUsername", "profileDisplayName", "profileEmail",
            "profileAccountType", "profileSignInMethod", "profileRequestStorage", "requestStorageDescription", "sidebarAvatar",
            "topAvatar", "profileAvatar", "logoutButton", "profileLogout", "profileLogoutButton",
            "requestForm", "requestList", "recentRequestList", "totalCount", "pendingCount",
            "completedCount", "highPriorityCount", "dashboardError", "username", "password", "requester",
            "requestTitle", "priority", "requestFormHeading", "requestSubmitButton",
            "cancelEditButton", "quickSearch", "filterStatus", "filterPriority", "sortRequests",
            "clearFilters", "markAllReadButton", "closeDetailsButton", "detailsDialog",
            "detailsTitle", "detailContent", "themeSelect", "themeIcon", "themeToggle",
            "sidebar", "sidebarBackdrop", "mobileMenuToggle", "profileMenu", "navDashboard",
            "navRequests", "navCreateRequest", "navAnalytics", "navNotifications", "navProfile",
            "navSettings", "dashboardCreateButton", "requestsCreateButton", "emptyCreateButton",
            "analyticsLink", "allRequestsLink", "notificationButton", "profileMenuLink",
            "profileButton", "notificationDot", "sidebarUnreadCount", "notificationList",
            "notificationEmpty", "recentEmpty", "requestEmpty", "requestEmptyTitle",
            "requestEmptyCopy", "viewDashboard", "viewRequests", "viewCreate", "viewAnalytics",
            "viewNotifications", "viewProfile", "viewSettings", "statusChart", "analyticsStatusChart", "priorityChart",
            "analyticsPriorityChart", "activityChart", "activityNote", "pageTitle", "pageEyebrow"
        ];
        ids.forEach(id => elements.set(id, new FakeElement()));

        const document = {
            body: new FakeElement(),
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
        elements.get("sortRequests").value = "newest";
        elements.get("themeSelect").value = "light";
        const registrationCalls = [];
        const registrationForm = elements.get("createAccountForm");
        const registrationButton = new FakeElement();
        registrationForm.querySelector = () => registrationButton;
        registrationForm.reset = () => {
            ["newFullName", "newUsername", "newEmail", "newPassword", "confirmPassword"]
                .forEach(id => { elements.get(id).value = ""; });
        };

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
            if (url === "/api/register") {
                if (options.method !== "POST") {
                    return { ok: true, json: async () => ({ available: true }) };
                }
                registrationCalls.push(JSON.parse(options.body));
                return {
                    ok: true,
                    json: async () => ({ account: { username: "new.member" } })
                };
            }
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
                json: async () => ({ username, id: null, fullName: username, email: null })
            };
        };

        vm.runInNewContext(script, { document, sessionStorage, localStorage, fetch, confirm: () => true });
        return { elements, sessionStorage, registrationCalls };
    }

    const browser = createBrowser();
    const { elements } = browser;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(elements.get("createAccountButton").disabled, false);
    elements.get("createAccountTab").listeners.click();
    assert.equal(elements.get("loginForm").hidden, false);
    assert.equal(elements.get("signInFields").hidden, true);
    assert.equal(elements.get("createAccountPanel").hidden, false);
    elements.get("signInTab").listeners.click();
    assert.equal(elements.get("signInFields").hidden, false);
    assert.equal(elements.get("createAccountPanel").hidden, true);
    elements.get("createAccountTab").listeners.click();
    elements.get("newFullName").value = "New Member";
    elements.get("newUsername").value = "new.member";
    elements.get("newEmail").value = "new@example.com";
    elements.get("newPassword").value = "long-test-password";
    elements.get("confirmPassword").value = "long-test-password";
    await elements.get("createAccountForm").listeners.submit({
        preventDefault() {},
        currentTarget: elements.get("createAccountForm")
    });
    assert.equal(browser.registrationCalls[0].fullName, "New Member");
    assert.equal(browser.registrationCalls[0].email, "new@example.com");
    assert.equal(browser.registrationCalls[0].password, "long-test-password");
    assert.equal(elements.get("username").value, "new.member");
    assert.equal(elements.get("loginSuccess").hidden, false);
    assert.equal(elements.get("createAccountPanel").hidden, true);
    elements.get("username").value = username;
    elements.get("password").value = password;
    await elements.get("loginForm").listeners.submit({ preventDefault() {} });
    assert.equal(elements.get("appShell").hidden, false);
    assert.equal(elements.get("topUsername").textContent, username);
    assert.equal(browser.sessionStorage.getItem("assistToken"), token);
    elements.get("quickSearch").value = "Alex";
    elements.get("quickSearch").listeners.input();
    assert.equal(elements.get("viewRequests").hidden, false);
    elements.get("navDashboard").listeners.click({ preventDefault() {} });

    elements.get("requester").value = "Alex";
    elements.get("requestTitle").value = "Project assistance";
    elements.get("priority").value = "High";
    elements.get("requestForm").listeners.submit({ preventDefault() {} });
    assert.equal(elements.get("totalCount").textContent, "1");
    assert.equal(elements.get("pendingCount").textContent, "1");
    assert.equal(elements.get("completedCount").textContent, "0");
    assert.equal(elements.get("highPriorityCount").textContent, "1");
    assert.equal(JSON.parse(savedRequests.get("assistRequests"))[0].requester, "Alex");
    assert.ok(JSON.parse(savedRequests.get("assistRequests"))[0].createdAt);
    assert.match(JSON.parse(savedRequests.get("assistNotifications"))[0].message, /New request created/);

    elements.get("quickSearch").value = "alex";
    elements.get("filterPriority").value = "High";
    elements.get("filterStatus").value = "Pending";
    elements.get("quickSearch").listeners.input();
    assert.equal(elements.get("requestList").children.length, 1);
    elements.get("filterPriority").value = "Low";
    elements.get("filterPriority").listeners.change();
    assert.equal(elements.get("requestList").children.length, 0);
    elements.get("clearFilters").listeners.click();
    assert.equal(elements.get("requestList").children.length, 1);

    const editButton = elements.get("requestList").children[0].children[6].children[0].children[1];
    editButton.listeners.click();
    elements.get("requestTitle").value = "Updated project assistance";
    elements.get("requestForm").listeners.submit({ preventDefault() {} });
    assert.equal(JSON.parse(savedRequests.get("assistRequests"))[0].title, "Updated project assistance");

    const actionButton = elements.get("requestList").children[0].children[6].children[0].children[2];
    actionButton.listeners.click();
    assert.equal(elements.get("completedCount").textContent, "1");
    assert.equal(JSON.parse(savedRequests.get("assistRequests"))[0].status, "Completed");

    const refreshedBrowser = createBrowser();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(refreshedBrowser.elements.get("totalCount").textContent, "1");
    assert.equal(refreshedBrowser.elements.get("completedCount").textContent, "1");
    const reopenedButton = refreshedBrowser.elements.get("requestList").children[0]
        .children[6].children[0].children[2];
    reopenedButton.listeners.click();
    assert.equal(refreshedBrowser.elements.get("pendingCount").textContent, "1");

    refreshedBrowser.elements.get("navNotifications").listeners.click({ preventDefault() {} });
    assert.equal(refreshedBrowser.elements.get("notificationList").children.length, 3);
    refreshedBrowser.elements.get("markAllReadButton").listeners.click();
    assert.equal(JSON.parse(savedRequests.get("assistNotifications")).filter(item => !item.read).length, 0);

    const deleteButton = refreshedBrowser.elements.get("requestList").children[0].children[6].children[0].children[3];
    deleteButton.listeners.click();
    assert.equal(refreshedBrowser.elements.get("totalCount").textContent, "0");

    refreshedBrowser.elements.get("logoutButton").listeners.click();
    assert.equal(refreshedBrowser.sessionStorage.getItem("assistToken"), null);
    assert.equal(refreshedBrowser.elements.get("appShell").hidden, true);
    assert.equal(refreshedBrowser.elements.get("loginView").hidden, false);
});
