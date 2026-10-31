
const loginView = document.getElementById("loginView");
const appShell = document.getElementById("appShell");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const loginButton = document.getElementById("loginButton");
let currentUsername = "";
let currentUser = null;
let dashboardInitialized = false;
let requests = [];
let notifications = [];
let editingRequestId = null;
let activeViewChange = () => {};

function showLogin(message = "") {
    sessionStorage.removeItem("assistToken");
    appShell.hidden = true;
    loginView.hidden = false;
    loginError.textContent = message;
    loginError.hidden = !message;
}

function setAuthMode(mode) {
    const signingIn = mode === "sign-in";
    loginForm.hidden = false;
    document.getElementById("signInFields").hidden = !signingIn;
    loginButton.hidden = !signingIn;
    document.getElementById("authEyebrow").hidden = !signingIn;
    document.getElementById("authTitle").hidden = !signingIn;
    document.getElementById("authCopy").hidden = !signingIn;
    document.getElementById("authFootnote").hidden = !signingIn;
    document.getElementById("createAccountPanel").hidden = signingIn;
    document.getElementById("signInTab").className = `auth-tab${signingIn ? " active" : ""}`;
    document.getElementById("createAccountTab").className = `auth-tab${signingIn ? "" : " active"}`;
    document.getElementById("signInTab").setAttribute("aria-selected", String(signingIn));
    document.getElementById("createAccountTab").setAttribute("aria-selected", String(!signingIn));
    loginError.hidden = true;
    document.getElementById("registrationError").hidden = true;
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
    currentUser = session;
    currentUsername = session.username;
    loginView.hidden = true;
    appShell.hidden = false;
    document.getElementById("sidebarUsername").textContent = currentUsername;
    document.getElementById("topUsername").textContent = currentUsername;
    document.getElementById("profileUsername").textContent = currentUsername;
    document.getElementById("profileDisplayName").textContent = session.fullName || currentUsername;
    document.getElementById("profileEmail").textContent = session.email || "Not configured";
    document.getElementById("profileAccountType").textContent = session.id ? "Registered account" : "Administrator account";
    document.getElementById("profileSignInMethod").textContent = session.id ? "Username or email and password" : "Environment-configured credentials";
    document.getElementById("sidebarRole").textContent = session.id ? "Member" : "Administrator";
    document.getElementById("profileRequestStorage").textContent = session.id ? "Account database" : "This browser only";
    document.getElementById("requestStorageDescription").textContent = session.id
        ? "Requests are stored in the account database and are only visible to this account."
        : "Requests for the environment-configured administrator remain in this browser.";
    const initial = (session.fullName || currentUsername).charAt(0).toUpperCase() || "A";
    ["sidebarAvatar", "topAvatar", "profileAvatar"].forEach(id => {
        document.getElementById(id).textContent = initial;
    });
    try {
        await initializeDashboard();
    } catch (error) {
        showLogin(error.message || "Unable to load your account data.");
    }
}

document.getElementById("signInTab").addEventListener("click", () => setAuthMode("sign-in"));
document.getElementById("createAccountTab").addEventListener("click", () => setAuthMode("create-account"));
document.getElementById("togglePassword").addEventListener("click", event => {
    const password = document.getElementById("password");
    const isHidden = password.type === "password";
    password.type = isHidden ? "text" : "password";
    event.currentTarget.textContent = isHidden ? "Hide" : "Show";
    event.currentTarget.setAttribute("aria-label", `${isHidden ? "Hide" : "Show"} password`);
});

async function checkRegistrationAvailability() {
    const notice = document.getElementById("registrationNotice");
    const button = document.getElementById("createAccountButton");
    try {
        const response = await fetch("/api/register");
        const status = await response.json();
        if (!response.ok || !status.available) {
            notice.textContent = status.message || "Account creation is currently unavailable.";
            button.disabled = true;
            return;
        }
        notice.textContent = "Choose a unique username and email. Passwords are stored as salted hashes, never as plain text.";
        button.disabled = false;
    } catch {
        notice.textContent = "Account creation availability could not be checked. No credentials will be sent.";
        button.disabled = true;
    }
}

loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    loginButton.disabled = true;
    document.getElementById("loginButtonText").textContent = "Signing in...";
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
            loginError.textContent = result.error || "Sign in failed.";
            loginError.hidden = false;
            return;
        }

        sessionStorage.setItem("assistToken", result.token);
        await showDashboard(result.token);
    } catch {
        loginError.textContent = "Unable to reach the server. Please try again.";
        loginError.hidden = false;
    } finally {
        loginButton.disabled = false;
        document.getElementById("loginButtonText").textContent = "Sign in";
    }
});

document.getElementById("createAccountForm").addEventListener("submit", async event => {
    event.preventDefault();
    const error = document.getElementById("registrationError");
    const button = event.currentTarget.querySelector("button[type='submit']");
    const password = document.getElementById("newPassword").value;
    const confirmation = document.getElementById("confirmPassword").value;
    error.hidden = false;

    if (password.length < 8) {
        error.textContent = "Use a password with at least 8 characters.";
    } else if (password !== confirmation) {
        error.textContent = "The passwords do not match.";
    } else {
        button.disabled = true;
        button.textContent = "Creating account...";
        try {
            const response = await fetch("/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fullName: document.getElementById("newFullName").value.trim(),
                    username: document.getElementById("newUsername").value.trim(),
                    email: document.getElementById("newEmail").value.trim(),
                    password
                })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Account creation failed.");
            event.currentTarget.reset();
            setAuthMode("sign-in");
            document.getElementById("username").value = result.account.username;
            document.getElementById("loginSuccess").textContent = "Your account is ready. Sign in with your username or email.";
            document.getElementById("loginSuccess").hidden = false;
        } catch (registrationError) {
            error.textContent = registrationError.message || "Unable to create the account. Please try again.";
        } finally {
            button.disabled = false;
            button.textContent = "Create account";
        }
    }
});

document.getElementById("logoutButton").addEventListener("click", () => showLogin());
document.getElementById("profileLogout").addEventListener("click", () => showLogin());
document.getElementById("profileLogoutButton").addEventListener("click", () => showLogin());

function loadArray(key) {
    try {
        const stored = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(stored) ? stored : [];
    } catch {
        return [];
    }
}

function persist(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        return false;
    }
    return true;
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function addNotification(message, requestId) {
    notifications.unshift({
        id: `${Date.now()}-${notifications.length}`,
        message,
        requestId,
        createdAt: new Date().toISOString(),
        read: false
    });
    notifications = notifications.slice(0, 100);
}

function notificationStorageKey() {
    return currentUser?.id ? `assistNotifications:${currentUser.id}` : "assistNotifications";
}

async function requestApi(path, method = "GET", body = undefined) {
    const token = sessionStorage.getItem("assistToken");
    const response = await fetch(path, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to save request changes.");
    return result;
}

async function initializeDashboard() {
    if (!dashboardInitialized) {
        const storedTheme = localStorage.getItem("assistTheme");
        applyTheme(storedTheme === "dark" ? "dark" : "light", false);
        setupNavigation();
        setupDashboardControls();
        setupRequestForm();
        dashboardInitialized = true;
    }

    if (currentUser?.id) {
        const result = await requestApi("/api/requests");
        requests = Array.isArray(result.requests) ? result.requests : [];
        notifications = loadArray(notificationStorageKey());
    } else {
        requests = loadArray("assistRequests");
        notifications = loadArray("assistNotifications");
    }
    updateDashboard(false);
}

function applyTheme(theme, save = true) {
    const selectedTheme = theme === "dark" ? "dark" : "light";
    document.body.dataset.theme = selectedTheme;
    document.getElementById("themeSelect").value = selectedTheme;
    document.getElementById("themeIcon").textContent = selectedTheme === "dark" ? "☼" : "☾";
    document.getElementById("themeToggle").setAttribute("aria-label", `Switch to ${selectedTheme === "dark" ? "light" : "dark"} mode`);
    if (save) persist("assistTheme", selectedTheme);
}

function setupNavigation() {
    const views = [
        ["Dashboard", "OVERVIEW", "navDashboard", "viewDashboard"],
        ["All requests", "WORK QUEUE", "navRequests", "viewRequests"],
        ["Create request", "REQUEST WORKFLOW", "navCreateRequest", "viewCreate"],
        ["Analytics", "INSIGHTS", "navAnalytics", "viewAnalytics"],
        ["Notifications", "UPDATES", "navNotifications", "viewNotifications"],
        ["My profile", "ACCOUNT", "navProfile", "viewProfile"],
        ["Settings", "PREFERENCES", "navSettings", "viewSettings"]
    ];

    function switchView(viewId) {
        const selected = views.find(view => view[3] === viewId) || views[0];
        views.forEach(view => {
            document.getElementById(view[3]).hidden = view !== selected;
            document.getElementById(view[2]).className = `nav-link${view === selected ? " active" : ""}`;
        });
        document.getElementById("pageTitle").textContent = selected[0];
        document.getElementById("pageEyebrow").textContent = selected[1];
        closeMobileNavigation();
        document.getElementById("profileMenu").hidden = true;
        if (viewId === "viewRequests") renderRequests();
        if (viewId === "viewNotifications") renderNotifications();
    }
    activeViewChange = switchView;

    views.forEach(view => {
        document.getElementById(view[2]).addEventListener("click", event => {
            event.preventDefault();
            switchView(view[3]);
        });
    });
    document.getElementById("dashboardCreateButton").addEventListener("click", () => switchView("viewCreate"));
    document.getElementById("requestsCreateButton").addEventListener("click", () => switchView("viewCreate"));
    document.getElementById("emptyCreateButton").addEventListener("click", () => switchView("viewCreate"));
    document.getElementById("analyticsLink").addEventListener("click", () => switchView("viewAnalytics"));
    document.getElementById("allRequestsLink").addEventListener("click", () => switchView("viewRequests"));
    document.getElementById("notificationButton").addEventListener("click", () => switchView("viewNotifications"));
    document.getElementById("profileMenuLink").addEventListener("click", () => switchView("viewProfile"));
    document.getElementById("profileButton").addEventListener("click", () => {
        const menu = document.getElementById("profileMenu");
        menu.hidden = !menu.hidden;
    });
    document.getElementById("mobileMenuToggle").addEventListener("click", () => {
        const sidebar = document.getElementById("sidebar");
        const isOpen = !sidebar.className.includes("open");
        sidebar.className = isOpen ? "sidebar open" : "sidebar";
        document.getElementById("sidebarBackdrop").hidden = !isOpen;
        document.getElementById("mobileMenuToggle").setAttribute("aria-expanded", String(isOpen));
    });
    document.getElementById("sidebarBackdrop").addEventListener("click", closeMobileNavigation);
    document.getElementById("themeToggle").addEventListener("click", () => {
        applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
    });
    document.getElementById("themeSelect").addEventListener("change", event => applyTheme(event.currentTarget.value));
}

function closeMobileNavigation() {
    const sidebar = document.getElementById("sidebar");
    sidebar.className = "sidebar";
    document.getElementById("sidebarBackdrop").hidden = true;
    document.getElementById("mobileMenuToggle").setAttribute("aria-expanded", "false");
}

function setupDashboardControls() {
    const search = document.getElementById("quickSearch");
    search.addEventListener("input", () => {
        if (search.value.trim() && document.getElementById("viewRequests").hidden) {
            activeViewChange("viewRequests");
        } else {
            renderRequests();
        }
    });
    ["filterStatus", "filterPriority", "sortRequests"].forEach(id => {
        document.getElementById(id).addEventListener("input", renderRequests);
        document.getElementById(id).addEventListener("change", renderRequests);
    });
    document.getElementById("clearFilters").addEventListener("click", () => {
        document.getElementById("quickSearch").value = "";
        document.getElementById("filterStatus").value = "";
        document.getElementById("filterPriority").value = "";
        document.getElementById("sortRequests").value = "newest";
        renderRequests();
    });
    document.getElementById("markAllReadButton").addEventListener("click", () => {
        notifications.forEach(notification => { notification.read = true; });
        updateDashboard(true);
    });
    document.getElementById("closeDetailsButton").addEventListener("click", closeDetails);
    document.getElementById("detailsDialog").addEventListener("click", event => {
        if (event.target === document.getElementById("detailsDialog")) closeDetails();
    });
}

function setupRequestForm() {
    const form = document.getElementById("requestForm");
    form.addEventListener("submit", async event => {
        event.preventDefault();
        const requester = document.getElementById("requester").value.trim();
        const title = document.getElementById("requestTitle").value.trim();
        if (!requester || !title) return;

        const priority = document.getElementById("priority").value;
        const submitButton = document.getElementById("requestSubmitButton");
        submitButton.disabled = true;
        try {
            if (editingRequestId !== null) {
                const request = requests.find(item => String(item.id) === String(editingRequestId));
                if (request) {
                    const fields = { id: request.id, requester, title, priority, status: request.status };
                    if (currentUser?.id) {
                        Object.assign(request, (await requestApi("/api/requests", "PATCH", fields)).request);
                    } else {
                        Object.assign(request, fields);
                    }
                }
            } else if (currentUser?.id) {
                const created = (await requestApi("/api/requests", "POST", { requester, title, priority })).request;
                requests.push(created);
                addNotification(`New request created: ${title}`, created.id);
            } else {
                const nextId = requests.reduce((maximum, item) => Math.max(maximum, Number(item.id) || 0), 0) + 1;
                const request = {
                    id: nextId,
                    requester,
                    title,
                    priority,
                    status: "Pending",
                    createdAt: new Date().toISOString()
                };
                requests.push(request);
                addNotification(`New request created: ${title}`, request.id);
            }
            form.reset();
            document.getElementById("priority").value = "Medium";
            editingRequestId = null;
            document.getElementById("requestFormHeading").textContent = "Create a request";
            submitButton.textContent = "Create request";
            document.getElementById("cancelEditButton").hidden = true;
            updateDashboard(true);
            navigateTo("viewRequests");
        } catch (error) {
            showDashboardError(error.message);
        } finally {
            submitButton.disabled = false;
        }
    });
    document.getElementById("cancelEditButton").addEventListener("click", () => {
        form.reset();
        document.getElementById("priority").value = "Medium";
        editingRequestId = null;
        document.getElementById("requestFormHeading").textContent = "Create a request";
        document.getElementById("requestSubmitButton").textContent = "Create request";
        document.getElementById("cancelEditButton").hidden = true;
    });
}

function navigateTo(viewId) {
    activeViewChange(viewId);
}

function showDashboardError(message) {
    const error = document.getElementById("dashboardError");
    error.textContent = message || "The request could not be saved.";
    error.hidden = false;
}

function updateDashboard(save) {
    document.getElementById("dashboardError").hidden = true;
    if (save) {
        if (!currentUser?.id) persist("assistRequests", requests);
        persist(notificationStorageKey(), notifications);
    }
    const pending = requests.filter(request => request.status !== "Completed").length;
    const completed = requests.length - pending;
    document.getElementById("totalCount").textContent = requests.length;
    document.getElementById("pendingCount").textContent = pending;
    document.getElementById("completedCount").textContent = completed;
    document.getElementById("highPriorityCount").textContent = requests.filter(request => request.priority === "High").length;
    renderRequests();
    renderRecentRequests();
    renderCharts();
    renderNotifications();
}

function makeCell(value, className = "") {
    const cell = document.createElement("td");
    cell.textContent = value;
    if (className) cell.className = className;
    return cell;
}

function displayRequestId(id) {
    const value = String(id ?? "—");
    return value.length === 36 ? `#${value.slice(0, 8)}` : `#${value}`;
}

function createRequestRow(request) {
    const row = document.createElement("tr");
    row.appendChild(makeCell(displayRequestId(request.id), "request-id"));
    row.appendChild(makeCell(request.requester || "—", "requester-name"));
    row.appendChild(makeCell(request.title || "Untitled request", "request-title-cell"));

    const priorityCell = document.createElement("td");
    const priority = document.createElement("span");
    const priorityName = ["Low", "Medium", "High"].includes(request.priority) ? request.priority : "Unknown";
    priority.className = `priority-badge ${priorityName.toLowerCase()}`;
    priority.textContent = priorityName;
    priorityCell.appendChild(priority);
    row.appendChild(priorityCell);

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    const completed = request.status === "Completed";
    status.className = `status-badge ${completed ? "completed" : "pending"}`;
    status.textContent = completed ? "Completed" : "Pending";
    statusCell.appendChild(status);
    row.appendChild(statusCell);
    row.appendChild(makeCell(formatDate(request.createdAt)));

    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.appendChild(makeActionButton("View", "row-action", () => showDetails(request)));
    actions.appendChild(makeActionButton("Edit", "row-action", () => editRequest(request)));
    actions.appendChild(makeActionButton(completed ? "Reopen" : "Complete", "row-action", () => toggleRequest(request)));
    actions.appendChild(makeActionButton("Delete", "row-action danger", () => deleteRequest(request)));
    actionsCell.appendChild(actions);
    row.appendChild(actionsCell);
    return row;
}

function makeActionButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
}

function getFilteredRequests() {
    const query = document.getElementById("quickSearch").value.trim().toLowerCase();
    const status = document.getElementById("filterStatus").value;
    const priority = document.getElementById("filterPriority").value;
    const sort = document.getElementById("sortRequests").value;
    const priorityRank = { High: 0, Medium: 1, Low: 2 };
    return requests.filter(request => {
        const matchesText = !query || `${request.requester || ""} ${request.title || ""}`.toLowerCase().includes(query);
        const matchesStatus = !status || (request.status === "Completed" ? "Completed" : "Pending") === status;
        const matchesPriority = !priority || request.priority === priority;
        return matchesText && matchesStatus && matchesPriority;
    }).sort((left, right) => {
        if (sort === "title") return String(left.title || "").localeCompare(String(right.title || ""));
        if (sort === "priority") return (priorityRank[left.priority] ?? 3) - (priorityRank[right.priority] ?? 3);
        if (sort === "oldest") return (new Date(left.createdAt || 0).getTime() || 0) - (new Date(right.createdAt || 0).getTime() || 0);
        return (new Date(right.createdAt || 0).getTime() || 0) - (new Date(left.createdAt || 0).getTime() || 0);
    });
}

function renderRequests() {
    const target = document.getElementById("requestList");
    if (!target) return;
    target.replaceChildren();
    const filtered = getFilteredRequests();
    filtered.forEach(request => target.appendChild(createRequestRow(request)));
    const empty = document.getElementById("requestEmpty");
    empty.hidden = filtered.length > 0;
    const hasFilters = document.getElementById("quickSearch").value || document.getElementById("filterStatus").value || document.getElementById("filterPriority").value;
    document.getElementById("requestEmptyTitle").textContent = hasFilters ? "No requests match" : "No requests yet";
    document.getElementById("requestEmptyCopy").textContent = hasFilters ? "Try changing or clearing your filters." : "Create a request to add it to your workspace.";
}

function renderRecentRequests() {
    const target = document.getElementById("recentRequestList");
    target.replaceChildren();
    const recent = [...requests].sort((left, right) => (new Date(right.createdAt || 0).getTime() || 0) - (new Date(left.createdAt || 0).getTime() || 0)).slice(0, 5);
    recent.forEach(request => target.appendChild(createRequestRow(request)));
    document.getElementById("recentEmpty").hidden = requests.length > 0;
}

function editRequest(request) {
    editingRequestId = request.id;
    document.getElementById("requester").value = request.requester || "";
    document.getElementById("requestTitle").value = request.title || "";
    document.getElementById("priority").value = request.priority || "Medium";
    document.getElementById("requestFormHeading").textContent = `Edit request #${request.id}`;
    document.getElementById("requestSubmitButton").textContent = "Save changes";
    document.getElementById("cancelEditButton").hidden = false;
    navigateTo("viewCreate");
}

async function toggleRequest(request) {
    const wasCompleted = request.status === "Completed";
    const status = wasCompleted ? "Pending" : "Completed";
    try {
        if (currentUser?.id) {
            Object.assign(request, (await requestApi("/api/requests", "PATCH", {
                id: request.id,
                requester: request.requester,
                title: request.title,
                priority: request.priority,
                status
            })).request);
        } else {
            request.status = status;
        }
    } catch (error) {
        showDashboardError(error.message);
        return;
    }
    const verb = wasCompleted ? "reopened" : "completed";
    addNotification(`Request ${request.id} ${verb}: ${request.title || "Untitled request"}`, request.id);
    updateDashboard(true);
}

async function deleteRequest(request) {
    if (!confirm(`Delete request #${request.id}? This cannot be undone.`)) return;
    try {
        if (currentUser?.id) await requestApi("/api/requests", "DELETE", { id: request.id });
        requests = requests.filter(item => String(item.id) !== String(request.id));
    } catch (error) {
        showDashboardError(error.message);
        return;
    }
    updateDashboard(true);
}

function showDetails(request) {
    const dialog = document.getElementById("detailsDialog");
    document.getElementById("detailsTitle").textContent = `Request ${displayRequestId(request.id)}`;
    const content = document.getElementById("detailContent");
    content.replaceChildren();
    const details = document.createElement("dl");
    details.className = "detail-grid";
    [["Requester", request.requester || "—"], ["Request", request.title || "Untitled request"], ["Priority", request.priority || "—"], ["Status", request.status || "Pending"], ["Created", formatDate(request.createdAt)]].forEach(([label, value]) => {
        const item = document.createElement("div");
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        item.appendChild(term);
        item.appendChild(description);
        details.appendChild(item);
    });
    content.appendChild(details);
    dialog.hidden = false;
    document.getElementById("closeDetailsButton").focus();
}

function closeDetails() {
    document.getElementById("detailsDialog").hidden = true;
}

function renderCharts() {
    const pending = requests.filter(request => request.status !== "Completed").length;
    const completed = requests.length - pending;
    ["statusChart", "analyticsStatusChart"].forEach(id => {
        const target = document.getElementById(id);
        target.replaceChildren();
        if (!requests.length) {
            const empty = document.createElement("p");
            empty.className = "chart-note";
            empty.textContent = "No request data yet.";
            target.appendChild(empty);
            return;
        }
        const total = requests.length;
        [["Pending", pending, "bar-pending"], ["Completed", completed, "bar-completed"]].forEach(([label, count, barClass]) => {
            const row = document.createElement("div");
            row.className = "chart-row";
            const name = document.createElement("span");
            name.textContent = label;
            const track = document.createElement("span");
            track.className = "chart-track";
            const bar = document.createElement("span");
            bar.className = `chart-bar ${barClass}`;
            bar.style.width = `${count / total * 100}%`;
            track.appendChild(bar);
            const value = document.createElement("span");
            value.className = "chart-value";
            value.textContent = String(count);
            row.appendChild(name);
            row.appendChild(track);
            row.appendChild(value);
            target.appendChild(row);
        });
    });
    ["priorityChart", "analyticsPriorityChart"].forEach(id => {
        const target = document.getElementById(id);
        target.replaceChildren();
        ["Low", "Medium", "High"].forEach(priority => {
            const count = requests.filter(request => request.priority === priority).length;
            const row = document.createElement("div");
            row.className = "priority-row";
            const name = document.createElement("span");
            name.textContent = priority;
            const track = document.createElement("span");
            track.className = "chart-track";
            const bar = document.createElement("span");
            bar.className = `chart-bar priority-${priority.toLowerCase()}`;
            bar.style.width = `${requests.length ? count / requests.length * 100 : 0}%`;
            track.appendChild(bar);
            const value = document.createElement("span");
            value.className = "chart-value";
            value.textContent = String(count);
            row.appendChild(name);
            row.appendChild(track);
            row.appendChild(value);
            target.appendChild(row);
        });
    });
    renderActivityChart();
}

function renderActivityChart() {
    const target = document.getElementById("activityChart");
    target.replaceChildren();
    const days = [];
    for (let offset = 6; offset >= 0; offset--) {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - offset);
        days.push(date);
    }
    const datedRequests = requests.filter(request => request.createdAt && !Number.isNaN(new Date(request.createdAt).getTime()));
    const counts = days.map(day => datedRequests.filter(request => {
        const created = new Date(request.createdAt);
        return created.getFullYear() === day.getFullYear() && created.getMonth() === day.getMonth() && created.getDate() === day.getDate();
    }).length);
    const maximum = Math.max(...counts, 1);
    days.forEach((day, index) => {
        const item = document.createElement("div");
        item.className = "activity-day";
        const column = document.createElement("span");
        column.className = "activity-column";
        column.style.height = `${Math.max(3, counts[index] / maximum * 100)}%`;
        column.setAttribute("aria-label", `${counts[index]} requests`);
        const label = document.createElement("span");
        label.textContent = day.toLocaleDateString(undefined, { weekday: "short" });
        item.appendChild(column);
        item.appendChild(label);
        target.appendChild(item);
    });
    document.getElementById("activityNote").textContent = datedRequests.length
        ? "Daily totals are based on request creation dates from the last seven days."
        : "No request creation dates are available yet.";
}

function renderNotifications() {
    const target = document.getElementById("notificationList");
    if (!target) return;
    target.replaceChildren();
    const unreadCount = notifications.filter(notification => !notification.read).length;
    document.getElementById("notificationDot").hidden = unreadCount === 0;
    const sidebarCount = document.getElementById("sidebarUnreadCount");
    sidebarCount.textContent = String(unreadCount);
    sidebarCount.hidden = unreadCount === 0;
    document.getElementById("notificationEmpty").hidden = notifications.length > 0;
    document.getElementById("markAllReadButton").disabled = unreadCount === 0;
    notifications.forEach(notification => {
        const item = document.createElement("article");
        item.className = `notification-item${notification.read ? "" : " unread"}`;
        const indicator = document.createElement("span");
        indicator.className = "notification-indicator";
        const copy = document.createElement("div");
        copy.className = "notification-copy";
        const message = document.createElement("p");
        message.textContent = notification.message || "Request activity";
        const date = document.createElement("time");
        date.textContent = formatDate(notification.createdAt);
        copy.appendChild(message);
        copy.appendChild(date);
        item.appendChild(indicator);
        item.appendChild(copy);
        if (!notification.read) {
            item.appendChild(makeActionButton("Mark read", "notification-read", () => {
                notification.read = true;
                updateDashboard(true);
            }));
        }
        target.appendChild(item);
    });
}

const storedToken = sessionStorage.getItem("assistToken");
checkRegistrationAvailability();
if (storedToken) {
    showDashboard(storedToken).catch(() => showLogin("Unable to reach the server. Please sign in again."));
} else {
    showLogin();
}

