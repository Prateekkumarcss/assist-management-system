import { getVerifiedSession } from "../lib/auth.js";
import {
    ApiError,
    handleDatabaseError,
    jsonResponse,
    readJsonBody,
    supabaseRequest
} from "../lib/supabase.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const priorities = new Set(["Low", "Medium", "High"]);
const statuses = new Set(["Pending", "Completed"]);

function getAccount(request) {
    const session = getVerifiedSession(request);
    if (!session) throw new ApiError(401, "Invalid or expired session.");
    if (!uuidPattern.test(session.uid || "")) {
        throw new ApiError(403, "This operation requires a registered account.");
    }
    return session.uid;
}

function toClientRequest(row) {
    return {
        id: row.id,
        requester: row.requester,
        title: row.title,
        priority: row.priority,
        status: row.status,
        createdAt: row.created_at
    };
}

function validateFields(body, includeStatus = false) {
    const requester = typeof body.requester === "string" ? body.requester.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (requester.length < 1 || requester.length > 120 || title.length < 1 || title.length > 180) {
        throw new ApiError(400, "Enter a requester name and a title within the allowed lengths.");
    }
    if (!priorities.has(body.priority)) throw new ApiError(400, "Choose a valid request priority.");
    if (includeStatus && !statuses.has(body.status)) throw new ApiError(400, "Choose a valid request status.");
    return {
        requester,
        title,
        priority: body.priority,
        ...(includeStatus ? { status: body.status } : {})
    };
}

function handleError(error) {
    return handleDatabaseError(error);
}

export async function handleRequests(request) {
    try {
        const userId = getAccount(request);
        const selected = "id,requester,title,priority,status,created_at";

        if (request.method === "GET") {
            const query = new URLSearchParams({
                select: selected,
                user_id: `eq.${userId}`,
                order: "created_at.desc"
            }).toString();
            const rows = await supabaseRequest("assist_requests", query);
            return jsonResponse(200, { requests: rows.map(toClientRequest) });
        }

        if (request.method === "POST") {
            const body = await readJsonBody(request);
            const requestFields = validateFields(body);
            const query = new URLSearchParams({ select: selected }).toString();
            const rows = await supabaseRequest("assist_requests", query, {
                method: "POST",
                body: { ...requestFields, status: "Pending", user_id: userId }
            });
            if (!rows?.[0]) throw new Error("Request creation returned no record.");
            return jsonResponse(201, { request: toClientRequest(rows[0]) });
        }

        if (request.method === "PATCH") {
            const body = await readJsonBody(request);
            if (!uuidPattern.test(body.id || "")) throw new ApiError(400, "Invalid request ID.");
            const fields = validateFields(body, true);
            const query = new URLSearchParams({
                select: selected,
                id: `eq.${body.id}`,
                user_id: `eq.${userId}`
            }).toString();
            const rows = await supabaseRequest("assist_requests", query, {
                method: "PATCH",
                body: fields
            });
            if (!rows?.[0]) throw new ApiError(404, "Request not found.");
            return jsonResponse(200, { request: toClientRequest(rows[0]) });
        }

        if (request.method === "DELETE") {
            const body = await readJsonBody(request);
            if (!uuidPattern.test(body.id || "")) throw new ApiError(400, "Invalid request ID.");
            const query = new URLSearchParams({
                select: "id",
                id: `eq.${body.id}`,
                user_id: `eq.${userId}`
            }).toString();
            const rows = await supabaseRequest("assist_requests", query, {
                method: "DELETE"
            });
            if (!rows?.[0]) throw new ApiError(404, "Request not found.");
            return jsonResponse(200, { ok: true });
        }

        return jsonResponse(405, { error: "Use GET, POST, PATCH, or DELETE for this endpoint." }, {
            Allow: "GET, POST, PATCH, DELETE"
        });
    } catch (error) {
        return handleError(error);
    }
}

export default {
    fetch(request) {
        return handleRequests(request);
    }
};