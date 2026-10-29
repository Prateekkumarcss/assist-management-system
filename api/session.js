import { handleSession } from "../lib/auth.js";

export default {
    fetch(request) {
        return handleSession(request);
    }
};
