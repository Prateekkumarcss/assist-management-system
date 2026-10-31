import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const MAX_BODY_BYTES = 16_384;

export class ApiError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

export function jsonResponse(statusCode, data, headers = {}) {
    return Response.json(data, {
        status: statusCode,
        headers: { "Cache-Control": "no-store", ...headers }
    });
}

export function getSupabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
        throw new ApiError(503, "Registration is not configured. The administrator must connect the Supabase database.");
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        throw new ApiError(503, "The Supabase database configuration is invalid.");
    }
    if (parsedUrl.protocol !== "https:") {
        throw new ApiError(503, "The Supabase database configuration is invalid.");
    }

    return { baseUrl: parsedUrl.origin, serviceKey };
}

export async function supabaseRequest(table, query = "", options = {}) {
    const { baseUrl, serviceKey } = getSupabaseConfig();
    const suffix = query ? `?${query}` : "";
    let response;
    try {
        response = await fetch(`${baseUrl}/rest/v1/${table}${suffix}`, {
            method: options.method || "GET",
            headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
                Prefer: options.prefer || "return=representation"
            },
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
            cache: "no-store"
        });
    } catch {
        throw new ApiError(503, "The account database could not be reached.");
    }

    let result = null;
    if (response.status !== 204) {
        try {
            result = await response.json();
        } catch {
            result = null;
        }
    }
    if (!response.ok) {
        if (result?.code === "23505") {
            throw new ApiError(409, "That username or email address is already registered.");
        }
        if (response.status >= 500) {
            throw new ApiError(503, "The account database is temporarily unavailable.");
        }
        throw new ApiError(response.status === 404 ? 404 : 400, "The database rejected the request. Check that the AssistMS schema is installed.");
    }
    return result;
}

export async function readJsonBody(request) {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        throw new ApiError(413, "Request body is too large.");
    }

    const body = await request.text();
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        throw new ApiError(413, "Request body is too large.");
    }
    try {
        const value = JSON.parse(body);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("Invalid body");
        }
        return value;
    } catch {
        throw new ApiError(400, "Invalid JSON request.");
    }
}

export async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
    const hash = await scrypt(password, Buffer.from(salt, "hex"), 64);
    return { salt, hash: Buffer.from(hash).toString("hex") };
}

export async function verifyPassword(password, salt, expectedHash) {
    try {
        const actual = await scrypt(password, Buffer.from(salt, "hex"), 64);
        const expected = Buffer.from(expectedHash, "hex");
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

export function handleDatabaseError(error) {
    if (error instanceof ApiError) {
        return jsonResponse(error.statusCode, { error: error.message });
    }
    console.error("Account database request failed.");
    return jsonResponse(500, { error: "The account service is unavailable." });
}