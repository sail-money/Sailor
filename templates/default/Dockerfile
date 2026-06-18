FROM node:20-slim
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Seconds between runs. Tune to your strategy: 60 = per-minute, 300 = 5 min, 86400 = daily.
ENV AGENT_INTERVAL=300

CMD ["sh", "-c", "\
  mkdir -p .sail/keys && \
  cp ci-keystore.json .sail/keys/manager.json && \
  while true; do \
    npx sailor run --once; \
    sleep ${AGENT_INTERVAL}; \
  done"]
