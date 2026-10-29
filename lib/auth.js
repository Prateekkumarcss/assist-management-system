import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_LIFETIME_SECONDS = 3600;
const MAX_BODY_BYTES = 10_240;

class RequestError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

function jsonResponse(statusCode, data, headers = {}) {
    return Response.json(data, {
        status: statusCode,
        headers: { "Cache-Control": "no-store", ...headers }
    });
}

function getAuthConfiguration() {
    const { LOGIN_USERNAME, LOGIN_PASSWORD, JWT_SECRET } = process.env;

    if (!LOGIN_USERNAME || !LOGIN_PASSWORD || !JWT_SECRET) {
        throw new Error("Set LOGIN_USERNAME, LOGIN_PASSWORD, and JWT_SECRET.");
    }
    if (Buffer.byteLength(JWT_SECRET) < 32) {
        throw new Error("JWT_SECRET must be at least 32 bytes.");
    }

    return { username: LOGIN_USERNAME, password: LOGIN_PASSWORD, secret: JWT_SECRET };
}

function safeEqualString(actual, expected) {
    if (typeof actual !== "string") return false;
    const actualBytes = Buffer.from(actual);
    const expectedBytes = Buffer.from(expected);
    return actualBytes.length === expectedBytes.length &&
        timingSafeEqual(actualBytes, expectedBytes);
}

function createToken(username, secret) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
        sub: username,
        iat: issuedAt,
        exp: issuedAt + TOKEN_LIFETIME_SECONDS
    })).toString("base64url");
    const signingInput = `${header}.${payload}`;
    const signature = createHmac("sha256", secret)
        .update(signingInput)
        .digest("base64url");

    return `${signingInput}.${signature}`;
}

function verifyToken(token, secret, expectedUsername) {
    if (typeof token !== "string" || token.length > 4096) return null;

    const parts = token.split(".");
    if (parts.length !== 3 || parts.some(part =>
        !/^[A-Za-z0-9_-]+$/.test(part) ||
        Buffer.from(part, "base64url").toString("base64url") !== part)) {
        return null;
    }

    const [headerPart, payloadPart, signaturePart] = parts;
    const expectedSignature = createHmac("sha256", secret)
        .update(`${headerPart}.${payloadPart}`)
        .digest();
    const actualSignature = Buffer.from(signaturePart, "base64url");

    if (actualSignature.length !== expectedSignature.length ||
        !timingSafeEqual(actualSignature, expectedSignature)) {
        return null;
    }

    try {
        const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
        const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));

        if (header.alg !== "HS256" ||
            payload.sub !== expectedUsername ||
            !Number.isFinite(payload.exp) ||
            payload.exp <= Date.now() / 1000) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

async function readJsonBody(request) {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        throw new RequestError(413, "Request body is too large.");
    }

    const body = await request.text();
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        throw new RequestError(413, "Request body is too large.");
    }

    try {
        const parsedBody = JSON.parse(body);
        if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
            throw new RequestError(400, "Invalid JSON request.");
        }
        return parsedBody;
    } catch (error) {
        if (error instanceof RequestError) throw error;
        throw new RequestError(400, "Invalid JSON request.");
    }
}

function handleError(error) {
    if (error instanceof RequestError) {
        return jsonResponse(error.statusCode, { error: error.message });
    }

    console.error("Authentication API request failed.", error);
    return jsonResponse(500, { error: "Authentication service is unavailable." });
}

export async function handleLogin(request) {
    if (request.method !== "POST") {
        return jsonResponse(405, { error: "Use POST for this endpoint." }, { Allow: "POST" });
    }

    try {
        const config = getAuthConfiguration();
        const body = await readJsonBody(request);

        if (!safeEqualString(body.username, config.username) ||
            !safeEqualString(body.password, config.password)) {
            return jsonResponse(401, { error: "Invalid username or password." });
        }

        return jsonResponse(200, {
            token: createToken(config.username, config.secret),
            tokenType: "Bearer",
            expiresIn: TOKEN_LIFETIME_SECONDS
        });
    } catch (error) {
        return handleError(error);
    }
}

export function handleSession(request) {
    if (request.method !== "GET") {
        return jsonResponse(405, { error: "Use GET for this endpoint." }, { Allow: "GET" });
    }

    try {
        const config = getAuthConfiguration();
        const authorization = request.headers.get("authorization") || "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        const session = verifyToken(token, config.secret, config.username);

        if (!session) {
            return jsonResponse(401, { error: "Invalid or expired session." });
        }
        return jsonResponse(200, {
            username: session.sub,
            expiresAt: session.exp
        });
    } catch (error) {
        return handleError(error);
    }
}

export function validateAuthConfiguration() {
    getAuthConfiguration();
}
