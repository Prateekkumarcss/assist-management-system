import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT) || 3000;
const { LOGIN_USERNAME, LOGIN_PASSWORD, JWT_SECRET } = process.env;
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

if (!LOGIN_USERNAME || !LOGIN_PASSWORD || !JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32) {
    console.error("Set LOGIN_USERNAME, LOGIN_PASSWORD, and a JWT_SECRET of at least 32 bytes in .env.");
    process.exit(1);
}

function createToken(username) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
        sub: username,
        iat: issuedAt,
        exp: issuedAt + 3600
    })).toString("base64url");
    const signingInput = `${header}.${payload}`;
    const signature = createHmac("sha256", JWT_SECRET)
        .update(signingInput)
        .digest("base64url");

    return `${signingInput}.${signature}`;
}

function verifyToken(token) {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerPart, payloadPart, signaturePart] = parts;
    const expectedSignature = createHmac("sha256", JWT_SECRET)
        .update(`${headerPart}.${payloadPart}`)
        .digest();
    const actualSignature = Buffer.from(signaturePart, "base64url");

    if (actualSignature.length !== expectedSignature.length ||
        !timingSafeEqual(actualSignature, expectedSignature)) return null;

    try {
        const header = JSON.parse(Buffer.from(headerPart, "base64url").toString());
        const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString());
        if (header.alg !== "HS256" || typeof payload.sub !== "string" ||
            !Number.isFinite(payload.exp) || payload.exp <= Date.now() / 1000) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
}

function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
    let body = "";

    for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 10_240) {
            throw new Error("Request body too large");
        }
    }

    return JSON.parse(body);
}

const staticFiles = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/style.css": ["style.css", "text/css; charset=utf-8"],
    "/script.js": ["script.js", "text/javascript; charset=utf-8"]
};

const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/session") {
        const authorization = request.headers.authorization || "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        const session = verifyToken(token);

        if (!session) return sendJson(response, 401, { error: "Invalid or expired session." });
        return sendJson(response, 200, { username: session.sub, expiresAt: session.exp });
    }

    if (request.method === "POST" && request.url === "/api/login") {
        try {
            const body = await readJsonBody(request);
            const { username, password } = body ?? {};

            if (username !== LOGIN_USERNAME || password !== LOGIN_PASSWORD) {
                return sendJson(response, 401, { error: "Invalid username or password." });
            }

            return sendJson(response, 200, {
                token: createToken(LOGIN_USERNAME),
                tokenType: "Bearer",
                expiresIn: 3600
            });
        } catch {
            return sendJson(response, 400, { error: "Invalid JSON request." });
        }
    }

    const file = staticFiles[request.url];
    if (request.method === "GET" && file) {
        response.writeHead(200, { "Content-Type": file[1] });
        return response.end(await readFile(path.join(projectDirectory, file[0])));
    }

    return sendJson(response, 404, { error: "Not found." });
});

server.listen(port, () => {
    console.log(`Assist Management System running at http://localhost:${port}`);
});