FROM node:22-alpine

WORKDIR /app

# 只复制运行所需的预构建产物（dist 已包含 HTML / JS / CSS / vendor）
COPY dist/ /app/

ENV HOST=0.0.0.0 \
    PORT=3000 \
    POPIPA_STATE=/data/state.json

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/state >/dev/null || exit 1

CMD ["node", "server.js"]
