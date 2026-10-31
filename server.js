import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
    handleLogin,
    handleSession,
    validateAuthConfiguration
} from "./lib/auth.js";
import { handleRegister } from "./api/register.js";
import { handleRequests } from "./api/requests.js";

const port = Number(process.env.PORT) || 3000;
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(projectDirectory, "public");

const staticFiles = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/style.css": ["style.css", "text/css; charset=utf-8"],
    "/script.js": ["script.js", "text/javascript; charset=utf-8"]
};

try {
    validateAuthConfiguration();
} catch (error) {
    console.error(`${error.message} Add them to .env for local development.`);
    process.exit(1);
}

async function dispatchApi(request, response, handler) {
    const headers = new Headers();
    for (const name of ["authorization", "content-length", "content-type"]) {
        const value = request.headers[name];
        if (value) headers.set(name, value);
    }

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const webRequest = new Request(new URL(request.url, "http://localhost"), {
        method: request.method,
        headers,
        ...(hasBody ? { body: Readable.toWeb(request), duplex: "half" } : {})
    });
    const webResponse = await handler(webRequest);
    const responseBody = Buffer.from(await webResponse.arrayBuffer());

    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    response.end(responseBody);
}

const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;

    const apiHandlers = {
        "/api/login": handleLogin,
        "/api/session": handleSession,
        "/api/register": handleRegister,
        "/api/requests": handleRequests
    };
    if (apiHandlers[pathname]) {
        const handler = apiHandlers[pathname];
        try {
            return await dispatchApi(request, response, handler);
        } catch (error) {
            console.error("Unable to process local API request.", error);
            response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            return response.end(JSON.stringify({ error: "Authentication service is unavailable." }));
        }
    }

    const file = staticFiles[pathname];
    if (request.method === "GET" && file) {
        try {
            const contents = await readFile(path.join(publicDirectory, file[0]));
            response.writeHead(200, { "Content-Type": file[1] });
            return response.end(contents);
        } catch (error) {
            console.error(`Unable to serve ${pathname}.`, error);
            response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            return response.end(JSON.stringify({ error: "Unable to serve this page." }));
        }
    }

    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Not found." }));
});

server.listen(port, () => {
    console.log(`Assist Management System running at http://localhost:${port}`);
});
