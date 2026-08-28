# Just Node + git - no SSH client/known_hosts, since push auth is an
# HTTPS token supplied per-invocation (see push.js), not SSH.
FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /workspace
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "run", "publish"]
