import { handleRequest } from "./handler.js";

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
