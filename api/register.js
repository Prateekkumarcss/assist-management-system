import {
    handleDatabaseError,
    getSupabaseConfig,
    hashPassword,
    jsonResponse,
    readJsonBody,
    supabaseRequest
} from "../lib/supabase.js";

const usernamePattern = /^[A-Za-z0-9._-]{3,30}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleRegister(request) {
    if (request.method === "GET") {
        try {
            getSupabaseConfig();
            return jsonResponse(200, { available: true });
        } catch (error) {
            if (error.statusCode === 503) {
                return jsonResponse(200, {
                    available: false,
                    message: "Account creation is unavailable until the administrator configures the Supabase database. No credentials will be sent or saved."
                });
            }
            return handleDatabaseError(error);
        }
    }
    if (request.method !== "POST") {
        return jsonResponse(405, { error: "Use POST for this endpoint." }, { Allow: "POST" });
    }

    try {
        const body = await readJsonBody(request);
        const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
        const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";

        if (fullName.length < 1 || fullName.length > 120) {
            return jsonResponse(400, { error: "Enter a name between 1 and 120 characters." });
        }
        if (!usernamePattern.test(username)) {
            return jsonResponse(400, { error: "Username must be 3–30 characters using letters, numbers, dots, underscores, or hyphens." });
        }
        if (email.length > 254 || !emailPattern.test(email)) {
            return jsonResponse(400, { error: "Enter a valid email address." });
        }
        if (password.length < 8 || password.length > 128) {
            return jsonResponse(400, { error: "Password must be between 8 and 128 characters." });
        }

        getSupabaseConfig();
        const { salt, hash } = await hashPassword(password);
        const query = new URLSearchParams({ select: "id,full_name,username,email,created_at" }).toString();
        const rows = await supabaseRequest("assist_users", query, {
            method: "POST",
            body: { full_name: fullName, username, email, password_salt: salt, password_hash: hash }
        });
        const account = rows?.[0];
        if (!account) throw new Error("Registration returned no account.");

        return jsonResponse(201, {
            account: {
                id: account.id,
                fullName: account.full_name,
                username: account.username,
                email: account.email
            }
        });
    } catch (error) {
        return handleDatabaseError(error);
    }
}

export default {
    fetch(request) {
        return handleRegister(request);
    }
};