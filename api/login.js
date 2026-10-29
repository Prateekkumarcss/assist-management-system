import { handleLogin } from "../lib/auth.js";

export default {
    fetch(request) {
        return handleLogin(request);
    }
};
