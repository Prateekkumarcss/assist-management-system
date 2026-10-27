
const loginView = document.getElementById("loginView");
const appShell = document.getElementById("appShell");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const loginButton = document.getElementById("loginButton");
const userTag = document.getElementById("userTag");

function showLogin(message = "") {
    sessionStorage.removeItem("assistToken");
    appShell.hidden = true;
    loginView.hidden = false;
    loginError.textContent = message;
    loginError.hidden = !message;
}

async function showDashboard(token) {
    const response = await fetch("/api/session", {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
        showLogin("Your session expired. Please sign in again.");
        return;
    }

    const session = await response.json();
    userTag.textContent = session.username;
    loginView.hidden = true;
    appShell.hidden = false;
    initializeDashboard();
}

loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    loginButton.disabled = true;
    loginError.hidden = true;

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: document.getElementById("username").value.trim(),
                password: document.getElementById("password").value
            })
        });
        const result = await response.json();

        if (!response.ok) {
            showLogin(result.error || "Sign in failed.");
            return;
        }

        sessionStorage.setItem("assistToken", result.token);
        await showDashboard(result.token);
    } catch {
        showLogin("Unable to reach the server. Please try again.");
    } finally {
        loginButton.disabled = false;
    }
});

document.getElementById("logoutButton").addEventListener("click", () => showLogin());

function initializeDashboard() {
    const form = document.getElementById("requestForm");
    const requestList = document.getElementById("requestList");
    const totalCount = document.getElementById("totalCount");
    const pendingCount = document.getElementById("pendingCount");
    const completedCount = document.getElementById("completedCount");

    let requests;
    try {
        const savedRequests = JSON.parse(localStorage.getItem("assistRequests") || "[]");
        requests = Array.isArray(savedRequests) ? savedRequests : [];
    } catch {
        requests = [];
    }

    let nextId = requests.length
        ? Math.max(...requests.map(request => Number(request.id) || 0)) + 1
        : 1;

    function updateDashboard() {
        localStorage.setItem("assistRequests", JSON.stringify(requests));
        totalCount.textContent = requests.length;
        pendingCount.textContent = requests.filter(request => request.status === "Pending").length;
        completedCount.textContent = requests.filter(request => request.status === "Completed").length;
        renderRequests();
    }

    function renderRequests() {
        requestList.replaceChildren();

        if (requests.length === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 5;
            cell.textContent = "No requests yet. Add one above.";
            row.appendChild(cell);
            requestList.appendChild(row);
            return;
        }

        requests.forEach(request => {
            const row = document.createElement("tr");
            [request.requester, request.title, request.priority].forEach(value => {
                const cell = document.createElement("td");
                cell.textContent = value;
                row.appendChild(cell);
            });

            const statusCell = document.createElement("td");
            const statusLabel = document.createElement("span");
            statusLabel.className = `status${request.status === "Completed" ? " completed" : ""}`;
            statusLabel.textContent = request.status;
            statusCell.appendChild(statusLabel);
            row.appendChild(statusCell);

            const actionCell = document.createElement("td");
            const actionButton = document.createElement("button");
            actionButton.className = "action-button";
            actionButton.textContent = request.status === "Pending" ? "Complete" : "Reopen";
            actionButton.addEventListener("click", () => {
                request.status = request.status === "Pending" ? "Completed" : "Pending";
                updateDashboard();
            });
            actionCell.appendChild(actionButton);
            row.appendChild(actionCell);
            requestList.appendChild(row);
        });
    }

    form.onsubmit = event => {
        event.preventDefault();
        const requester = document.getElementById("requester").value.trim();
        const title = document.getElementById("requestTitle").value.trim();

        if (!requester || !title) return;

        requests.push({
            id: nextId++,
            requester,
            title,
            priority: document.getElementById("priority").value,
            status: "Pending"
        });
        form.reset();
        updateDashboard();
    };

    updateDashboard();
}

const storedToken = sessionStorage.getItem("assistToken");
if (storedToken) {
    showDashboard(storedToken).catch(() => showLogin("Unable to reach the server. Please sign in again."));
} else {
    showLogin();
}

