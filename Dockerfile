FROM node:22-alpine AS build

WORKDIR /app

# 依赖在镜像构建阶段从 npm 拉取
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine

WORKDIR /app

# 最终镜像只保留构建后的运行文件
COPY --from=build /app/dist/ /app/

ENV HOST=0.0.0.0 \
    PORT=3000 \
    POPIPA_STATE=/data/state.json

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/state >/dev/null || exit 1

CMD ["node", "server.js"]
